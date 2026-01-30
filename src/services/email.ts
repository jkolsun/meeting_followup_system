import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Meeting, ReminderType, User, TemplateType, EmailTemplate, EmailActivityType } from '../types';
import { sendEmail, sendEmailAsUser, SendEmailResult } from './gmail';
import { createEmailThread, getEmailTemplate, getUserById, createEmailActivity, updateEmailActivityGmailIds, markEmailActivityFailed } from '../db/repositories';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// Default timezone for email formatting - can be overridden per organization later
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/New_York';

// Generate tracking pixel HTML
function getTrackingPixelHtml(trackingToken: string): string {
  return `<img src="${BASE_URL}/api/track/${trackingToken}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;" />`;
}

function getConfirmationUrl(meeting: Meeting): string {
  return `${BASE_URL}/api/confirm/${meeting.confirmationToken}`;
}

function formatMeetingDate(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(date, timezone, "EEEE, MMMM do 'at' h:mm a");
}

// Template variable replacement
interface TemplateVariables {
  clientName: string;
  meetingTitle: string;
  meetingDate: string;
  confirmUrl: string;
  senderName: string;
}

function replaceTemplateVariables(template: string, vars: TemplateVariables): string {
  return template
    .replace(/\{\{clientName\}\}/g, vars.clientName)
    .replace(/\{\{meetingTitle\}\}/g, vars.meetingTitle)
    .replace(/\{\{meetingDate\}\}/g, vars.meetingDate)
    .replace(/\{\{confirmUrl\}\}/g, vars.confirmUrl)
    .replace(/\{\{senderName\}\}/g, vars.senderName);
}

// ============ Default Templates ============

// Signature HTML block for all emails - uses BASE_URL for logo
function getEmailSignatureHtml(): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin-top: 30px; font-family: Arial, sans-serif;">
      <tr>
        <td style="padding-right: 15px; vertical-align: top;">
          <img src="${BASE_URL}/logo.png" alt="Bright Automations" style="width: 80px; height: 80px; border-radius: 8px;">
        </td>
        <td style="vertical-align: top; border-left: 2px solid #4A8B8B; padding-left: 15px;">
          <p style="margin: 0; font-weight: bold; color: #333;">{{senderName}}</p>
          <p style="margin: 2px 0; color: #666; font-size: 13px;">Co-Founder | Lead Developer</p>
          <p style="margin: 2px 0; color: #666; font-size: 13px;">610-256-9844</p>
          <p style="margin: 2px 0;"><a href="mailto:admin@brightautomations.net" style="color: #4A8B8B; text-decoration: none; font-size: 13px;">admin@brightautomations.net</a></p>
          <p style="margin: 2px 0;"><a href="https://www.brightautomations.org" style="color: #4A8B8B; text-decoration: none; font-size: 13px;">www.brightautomations.org</a></p>
        </td>
      </tr>
    </table>`;
}

const EMAIL_SIGNATURE_TEXT = `
{{senderName}}
Co-Founder | Lead Developer
610-256-9844
admin@brightautomations.net
www.brightautomations.org`;

export function getDefaultConfirmationRequestTemplate(senderName: string): { subject: string; htmlBody: string; textBody: string } {
  return {
    subject: 'Please confirm: {{meetingTitle}}',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Please Confirm Your Meeting</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #4A8B8B; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Please Confirm Your Meeting</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi {{clientName}},</p>

    <p>We'd like to confirm your upcoming meeting. Please confirm your attendance by clicking the button below or simply replying to this email.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4A8B8B;">
      <h3 style="margin-top: 0; color: #4A8B8B;">{{meetingTitle}}</h3>
      <p style="margin-bottom: 0;"><strong>When:</strong> {{meetingDate}}</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="{{confirmUrl}}" style="display: inline-block; background: #4A8B8B; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
        Confirm My Attendance
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
      Best regards,
    </p>
    ${getEmailSignatureHtml()}
  </div>
</body>
</html>`,
    textBody: `Please Confirm Your Meeting

Hi {{clientName}},

We'd like to confirm your upcoming meeting. Please confirm your attendance by clicking the link below or simply replying to this email.

Meeting: {{meetingTitle}}
When: {{meetingDate}}

Confirm your attendance: {{confirmUrl}}

Or simply reply to this email to confirm.

If you can no longer attend, please let us know as soon as possible so we can reschedule.

Best regards,
${EMAIL_SIGNATURE_TEXT}`,
  };
}

export function getDefaultFinalReminderTemplate(senderName: string): { subject: string; htmlBody: string; textBody: string } {
  return {
    subject: 'Reminder: {{meetingTitle}} in 1 hour',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Reminder</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #4A8B8B; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting in 1 Hour</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi {{clientName}},</p>

    <p>This is a friendly reminder that your meeting is coming up in <strong>1 hour</strong>.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4A8B8B;">
      <h3 style="margin-top: 0; color: #4A8B8B;">{{meetingTitle}}</h3>
      <p style="margin-bottom: 0;"><strong>When:</strong> {{meetingDate}}</p>
    </div>

    <p>We look forward to speaking with you!</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,
    </p>
    ${getEmailSignatureHtml()}
  </div>
</body>
</html>`,
    textBody: `Meeting Reminder

Hi {{clientName}},

This is a friendly reminder that your meeting is coming up in 1 hour.

Meeting: {{meetingTitle}}
When: {{meetingDate}}

We look forward to speaking with you!

Best regards,
${EMAIL_SIGNATURE_TEXT}`,
  };
}

export function getDefaultAcknowledgementTemplate(senderName: string): { subject: string; htmlBody: string; textBody: string } {
  return {
    subject: 'Confirmed: {{meetingTitle}}',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Confirmed</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #28a745; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Confirmed!</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi {{clientName}},</p>

    <p>Thank you for confirming your attendance! We're looking forward to meeting with you.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
      <h3 style="margin-top: 0; color: #28a745;">{{meetingTitle}}</h3>
      <p style="margin-bottom: 0;"><strong>When:</strong> {{meetingDate}}</p>
    </div>

    <p>You'll receive a final reminder 1 hour before the meeting.</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,
    </p>
    ${getEmailSignatureHtml()}
  </div>
</body>
</html>`,
    textBody: `Meeting Confirmed!

Hi {{clientName}},

Thank you for confirming your attendance! We're looking forward to meeting with you.

Meeting: {{meetingTitle}}
When: {{meetingDate}}

You'll receive a final reminder 1 hour before the meeting.

Best regards,
${EMAIL_SIGNATURE_TEXT}`,
  };
}

export function getDefaultCancellationTemplate(senderName: string): { subject: string; htmlBody: string; textBody: string } {
  return {
    subject: 'Cancelled: {{meetingTitle}}',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Cancelled</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #dc3545; padding: 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Cancelled</h1>
  </div>

  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
    <p>Hi {{clientName}},</p>

    <p>Unfortunately, your meeting has been cancelled due to no confirmation received.</p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
      <h3 style="margin-top: 0; color: #dc3545;">{{meetingTitle}}</h3>
      <p style="margin-bottom: 0;"><strong>Originally scheduled:</strong> {{meetingDate}}</p>
    </div>

    <p>If you'd like to reschedule, please contact us and we'll be happy to find a new time that works for you.</p>

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Best regards,
    </p>
    ${getEmailSignatureHtml()}
  </div>
</body>
</html>`,
    textBody: `Meeting Cancelled

Hi {{clientName}},

Unfortunately, your meeting has been cancelled due to no confirmation received.

Meeting: {{meetingTitle}}
Originally scheduled: {{meetingDate}}

If you'd like to reschedule, please contact us and we'll be happy to find a new time that works for you.

Best regards,
${EMAIL_SIGNATURE_TEXT}`,
  };
}

// Get template (from DB or default)
async function getTemplateContent(
  templateType: TemplateType,
  userId: string | null,
  senderName: string
): Promise<{ subject: string; htmlBody: string; textBody: string }> {
  // Try to load from database if user is assigned
  if (userId) {
    const dbTemplate = await getEmailTemplate(userId, templateType);
    if (dbTemplate) {
      return {
        subject: dbTemplate.subject,
        htmlBody: dbTemplate.htmlBody,
        textBody: dbTemplate.textBody,
      };
    }
  }

  // Fall back to default templates
  switch (templateType) {
    case 'confirmation_request':
      return getDefaultConfirmationRequestTemplate(senderName);
    case 'final_reminder':
      return getDefaultFinalReminderTemplate(senderName);
    case 'acknowledgement':
      return getDefaultAcknowledgementTemplate(senderName);
    case 'cancellation':
      return getDefaultCancellationTemplate(senderName);
    default:
      return getDefaultConfirmationRequestTemplate(senderName);
  }
}

// Determine which template type to use for a reminder
function getTemplateTypeForReminder(reminderType: ReminderType): TemplateType {
  if (reminderType === '1_hour') {
    return 'final_reminder';
  }
  return 'confirmation_request';
}

// Convert reminder type to activity type
function getActivityTypeForReminder(reminderType: ReminderType): EmailActivityType {
  const mapping: Record<ReminderType, EmailActivityType> = {
    '48_hours': 'reminder_48h',
    '24_hours': 'reminder_24h',
    '6_hours': 'reminder_6h',
    '1_hour': 'reminder_1h',
    '30_minutes': 'reminder_30m',
  };
  return mapping[reminderType];
}

// ============ Email Sending Functions ============

// Send immediate booking confirmation when meeting is created
export async function sendBookingConfirmationEmail(meeting: Meeting): Promise<SendEmailResult> {
  const user = meeting.assignedUserId ? await getUserById(meeting.assignedUserId) : null;
  const senderName = user?.name || 'The Team';

  // Use the confirmation_request template for the initial booking email
  const template = await getTemplateContent('confirmation_request', meeting.assignedUserId, senderName);

  const vars: TemplateVariables = {
    clientName: meeting.clientName,
    meetingTitle: meeting.meetingTitle,
    meetingDate: formatMeetingDate(meeting.scheduledAt),
    confirmUrl: getConfirmationUrl(meeting),
    senderName,
  };

  const subject = replaceTemplateVariables(template.subject, vars);
  let htmlBody = replaceTemplateVariables(template.htmlBody, vars);
  const textBody = replaceTemplateVariables(template.textBody, vars);

  // Create activity first to get tracking token
  const activity = await createEmailActivity({
    meetingId: meeting.id,
    activityType: 'booking_confirmation',
    recipientEmail: meeting.clientEmail,
    subject,
    status: 'sent', // Will update if it fails
  });

  // Inject tracking pixel into HTML body
  if (activity.trackingToken) {
    const trackingPixel = getTrackingPixelHtml(activity.trackingToken);
    htmlBody = htmlBody.replace('</body>', `${trackingPixel}</body>`);
  }

  try {
    let result: SendEmailResult;
    if (user && user.gmailRefreshToken) {
      result = await sendEmailAsUser(user, {
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    } else {
      result = await sendEmail({
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    }

    // Track the email thread for reply detection
    await createEmailThread({
      meetingId: meeting.id,
      gmailThreadId: result.threadId,
      gmailMessageId: result.messageId,
    });

    // Update activity with Gmail IDs
    await updateEmailActivityGmailIds(activity.id, result.messageId, result.threadId);

    console.log(`Sent booking confirmation email to ${meeting.clientEmail}${user ? ` (from ${user.name})` : ''}`);

    return result;
  } catch (error) {
    // Mark activity as failed
    await markEmailActivityFailed(activity.id, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

export async function sendReminderEmail(
  meeting: Meeting,
  reminderType: ReminderType
): Promise<SendEmailResult> {
  const user = meeting.assignedUserId ? await getUserById(meeting.assignedUserId) : null;
  const senderName = user?.name || 'The Team';

  const templateType = getTemplateTypeForReminder(reminderType);
  const template = await getTemplateContent(templateType, meeting.assignedUserId, senderName);

  const vars: TemplateVariables = {
    clientName: meeting.clientName,
    meetingTitle: meeting.meetingTitle,
    meetingDate: formatMeetingDate(meeting.scheduledAt),
    confirmUrl: getConfirmationUrl(meeting),
    senderName,
  };

  const subject = replaceTemplateVariables(template.subject, vars);
  let htmlBody = replaceTemplateVariables(template.htmlBody, vars);
  let textBody = replaceTemplateVariables(template.textBody, vars);

  // Add Zoom link for 1 hour and 30 minute reminders only
  if ((reminderType === '1_hour' || reminderType === '30_minutes') && meeting.zoomLink) {
    const zoomHtml = `
      <div style="background: #2D8CFF; color: white; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">Join Zoom Meeting</p>
        <a href="${meeting.zoomLink}" style="color: white; text-decoration: underline; word-break: break-all;">${meeting.zoomLink}</a>
      </div>`;
    // Insert Zoom link before the signature
    htmlBody = htmlBody.replace('</div>\n</body>', `${zoomHtml}</div>\n</body>`);
    textBody = textBody + `\n\nJoin Zoom Meeting: ${meeting.zoomLink}`;
  }

  // Create activity first to get tracking token
  const activity = await createEmailActivity({
    meetingId: meeting.id,
    activityType: getActivityTypeForReminder(reminderType),
    recipientEmail: meeting.clientEmail,
    subject,
    status: 'sent',
  });

  // Inject tracking pixel into HTML body
  if (activity.trackingToken) {
    const trackingPixel = getTrackingPixelHtml(activity.trackingToken);
    htmlBody = htmlBody.replace('</body>', `${trackingPixel}</body>`);
  }

  // Send using user's account if available, otherwise use default
  let result: SendEmailResult;
  try {
    if (user && user.gmailRefreshToken) {
      result = await sendEmailAsUser(user, {
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    } else {
      result = await sendEmail({
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    }

    // Track the email thread for reply detection
    await createEmailThread({
      meetingId: meeting.id,
      gmailThreadId: result.threadId,
      gmailMessageId: result.messageId,
    });

    // Update activity with Gmail IDs
    await updateEmailActivityGmailIds(activity.id, result.messageId, result.threadId);

    console.log(`Sent ${reminderType} reminder email to ${meeting.clientEmail}${user ? ` (from ${user.name})` : ''}`);

    return result;
  } catch (error) {
    // Mark activity as failed
    await markEmailActivityFailed(activity.id, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

export async function sendCancellationEmail(meeting: Meeting): Promise<void> {
  const user = meeting.assignedUserId ? await getUserById(meeting.assignedUserId) : null;
  const senderName = user?.name || 'The Team';

  const template = await getTemplateContent('cancellation', meeting.assignedUserId, senderName);

  const vars: TemplateVariables = {
    clientName: meeting.clientName,
    meetingTitle: meeting.meetingTitle,
    meetingDate: formatMeetingDate(meeting.scheduledAt),
    confirmUrl: getConfirmationUrl(meeting),
    senderName,
  };

  const subject = replaceTemplateVariables(template.subject, vars);
  let htmlBody = replaceTemplateVariables(template.htmlBody, vars);
  const textBody = replaceTemplateVariables(template.textBody, vars);

  // Create activity first to get tracking token
  const activity = await createEmailActivity({
    meetingId: meeting.id,
    activityType: 'cancellation',
    recipientEmail: meeting.clientEmail,
    subject,
    status: 'sent',
  });

  // Inject tracking pixel into HTML body
  if (activity.trackingToken) {
    const trackingPixel = getTrackingPixelHtml(activity.trackingToken);
    htmlBody = htmlBody.replace('</body>', `${trackingPixel}</body>`);
  }

  try {
    let result: SendEmailResult;
    if (user && user.gmailRefreshToken) {
      result = await sendEmailAsUser(user, {
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    } else {
      result = await sendEmail({
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    }

    // Update activity with Gmail IDs
    await updateEmailActivityGmailIds(activity.id, result.messageId, result.threadId);

    console.log(`Sent cancellation email to ${meeting.clientEmail}${user ? ` (from ${user.name})` : ''}`);
  } catch (error) {
    // Mark activity as failed
    await markEmailActivityFailed(activity.id, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

export async function sendConfirmationAcknowledgement(meeting: Meeting): Promise<void> {
  const user = meeting.assignedUserId ? await getUserById(meeting.assignedUserId) : null;
  const senderName = user?.name || 'The Team';

  const template = await getTemplateContent('acknowledgement', meeting.assignedUserId, senderName);

  const vars: TemplateVariables = {
    clientName: meeting.clientName,
    meetingTitle: meeting.meetingTitle,
    meetingDate: formatMeetingDate(meeting.scheduledAt),
    confirmUrl: getConfirmationUrl(meeting),
    senderName,
  };

  const subject = replaceTemplateVariables(template.subject, vars);
  let htmlBody = replaceTemplateVariables(template.htmlBody, vars);
  const textBody = replaceTemplateVariables(template.textBody, vars);

  // Create activity first to get tracking token
  const activity = await createEmailActivity({
    meetingId: meeting.id,
    activityType: 'confirmation_ack',
    recipientEmail: meeting.clientEmail,
    subject,
    status: 'sent',
  });

  // Inject tracking pixel into HTML body
  if (activity.trackingToken) {
    const trackingPixel = getTrackingPixelHtml(activity.trackingToken);
    htmlBody = htmlBody.replace('</body>', `${trackingPixel}</body>`);
  }

  try {
    let result: SendEmailResult;
    if (user && user.gmailRefreshToken) {
      result = await sendEmailAsUser(user, {
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    } else {
      result = await sendEmail({
        to: meeting.clientEmail,
        subject,
        htmlBody,
        textBody,
      });
    }

    // Update activity with Gmail IDs
    await updateEmailActivityGmailIds(activity.id, result.messageId, result.threadId);

    console.log(`Sent confirmation acknowledgement to ${meeting.clientEmail}${user ? ` (from ${user.name})` : ''}`);
  } catch (error) {
    // Mark activity as failed
    await markEmailActivityFailed(activity.id, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}
