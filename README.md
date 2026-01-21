# Meeting Follow-up System

Automated meeting confirmation and reminder system for Bright Automations. Sends scheduled reminder emails before client meetings and handles confirmation via link clicks or email replies.

## Features

- **Scheduled Reminders**: Automatically sends emails at 48h, 24h, 6h, 1h, and 30min before meetings
- **Dual Confirmation**: Clients can confirm by clicking a link OR replying to the email
- **Smart Cancellation**: If no confirmation by 30 minutes before, the meeting is auto-cancelled
- **1-Hour Reminder**: Always sent regardless of confirmation status (acts as final reminder)
- **Gmail Integration**: Uses Gmail API for sending and detecting replies

## Reminder Flow

```
Meeting Booked
     │
     ├─► 48h before: "Please confirm" email (confirmation request)
     │        └─► If client confirms → stop 48h, 24h, 6h, 30min reminders
     │
     ├─► 24h before: "Please confirm" email (if not confirmed)
     │        └─► If client confirms → stop remaining reminders
     │
     ├─► 6h before: "Please confirm" email (if not confirmed)
     │        └─► If client confirms → stop remaining reminders
     │
     ├─► 1h before: "Reminder" email (ALWAYS sent, even if confirmed)
     │
     └─► 30min before: Final check
              ├─► If confirmed → Do nothing
              └─► If NOT confirmed → Cancel meeting, send cancellation email
```

## Prerequisites

- Node.js 18+
- Redis (for job queue)
- Gmail account with API access

## Quick Start

### 1. Install Dependencies

```bash
cd meeting-followup-system
npm install
```

### 2. Set Up Redis

```bash
# macOS
brew install redis
brew services start redis

# Linux
sudo apt install redis-server
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis
```

### 3. Configure Gmail OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the **Gmail API**
4. Create OAuth 2.0 credentials (Web application type)
5. Add `http://localhost:3000/auth/google/callback` as redirect URI
6. Copy Client ID and Secret

### 4. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=3000
BASE_URL=http://localhost:3000

GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REDIRECT_URI=http://localhost:3000/auth/google/callback
GMAIL_USER=your-email@gmail.com
```

### 5. Get Gmail Refresh Token

```bash
npm run setup-gmail
```

Visit `http://localhost:3000/auth/google` and authorize. Copy the refresh token to `.env`.

### 6. Run the Application

```bash
# Terminal 1: Start the API server
npm run dev

# Terminal 2: Start the background worker
npm run worker
```

## API Usage

### Create a Meeting

```bash
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{
    "clientName": "John Doe",
    "clientEmail": "john@example.com",
    "meetingTitle": "Strategy Discussion",
    "scheduledAt": "2024-01-15T14:00:00Z"
  }'
```

### List Meetings

```bash
# All upcoming meetings
curl http://localhost:3000/api/meetings

# Only unconfirmed meetings
curl http://localhost:3000/api/meetings?status=unconfirmed
```

### Get Meeting Details

```bash
curl http://localhost:3000/api/meetings/{meeting-id}
```

### Cancel a Meeting

```bash
curl -X POST http://localhost:3000/api/meetings/{meeting-id}/cancel
```

### Manually Confirm a Meeting

```bash
curl -X POST http://localhost:3000/api/meetings/{meeting-id}/confirm
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Express API   │────►│   SQLite DB     │     │     Redis       │
│    (index.ts)   │     │  (meetings,     │     │   (BullMQ)      │
└────────┬────────┘     │   reminders)    │     └────────┬────────┘
         │              └─────────────────┘              │
         │                                               │
         ▼                                               ▼
┌─────────────────┐                          ┌─────────────────┐
│  Schedule Jobs  │─────────────────────────►│     Worker      │
│  on meeting     │                          │  (worker.ts)    │
│  creation       │                          │                 │
└─────────────────┘                          │  - Send emails  │
                                             │  - Check status │
                                             │  - Cancel if    │
                                             │    unconfirmed  │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │   Gmail API     │
                                             │  (send emails)  │
                                             └─────────────────┘
```

## Reply Detection (Optional)

For automatic confirmation via email replies, you need Google Cloud Pub/Sub:

1. Create a Pub/Sub topic and subscription in Google Cloud
2. Set up Gmail push notifications to that topic
3. Configure the webhook URL in your deployment
4. Add Pub/Sub credentials to your environment

See `src/services/reply-detector.ts` for implementation details.

## Production Deployment

For production, consider:

1. **Use PostgreSQL** instead of SQLite for better concurrency
2. **Use a managed Redis** (e.g., Redis Cloud, AWS ElastiCache)
3. **Deploy behind a reverse proxy** (nginx, Cloudflare)
4. **Set BASE_URL** to your public domain
5. **Enable HTTPS** for the confirmation links
6. **Set up monitoring** for the worker process

## File Structure

```
meeting-followup-system/
├── src/
│   ├── config/
│   │   └── redis.ts          # Redis connection
│   ├── db/
│   │   ├── schema.ts         # Database initialization
│   │   └── repositories.ts   # Data access layer
│   ├── jobs/
│   │   └── queue.ts          # BullMQ job scheduling
│   ├── routes/
│   │   ├── meetings.ts       # Meeting CRUD endpoints
│   │   ├── confirmation.ts   # Confirmation link handler
│   │   └── webhook.ts        # Gmail webhook handler
│   ├── services/
│   │   ├── gmail.ts          # Gmail API client
│   │   ├── email.ts          # Email templates & sending
│   │   └── reply-detector.ts # Reply detection service
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   ├── scripts/
│   │   └── setup-gmail.ts    # OAuth setup helper
│   ├── index.ts              # API server entry
│   └── worker.ts             # Background worker entry
├── data/                     # SQLite database (auto-created)
├── .env.example
├── package.json
└── tsconfig.json
```

## License

Proprietary - Bright Automations
