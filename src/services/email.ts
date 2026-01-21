import { format } from 'date-fns';
import { Meeting, ReminderType } from '../types';
import { sendEmail, SendEmailResult } from './gmail';
import { createEmailThread, updateEmailThreadIds } from '../db/repositories';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function getConfirmationUrl(meeting: Meeting): string {
  return `${BASE_URL}/api/confirm/${meeting.confirmationToken}`;
}

function formatMeetingDate(date: Date): string {
  return format(date, "EEEE, MMMM do 'at' h:mm a");
}

function getReminderSubject(meeting: Meeting, reminderType: ReminderType): string {
  const timeLabels: Record<ReminderType, string> = {
    '48_hours': '48 hours',
    '24_hours': '24 hours',
    '6_hours': '6 hours',
    '1_hour': '1 hour',
    '30_minutes': '30 minutes',
  };

  if (reminderType === '1_hour') {
    return `Reminder: ${meeting.meetingTitle} in 1 hour`;
  }

  return `Please confirm: ${meeting.meetingTitle} in ${timeLabels[reminderType]}`;
}

function createReminderEmailHtml(meeting: Meeting, reminderType: ReminderType): string {
  const confirmUrl = getConfirmationUrl(meeting);
  const meetingDate = formatMeetingDate(meeting.scheduledAt);
  const isOneHourReminder = reminderType === '1_hour';

  if (isOneHourReminder) {
    // 1-hour reminder is just a reminder, not asking for confirmation
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Reminder</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">⏰ Meeting in 1 Hour</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi ${meeting.clientName},</p>

    <p>This is a friendly reminder that your meeting is coming up in <strong>1 hour</strong>.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
      <h3 style="margin-top: 0; color: #667eea;">${meeting.meetingTitle}</h3>
      <p style="margin-bottom: 0;"><strong>📅 When:</strong> ${meetingDate}</p>
    </div>

    <p>We look forward to speaking with you!</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,<br>
      The Team
    </p>
  </div>
</body>
</html>`;
  }

  // Confirmation request email
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Please Confirm Your Meeting</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">📅 Please Confirm Your Meeting</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi ${meeting.clientName},</p>

    <p>We'd like to confirm your upcoming meeting. Please confirm your attendance by clicking the button below or simply replying to this email.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
      <h3 style="margin-top: 0; color: #667eea;">${meeting.meetingTitle}</h3>
      <p style="margin-bottom: 0;"><strong>📅 When:</strong> ${meetingDate}</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${confirmUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
        ✓ Confirm My Attendance
      </a>
    </div>

    <p style="text-align: center; color: #666; font-size: 14px;">
      Or simply reply to this email to confirm.
    </p>

    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

    <p style="color: #999; font-size: 12px;">
      If you can no longer attend, please let us know as soon as possible so we can reschedule.
    </p>

    <p style="color: #666; font-size: 14px; margin-top: 20px;">
      Best regards,<br>
      The Team
    </p>
  </div>
</body>
</html>`;
}

function createReminderEmailText(meeting: Meeting, reminderType: ReminderType): string {
  const confirmUrl = getConfirmationUrl(meeting);
  const meetingDate = formatMeetingDate(meeting.scheduledAt);
  const isOneHourReminder = reminderType === '1_hour';

  if (isOneHourReminder) {
    return `
Meeting Reminder

Hi ${meeting.clientName},

This is a friendly reminder that your meeting is coming up in 1 hour.

Meeting: ${meeting.meetingTitle}
When: ${meetingDate}

We look forward to speaking with you!

Best regards,
The Team
`.trim();
  }

  return `
Please Confirm Your Meeting

Hi ${meeting.clientName},

We'd like to confirm your upcoming meeting. Please confirm your attendance by clicking the link below or simply replying to this email.

Meeting: ${meeting.meetingTitle}
When: ${meetingDate}

Confirm your attendance: ${confirmUrl}

Or simply reply to this email to confirm.

If you can no longer attend, please let us know as soon as possible so we can reschedule.

Best regards,
The Team
`.trim();
}

export async function sendReminderEmail(
  meeting: Meeting,
  reminderType: ReminderType
): Promise<SendEmailResult> {
  const subject = getReminderSubject(meeting, reminderType);
  const htmlBody = createReminderEmailHtml(meeting, reminderType);
  const textBody = createReminderEmailText(meeting, reminderType);

  const result = await sendEmail({
    to: meeting.clientEmail,
    subject,
    htmlBody,
    textBody,
  });

  // Track the email thread for reply detection
  createEmailThread({
    meetingId: meeting.id,
    gmailThreadId: result.threadId,
    gmailMessageId: result.messageId,
  });

  console.log(`Sent ${reminderType} reminder email to ${meeting.clientEmail}`);

  return result;
}

export async function sendCancellationEmail(meeting: Meeting): Promise<void> {
  const meetingDate = formatMeetingDate(meeting.scheduledAt);

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Cancelled</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #dc3545; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">❌ Meeting Cancelled</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi ${meeting.clientName},</p>

    <p>Unfortunately, your meeting has been cancelled due to no confirmation received.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
      <h3 style="margin-top: 0; color: #dc3545;">${meeting.meetingTitle}</h3>
      <p style="margin-bottom: 0;"><strong>📅 Originally scheduled:</strong> ${meetingDate}</p>
    </div>

    <p>If you'd like to reschedule, please contact us and we'll be happy to find a new time that works for you.</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,<br>
      The Team
    </p>
  </div>
</body>
</html>`;

  const textBody = `
Meeting Cancelled

Hi ${meeting.clientName},

Unfortunately, your meeting has been cancelled due to no confirmation received.

Meeting: ${meeting.meetingTitle}
Originally scheduled: ${meetingDate}

If you'd like to reschedule, please contact us and we'll be happy to find a new time that works for you.

Best regards,
The Team
`.trim();

  await sendEmail({
    to: meeting.clientEmail,
    subject: `Cancelled: ${meeting.meetingTitle}`,
    htmlBody,
    textBody,
  });

  console.log(`Sent cancellation email to ${meeting.clientEmail}`);
}

export async function sendConfirmationAcknowledgement(meeting: Meeting): Promise<void> {
  const meetingDate = formatMeetingDate(meeting.scheduledAt);

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Confirmed</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #28a745; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">✓ Meeting Confirmed!</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi ${meeting.clientName},</p>

    <p>Thank you for confirming your attendance! We're looking forward to meeting with you.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
      <h3 style="margin-top: 0; color: #28a745;">${meeting.meetingTitle}</h3>
      <p style="margin-bottom: 0;"><strong>📅 When:</strong> ${meetingDate}</p>
    </div>

    <p>You'll receive a final reminder 1 hour before the meeting.</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,<br>
      The Team
    </p>
  </div>
</body>
</html>`;

  const textBody = `
Meeting Confirmed!

Hi ${meeting.clientName},

Thank you for confirming your attendance! We're looking forward to meeting with you.

Meeting: ${meeting.meetingTitle}
When: ${meetingDate}

You'll receive a final reminder 1 hour before the meeting.

Best regards,
The Team
`.trim();

  await sendEmail({
    to: meeting.clientEmail,
    subject: `Confirmed: ${meeting.meetingTitle}`,
    htmlBody,
    textBody,
  });

  console.log(`Sent confirmation acknowledgement to ${meeting.clientEmail}`);
}
