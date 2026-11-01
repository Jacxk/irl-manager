import 'dotenv/config';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import {
  DEVELOPMENT_EMAIL,
  DEVELOPMENT_USER_ID,
  validateDevelopmentDatabase,
} from '../src/lib/development';

// Never ship this fixture as a production schema/data migration.
validateDevelopmentDatabase(process.env.NODE_ENV, process.env.DATABASE_URL);
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
try {
  const password = await hashPassword('test');
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(839152002)`;
    const existing = await tx`select id from "user" where id = ${DEVELOPMENT_USER_ID}`;
    if (existing.length) return;
    const collision = await tx`select id from "user" where email = ${DEVELOPMENT_EMAIL}`;
    if (collision.length)
      throw new Error('Development email already belongs to another account; no data changed.');
    await tx`insert into "user" (id, name, email, "instanceRole", active, "emailVerified")
      values (${DEVELOPMENT_USER_ID}, 'Development Admin', ${DEVELOPMENT_EMAIL}, 'admin', true, true)`;
    await tx`insert into account (id, "accountId", "providerId", "userId", password)
      values (${crypto.randomUUID()}, ${DEVELOPMENT_USER_ID}, 'credential', ${DEVELOPMENT_USER_ID}, ${password})`;
    const workspaceId = crypto.randomUUID();
    await tx`insert into workspace (id, name) values (${workspaceId}, 'Development workspace')`;
    await tx`insert into member (id, "workspaceId", "userId", role)
      values (${crypto.randomUUID()}, ${workspaceId}, ${DEVELOPMENT_USER_ID}, 'owner')`;
  });
  console.log(
    'Development account ready (existing accounts are preserved). See CONTRIBUTING.md for login.',
  );
} finally {
  await sql.end();
}
