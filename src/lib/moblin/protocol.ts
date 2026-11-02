import { createHash, timingSafeEqual } from 'node:crypto';
export function moblinAuthentication(password: string, salt: string, challenge: string) {
  const secret = createHash('sha256')
    .update(password + salt)
    .digest('base64');
  return createHash('sha256')
    .update(secret + challenge)
    .digest('base64');
}
export function verifyMoblinAuthentication(value: string, expected: string) {
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function moblinEndpoint(publicUrl: string, override: string, channelId: string) {
  const url = new URL(override || publicUrl);
  if (!override) url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const local =
    /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      url.hostname,
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local))
  )
    throw new Error('Configure an HTTPS public application URL or an explicit WSS Moblin URL.');
  // Keep the configured host and port. The public reverse proxy routes /moblin/
  // to the private gateway; a machine-specific address is never inferred.
  url.pathname = `/moblin/${channelId}`;
  return url.toString();
}

export type BitrateState = {
  lowBitrateKbps: number;
  lowBitrateSeconds: number;
  recoverySeconds: number;
  lowSince: Date | null;
  healthySince: Date | null;
  lowBitrateActive: boolean;
  bitrateAt?: Date | null;
};
export function nextMoblinBitrate(c: BitrateState, kbps: number, now: Date) {
  if (c.bitrateAt && now.getTime() - c.bitrateAt.getTime() >= 15000)
    c = { ...c, lowSince: null, healthySince: null, lowBitrateActive: false };
  const lowSince = c.lowBitrateKbps > 0 && kbps < c.lowBitrateKbps ? (c.lowSince ?? now) : null;
  const healthySince =
    c.lowBitrateKbps > 0 && kbps >= c.lowBitrateKbps * 1.2 ? (c.healthySince ?? now) : null;
  const lowBitrateActive =
    c.lowBitrateKbps === 0
      ? false
      : lowSince && now.getTime() - lowSince.getTime() >= c.lowBitrateSeconds * 1000
        ? true
        : healthySince && now.getTime() - healthySince.getTime() >= c.recoverySeconds * 1000
          ? false
          : c.lowBitrateActive;
  return { lowSince, healthySince, lowBitrateActive };
}
export function moblinFallbackActive(
  c: { enabled: boolean; lowBitrateActive: boolean; bitrateAt: Date | null },
  now = Date.now(),
) {
  return c.enabled && c.lowBitrateActive && !!c.bitrateAt && now - c.bitrateAt.getTime() < 15000;
}
