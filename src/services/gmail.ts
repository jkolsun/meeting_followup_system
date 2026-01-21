import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Gmail OAuth2 configuration
const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI!;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN!;

let oauth2Client: OAuth2Client | null = null;
let gmailClient: gmail_v1.Gmail | null = null;

export function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.setCredentials({
      refresh_token: REFRESH_TOKEN,
    });
  }
  return oauth2Client;
}

export function getGmailClient(): gmail_v1.Gmail {
  if (!gmailClient) {
    gmailClient = google.gmail({
      version: 'v1',
      auth: getOAuth2Client(),
    });
  }
  return gmailClient;
}

// Generate authorization URL for initial setup
export function getAuthUrl(): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    prompt: 'consent', // Force consent to get refresh token
  });
}

// Exchange authorization code for tokens
export async function getTokensFromCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
  };
}

// Create a raw email message in RFC 2822 format
function createRawEmail(options: {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `boundary_${Date.now()}`;

  const headers = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (options.replyTo) {
    headers.push(`Reply-To: ${options.replyTo}`);
  }
  if (options.inReplyTo) {
    headers.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    headers.push(`References: ${options.references}`);
  }

  const body = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    options.textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    options.htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  // Base64 URL-safe encode the message
  return Buffer.from(body)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface SendEmailResult {
  messageId: string;
  threadId: string;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  threadId?: string;
  inReplyTo?: string;
}): Promise<SendEmailResult> {
  const gmail = getGmailClient();
  const fromEmail = process.env.GMAIL_USER!;

  const raw = createRawEmail({
    to: options.to,
    from: fromEmail,
    subject: options.subject,
    htmlBody: options.htmlBody,
    textBody: options.textBody,
    inReplyTo: options.inReplyTo,
    references: options.inReplyTo,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: options.threadId,
    },
  });

  return {
    messageId: response.data.id!,
    threadId: response.data.threadId!,
  };
}

// Watch for new emails (for reply detection)
export async function setupGmailWatch(topicName: string): Promise<void> {
  const gmail = getGmailClient();

  await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
    },
  });

  console.log('Gmail watch set up successfully');
}

// Get message details
export async function getMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return response.data;
}

// Get thread details
export async function getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
  const gmail = getGmailClient();
  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  });
  return response.data;
}

// Check if a thread has a reply from the recipient
export async function hasReplyInThread(
  threadId: string,
  originalSenderEmail: string
): Promise<boolean> {
  const thread = await getThread(threadId);
  const messages = thread.messages || [];

  // Check if any message in the thread is FROM someone other than us
  // (meaning the client replied)
  for (const message of messages) {
    const headers = message.payload?.headers || [];
    const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from');
    if (fromHeader?.value && !fromHeader.value.includes(originalSenderEmail)) {
      return true;
    }
  }

  return false;
}
