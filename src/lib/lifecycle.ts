export type Health = 'starting' | 'live' | 'degraded' | 'fallback' | 'recovering' | 'ended';
export function nextHealth(input: {
  desired: string;
  manual: boolean;
  now: number;
  lastFrame: number;
  stableSince: number | null;
  started: number;
  graceSeconds: number;
}): Health {
  if (input.desired === 'stopped') return 'ended';
  const absent = input.now - (input.lastFrame || input.started);
  if (absent >= input.graceSeconds * 1000) return 'ended';
  if (input.manual) return 'fallback';
  if (!input.lastFrame) return absent < 5000 ? 'starting' : 'fallback';
  if (absent >= 5000) return 'fallback';
  if (absent >= 2000) return 'degraded';
  if (input.stableSince === null || input.now - input.stableSince < 5000) return 'recovering';
  return 'live';
}
export function retryDelay(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}
