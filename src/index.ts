import 'dotenv/config';
import express from 'express';
import { getDatabase, closeDatabase } from './db/schema';
import meetingsRouter from './routes/meetings';
import confirmationRouter from './routes/confirmation';
import webhookRouter from './routes/webhook';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Initialize database
  console.log('Initializing database...');
  getDatabase();

  // Create Express app
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.use('/api', meetingsRouter);
  app.use('/api', confirmationRouter);
  app.use('/api', webhookRouter);

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`🚀 Meeting Follow-up System running on http://localhost:${PORT}`);
    console.log('');
    console.log('Available endpoints:');
    console.log(`  POST   /api/meetings          - Create a new meeting`);
    console.log(`  GET    /api/meetings          - List upcoming meetings`);
    console.log(`  GET    /api/meetings/:id      - Get meeting details`);
    console.log(`  POST   /api/meetings/:id/cancel  - Cancel a meeting`);
    console.log(`  POST   /api/meetings/:id/confirm - Manually confirm a meeting`);
    console.log(`  GET    /api/confirm/:token    - Confirm via link (client-facing)`);
    console.log(`  POST   /api/webhooks/gmail    - Gmail push notifications`);
    console.log('');
    console.log('⚠️  Make sure to run the worker process separately: npm run worker');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
