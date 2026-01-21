import { Router, Request, Response } from 'express';
import { getMeetingByToken, confirmMeeting } from '../db/repositories';
import { cancelRemindersForMeeting } from '../jobs/queue';
import { sendConfirmationAcknowledgement } from '../services/email';

const router = Router();

// Handle confirmation via link click
router.get('/confirm/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    const meeting = await getMeetingByToken(token);

    if (!meeting) {
      return res.status(404).send(renderErrorPage('Meeting Not Found', 'This confirmation link is invalid or has expired.'));
    }

    if (meeting.cancelledAt) {
      return res.status(410).send(renderErrorPage('Meeting Cancelled', 'This meeting has already been cancelled.'));
    }

    if (meeting.confirmedAt) {
      return res.send(renderSuccessPage(
        'Already Confirmed',
        `You've already confirmed your attendance for "${meeting.meetingTitle}". We'll see you soon!`
      ));
    }

    // Confirm the meeting
    const confirmedMeeting = await confirmMeeting(meeting.id);

    if (!confirmedMeeting) {
      return res.status(500).send(renderErrorPage('Error', 'Something went wrong. Please try again.'));
    }

    // Cancel all pending reminders except the 1-hour one
    await cancelRemindersForMeeting(meeting.id);

    // Send confirmation acknowledgement email
    await sendConfirmationAcknowledgement(confirmedMeeting);

    console.log(`Meeting ${meeting.id} confirmed via link click`);

    return res.send(renderSuccessPage(
      'Meeting Confirmed!',
      `Thank you for confirming your attendance for "${meeting.meetingTitle}". You'll receive a reminder 1 hour before the meeting.`
    ));
  } catch (error) {
    console.error('Error confirming meeting:', error);
    return res.status(500).send(renderErrorPage('Error', 'Something went wrong. Please try again.'));
  }
});

function renderSuccessPage(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #4A8B8B 0%, #3d7575 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #28a745;
      margin-bottom: 16px;
      font-size: 28px;
    }
    p {
      color: #666;
      line-height: 1.6;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #4A8B8B 0%, #3d7575 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #dc3545;
      margin-bottom: 16px;
      font-size: 28px;
    }
    p {
      color: #666;
      line-height: 1.6;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
