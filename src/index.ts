import 'dotenv/config';
import express from 'express';
import path from 'path';
import { initializeDatabase, closeDatabase } from './db/database';
import meetingsRouter from './routes/meetings';
import confirmationRouter from './routes/confirmation';
import webhookRouter from './routes/webhook';
import usersRouter from './routes/users';
import templatesRouter from './routes/templates';
import authRouter from './routes/auth';
import { isAuthEnabled } from './config/supabase';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Initialize database
  console.log('Initializing database...');
  await initializeDatabase();

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

  // Auth routes (must be before other API routes)
  app.use('/api', authRouter);

  // API Routes
  app.use('/api', meetingsRouter);
  app.use('/api', confirmationRouter);
  app.use('/api', webhookRouter);
  app.use('/api', usersRouter);
  app.use('/api', templatesRouter);

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`Meeting Follow-up System running on http://localhost:${PORT}`);
    console.log('');
    console.log('Admin Dashboard: http://localhost:' + PORT);
    console.log('Settings: http://localhost:' + PORT + '/settings.html');
    if (isAuthEnabled()) {
      console.log('');
      console.log('Authentication: Enabled (Supabase)');
      console.log('Login: http://localhost:' + PORT + '/login.html');
    } else {
      console.log('');
      console.log('Authentication: Disabled (demo mode)');
      console.log('To enable auth, set SUPABASE_URL and SUPABASE_ANON_KEY env vars');
    }
    console.log('');
    console.log('Make sure to run the worker process separately: npm run worker');
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
