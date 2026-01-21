import 'dotenv/config';
import express from 'express';
import path from 'path';
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

  // Serve static files (admin dashboard)
  app.use(express.static(path.join(__dirname, 'public')));

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
    console.log('📊 Admin Dashboard: http://localhost:' + PORT);
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
