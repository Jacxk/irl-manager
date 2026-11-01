import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { sql } from '../src/lib/db';
try {
  const migration = await readFile(
    new URL('../migrations/20261101_node_removal.sql', import.meta.url),
    'utf8',
  );
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
  });
  console.log('Node removal migration applied. Existing settings and data preserved.');
} finally {
  await sql.end();
}
