import 'dotenv/config';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating.');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(
    readFileSync(new URL('../migrations/001-instance-admin.sql', import.meta.url), 'utf8'),
  );
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (bootstrapEmail) {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(839152001)`;
      const admins =
        await tx`select id from "user" where "instanceRole" = 'admin' and active = true`;
      if (admins.length)
        throw new Error('An active administrator already exists. Use the admin UI.');
      const users =
        await tx`update "user" set "instanceRole" = 'admin', active = true where email = ${bootstrapEmail} returning id`;
      if (users.length !== 1)
        throw new Error('Bootstrap email must identify exactly one existing account.');
      await tx`insert into admin_audit (id, "actorId", target, action) values (${crypto.randomUUID()}, ${users[0].id}, ${users[0].id}, 'bootstrap.admin.explicit')`;
    });
  }
  console.log('Admin migration complete.');
} finally {
  await sql.end();
}
