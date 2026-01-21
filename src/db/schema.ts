import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/meetings.db');

let dbInstance: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;

async function initializeDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing database or create new one
  let db: Database;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables

  // Users table - team members who send emails
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      gmail_refresh_token TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Email templates table - editable templates per user
  db.run(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      template_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_body TEXT NOT NULL,
      text_body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, template_type)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      meeting_title TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      confirmed_at TEXT,
      cancelled_at TEXT,
      confirmation_token TEXT UNIQUE NOT NULL,
      assigned_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id)
    )
  `);

  // Migration: Add assigned_user_id column if it doesn't exist (for existing databases)
  try {
    db.run(`ALTER TABLE meetings ADD COLUMN assigned_user_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS reminder_jobs (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      reminder_type TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      job_id TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_threads (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      gmail_thread_id TEXT,
      gmail_message_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )
  `);

  // Settings table for company info and email templates
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Save to disk
  saveDatabase(db);

  return db;
}

export function saveDatabase(db: Database): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }
  if (!dbInitPromise) {
    dbInitPromise = initializeDatabase().then((db) => {
      dbInstance = db;
      return db;
    });
  }
  return dbInitPromise;
}

export function getDatabaseSync(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call await getDatabase() first.');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    saveDatabase(dbInstance);
    dbInstance.close();
    dbInstance = null;
    dbInitPromise = null;
  }
}
