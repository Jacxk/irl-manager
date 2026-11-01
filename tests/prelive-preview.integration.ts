import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { sql } from '../src/lib/db';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_preview_admin_verify'));
const nodeId = randomUUID(),
  channelId = randomUUID();
const paths: string[] = [];
const upstream = createServer((req, res) => {
  paths.push(req.url!);
  res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end('#EXTM3U\n');
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const address = upstream.address();
assert.ok(address && typeof address !== 'string');
const base = 'http://localhost:3158';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3158'], {
  env: {
    ...process.env,
    BETTER_AUTH_URL: base,
    MEDIA_SERVER_ID: nodeId,
    MEDIA_HLS_URL: `http://127.0.0.1:${address.port}`,
    ALLOW_PRE_LIVE_PREVIEW: 'true',
    PREVIEW_ON_BY_DEFAULT: 'true',
    LOCK_BY_ENVIRONMENT: 'false',
  },
  stdio: 'ignore',
});
let userId = '',
  workspaceId = '';
const browser = await chromium.launch();
const mediaDir = mkdtempSync(join(tmpdir(), 'irl-player-'));
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=160x90:rate=24',
  '-t',
  '20',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '24',
  '-f',
  'hls',
  '-hls_time',
  '1',
  '-hls_list_size',
  '0',
  join(mediaDir, 'index.m3u8'),
]);
try {
  for (let i = 0; i < 60; i++) {
    assert.equal(app.exitCode, null);
    try {
      if ((await fetch(base + '/login')).ok) break;
    } catch {}
    await delay(200);
  }
  const signup = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      name: 'Preview test',
      email: `preview-${randomUUID()}@example.test`,
      password: randomUUID(),
    }),
  });
  assert.equal(signup.status, 200);
  userId = (await signup.json()).user.id;
  const cookie = signup.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const headers = { Cookie: cookie };
  const initial = await (await fetch(base + '/api/control', { headers })).json();
  workspaceId = initial.workspace.id;
  assert.equal(initial.previewOnByDefault, true);
  assert.equal(initial.allowPreLivePreview, true);
  await sql`insert into media_server(id,"workspaceId",name,host,region) values(${nodeId},${workspaceId},'Preview node','localhost','Test')`;
  await sql`insert into channel(id,"workspaceId","serverId",name,protocol,"ingestKey") values(${channelId},${workspaceId},${nodeId},'Preview fixture','srt','private-test-key')`;
  const url = base + `/api/preview/${channelId}/index.m3u8`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(paths.at(-1), `/input_${channelId}/index.m3u8`);
  assert.equal(
    (await sql`select desired from channel where id=${channelId}`)[0].desired,
    'stopped',
  );
  await sql`insert into instance_setting(key,value) values('allowPreLivePreview','false'::jsonb)`;
  assert.equal((await fetch(url, { headers })).status, 403);
  assert.equal(
    (await fetch(base + `/api/preview/${channelId}/segment.mp4`, { headers })).status,
    403,
  );
  await sql`update channel set desired='running' where id=${channelId}`;
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(paths.at(-1), `/program_${channelId}/index.m3u8`);
  await sql`update channel set desired='stopped' where id=${channelId}`;
  await sql`delete from instance_setting where key='allowPreLivePreview'`;
  const context = await browser.newContext();
  await context.addCookies(
    cookie.split('; ').map((c) => {
      const i = c.indexOf('=');
      return { name: c.slice(0, i), value: c.slice(i + 1), url: base };
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/preview/**', (route) => {
    const name = basename(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 200,
      contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      body: readFileSync(join(mediaDir, name)),
    });
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Go live', exact: true }).waitFor();
  await page.getByText('INPUT PREVIEW · NOT LIVE', { exact: true }).waitFor();
  const video = page.getByLabel('Incoming stream preview');
  await page.getByText('Input connected · Not live', { exact: true }).waitFor();
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.controls), false);
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.muted), true);
  await page.getByRole('button', { name: 'Pause preview playback', exact: true }).click();
  await page.getByText('Preview playback paused', { exact: true }).waitFor();
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true);
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.getByText('Input connected · Not live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Unmute preview', exact: true }).click();
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.muted), false);
  const volume = page.getByRole('slider', { name: 'Preview volume', exact: true });
  await expect(volume).toHaveAttribute('aria-valuenow', '1');
  await volume.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBe(0);
  await page.getByRole('button', { name: 'Unmute preview', exact: true }).click();
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.muted || v.volume === 0), false);
  const player = page.getByRole('region', { name: 'Stream preview player' });
  await player.focus();
  await page.keyboard.press('m');
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.muted), true);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reconnect preview', exact: true }).click();
  await page.getByText('Input connected · Not live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Disable preview', exact: true }).click();
  await page.getByText('Input preview paused', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enable preview', exact: true }).click();
  await page.getByText('INPUT PREVIEW · NOT LIVE', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.equal(
    (await sql`select desired from channel where id=${channelId}`)[0].desired,
    'stopped',
  );
  console.log(
    'Pre-live input routing, policy enforcement, program routing, default preview, pause/resume, custom playback/audio/fullscreen controls, mobile layout and session isolation passed.',
  );
} finally {
  await browser.close();
  app.kill('SIGTERM');
  await once(app, 'exit');
  upstream.close();
  if (workspaceId) await sql`delete from workspace where id=${workspaceId}`;
  if (userId) await sql`delete from "user" where id=${userId}`;
  await sql.end();
  rmSync(mediaDir, { recursive: true, force: true });
}
