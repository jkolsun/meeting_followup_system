import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './schema';
import { Meeting, ReminderJob, ReminderType, MeetingWithReminders } from '../types';

// ============ Meeting Repository ============

export function createMeeting(data: {
  clientName: string;
  clientEmail: string;
  meetingTitle: string;
  scheduledAt: Date;
}): Meeting {
  const db = getDatabase();
  const id = uuidv4();
  const confirmationToken = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO meetings (id, client_name, client_email, meeting_title, scheduled_at, confirmation_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.clientName,
    data.clientEmail,
    data.meetingTitle,
    data.scheduledAt.toISOString(),
    confirmationToken,
    now,
    now
  );

  return getMeetingById(id)!;
}

export function getMeetingById(id: string): Meeting | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as any;
  return row ? mapRowToMeeting(row) : null;
}

export function getMeetingByToken(token: string): Meeting | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM meetings WHERE confirmation_token = ?').get(token) as any;
  return row ? mapRowToMeeting(row) : null;
}

export function getMeetingWithReminders(meetingId: string): MeetingWithReminders | null {
  const meeting = getMeetingById(meetingId);
  if (!meeting) return null;

  const reminders = getRemindersByMeetingId(meetingId);
  return { ...meeting, reminders };
}

export function confirmMeeting(meetingId: string): Meeting | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE meetings SET confirmed_at = ?, updated_at = ? WHERE id = ? AND confirmed_at IS NULL
  `).run(now, now, meetingId);

  return getMeetingById(meetingId);
}

export function cancelMeeting(meetingId: string): Meeting | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE meetings SET cancelled_at = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL
  `).run(now, now, meetingId);

  return getMeetingById(meetingId);
}

export function getUpcomingMeetings(): Meeting[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM meetings
    WHERE scheduled_at > datetime('now')
    AND cancelled_at IS NULL
    ORDER BY scheduled_at ASC
  `).all() as any[];

  return rows.map(mapRowToMeeting);
}

export function getUnconfirmedMeetings(): Meeting[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM meetings
    WHERE confirmed_at IS NULL
    AND cancelled_at IS NULL
    AND scheduled_at > datetime('now')
    ORDER BY scheduled_at ASC
  `).all() as any[];

  return rows.map(mapRowToMeeting);
}

function mapRowToMeeting(row: any): Meeting {
  return {
    id: row.id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    meetingTitle: row.meeting_title,
    scheduledAt: new Date(row.scheduled_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    confirmationToken: row.confirmation_token,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============ Reminder Repository ============

export function createReminder(data: {
  meetingId: string;
  reminderType: ReminderType;
  scheduledFor: Date;
  jobId?: string;
}): ReminderJob {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO reminder_jobs (id, meeting_id, reminder_type, scheduled_for, job_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.meetingId,
    data.reminderType,
    data.scheduledFor.toISOString(),
    data.jobId || null,
    now
  );

  return getReminderById(id)!;
}

export function getReminderById(id: string): ReminderJob | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM reminder_jobs WHERE id = ?').get(id) as any;
  return row ? mapRowToReminder(row) : null;
}

export function getRemindersByMeetingId(meetingId: string): ReminderJob[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM reminder_jobs WHERE meeting_id = ? ORDER BY scheduled_for ASC').all(meetingId) as any[];
  return rows.map(mapRowToReminder);
}

export function updateReminderJobId(reminderId: string, jobId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE reminder_jobs SET job_id = ? WHERE id = ?').run(jobId, reminderId);
}

export function markReminderSent(reminderId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE reminder_jobs SET sent_at = ? WHERE id = ?').run(now, reminderId);
}

export function getCancellableReminders(meetingId: string): ReminderJob[] {
  const db = getDatabase();
  // Get all reminders except the 1_hour reminder (that one always sends)
  const rows = db.prepare(`
    SELECT * FROM reminder_jobs
    WHERE meeting_id = ?
    AND reminder_type != '1_hour'
    AND sent_at IS NULL
  `).all(meetingId) as any[];

  return rows.map(mapRowToReminder);
}

function mapRowToReminder(row: any): ReminderJob {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    reminderType: row.reminder_type as ReminderType,
    scheduledFor: new Date(row.scheduled_for),
    jobId: row.job_id,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    createdAt: new Date(row.created_at),
  };
}

// ============ Email Thread Repository ============

export function createEmailThread(data: {
  meetingId: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
}): void {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO email_threads (id, meeting_id, gmail_thread_id, gmail_message_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.meetingId, data.gmailThreadId || null, data.gmailMessageId || null, now);
}

export function getMeetingByThreadId(threadId: string): Meeting | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT m.* FROM meetings m
    JOIN email_threads et ON et.meeting_id = m.id
    WHERE et.gmail_thread_id = ?
  `).get(threadId) as any;

  return row ? mapRowToMeeting(row) : null;
}

export function updateEmailThreadIds(meetingId: string, threadId: string, messageId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE email_threads SET gmail_thread_id = ?, gmail_message_id = ? WHERE meeting_id = ?
  `).run(threadId, messageId, meetingId);
}
