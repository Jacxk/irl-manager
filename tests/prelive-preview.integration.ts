import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
let publishing = true;
const upstream = createServer((req, res) => {
  paths.push(req.url!);
  if (!publishing) {
    res.writeHead(404).end('No stream');
    return;
  }
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
  const statusUrl = base + `/api/preview/${channelId}/status.json`;
  assert.equal((await fetch(statusUrl)).status, 401);
  publishing = false;
  assert.deepEqual(await (await fetch(statusUrl, { headers })).json(), { connected: false });
  publishing = true;
  assert.deepEqual(await (await fetch(statusUrl, { headers })).json(), { connected: true });
  assert.equal(paths.at(-1), `/input_${channelId}/index.m3u8`);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(paths.at(-1), `/input_${channelId}/index.m3u8`);
  assert.equal(
    (await sql`select desired from channel where id=${channelId}`)[0].desired,
    'stopped',
  );
  const agentToken = randomUUID(),
    agentInstance = randomUUID();
  await sql`update media_server set "agentTokenHash"=${createHash('sha256').update(agentToken).digest('hex')},"agentInstance"=${agentInstance},"heartbeatAt"=now() where id=${nodeId}`;
  for (const upstreamStatus of [200, 404]) {
    const pending = fetch(statusUrl, { headers });
    let ticket: { id: string; path: string } | undefined;
    for (let i = 0; i < 50; i++) {
      ticket = (
        await sql`select id,path from node_preview where "nodeId"=${nodeId} limit 1`
      )[0] as typeof ticket;
      if (ticket) break;
      await delay(50);
    }
    assert.ok(ticket);
    assert.equal(ticket.path, `input_${channelId}/index.m3u8`);
    const reply = await fetch(base + `/api/nodes/agent/preview/${ticket.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'x-node-id': nodeId,
        'x-node-instance': agentInstance,
        'x-preview-status': String(upstreamStatus),
        'content-type': 'application/vnd.apple.mpegurl',
      },
      body: upstreamStatus === 200 ? '#EXTM3U\n' : 'No stream',
    });
    assert.equal(reply.status, 204);
    assert.deepEqual(await (await pending).json(), { connected: upstreamStatus === 200 });
  }
  await sql`update media_server set "heartbeatAt"=now()-interval '30 seconds' where id=${nodeId}`;
  assert.deepEqual(await (await fetch(statusUrl, { headers })).json(), { connected: false });
  assert.equal((await sql`select id from node_preview where "nodeId"=${nodeId}`).length, 0);
  await sql`update media_server set "agentTokenHash"=null,"agentInstance"=null where id=${nodeId}`;
  await sql`insert into instance_setting(key,value) values('allowPreLivePreview','false'::jsonb)`;
  assert.equal((await fetch(url, { headers })).status, 403);
  assert.equal((await fetch(statusUrl, { headers })).status, 403);
  assert.equal(
    (await fetch(base + `/api/preview/${channelId}/segment.mp4`, { headers })).status,
    403,
  );
  await sql`update channel set desired='running' where id=${channelId}`;
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(paths.at(-1), `/program_${channelId}/index.m3u8`);
  assert.deepEqual(await (await fetch(statusUrl, { headers })).json(), { connected: true });
  assert.equal(paths.at(-1), `/input_${channelId}/index.m3u8`);
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
  let inputAvailable = false;
  let programAvailable = false;
  await page.route('**/api/preview/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/status.json'))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: inputAvailable }),
      });
    if (!inputAvailable && !programAvailable)
      return route.fulfill({ status: 404, body: 'No incoming stream' });
    const name = basename(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 200,
      contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      body: readFileSync(join(mediaDir, name)),
    });
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Go live', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'No incoming stream', exact: true }).waitFor();
  assert.equal(await page.locator('video').count(), 0);
  inputAvailable = true;
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
  await expect
    .poll(() =>
      video.evaluate(
        (v: HTMLVideoElement) => Number.isFinite(v.duration) && v.duration > 0 && v.readyState >= 2,
      ),
    )
    .toBe(true);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.max(0, v.duration - 0.5);
    v.playbackRate = 4;
  });
  inputAvailable = false;
  await page
    .getByRole('heading', { name: 'No incoming stream', exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(await page.locator('video').count(), 0);
  inputAvailable = true;
  await page.getByText('Input connected · Not live', { exact: true }).waitFor({ timeout: 15000 });
  await video.evaluate((v: HTMLVideoElement) => {
    v.playbackRate = 1;
  });
  await page.getByRole('button', { name: 'Disable preview', exact: true }).click();
  await page.getByText('Input preview paused', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enable preview', exact: true }).click();
  await page.getByText('INPUT PREVIEW · NOT LIVE', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const protectedSession = randomUUID();
  await sql`insert into moblin_pairing("channelId","workspaceId","pairedBy","encryptedPassword",enabled,"lastStreaming","previewSessionId","previewStartedAt","previewState") values(${channelId},${workspaceId},${userId},'isolated-unused-password',true,true,${protectedSession},now(),'fallback')`;
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(paths.at(-1), `/preview_${channelId}/index.m3u8`);
  programAvailable = true;
  inputAvailable = false;
  await page.getByText('BRB PREVIEW · NOT BROADCASTING', { exact: true }).waitFor();
  await expect(page.getByLabel('BRB-protected pre-live preview')).toBeVisible();
  await page.getByText('BRB preview · Waiting for input', { exact: true }).waitFor();
  await delay(3500);
  await expect(page.getByLabel('BRB-protected pre-live preview')).toBeVisible();
  assert.equal(
    (await sql`select desired from channel where id=${channelId}`)[0].desired,
    'stopped',
  );
  await sql`update moblin_pairing set "lastStreaming"=false,"previewSessionId"=null where "channelId"=${channelId}`;
  programAvailable = false;
  await page.getByRole('heading', { name: 'No incoming stream', exact: true }).waitFor();
  inputAvailable = true;
  await sql`update channel set desired='running',state='live',"sessionId"=${randomUUID()} where id=${channelId}`;
  programAvailable = true;
  inputAvailable = false;
  await sql`update channel set state='fallback' where id=${channelId}`;
  await page.getByText('PROGRAM PREVIEW', { exact: true }).waitFor();
  await page.getByText('Fallback active', { exact: true }).waitFor();
  await expect(page.getByLabel('Final program preview')).toBeVisible();
  // Input loss during a live session must not unmount the BRB program preview.
  await delay(3500);
  await expect(page.getByLabel('Final program preview')).toBeVisible();
  inputAvailable = true;
  await page.getByRole('button', { name: 'End stream', exact: true }).click();
  await page.getByRole('button', { name: 'End all destinations', exact: true }).click();
  programAvailable = false;
  await page.getByText('INPUT PREVIEW · NOT LIVE', { exact: true }).waitFor();
  inputAvailable = false;
  await page.getByRole('heading', { name: 'No incoming stream', exact: true }).waitFor();
  assert.equal(await page.locator('video').count(), 0);
  inputAvailable = true;
  await page.getByText('Input connected · Not live', { exact: true }).waitFor({ timeout: 15000 });
  assert.deepEqual(errors, []);
  assert.equal(
    (await sql`select desired from channel where id=${channelId}`)[0].desired,
    'stopped',
  );
  console.log(
    'No publisher means no player; publisher arrival opens preview, departure removes it, reconnection reopens it; pre-live input routing, policy enforcement, program routing, default preview, pause/resume, custom playback/audio/fullscreen controls, mobile layout and session isolation passed.',
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
