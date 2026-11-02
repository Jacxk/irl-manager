import type { channel, destination } from '../src/lib/db/schema';
export type ChannelRow = typeof channel.$inferSelect & {
  automaticFallback?: boolean;
  previewSessionId?: string | null;
  previewStartedAt?: Date | null;
  previewLastFrameAt?: Date | null;
};
export type DestinationRow = typeof destination.$inferSelect & { streamKey?: string };
export interface Store {
  load(): Promise<{ channels: ChannelRow[]; destinations: DestinationRow[] }>;
  preview(
    c: ChannelRow,
    sessionId: string,
    patch: { state: string; lastFrameAt: Date | null; finished?: boolean },
  ): Promise<void>;
  channel(c: ChannelRow, patch: Partial<ChannelRow>): Promise<void>;
  destination(
    d: Pick<DestinationRow, 'id' | 'channelId'>,
    sessionId: string | null,
    patch: Partial<DestinationRow>,
  ): Promise<void>;
  event(c: ChannelRow, kind: string, message: string): Promise<void>;
  key(d: DestinationRow): Promise<string>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
export async function createStore(nodeId: string): Promise<Store> {
  if (process.env.CONTROL_URL) return (await import('./remote-store')).remoteStore(nodeId);
  return (await import('./local-store')).localStore(nodeId);
}
