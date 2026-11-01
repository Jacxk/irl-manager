import { z } from 'zod';
const text = z.string().trim().max(500);
const asset = z.union([
  z.literal(''),
  z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === 'https:', 'Use an HTTPS URL.'),
]);
export const settingDefinitions = {
  instanceName: {
    section: 'General',
    label: 'Instance name',
    env: 'INSTANCE_NAME',
    default: 'IRL Manager',
    schema: text.min(1),
  },
  description: {
    section: 'General',
    label: 'Description',
    env: 'INSTANCE_DESCRIPTION',
    default: 'A control room for your IRL broadcasts.',
    schema: text,
  },
  publicUrl: {
    section: 'General',
    label: 'Public application URL',
    env: 'BETTER_AUTH_URL',
    default: 'http://localhost:3000',
    schema: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          ['http:', 'https:'].includes(u.protocol) && u.origin === v && !u.username && !u.password
        );
      }, 'Use an HTTP(S) origin without a trailing slash or path.'),
  },
  logoUrl: {
    section: 'Appearance',
    label: 'Logo URL',
    env: 'LOGO_URL',
    default: '',
    schema: asset,
  },
  faviconUrl: {
    section: 'Appearance',
    label: 'Favicon URL',
    env: 'FAVICON_URL',
    default: '',
    schema: asset,
  },
  accentColor: {
    section: 'Appearance',
    label: 'Accent color',
    env: 'ACCENT_COLOR',
    default: '#dfef94',
    schema: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  },
  theme: {
    section: 'Appearance',
    label: 'Default theme',
    env: 'DEFAULT_THEME',
    default: 'dark',
    schema: z.enum(['dark', 'light', 'system']),
  },
  loginMessage: {
    section: 'Announcements',
    label: 'Login message',
    env: 'LOGIN_MESSAGE',
    default: '',
    schema: text,
  },
  banner: {
    section: 'Announcements',
    label: 'Instance banner',
    env: 'INSTANCE_BANNER',
    default: '',
    schema: text,
  },
  maintenanceNotice: {
    section: 'Announcements',
    label: 'Maintenance notice (informational)',
    env: 'MAINTENANCE_NOTICE',
    default: '',
    schema: text,
  },
  registrationEnabled: {
    section: 'Access',
    label: 'Allow registration',
    env: 'REGISTRATION_ENABLED',
    default: true,
    schema: z.boolean(),
  },
  minPasswordLength: {
    section: 'Access',
    label: 'Minimum password length',
    env: 'MIN_PASSWORD_LENGTH',
    default: 10,
    schema: z.number().int().min(10).max(128),
  },
  sessionDays: {
    section: 'Access',
    label: 'Session lifetime (days; new sessions)',
    env: 'SESSION_DAYS',
    default: 7,
    schema: z.number().int().min(1).max(90),
  },
  trustedOrigins: {
    section: 'Access',
    label: 'Additional trusted origins (comma separated)',
    env: 'TRUSTED_ORIGINS',
    default: '',
    schema: text.refine(
      (v) =>
        !v ||
        v.split(',').every((s) => {
          try {
            const u = new URL(s.trim());
            return ['http:', 'https:'].includes(u.protocol) && u.origin === s.trim();
          } catch {
            return false;
          }
        }),
      'Enter HTTP(S) origins separated by commas.',
    ),
  },
  rateLimitMax: {
    section: 'Access',
    label: 'Global auth requests per minute (sensitive endpoints have additional limits)',
    env: 'AUTH_RATE_LIMIT_MAX',
    default: 100,
    schema: z.number().int().min(5).max(1000),
  },
  allowWorkspaceCreation: {
    section: 'Policies',
    label: 'Allow workspace creation',
    env: 'ALLOW_WORKSPACE_CREATION',
    default: true,
    schema: z.boolean(),
  },
  allowPersonalNodes: {
    section: 'Policies',
    label: 'Allow users to add personal nodes',
    env: 'ALLOW_PERSONAL_NODES',
    default: true,
    schema: z.boolean(),
  },
  maxNodesPerWorkspace: {
    section: 'Policies',
    label: 'Personal nodes per workspace (0 = unlimited)',
    env: 'MAX_NODES_PER_WORKSPACE',
    default: 0,
    schema: z.number().int().min(0).max(10000),
  },
  allowLocalNodeInstallation: {
    section: 'Node operations',
    label: 'Allow local node installation',
    env: 'ALLOW_LOCAL_NODE_INSTALLATION',
    default: true,
    schema: z.boolean(),
  },
  allowSshNodeInstallation: {
    section: 'Node operations',
    label: 'Allow remote node installation over SSH',
    env: 'ALLOW_SSH_NODE_INSTALLATION',
    default: true,
    schema: z.boolean(),
  },
  allowNodeRemoval: {
    section: 'Node operations',
    label: 'Allow permanent node removal',
    env: 'ALLOW_NODE_REMOVAL',
    default: true,
    schema: z.boolean(),
  },
  nodeControlUrl: {
    section: 'Node operations',
    label: 'Default node control URL (blank uses public application URL; new setups only)',
    env: 'NODE_CONTROL_URL',
    default: '',
    schema: z
      .string()
      .trim()
      .refine((v) => {
        if (!v) return true;
        try {
          const u = new URL(v);
          return (
            ['http:', 'https:'].includes(u.protocol) && u.origin === v && !u.username && !u.password
          );
        } catch {
          return false;
        }
      }, 'Use an HTTP(S) origin without credentials, path, or trailing slash.'),
  },
  allowPreLivePreview: {
    section: 'Policies',
    label: 'Allow input preview before Go live (applies immediately)',
    env: 'ALLOW_PRE_LIVE_PREVIEW',
    default: true,
    schema: z.boolean(),
  },
  previewOnByDefault: {
    section: 'UI defaults',
    label: 'Enable preview by default (new dashboard views)',
    env: 'PREVIEW_ON_BY_DEFAULT',
    default: true,
    schema: z.boolean(),
  },
  language: {
    section: 'UI defaults',
    label: 'Language / locale',
    env: 'DEFAULT_LANGUAGE',
    default: 'en',
    schema: text.refine((v) => {
      try {
        new Intl.DateTimeFormat(v);
        return !!v;
      } catch {
        return false;
      }
    }),
  },
  timezone: {
    section: 'UI defaults',
    label: 'Timezone',
    env: 'DEFAULT_TIMEZONE',
    default: 'UTC',
    schema: text.refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  },
  hour12: {
    section: 'UI defaults',
    label: 'Use 12-hour clock',
    env: 'USE_12_HOUR_CLOCK',
    default: false,
    schema: z.boolean(),
  },
} as const;
export type SettingKey = keyof typeof settingDefinitions;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingDefinitions)[K]['schema']> };
export function resolveSetting(
  key: SettingKey,
  saved: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const d = settingDefinitions[key];
  const present = env[d.env] !== undefined;
  const locked = env.LOCK_BY_ENVIRONMENT === 'true' && present;
  const source = locked
    ? 'Environment'
    : saved !== undefined
      ? 'Saved'
      : present
        ? 'Environment'
        : 'Default';
  let value: unknown = source === 'Saved' ? saved : source === 'Default' ? d.default : env[d.env];
  if (source === 'Environment') {
    if (typeof d.default === 'boolean') {
      if (value !== 'true' && value !== 'false')
        throw new Error(`Invalid environment setting: ${d.env}`);
      value = value === 'true';
    } else if (typeof d.default === 'number') value = value === '' ? NaN : Number(value);
  }
  const result = d.schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid configuration: ${d.env}`);
  return { value: result.data, source, locked };
}
