import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/meetings.db');

export function initializeDatabase(): Database.Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Create meetings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      meeting_title TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      confirmed_at TEXT,
      cancelled_at TEXT,
      confirmation_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON meetings(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_meetings_confirmation_token ON meetings(confirmation_token);
    CREATE INDEX IF NOT EXISTS idx_meetings_client_email ON meetings(client_email);
  `);

  // Create reminder_jobs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminder_jobs (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      reminder_type TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      job_id TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reminder_jobs_meeting_id ON reminder_jobs(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_jobs_job_id ON reminder_jobs(job_id);
  `);

  // Create email_threads table (for tracking reply detection)
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_threads (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      gmail_thread_id TEXT,
      gmail_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_email_threads_gmail_thread_id ON email_threads(gmail_thread_id);
    CREATE INDEX IF NOT EXISTS idx_email_threads_meeting_id ON email_threads(meeting_id);
  `);

  return db;
}

// Singleton database instance
let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    // Ensure data directory exists
    const fs = require('fs');
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbInstance = initializeDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
