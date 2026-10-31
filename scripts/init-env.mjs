import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env already exists; left unchanged.');
  process.exit(0);
}
const secret = () => randomBytes(32).toString('hex');
const password = secret();
writeFileSync(
  '.env',
  `DATABASE_URL=postgres://irl:${password}@localhost:5432/irl\nPOSTGRES_PASSWORD=${password}\nBETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${secret()}\nENCRYPTION_KEY=${secret()}\nMEDIA_WORKER_TOKEN=${secret()}\nMEDIA_SERVER_ID=\nMEDIA_INTERNAL_HOST=localhost\nMEDIA_HLS_URL=http://localhost:8888\n`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Created .env with unique local secrets. Add a node in the app, then set MEDIA_SERVER_ID.',
);
