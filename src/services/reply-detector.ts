import { PubSub } from '@google-cloud/pubsub';
import { getGmailClient, getThread } from './gmail';
import { getMeetingByThreadId, getMeetingById, confirmMeeting } from '../db/repositories';
import { queryAll } from '../db/database';
import { cancelRemindersForMeeting } from '../jobs/queue';
import { sendConfirmationAcknowledgement } from './email';

const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION || 'gmail-notifications-sub';
const GMAIL_USER = process.env.GMAIL_USER || '';

interface GmailNotification {
  emailAddress: string;
  historyId: number;
}

let lastHistoryId: string | null = null;

export async function startReplyDetection(): Promise<void> {
  const pubsub = new PubSub();
  const subscription = pubsub.subscription(SUBSCRIPTION_NAME);

  console.log('Starting Gmail reply detection...');

  subscription.on('message', async (message) => {
    try {
      const data = JSON.parse(Buffer.from(message.data as unknown as string, 'base64').toString()) as GmailNotification;
      console.log('Received Gmail notification:', data);

      await processGmailNotification(data);

      message.ack();
    } catch (error) {
      console.error('Error processing Gmail notification:', error);
      message.nack();
    }
  });

  subscription.on('error', (error) => {
    console.error('Pub/Sub subscription error:', error);
  });
}

async function processGmailNotification(notification: GmailNotification): Promise<void> {
  const gmail = getGmailClient();

  // Get history changes since last notification
  const historyResponse = await gmail.users.history.list({
    userId: 'me',
    startHistoryId: lastHistoryId || notification.historyId.toString(),
    historyTypes: ['messageAdded'],
  });

  lastHistoryId = notification.historyId.toString();

  const history = historyResponse.data.history || [];

  for (const historyItem of history) {
    const messagesAdded = historyItem.messagesAdded || [];

    for (const messageAdded of messagesAdded) {
      const message = messageAdded.message;
      if (!message?.threadId) continue;

      // Check if this thread is associated with a meeting
      const meeting = await getMeetingByThreadId(message.threadId);
      if (!meeting) continue;

      // Skip if already confirmed or cancelled
      if (meeting.confirmedAt || meeting.cancelledAt) continue;

      // Get full message details to check if it's a reply (not from us)
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
        format: 'metadata',
        metadataHeaders: ['From'],
      });

      const headers = fullMessage.data.payload?.headers || [];
      const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from');

      // If the message is NOT from our email (i.e., it's a reply from the client)
      if (fromHeader?.value && !fromHeader.value.includes(GMAIL_USER)) {
        console.log(`Detected reply from client for meeting ${meeting.id}`);

        // Confirm the meeting
        const confirmedMeeting = await confirmMeeting(meeting.id);
        if (confirmedMeeting) {
          // Cancel pending reminders except 1-hour
          await cancelRemindersForMeeting(meeting.id);

          // Send confirmation acknowledgement
          await sendConfirmationAcknowledgement(confirmedMeeting);

          console.log(`Meeting ${meeting.id} confirmed via email reply`);
        }
      }
    }
  }
}

// Alternative: Poll-based reply detection (simpler, no Pub/Sub required)
export async function checkForReplies(meetingIds: string[]): Promise<void> {
  const gmail = getGmailClient();

  for (const meetingId of meetingIds) {
    // Get threads associated with this meeting using the database abstraction
    const threads = await queryAll(
      'SELECT gmail_thread_id FROM email_threads WHERE meeting_id = ?',
      [meetingId]
    ) as { gmail_thread_id: string }[];

    for (const { gmail_thread_id } of threads) {
      if (!gmail_thread_id) continue;

      try {
        const thread = await getThread(gmail_thread_id);
        const messages = thread.messages || [];

        // Check if there's a message from someone other than us
        for (const message of messages) {
          const headers = message.payload?.headers || [];
          const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from');

          if (fromHeader?.value && !fromHeader.value.includes(GMAIL_USER)) {
            // This is a reply from the client
            const meeting = await getMeetingById(meetingId);
            if (meeting && !meeting.confirmedAt && !meeting.cancelledAt) {
              console.log(`Found reply for meeting ${meetingId}`);

              const confirmedMeeting = await confirmMeeting(meetingId);
              if (confirmedMeeting) {
                await cancelRemindersForMeeting(meetingId);
                await sendConfirmationAcknowledgement(confirmedMeeting);
                console.log(`Meeting ${meetingId} confirmed via email reply (poll-based)`);
              }
            }
            break;
          }
        }
      } catch (error) {
        console.error(`Error checking thread ${gmail_thread_id}:`, error);
      }
    }
  }
}
