// Database abstraction layer - switches between SQLite (local) and PostgreSQL (production)

import { v4 as uuidv4 } from 'uuid';

// Determine which database to use
const usePostgres = !!process.env.DATABASE_URL;

// Dynamic imports based on database type
let sqliteModule: typeof import('./schema') | null = null;
let postgresModule: typeof import('./postgres') | null = null;

export async function initializeDatabase(): Promise<void> {
  if (usePostgres) {
    postgresModule = await import('./postgres');
    await postgresModule.getPostgresPool();
    console.log('Using PostgreSQL database');
  } else {
    sqliteModule = await import('./schema');
    await sqliteModule.getDatabase();
    console.log('Using SQLite database');
  }
}

export async function closeDatabase(): Promise<void> {
  if (usePostgres && postgresModule) {
    await postgresModule.closePostgresPool();
  } else if (sqliteModule) {
    sqliteModule.closeDatabase();
  }
}

// Query helpers that work with both databases
export async function queryAll(sql: string, params: any[] = []): Promise<any[]> {
  if (usePostgres && postgresModule) {
    // PostgreSQL uses $1, $2, etc. for parameters
    const pgSql = convertToPostgresParams(sql);
    return postgresModule.query(pgSql, params);
  } else if (sqliteModule) {
    const db = sqliteModule.getDatabaseSync();
    const stmt = db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
  throw new Error('Database not initialized');
}

export async function queryOne(sql: string, params: any[] = []): Promise<any | null> {
  const results = await queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

export async function execute(sql: string, params: any[] = []): Promise<void> {
  if (usePostgres && postgresModule) {
    const pgSql = convertToPostgresParams(sql);
    await postgresModule.execute(pgSql, params);
  } else if (sqliteModule) {
    const db = sqliteModule.getDatabaseSync();
    db.run(sql, params);
    sqliteModule.saveDatabase(db);
  } else {
    throw new Error('Database not initialized');
  }
}

// Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
function convertToPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

// Check if using PostgreSQL
export function isPostgres(): boolean {
  return usePostgres;
}

export { uuidv4 };
