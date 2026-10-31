export type Channel = {
  id: string;
  serverId: string;
  name: string;
  protocol: string;
  sceneTitle: string;
  sceneSubtitle: string;
  sceneColor: string;
  graceSeconds: number;
  desired: string;
  state: string;
  manualFallback: boolean;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  lastFrameAt: string | null;
};
export type Destination = {
  id: string;
  channelId: string;
  name: string;
  provider: string;
  url: string;
  enabled: boolean;
  status: string;
  retries: number;
  lastError: string | null;
};
export type Server = {
  id: string;
  name: string;
  host: string;
  region: string;
  heartbeatAt: string | null;
};
export type DashboardData = {
  invitations: { id: string; workspaceName: string; role: string }[];
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string };
  role: string;
  channels: Channel[];
  destinations: Destination[];
  servers: Server[];
  members: { id: string; name: string; email: string; role: string }[];
  events: { id: string; channelId: string; kind: string; message: string; createdAt: string }[];
};
