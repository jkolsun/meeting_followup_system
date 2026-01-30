import { queryAll, queryOne, execute, uuidv4 } from './database';
import { Meeting, ReminderJob, ReminderType, MeetingWithReminders, User, EmailTemplate, TemplateType, EmailActivity, EmailActivityType, EmailActivityStatus, Organization, PlanType, UserRole } from '../types';

// ============ Organization Repository ============

export async function createOrganization(data: {
  name: string;
  slug: string;
  ownerAuthId: string;
  logoUrl?: string;
  primaryColor?: string;
}): Promise<Organization> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO organizations (id, name, slug, owner_auth_id, logo_url, primary_color, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'free', ?, ?)`,
    [id, data.name, data.slug, data.ownerAuthId, data.logoUrl || null, data.primaryColor || '#4A8B8B', now, now]
  );

  return (await getOrganizationById(id))!;
}

export async function getOrganizationById(id: string): Promise<Organization | null> {
  const row = await queryOne('SELECT * FROM organizations WHERE id = ?', [id]);
  return row ? mapRowToOrganization(row) : null;
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const row = await queryOne('SELECT * FROM organizations WHERE slug = ?', [slug]);
  return row ? mapRowToOrganization(row) : null;
}

export async function getOrganizationByOwnerAuthId(authId: string): Promise<Organization | null> {
  const row = await queryOne('SELECT * FROM organizations WHERE owner_auth_id = ?', [authId]);
  return row ? mapRowToOrganization(row) : null;
}

export async function updateOrganization(orgId: string, data: {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  googleCalendarConnected?: boolean;
  googleCalendarRefreshToken?: string;
  timezone?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  plan?: PlanType;
}): Promise<Organization | null> {
  const updates: string[] = [];
  const params: any[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    params.push(data.name);
  }
  if (data.logoUrl !== undefined) {
    updates.push('logo_url = ?');
    params.push(data.logoUrl);
  }
  if (data.primaryColor !== undefined) {
    updates.push('primary_color = ?');
    params.push(data.primaryColor);
  }
  if (data.googleCalendarConnected !== undefined) {
    updates.push('google_calendar_connected = ?');
    params.push(data.googleCalendarConnected ? 1 : 0);
  }
  if (data.googleCalendarRefreshToken !== undefined) {
    updates.push('google_calendar_refresh_token = ?');
    params.push(data.googleCalendarRefreshToken);
  }
  if (data.timezone !== undefined) {
    updates.push('timezone = ?');
    params.push(data.timezone);
  }
  if (data.stripeCustomerId !== undefined) {
    updates.push('stripe_customer_id = ?');
    params.push(data.stripeCustomerId);
  }
  if (data.stripeSubscriptionId !== undefined) {
    updates.push('stripe_subscription_id = ?');
    params.push(data.stripeSubscriptionId);
  }
  if (data.plan !== undefined) {
    updates.push('plan = ?');
    params.push(data.plan);
  }

  if (updates.length === 0) return getOrganizationById(orgId);

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(orgId);

  await execute(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`, params);
  return getOrganizationById(orgId);
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await execute('DELETE FROM organizations WHERE id = ?', [orgId]);
}

function mapRowToOrganization(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url || null,
    primaryColor: row.primary_color || '#4A8B8B',
    ownerAuthId: row.owner_auth_id,
    googleCalendarConnected: row.google_calendar_connected === 1 || row.google_calendar_connected === true,
    googleCalendarRefreshToken: row.google_calendar_refresh_token || null,
    timezone: row.timezone || 'America/New_York',
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    plan: (row.plan || 'free') as PlanType,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============ Meeting Repository ============

export async function createMeeting(data: {
  clientName: string;
  clientEmail: string;
  meetingTitle: string;
  scheduledAt: Date;
  assignedUserId?: string;
  organizationId?: string;
  googleCalendarEventId?: string;
  zoomLink?: string;
}): Promise<Meeting> {
  const id = uuidv4();
  const confirmationToken = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO meetings (id, organization_id, client_name, client_email, meeting_title, scheduled_at, confirmation_token, assigned_user_id, google_calendar_event_id, zoom_link, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.organizationId || null, data.clientName, data.clientEmail, data.meetingTitle, data.scheduledAt.toISOString(), confirmationToken, data.assignedUserId || null, data.googleCalendarEventId || null, data.zoomLink || null, now, now]
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

export async function getMeetingsByOrganizationId(orgId: string): Promise<Meeting[]> {
  const now = new Date().toISOString();
  const rows = await queryAll(
    `SELECT * FROM meetings WHERE organization_id = ? AND scheduled_at > ? AND cancelled_at IS NULL ORDER BY scheduled_at ASC`,
    [orgId, now]
  );
  return rows.map(mapRowToMeeting);
}

function mapRowToMeeting(row: any): Meeting {
  return {
    id: row.id,
    organizationId: row.organization_id || null,
    clientName: row.client_name,
    clientEmail: row.client_email,
    meetingTitle: row.meeting_title,
    scheduledAt: new Date(row.scheduled_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    confirmationToken: row.confirmation_token,
    assignedUserId: row.assigned_user_id || null,
    googleCalendarEventId: row.google_calendar_event_id || null,
    zoomLink: row.zoom_link || null,
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
  organizationId?: string;
  authId?: string;
  role?: UserRole;
  gmailRefreshToken?: string;
}): Promise<User> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO users (id, organization_id, auth_id, name, email, role, gmail_refresh_token, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, data.organizationId || null, data.authId || null, data.name, data.email, data.role || 'member', data.gmailRefreshToken || null, now]
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

export async function getUserByAuthId(authId: string): Promise<User | null> {
  const row = await queryOne('SELECT * FROM users WHERE auth_id = ?', [authId]);
  return row ? mapRowToUser(row) : null;
}

export async function getUsersByOrganizationId(orgId: string): Promise<User[]> {
  const rows = await queryAll('SELECT * FROM users WHERE organization_id = ? ORDER BY created_at ASC', [orgId]);
  return rows.map(mapRowToUser);
}

export async function getActiveUsersByOrganizationId(orgId: string): Promise<User[]> {
  const rows = await queryAll('SELECT * FROM users WHERE organization_id = ? AND is_active = 1 ORDER BY created_at ASC', [orgId]);
  return rows.map(mapRowToUser);
}

function mapRowToUser(row: any): User {
  return {
    id: row.id,
    organizationId: row.organization_id || null,
    authId: row.auth_id || null,
    name: row.name,
    email: row.email,
    role: (row.role || 'member') as UserRole,
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

// ============ Email Activity Repository ============

export async function createEmailActivity(data: {
  meetingId: string;
  activityType: EmailActivityType;
  recipientEmail: string;
  subject: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  status: EmailActivityStatus;
  errorMessage?: string;
}): Promise<EmailActivity> {
  const id = uuidv4();
  const trackingToken = uuidv4(); // Generate unique tracking token for email open tracking
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO email_activity (id, meeting_id, activity_type, recipient_email, subject, gmail_message_id, gmail_thread_id, status, error_message, tracking_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.meetingId, data.activityType, data.recipientEmail, data.subject, data.gmailMessageId || null, data.gmailThreadId || null, data.status, data.errorMessage || null, trackingToken, now]
  );

  return (await getEmailActivityById(id))!;
}

export async function getEmailActivityById(id: string): Promise<EmailActivity | null> {
  const row = await queryOne('SELECT * FROM email_activity WHERE id = ?', [id]);
  return row ? mapRowToEmailActivity(row) : null;
}

export async function getEmailActivityByMeetingId(meetingId: string): Promise<EmailActivity[]> {
  const rows = await queryAll('SELECT * FROM email_activity WHERE meeting_id = ? ORDER BY created_at DESC', [meetingId]);
  return rows.map(mapRowToEmailActivity);
}

export async function getRecentEmailActivity(limit: number = 50): Promise<EmailActivity[]> {
  const rows = await queryAll('SELECT * FROM email_activity ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map(mapRowToEmailActivity);
}

export interface EmailActivityWithMeeting extends EmailActivity {
  clientName: string;
  meetingTitle: string;
}

export async function getRecentEmailActivityWithMeetings(limit: number = 50): Promise<EmailActivityWithMeeting[]> {
  const rows = await queryAll(
    `SELECT ea.*, m.client_name, m.meeting_title
     FROM email_activity ea
     JOIN meetings m ON ea.meeting_id = m.id
     ORDER BY ea.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(row => ({
    ...mapRowToEmailActivity(row),
    clientName: row.client_name,
    meetingTitle: row.meeting_title,
  }));
}

export async function getEmailActivityByTrackingToken(trackingToken: string): Promise<EmailActivity | null> {
  const row = await queryOne('SELECT * FROM email_activity WHERE tracking_token = ?', [trackingToken]);
  return row ? mapRowToEmailActivity(row) : null;
}

export async function markEmailOpened(trackingToken: string): Promise<EmailActivity | null> {
  const now = new Date().toISOString();
  // Only update if not already opened (first open time)
  await execute(
    `UPDATE email_activity SET opened_at = ? WHERE tracking_token = ? AND opened_at IS NULL`,
    [now, trackingToken]
  );
  return getEmailActivityByTrackingToken(trackingToken);
}

export async function updateEmailActivityGmailIds(activityId: string, messageId: string, threadId: string): Promise<void> {
  await execute(
    `UPDATE email_activity SET gmail_message_id = ?, gmail_thread_id = ? WHERE id = ?`,
    [messageId, threadId, activityId]
  );
}

export async function markEmailActivityFailed(activityId: string, errorMessage: string): Promise<void> {
  await execute(
    `UPDATE email_activity SET status = 'failed', error_message = ? WHERE id = ?`,
    [errorMessage, activityId]
  );
}

function mapRowToEmailActivity(row: any): EmailActivity {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    activityType: row.activity_type as EmailActivityType,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    gmailMessageId: row.gmail_message_id || null,
    gmailThreadId: row.gmail_thread_id || null,
    status: row.status as EmailActivityStatus,
    errorMessage: row.error_message || null,
    trackingToken: row.tracking_token || null,
    openedAt: row.opened_at ? new Date(row.opened_at) : null,
    createdAt: new Date(row.created_at),
  };
}
