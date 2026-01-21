import { Router, Request, Response } from 'express';
import {
  createMeeting,
  getMeetingById,
  getMeetingWithReminders,
  getUpcomingMeetings,
  getUnconfirmedMeetings,
  cancelMeeting,
} from '../db/repositories';
import { scheduleRemindersForMeeting, cancelRemindersForMeeting } from '../jobs/queue';

const router = Router();

// Create a new meeting and schedule reminders
router.post('/meetings', async (req: Request, res: Response) => {
  try {
    const { clientName, clientEmail, meetingTitle, scheduledAt, assignedUserId } = req.body;

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
    });

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

// Manually confirm a meeting (admin endpoint)
router.post('/meetings/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meeting = await getMeetingById(id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.cancelledAt) {
      return res.status(400).json({ error: 'Cannot confirm a cancelled meeting' });
    }

    if (meeting.confirmedAt) {
      return res.status(400).json({ error: 'Meeting already confirmed' });
    }

    // Import and use confirmMeeting
    const { confirmMeeting: confirm } = await import('../db/repositories');
    const confirmedMeeting = await confirm(id);

    // Cancel pending reminders except 1-hour
    await cancelRemindersForMeeting(id);

    console.log(`Meeting ${id} manually confirmed`);

    return res.json({
      success: true,
      meeting: confirmedMeeting,
    });
  } catch (error) {
    console.error('Error confirming meeting:', error);
    return res.status(500).json({ error: 'Failed to confirm meeting' });
  }
});

export default router;
