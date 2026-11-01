export const DEVELOPMENT_USER_ID = 'irl-development-admin';
export const DEVELOPMENT_EMAIL = 'admin@example.test';

export function developmentAccountAllowed(
  id: string,
  mode: string | undefined = process.env.NODE_ENV,
) {
  return id !== DEVELOPMENT_USER_ID || mode === 'development';
}

export function validateDevelopmentDatabase(
  mode: string | undefined,
  connection: string | undefined,
) {
  if (mode !== 'development')
    throw new Error('Development migration requires NODE_ENV=development.');
  if (!connection) throw new Error('Set DATABASE_URL using npm run setup first.');
  const url = new URL(connection);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !(url.pathname === '/irl' || url.pathname.endsWith('_dev'))
  ) {
    throw new Error('Use a dedicated local development database named irl or ending in _dev.');
  }
}
