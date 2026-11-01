import { developmentAccountAllowed } from './development';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { db } from './db';
import * as schema from './db/schema';
import { readSettings } from './settings';
export async function getAuth() {
  const { values: s } = await readSettings();
  return betterAuth({
    baseURL: s.publicUrl,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    user: {
      additionalFields: {
        instanceRole: { type: 'string', defaultValue: 'user', input: false },
        active: { type: 'boolean', defaultValue: true, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: s.minPasswordLength,
      disableSignUp: !s.registrationEnabled,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: s.sessionDays * 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: s.rateLimitMax, storage: 'database' },
    trustedOrigins: [
      s.publicUrl,
      ...s.trustedOrigins
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const person = await db.query.user.findFirst({
              where: eq(schema.user.id, session.userId),
            });
            if (!person?.active || !developmentAccountAllowed(person.id))
              throw new APIError('FORBIDDEN', { message: 'This account is deactivated.' });
          },
        },
      },
    },
  });
}
