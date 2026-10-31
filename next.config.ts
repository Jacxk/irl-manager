import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['postgres'],
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};
export default config;
