import 'dotenv/config';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating.');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(
    readFileSync(new URL('../migrations/004-channel-telemetry.sql', import.meta.url), 'utf8'),
  );
  console.log('Channel telemetry columns are present. Existing channels and routes are unchanged.');
} finally {
  await sql.end();
}
