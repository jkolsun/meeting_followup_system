import { Router, Request, Response } from 'express';
import {
  createMeeting,
  getMeetingById,
  getMeetingWithReminders,
  getUpcomingMeetings,
  getUnconfirmedMeetings,
  cancelMeeting,
  getRecentEmailActivityWithMeetings,
  getEmailActivityByMeetingId,
  getRemindersByMeetingId,
} from '../db/repositories';
import { scheduleRemindersForMeeting, cancelRemindersForMeeting, reminderQueue } from '../jobs/queue';
import { sendBookingConfirmationEmail } from '../services/email';

const router = Router();

// Create a new meeting and schedule reminders
router.post('/meetings', async (req: Request, res: Response) => {
  try {
    const { clientName, clientEmail, meetingTitle, scheduledAt, assignedUserId, zoomLink } = req.body;

    // Validate required fields
    if (!clientName || !clientEmail || !meetingTitle || !scheduledAt) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientName', 'clientEmail', 'meetingTitle', 'scheduledAt'],
      });
    }

    // Parse and validate the date
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format for scheduledAt' });
    }

    // Ensure meeting is in the future
    if (scheduledDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Meeting must be scheduled in the future' });
    }

    // Create the meeting
    const meeting = await createMeeting({
      clientName,
      clientEmail,
      meetingTitle,
      scheduledAt: scheduledDate,
      assignedUserId: assignedUserId || undefined,
      zoomLink: zoomLink || undefined,
    });

    // Send immediate booking confirmation email
    try {
      await sendBookingConfirmationEmail(meeting);
    } catch (emailError) {
      console.error('Failed to send booking confirmation email:', emailError);
      // Don't fail the meeting creation if email fails - it's logged in activity
    }

    // Schedule all reminder jobs
    await scheduleRemindersForMeeting(meeting.id);

    console.log(`Created meeting ${meeting.id} for ${clientEmail} at ${scheduledDate.toISOString()}`);

    return res.status(201).json({
      success: true,
      meeting: {
        id: meeting.id,
        clientName: meeting.clientName,
        clientEmail: meeting.clientEmail,
        meetingTitle: meeting.meetingTitle,
        scheduledAt: meeting.scheduledAt.toISOString(),
        confirmationToken: meeting.confirmationToken,
        assignedUserId: meeting.assignedUserId,
        zoomLink: meeting.zoomLink,
      },
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    return res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Get a specific meeting with its reminders
router.get('/meetings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meeting = await getMeetingWithReminders(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    return res.json({ meeting });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    return res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

// Get all upcoming meetings
router.get('/meetings', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;

    let meetings;
    if (status === 'unconfirmed') {
      meetings = await getUnconfirmedMeetings();
    } else {
      meetings = await getUpcomingMeetings();
    }

    return res.json({ meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    return res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// Manually cancel a meeting
router.post('/meetings/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meeting = await getMeetingById(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.cancelledAt) {
      return res.status(400).json({ error: 'Meeting already cancelled' });
    }

    // Cancel all pending reminder jobs
    await cancelRemindersForMeeting(id);

    // Mark meeting as cancelled
    const cancelledMeeting = await cancelMeeting(id);

    console.log(`Meeting ${id} manually cancelled`);

    return res.json({
      success: true,
      meeting: cancelledMeeting,
    });
  } catch (error) {
    console.error('Error cancelling meeting:', error);
    return res.status(500).json({ error: 'Failed to cancel meeting' });
  }
});

// Get email activity log
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const activity = await getRecentEmailActivityWithMeetings(limit);

    return res.json({ activity });
  } catch (error) {
    console.error('Error fetching activity:', error);
    return res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// Get email activity for a specific meeting
router.get('/meetings/:id/activity', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meeting = await getMeetingById(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const activity = await getEmailActivityByMeetingId(id);
    return res.json({ activity });
  } catch (error) {
    console.error('Error fetching meeting activity:', error);
    return res.status(500).json({ error: 'Failed to fetch meeting activity' });
  }
});

// Debug endpoint to check queue status
router.get('/debug/queue', async (req: Request, res: Response) => {
  try {
    const [waiting, active, delayed, completed, failed] = await Promise.all([
      reminderQueue.getWaitingCount(),
      reminderQueue.getActiveCount(),
      reminderQueue.getDelayedCount(),
      reminderQueue.getCompletedCount(),
      reminderQueue.getFailedCount(),
    ]);

    // Get delayed jobs details
    const delayedJobs = await reminderQueue.getDelayed(0, 20);
    const delayedDetails = delayedJobs.map(job => ({
      id: job.id,
      name: job.name,
      data: job.data,
      delay: job.opts.delay,
      processAt: new Date(job.timestamp + (job.opts.delay || 0)).toISOString(),
    }));

    // Get failed jobs details
    const failedJobs = await reminderQueue.getFailed(0, 10);
    const failedDetails = failedJobs.map(job => ({
      id: job.id,
      name: job.name,
      data: job.data,
      failedReason: job.failedReason,
    }));

    return res.json({
      counts: { waiting, active, delayed, completed, failed },
      delayedJobs: delayedDetails,
      failedJobs: failedDetails,
    });
  } catch (error) {
    console.error('Error checking queue:', error);
    return res.status(500).json({ error: 'Failed to check queue', details: String(error) });
  }
});

// Debug endpoint to check reminders for a meeting
router.get('/debug/meeting/:id/reminders', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meeting = await getMeetingById(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const reminders = await getRemindersByMeetingId(id);

    return res.json({
      meeting: {
        id: meeting.id,
        clientName: meeting.clientName,
        scheduledAt: meeting.scheduledAt,
        confirmedAt: meeting.confirmedAt,
        cancelledAt: meeting.cancelledAt,
      },
      reminders: reminders.map(r => ({
        ...r,
        scheduledFor: r.scheduledFor,
        isPast: new Date(r.scheduledFor) < new Date(),
      })),
    });
  } catch (error) {
    console.error('Error checking reminders:', error);
    return res.status(500).json({ error: 'Failed to check reminders' });
  }
});

export default router;
