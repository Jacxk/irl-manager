import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { account, adminAudit, user, verification } from '../src/lib/db/schema';
import { readSettings } from '../src/lib/settings';

try {
  const email = process.argv[2]?.trim();
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the application database.');
  if (!email || process.argv.length !== 3) {
    throw new Error('Usage: npm run admin:reset-password -- <administrator-email>');
  }
  const { values } = await readSettings();
  const token = randomBytes(32).toString('hex');
  await db.transaction(async (tx) => {
    const [person] = await tx.select().from(user).where(eq(user.email, email)).for('update');
    if (!person || !person.active || person.instanceRole !== 'admin') {
      throw new Error('Email must identify an active instance administrator.');
    }
    const credentials = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, person.id), eq(account.providerId, 'credential')));
    if (credentials.length !== 1)
      throw new Error('Administrator must have exactly one password account.');
    await tx
      .delete(verification)
      .where(
        and(eq(verification.value, person.id), like(verification.identifier, 'reset-password:%')),
      );
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: `reset-password:${token}`,
      value: person.id,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    await tx.insert(adminAudit).values({
      id: randomUUID(),
      actorId: 'system:cli',
      target: person.id,
      action: 'resetPassword.cli',
    });
  });
  console.log(
    `Single-use reset link (expires in 5 minutes):\n${values.publicUrl}/reset-password#${token}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create a reset link.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
