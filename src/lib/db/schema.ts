import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  instanceRole: text().notNull().default('user'),
  active: boolean().notNull().default(true),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});
export const session = pgTable('session', {
  id: text().primaryKey(),
  expiresAt: timestamp().notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
export const account = pgTable('account', {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp(),
  refreshTokenExpiresAt: timestamp(),
  scope: text(),
  password: text(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});
export const verification = pgTable('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow(),
});
export const workspace = pgTable('workspace', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});
export const member = pgTable('member', {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  userId: text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text().notNull().default('operator'),
});
export const mediaServer = pgTable('media_server', {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  host: text().notNull(),
  region: text().notNull().default('Local'),
  shared: boolean().notNull().default(false),
  available: boolean().notNull().default(true),
  heartbeatAt: timestamp(),
  createdAt: timestamp().notNull().defaultNow(),
});
export const channel = pgTable('channel', {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  serverId: text()
    .notNull()
    .references(() => mediaServer.id),
  name: text().notNull(),
  protocol: text().notNull().default('srtla'),
  ingestKey: text().notNull(),
  sceneTitle: text().notNull().default('We’ll be right back'),
  sceneSubtitle: text().notNull().default('Reconnecting to the live stream…'),
  sceneColor: text().notNull().default('#101820'),
  graceSeconds: integer().notNull().default(300),
  desired: text().notNull().default('stopped'),
  state: text().notNull().default('idle'),
  manualFallback: boolean().notNull().default(false),
  sessionId: text(),
  startedAt: timestamp(),
  endedAt: timestamp(),
  endReason: text(),
  lastFrameAt: timestamp(),
  createdAt: timestamp().notNull().defaultNow(),
});
export const destination = pgTable('destination', {
  id: text().primaryKey(),
  channelId: text()
    .notNull()
    .references(() => channel.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  provider: text().notNull(),
  url: text().notNull(),
  encryptedKey: text().notNull(),
  enabled: boolean().notNull().default(true),
  status: text().notNull().default('idle'),
  retries: integer().notNull().default(0),
  lastError: text(),
  updatedAt: timestamp().notNull().defaultNow(),
});
export const event = pgTable('event', {
  id: text().primaryKey(),
  channelId: text()
    .notNull()
    .references(() => channel.id, { onDelete: 'cascade' }),
  sessionId: text(),
  kind: text().notNull(),
  message: text().notNull(),
  details: jsonb(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const invitation = pgTable(
  'invitation',
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [uniqueIndex('invitation_workspace_user').on(table.workspaceId, table.userId)],
);

export const instanceSetting = pgTable('instance_setting', {
  key: text().primaryKey(),
  value: jsonb(),
  revision: integer().notNull().default(1),
  updatedAt: timestamp().notNull().defaultNow(),
});
export const adminAudit = pgTable('admin_audit', {
  id: text().primaryKey(),
  actorId: text().notNull(),
  target: text().notNull(),
  action: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});
export const rateLimit = pgTable('rate_limit', {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: 'number' }).notNull(),
});
