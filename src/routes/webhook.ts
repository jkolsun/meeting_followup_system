import { Router, Request, Response } from 'express';
import { getGmailClient } from '../services/gmail';
import { getMeetingByThreadId, confirmMeeting } from '../db/repositories';
import { cancelRemindersForMeeting } from '../jobs/queue';
import { sendConfirmationAcknowledgement } from '../services/email';

const router = Router();

const GMAIL_USER = process.env.GMAIL_USER || '';

// Google Pub/Sub push endpoint for Gmail notifications
router.post('/webhooks/gmail', async (req: Request, res: Response) => {
  try {
    // Verify the request is from Google (in production, verify the JWT token)
    const message = req.body.message;
    if (!message) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    // Decode the message data
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    console.log('Received Gmail webhook:', data);

    // Process the notification
    await processGmailWebhook(data.historyId);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing Gmail webhook:', error);
    // Return 200 to prevent retries for non-retryable errors
    return res.status(200).json({ error: 'Processing error' });
  }
});

let lastProcessedHistoryId: string | null = null;

async function processGmailWebhook(historyId: string): Promise<void> {
  const gmail = getGmailClient();

  if (!lastProcessedHistoryId) {
    lastProcessedHistoryId = historyId;
    return;
  }

  try {
    const historyResponse = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastProcessedHistoryId,
      historyTypes: ['messageAdded'],
    });

    lastProcessedHistoryId = historyId;

    const history = historyResponse.data.history || [];

    for (const historyItem of history) {
      const messagesAdded = historyItem.messagesAdded || [];

      for (const messageAdded of messagesAdded) {
        const message = messageAdded.message;
        if (!message?.threadId || !message?.id) continue;

        // Check if this thread is associated with a meeting
        const meeting = await getMeetingByThreadId(message.threadId);
        if (!meeting) continue;

        // Skip if already confirmed or cancelled
        if (meeting.confirmedAt || meeting.cancelledAt) continue;

        // Get message details to check sender
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From'],
        });

        const headers = fullMessage.data.payload?.headers || [];
        const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from');

        // If this is a reply from the client (not from us)
        if (fromHeader?.value && !fromHeader.value.includes(GMAIL_USER)) {
          console.log(`Client replied to meeting ${meeting.id}`);

          const confirmedMeeting = await confirmMeeting(meeting.id);
          if (confirmedMeeting) {
            await cancelRemindersForMeeting(meeting.id);
            await sendConfirmationAcknowledgement(confirmedMeeting);
            console.log(`Meeting ${meeting.id} confirmed via webhook`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing Gmail history:', error);
    throw error;
  }
}

export default router;
