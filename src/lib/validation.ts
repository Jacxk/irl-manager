import { z } from 'zod';
export const providerSchema = z.enum(['twitch', 'youtube', 'kick', 'custom']);
export const rtmpUrl = z
  .string()
  .url()
  .max(1000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['rtmp:', 'rtmps:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use an RTMP or RTMPS server URL without credentials, query, or stream key.');
const id = z.string().uuid();
export const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('createServer'),
    name: z.string().trim().min(1).max(80),
    host: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.-]+$/, 'Enter a hostname or IPv4 address.'),
    region: z.string().trim().min(1).max(60),
  }),
  z.object({
    action: z.literal('updateServer'),
    serverId: id,
    name: z.string().trim().min(1).max(80),
    host: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.-]+$/, 'Enter a hostname or IPv4 address.'),
    region: z.string().trim().min(1).max(60),
  }),
  z.object({
    action: z.literal('createChannel'),
    name: z.string().trim().min(1).max(80),
    serverId: id,
    protocol: z.enum(['srtla', 'srt', 'rtmp']),
  }),
  z
    .object({
      action: z.literal('addDestination'),
      channelId: id,
      name: z.string().trim().min(1).max(80),
      provider: providerSchema,
      url: rtmpUrl,
      autoStopConfirmed: z.boolean().optional(),
      key: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .refine((v) => !/[\s\x00-\x1f?#]/.test(v), 'Stream key contains unsupported characters.'),
    })
    .refine((v) => v.provider !== 'youtube' || v.autoStopConfirmed === true, {
      message: 'Enable auto-stop in YouTube Studio and confirm it before adding this destination.',
    }),
  z
    .object({
      action: z.literal('updateDestination'),
      channelId: id,
      destinationId: id,
      name: z.string().trim().min(1).max(80),
      provider: providerSchema,
      url: rtmpUrl,
      autoStopConfirmed: z.boolean().optional(),
      key: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .refine(
          (v) => !v || !/[\s\x00-\x1f?#]/.test(v),
          'Stream key contains unsupported characters.',
        ),
    })
    .refine((v) => v.provider !== 'youtube' || v.autoStopConfirmed === true, {
      message: 'Enable auto-stop in YouTube Studio and confirm it before saving this destination.',
    }),
  z.object({
    action: z.literal('toggleDestination'),
    channelId: id,
    destinationId: id,
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal('deleteDestination'), channelId: id, destinationId: id }),
  z.object({ action: z.literal('deleteChannel'), channelId: id }),
  z.object({ action: z.literal('start'), channelId: id }),
  z.object({ action: z.literal('stop'), channelId: id }),
  z.object({ action: z.literal('fallback'), channelId: id, enabled: z.boolean() }),
  z.object({
    action: z.literal('scene'),
    channelId: id,
    title: z.string().trim().min(1).max(100),
    subtitle: z.string().trim().max(160),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    graceSeconds: z.number().int().min(15).max(3600),
  }),
  z.object({ action: z.literal('credentials'), channelId: id }),
  z.object({ action: z.literal('rotateKey'), channelId: id }),
  z.object({
    action: z.literal('addMember'),
    email: z.string().email(),
    role: z.enum(['admin', 'operator']),
  }),
  z.object({ action: z.literal('acceptInvitation'), invitationId: id }),
  z.object({ action: z.literal('declineInvitation'), invitationId: id }),
  z.object({ action: z.literal('removeMember'), memberId: id }),
]);
