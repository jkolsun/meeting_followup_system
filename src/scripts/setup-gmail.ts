import 'dotenv/config';
import express from 'express';
import { getAuthUrl, getTokensFromCode, setupGmailWatch } from '../services/gmail';

/**
 * Gmail OAuth2 Setup Script
 *
 * This script helps you get the Gmail OAuth2 refresh token needed for the app.
 *
 * Prerequisites:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a new project (or select existing)
 * 3. Enable the Gmail API
 * 4. Go to "APIs & Services" > "Credentials"
 * 5. Create OAuth 2.0 Client ID (choose "Web application")
 * 6. Add http://localhost:3000/auth/google/callback as an authorized redirect URI
 * 7. Copy the Client ID and Client Secret to your .env file
 *
 * Usage:
 *   npm run setup-gmail
 *
 * Then visit http://localhost:3000/auth/google to start the OAuth flow.
 */

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

app.get('/auth/google', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokens = await getTokensFromCode(code);

    res.send(`
      <html>
        <head>
          <title>Gmail Setup Complete</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .card {
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #28a745; }
            code {
              background: #f0f0f0;
              padding: 15px;
              display: block;
              border-radius: 5px;
              word-break: break-all;
              margin: 10px 0;
            }
            .warning {
              background: #fff3cd;
              border: 1px solid #ffc107;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Gmail Setup Complete!</h1>
            <p>Add the following to your <strong>.env</strong> file:</p>
            <code>GMAIL_REFRESH_TOKEN=${tokens.refresh_token}</code>

            <div class="warning">
              <strong>⚠️ Important:</strong> Keep this token secret! It provides access to your Gmail account.
            </div>

            <h2>Next Steps:</h2>
            <ol>
              <li>Copy the refresh token above to your .env file</li>
              <li>Stop this setup script (Ctrl+C)</li>
              <li>Start the main application: <code>npm run dev</code></li>
              <li>In another terminal, start the worker: <code>npm run worker</code></li>
            </ol>
          </div>
        </body>
      </html>
    `);

    console.log('\n✅ Gmail OAuth setup complete!');
    console.log('Add this to your .env file:');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nYou can now stop this script (Ctrl+C) and start the main app.');
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).send('Failed to get tokens. Check console for details.');
  }
});

// Setup Gmail Pub/Sub watch (for reply detection)
app.get('/setup/watch', async (req, res) => {
  try {
    const topicName = process.env.PUBSUB_TOPIC;
    if (!topicName) {
      return res.status(400).send('PUBSUB_TOPIC not configured');
    }

    await setupGmailWatch(`projects/${process.env.GOOGLE_CLOUD_PROJECT}/topics/${topicName}`);
    res.send('Gmail watch set up successfully. Notifications will be sent to your Pub/Sub topic.');
  } catch (error) {
    console.error('Error setting up watch:', error);
    res.status(500).send('Failed to set up Gmail watch. Check console for details.');
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Gmail OAuth2 Setup');
  console.log('='.repeat(60));
  console.log('');
  console.log('  Visit this URL to authorize Gmail access:');
  console.log(`  http://localhost:${PORT}/auth/google`);
  console.log('');
  console.log('  After authorization, you\'ll receive a refresh token');
  console.log('  to add to your .env file.');
  console.log('');
  console.log('='.repeat(60));
});
