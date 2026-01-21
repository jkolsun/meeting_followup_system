import { Redis } from 'ioredis';

// Support both REDIS_URL (Railway format) and individual env vars
const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

export function createRedisConnection(): Redis {
  if (REDIS_URL) {
    // Use full Redis URL (includes auth) - Railway provides this
    return new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ
    });
  }

  // Fall back to individual env vars
  return new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
  });
}

// Singleton connection for the app
let redisInstance: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redisInstance) {
    redisInstance = createRedisConnection();
  }
  return redisInstance;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
