import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { ReminderJobData, ReminderType, REMINDER_OFFSETS, REMINDER_TYPES } from '../types';
import {
  getMeetingById,
  getReminderById,
  createReminder,
  updateReminderJobId,
  markReminderSent,
  getCancellableReminders,
  cancelMeeting,
} from '../db/repositories';
import { sendReminderEmail, sendCancellationEmail } from '../services/email';

const QUEUE_NAME = 'meeting-reminders';

// Create the queue
export const reminderQueue = new Queue<ReminderJobData>(QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Schedule all reminders for a meeting
export async function scheduleRemindersForMeeting(meetingId: string): Promise<void> {
  const meeting = getMeetingById(meetingId);
  if (!meeting) {
    throw new Error(`Meeting not found: ${meetingId}`);
  }

  const meetingTime = meeting.scheduledAt.getTime();
  const now = Date.now();

  for (const reminderType of REMINDER_TYPES) {
    const offset = REMINDER_OFFSETS[reminderType];
    const scheduledFor = new Date(meetingTime - offset);

    // Skip if the reminder time has already passed
    if (scheduledFor.getTime() <= now) {
      console.log(`Skipping ${reminderType} reminder for meeting ${meetingId} - time already passed`);
      continue;
    }

    // Create the reminder record
    const reminder = createReminder({
      meetingId,
      reminderType,
      scheduledFor,
    });

    // Calculate delay in milliseconds
    const delay = scheduledFor.getTime() - now;

    // Add job to the queue
    const job = await reminderQueue.add(
      `reminder-${reminderType}`,
      {
        meetingId,
        reminderType,
        reminderId: reminder.id,
      },
      {
        delay,
        jobId: `${meetingId}-${reminderType}`, // Unique job ID for easy cancellation
      }
    );

    // Update the reminder with the job ID
    updateReminderJobId(reminder.id, job.id!);

    console.log(`Scheduled ${reminderType} reminder for meeting ${meetingId} at ${scheduledFor.toISOString()}`);
  }
}

// Cancel all reminders except the 1-hour one
export async function cancelRemindersForMeeting(meetingId: string): Promise<void> {
  const reminders = getCancellableReminders(meetingId);

  for (const reminder of reminders) {
    if (reminder.jobId) {
      try {
        const job = await reminderQueue.getJob(reminder.jobId);
        if (job) {
          await job.remove();
          console.log(`Cancelled ${reminder.reminderType} reminder for meeting ${meetingId}`);
        }
      } catch (error) {
        console.error(`Failed to cancel job ${reminder.jobId}:`, error);
      }
    }
  }
}

// Create the worker that processes reminder jobs
export function createReminderWorker(): Worker<ReminderJobData> {
  const worker = new Worker<ReminderJobData>(
    QUEUE_NAME,
    async (job: Job<ReminderJobData>) => {
      const { meetingId, reminderType, reminderId } = job.data;

      console.log(`Processing ${reminderType} reminder for meeting ${meetingId}`);

      const meeting = getMeetingById(meetingId);
      if (!meeting) {
        console.log(`Meeting ${meetingId} not found, skipping reminder`);
        return;
      }

      // Check if meeting was cancelled
      if (meeting.cancelledAt) {
        console.log(`Meeting ${meetingId} was cancelled, skipping reminder`);
        return;
      }

      // Handle different reminder types
      if (reminderType === '30_minutes') {
        // This is the final check - if not confirmed, cancel the meeting
        if (!meeting.confirmedAt) {
          console.log(`Meeting ${meetingId} not confirmed by 30 minutes before - cancelling`);
          await sendCancellationEmail(meeting);
          cancelMeeting(meetingId);
          return;
        }
      }

      // For 1_hour reminder, always send regardless of confirmation status
      // For other reminders, only send if not already confirmed (they want confirmation)
      if (reminderType === '1_hour' || !meeting.confirmedAt) {
        await sendReminderEmail(meeting, reminderType);
        markReminderSent(reminderId);
      } else {
        console.log(`Meeting ${meetingId} already confirmed, skipping ${reminderType} reminder`);
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id} failed:`, error);
  });

  return worker;
}
