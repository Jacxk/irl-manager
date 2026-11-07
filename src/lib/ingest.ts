const PATH_PATTERN = /^input_[A-Za-z0-9_-]+$/;

export type PublishIdentity = { path: string; user: string; password: string };

function decodePath(path: string) {
  let value = path;
  for (let attempt = 0; attempt < 2 && value.includes('%'); attempt++) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}

function withQuery(user: string, password: string, query: string) {
  const params = new URLSearchParams(query);
  return {
    user: user || params.get('user') || '',
    password: password || params.get('pass') || params.get('password') || '',
  };
}

/** Accept a real query string and a stream key that still contains an encoded "?". */
export function publishIdentity(input: {
  action?: unknown;
  path?: unknown;
  user?: unknown;
  password?: unknown;
  query?: unknown;
}): PublishIdentity | null {
  if (input.action !== 'publish' || typeof input.path !== 'string' || !input.path) return null;
  let path = decodePath(input.path);
  let user = typeof input.user === 'string' ? input.user : '';
  let password = typeof input.password === 'string' ? input.password : '';
  const embedded = path.indexOf('?');
  if (embedded >= 0) {
    ({ user, password } = withQuery(user, password, path.slice(embedded + 1)));
    path = path.slice(0, embedded);
  }
  if (typeof input.query === 'string' && input.query)
    ({ user, password } = withQuery(user, password, input.query));
  if (!PATH_PATTERN.test(path) || !user || !password) return null;
  return { path, user, password };
}

export function encoderConnection(credentials: {
  host: string;
  path: string;
  username: string;
  key: string;
}) {
  const streamId = `publish:${credentials.path}:${credentials.username}:${credentials.key}`;
  return {
    rtmpServer: `rtmp://${credentials.host}:1935`,
    rtmpStreamKey: `${credentials.path}?user=${credentials.username}&pass=${credentials.key}`,
    srtServer: `srt://${credentials.host}:8890`,
    srtStreamId: streamId,
    srtUrl: `srt://${credentials.host}:8890?streamid=${streamId}`,
    srtlaAddress: `${credentials.host}:5000`,
    srtlaUrl: `srtla://${credentials.host}:5000?streamid=${streamId}`,
    rtmpUrl: `rtmp://${credentials.host}:1935/${credentials.path}?user=${credentials.username}&pass=${credentials.key}`,
    localOnly: ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(credentials.host),
  };
}

export type IngestProtocol = 'srtla' | 'srt' | 'rtmp';

export function encoderGuide(
  credentials: { host: string; path: string; username: string; key: string },
  protocol: IngestProtocol,
) {
  const connection = encoderConnection(credentials);
  const hostNote = connection.localOnly
    ? `Node host is ${credentials.host}. That address only works on this computer. Edit this node’s host to a name the phone can reach, then copy these fields again.`
    : `Node host is ${credentials.host}.`;
  const guides: Record<
    IngestProtocol,
    { url: string; urlHint: string; parts: { label: string; value: string; hint: string; secret?: boolean }[] }
  > = {
    srtla: {
      url: connection.srtlaUrl,
      urlHint: 'Paste this whole URL if Moblin has one URL field.',
      parts: [
        {
          label: 'Address',
          value: connection.srtlaAddress,
          hint: 'Moblin → SRTLA, if it asks for the address separately.',
        },
        {
          label: 'Stream ID',
          value: connection.srtStreamId,
          hint: 'Moblin → Stream ID. Leave this out of the URL when you use the separate fields.',
          secret: true,
        },
      ],
    },
    srt: {
      url: connection.srtUrl,
      urlHint: 'Paste this whole URL if Moblin has one URL field.',
      parts: [
        {
          label: 'Server',
          value: connection.srtServer,
          hint: 'Moblin → SRT → URL, without the stream ID.',
        },
        {
          label: 'Stream ID',
          value: connection.srtStreamId,
          hint: 'Moblin → SRT → Stream ID.',
          secret: true,
        },
      ],
    },
    rtmp: {
      url: connection.rtmpUrl,
      urlHint: 'Paste this whole URL if Moblin has one URL field.',
      parts: [
        {
          label: 'Server',
          value: connection.rtmpServer,
          hint: 'Moblin → RTMP → server, without the stream key.',
        },
        {
          label: 'Stream key',
          value: connection.rtmpStreamKey,
          hint: 'Paste the whole key, including the question mark.',
          secret: true,
        },
      ],
    },
  };
  return { connection, hostNote, ...guides[protocol] };
}

export function encoderFields(
  credentials: { host: string; path: string; username: string; key: string },
  protocol: string,
) {
  const selected: IngestProtocol = protocol === 'rtmp' || protocol === 'srt' ? protocol : 'srtla';
  const guide = encoderGuide(credentials, selected);
  return {
    connection: guide.connection,
    fields: [
      { label: `${selected.toUpperCase()} URL`, value: guide.url, hint: guide.urlHint },
      ...guide.parts.map((part) => ({
        label: part.label,
        value: part.value,
        hint: part.hint,
      })),
    ],
  };
}
