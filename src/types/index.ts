export type PlanType = 'free' | 'starter' | 'pro' | 'business';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  ownerAuthId: string;
  googleCalendarConnected: boolean;
  googleCalendarRefreshToken: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanType;
  createdAt: Date;
  updatedAt: Date;
}

export interface Meeting {
  id: string;
  organizationId: string | null;
  clientName: string;
  clientEmail: string;
  meetingTitle: string;
  scheduledAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  confirmationToken: string;
  assignedUserId: string | null;
  googleCalendarEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  organizationId: string | null;
  authId: string | null;
  name: string;
  email: string;
  role: UserRole;
  gmailRefreshToken: string | null;
  isActive: boolean;
  createdAt: Date;
}

export type TemplateType = 'confirmation_request' | 'final_reminder' | 'acknowledgement' | 'cancellation';

export interface EmailTemplate {
  id: string;
  userId: string;
  templateType: TemplateType;
  subject: string;
  htmlBody: string;
  textBody: string;
  updatedAt: Date;
}

export const TEMPLATE_TYPES: TemplateType[] = [
  'confirmation_request',
  'final_reminder',
  'acknowledgement',
  'cancellation',
];

export interface ReminderJob {
  id: string;
  meetingId: string;
  reminderType: ReminderType;
  scheduledFor: Date;
  jobId: string | null; // BullMQ job ID
  sentAt: Date | null;
  createdAt: Date;
}

export type ReminderType =
  | '48_hours'
  | '24_hours'
  | '6_hours'
  | '1_hour'    // This one always sends, never cancelled
  | '30_minutes';

export interface ReminderJobData {
  meetingId: string;
  reminderType: ReminderType;
  reminderId: string;
}

export interface MeetingWithReminders extends Meeting {
  reminders: ReminderJob[];
}

export const REMINDER_OFFSETS: Record<ReminderType, number> = {
  '48_hours': 48 * 60 * 60 * 1000,
  '24_hours': 24 * 60 * 60 * 1000,
  '6_hours': 6 * 60 * 60 * 1000,
  '1_hour': 1 * 60 * 60 * 1000,
  '30_minutes': 30 * 60 * 1000,
};

export const REMINDER_TYPES: ReminderType[] = [
  '48_hours',
  '24_hours',
  '6_hours',
  '1_hour',
  '30_minutes',
];

export type EmailActivityType =
  | 'booking_confirmation'
  | 'reminder_48h'
  | 'reminder_24h'
  | 'reminder_6h'
  | 'reminder_1h'
  | 'reminder_30m'
  | 'confirmation_ack'
  | 'cancellation';

export type EmailActivityStatus = 'sent' | 'failed';

export interface EmailActivity {
  id: string;
  meetingId: string;
  activityType: EmailActivityType;
  recipientEmail: string;
  subject: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  status: EmailActivityStatus;
  errorMessage: string | null;
  createdAt: Date;
}
