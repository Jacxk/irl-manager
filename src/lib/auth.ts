import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  rateLimit: { enabled: true },
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],
});
