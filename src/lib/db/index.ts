import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
const globalDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
export const sql =
  globalDb.sql ??
  postgres(process.env.DATABASE_URL ?? 'postgres://irl:irl@localhost:5432/irl', { max: 10 });
if (process.env.NODE_ENV !== 'production') globalDb.sql = sql;
export const db = drizzle(sql, { schema });
