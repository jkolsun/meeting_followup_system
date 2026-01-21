import 'dotenv/config';
import { initializeDatabase, closeDatabase } from './db/database';
import { createReminderWorker } from './jobs/queue';
import { closeRedisConnection } from './config/redis';

async function main() {
  console.log('Starting Meeting Reminder Worker...');

  // Initialize database
  await initializeDatabase();

  // Create and start the worker
  const worker = createReminderWorker();

  console.log('✅ Worker is running and listening for jobs');
  console.log('');
  console.log('The worker will process scheduled reminders:');
  console.log('  - 48 hours before: Send confirmation request');
  console.log('  - 24 hours before: Send confirmation request');
  console.log('  - 6 hours before: Send confirmation request');
  console.log('  - 1 hour before: Always send reminder (even if confirmed)');
  console.log('  - 30 minutes before: Check confirmation, cancel if not confirmed');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down worker...');
    await worker.close();
    await closeRedisConnection();
    closeDatabase();
    console.log('Worker shut down gracefully');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
