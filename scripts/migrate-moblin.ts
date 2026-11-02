import 'dotenv/config';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating.');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(readFileSync(new URL('../migrations/002-moblin.sql', import.meta.url), 'utf8'));
  await sql.unsafe(
    readFileSync(new URL('../migrations/003-moblin-preview.sql', import.meta.url), 'utf8'),
  );
  console.log('Moblin migration complete.');
} finally {
  await sql.end();
}
