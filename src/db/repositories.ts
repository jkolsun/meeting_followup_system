import { queryAll, queryOne, execute, uuidv4 } from './database';
import { Meeting, ReminderJob, ReminderType, MeetingWithReminders, User, EmailTemplate, TemplateType } from '../types';

// ============ Meeting Repository ============

export async function createMeeting(data: {
  clientName: string;
  clientEmail: string;
  meetingTitle: string;
  scheduledAt: Date;
  assignedUserId?: string;
}): Promise<Meeting> {
  const id = uuidv4();
  const confirmationToken = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO meetings (id, client_name, client_email, meeting_title, scheduled_at, confirmation_token, assigned_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.clientName, data.clientEmail, data.meetingTitle, data.scheduledAt.toISOString(), confirmationToken, data.assignedUserId || null, now, now]
  );

  return (await getMeetingById(id))!;
}

export async function getMeetingById(id: string): Promise<Meeting | null> {
  const row = await queryOne('SELECT * FROM meetings WHERE id = ?', [id]);
  return row ? mapRowToMeeting(row) : null;
}

export async function getMeetingByToken(token: string): Promise<Meeting | null> {
  const row = await queryOne('SELECT * FROM meetings WHERE confirmation_token = ?', [token]);
  return row ? mapRowToMeeting(row) : null;
}

export async function getMeetingWithReminders(meetingId: string): Promise<MeetingWithReminders | null> {
  const meeting = await getMeetingById(meetingId);
  if (!meeting) return null;

  const reminders = await getRemindersByMeetingId(meetingId);
  return { ...meeting, reminders };
}

export async function confirmMeeting(meetingId: string): Promise<Meeting | null> {
  const now = new Date().toISOString();
  await execute(
    `UPDATE meetings SET confirmed_at = ?, updated_at = ? WHERE id = ? AND confirmed_at IS NULL`,
    [now, now, meetingId]
  );
  return getMeetingById(meetingId);
}

export async function cancelMeeting(meetingId: string): Promise<Meeting | null> {
  const now = new Date().toISOString();
  await execute(
    `UPDATE meetings SET cancelled_at = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL`,
    [now, now, meetingId]
  );
  return getMeetingById(meetingId);
}

export async function getUpcomingMeetings(): Promise<Meeting[]> {
  const now = new Date().toISOString();
  const rows = await queryAll(
    `SELECT * FROM meetings WHERE scheduled_at > ? AND cancelled_at IS NULL ORDER BY scheduled_at ASC`,
    [now]
  );
  return rows.map(mapRowToMeeting);
}

export async function getUnconfirmedMeetings(): Promise<Meeting[]> {
  const now = new Date().toISOString();
  const rows = await queryAll(
    `SELECT * FROM meetings WHERE confirmed_at IS NULL AND cancelled_at IS NULL AND scheduled_at > ? ORDER BY scheduled_at ASC`,
    [now]
  );
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
    assignedUserId: row.assigned_user_id || null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============ Reminder Repository ============

export async function createReminder(data: {
  meetingId: string;
  reminderType: ReminderType;
  scheduledFor: Date;
  jobId?: string;
}): Promise<ReminderJob> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO reminder_jobs (id, meeting_id, reminder_type, scheduled_for, job_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.meetingId, data.reminderType, data.scheduledFor.toISOString(), data.jobId || null, now]
  );

  return (await getReminderById(id))!;
}

export async function getReminderById(id: string): Promise<ReminderJob | null> {
  const row = await queryOne('SELECT * FROM reminder_jobs WHERE id = ?', [id]);
  return row ? mapRowToReminder(row) : null;
}

export async function getRemindersByMeetingId(meetingId: string): Promise<ReminderJob[]> {
  const rows = await queryAll('SELECT * FROM reminder_jobs WHERE meeting_id = ? ORDER BY scheduled_for ASC', [meetingId]);
  return rows.map(mapRowToReminder);
}

export async function updateReminderJobId(reminderId: string, jobId: string): Promise<void> {
  await execute('UPDATE reminder_jobs SET job_id = ? WHERE id = ?', [jobId, reminderId]);
}

export async function markReminderSent(reminderId: string): Promise<void> {
  const now = new Date().toISOString();
  await execute('UPDATE reminder_jobs SET sent_at = ? WHERE id = ?', [now, reminderId]);
}

export async function getCancellableReminders(meetingId: string): Promise<ReminderJob[]> {
  const rows = await queryAll(
    `SELECT * FROM reminder_jobs WHERE meeting_id = ? AND reminder_type != '1_hour' AND sent_at IS NULL`,
    [meetingId]
  );
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

export async function createEmailThread(data: {
  meetingId: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
}): Promise<void> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO email_threads (id, meeting_id, gmail_thread_id, gmail_message_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.meetingId, data.gmailThreadId || null, data.gmailMessageId || null, now]
  );
}

export async function getMeetingByThreadId(threadId: string): Promise<Meeting | null> {
  const row = await queryOne(
    `SELECT m.* FROM meetings m JOIN email_threads et ON et.meeting_id = m.id WHERE et.gmail_thread_id = ?`,
    [threadId]
  );
  return row ? mapRowToMeeting(row) : null;
}

export async function updateEmailThreadIds(meetingId: string, threadId: string, messageId: string): Promise<void> {
  await execute(
    `UPDATE email_threads SET gmail_thread_id = ?, gmail_message_id = ? WHERE meeting_id = ?`,
    [threadId, messageId, meetingId]
  );
}

// ============ User Repository ============

export async function createUser(data: {
  name: string;
  email: string;
  gmailRefreshToken?: string;
}): Promise<User> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO users (id, name, email, gmail_refresh_token, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [id, data.name, data.email, data.gmailRefreshToken || null, now]
  );

  return (await getUserById(id))!;
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
  return row ? mapRowToUser(row) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const row = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  return row ? mapRowToUser(row) : null;
}

export async function getAllUsers(): Promise<User[]> {
  const rows = await queryAll('SELECT * FROM users ORDER BY created_at ASC');
  return rows.map(mapRowToUser);
}

export async function getActiveUsers(): Promise<User[]> {
  const rows = await queryAll('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at ASC');
  return rows.map(mapRowToUser);
}

export async function updateUserGmailToken(userId: string, refreshToken: string): Promise<void> {
  await execute(
    `UPDATE users SET gmail_refresh_token = ? WHERE id = ?`,
    [refreshToken, userId]
  );
}

export async function updateUser(userId: string, data: { name?: string; email?: string; isActive?: boolean }): Promise<User | null> {
  const updates: string[] = [];
  const params: any[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    params.push(data.name);
  }
  if (data.email !== undefined) {
    updates.push('email = ?');
    params.push(data.email);
  }
  if (data.isActive !== undefined) {
    updates.push('is_active = ?');
    params.push(data.isActive ? 1 : 0);
  }

  if (updates.length === 0) return getUserById(userId);

  params.push(userId);
  await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  return getUserById(userId);
}

export async function deleteUser(userId: string): Promise<void> {
  await execute('DELETE FROM users WHERE id = ?', [userId]);
}

function mapRowToUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    gmailRefreshToken: row.gmail_refresh_token || null,
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: new Date(row.created_at),
  };
}

// ============ Email Template Repository ============

export async function createEmailTemplate(data: {
  userId: string;
  templateType: TemplateType;
  subject: string;
  htmlBody: string;
  textBody: string;
}): Promise<EmailTemplate> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO email_templates (id, user_id, template_type, subject, html_body, text_body, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.userId, data.templateType, data.subject, data.htmlBody, data.textBody, now]
  );

  return (await getEmailTemplateById(id))!;
}

export async function getEmailTemplateById(id: string): Promise<EmailTemplate | null> {
  const row = await queryOne('SELECT * FROM email_templates WHERE id = ?', [id]);
  return row ? mapRowToEmailTemplate(row) : null;
}

export async function getEmailTemplate(userId: string, templateType: TemplateType): Promise<EmailTemplate | null> {
  const row = await queryOne(
    'SELECT * FROM email_templates WHERE user_id = ? AND template_type = ?',
    [userId, templateType]
  );
  return row ? mapRowToEmailTemplate(row) : null;
}

export async function getEmailTemplatesByUserId(userId: string): Promise<EmailTemplate[]> {
  const rows = await queryAll('SELECT * FROM email_templates WHERE user_id = ? ORDER BY template_type', [userId]);
  return rows.map(mapRowToEmailTemplate);
}

export async function updateEmailTemplate(templateId: string, data: {
  subject?: string;
  htmlBody?: string;
  textBody?: string;
}): Promise<EmailTemplate | null> {
  const updates: string[] = [];
  const params: any[] = [];

  if (data.subject !== undefined) {
    updates.push('subject = ?');
    params.push(data.subject);
  }
  if (data.htmlBody !== undefined) {
    updates.push('html_body = ?');
    params.push(data.htmlBody);
  }
  if (data.textBody !== undefined) {
    updates.push('text_body = ?');
    params.push(data.textBody);
  }

  if (updates.length === 0) return getEmailTemplateById(templateId);

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(templateId);

  await execute(`UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`, params);

  return getEmailTemplateById(templateId);
}

export async function deleteEmailTemplate(templateId: string): Promise<void> {
  await execute('DELETE FROM email_templates WHERE id = ?', [templateId]);
}

export async function deleteEmailTemplatesByUserId(userId: string): Promise<void> {
  await execute('DELETE FROM email_templates WHERE user_id = ?', [userId]);
}

function mapRowToEmailTemplate(row: any): EmailTemplate {
  return {
    id: row.id,
    userId: row.user_id,
    templateType: row.template_type as TemplateType,
    subject: row.subject,
    htmlBody: row.html_body,
    textBody: row.text_body,
    updatedAt: new Date(row.updated_at),
  };
}
