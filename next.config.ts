import type { NextConfig } from 'next';
const gateway = new URL(process.env.MOBLIN_GATEWAY_URL ?? 'http://127.0.0.1:3001');
if (
  !['http:', 'https:'].includes(gateway.protocol) ||
  gateway.username ||
  gateway.password ||
  gateway.pathname !== '/' ||
  gateway.search ||
  gateway.hash
)
  throw new Error(
    'MOBLIN_GATEWAY_URL must be an internal HTTP(S) origin without credentials or a path.',
  );
const config: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  async rewrites() {
    return {
      beforeFiles: [{ source: '/moblin/:path*', destination: `${gateway.origin}/moblin/:path*` }],
    };
  },
  serverExternalPackages: ['postgres'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    // Build containers discard this cache; avoid retaining its graph during type checking.
    turbopackFileSystemCacheForBuild: false,
  },
};
export default config;
