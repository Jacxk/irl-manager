import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from '../src/lib/db';
import { remotePreview } from '../src/lib/nodes/preview';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const a = randomUUID(),
  b = randomUUID(),
  other = randomUUID(),
  foreignChannel = randomUUID(),
  lease = randomUUID();
const tokenA = randomUUID(),
  tokenB = randomUUID();
let pending: Promise<Response> | undefined;
async function put(node: string, token: string, id: string, body: string, instance = lease) {
  return fetch(`${base}/api/nodes/agent/preview/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-node-id': node,
      'x-node-instance': instance,
      'x-preview-status': '200',
      'content-type': 'video/mp2t',
    },
    body,
  });
}
try {
  await sql`insert into workspace(id,name) values(${other},'Foreign preview fixture')`;
  for (const [id, workspace, token] of [
    [a, fixture.workspaces[0], tokenA],
    [b, other, tokenB],
  ])
    await sql`insert into media_server(id,"workspaceId",name,host,region,"agentTokenHash","agentInstance") values(${id},${workspace},'Preview test','localhost','Test',${createHash('sha256').update(token).digest('hex')},${lease})`;
  await sql`insert into channel(id,"workspaceId","serverId",name,protocol,"ingestKey") values(${foreignChannel},${other},${b},'Foreign preview','srt','test-key')`;
  assert.equal(
    (
      await fetch(`${base}/api/preview/${foreignChannel}/index.m3u8`, {
        headers: { Cookie: fixture.owner.cookie },
      })
    ).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/preview/${fixture.channel.id}/index.m3u8`)).status, 401);
  const ticket = randomUUID(),
    expired = randomUUID();
  await sql`insert into node_preview(id,"nodeId",path,"expiresAt") values(${ticket},${a},'program_test/index.m3u8',${new Date(Date.now() + 60000).toISOString()}),(${expired},${a},'program_test/index.m3u8',${new Date(Date.now() - 1000).toISOString()})`;
  assert.equal((await put(b, tokenB, ticket, 'foreign')).status, 204);
  assert.equal((await put(a, tokenA, expired, 'expired')).status, 204);
  assert.equal((await put(a, tokenA, ticket, 'lost lease', randomUUID())).status, 409);
  for (const id of [ticket, expired])
    assert.equal((await sql`select status from node_preview where id=${id}`)[0].status, null);
  assert.equal((await put(a, tokenA, ticket, 'x'.repeat(8 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await sql`select status from node_preview where id=${ticket}`)[0].status, null);
  const boundary = randomUUID();
  await sql`insert into node_preview(id,"nodeId",path,"expiresAt") values(${boundary},${a},'program_test/boundary.ts',${new Date(Date.now() + 60000).toISOString()})`;
  assert.equal((await put(a, tokenA, boundary, 'x'.repeat(8 * 1024 * 1024))).status, 204);
  assert.equal(
    (
      await sql`select octet_length(decode(body,'base64')) as bytes from node_preview where id=${boundary}`
    )[0].bytes,
    8 * 1024 * 1024,
  );
  await sql`delete from node_preview where id=${boundary}`;
  assert.equal((await put(a, tokenA, ticket, 'first')).status, 204);
  assert.equal((await put(a, tokenA, ticket, 'second')).status, 204);
  assert.equal(
    Buffer.from(
      (await sql`select body from node_preview where id=${ticket}`)[0].body,
      'base64',
    ).toString(),
    'first',
  );
  await sql`delete from node_preview where "nodeId"=${a}`;
  console.log(
    'PASS preview tenant isolation, guest denial, lease checks, expiry and single-use replies',
  );
  await sql`update channel set "serverId"=${a} where id=${fixture.channel.id}`;
  await sql`insert into node_preview(id,"nodeId",path,"expiresAt") select gen_random_uuid()::text,${a},'program_test/index.m3u8',${new Date(Date.now() + 60000).toISOString()}::timestamp from generate_series(1,32)`;
  const limited = await fetch(`${base}/api/preview/${fixture.channel.id}/index.m3u8`, {
    headers: { Cookie: fixture.owner.cookie },
  });
  assert.equal(limited.status, 429, 'Preview quota must report a client retry response');
  await sql`delete from node_preview where "nodeId"=${a}`;
  const controller = new AbortController();
  pending = remotePreview(a, 'program_test/index.m3u8', controller.signal);
  for (let i = 0; i < 100; i++) {
    if ((await sql`select id from node_preview where "nodeId"=${a}`).length) break;
    await delay(10);
  }
  controller.abort();
  const stopped = await Promise.race([
    pending.then(
      () => false,
      () => true,
    ),
    delay(1000).then(() => false),
  ]);
  assert.equal(stopped, true, 'Cancelled preview must stop promptly');
  assert.equal(
    (await sql`select id from node_preview where "nodeId"=${a}`).length,
    0,
    'Cancelled ticket must release preview capacity',
  );
  console.log('PASS cancelled preview stops and releases ticket capacity promptly');
  pending = remotePreview(a, 'program_test/index.m3u8');
  let liveTicket: string | undefined;
  for (let i = 0; i < 100; i++) {
    liveTicket = (await sql`select id from node_preview where "nodeId"=${a}`)[0]?.id;
    if (liveTicket) break;
    await delay(10);
  }
  assert.ok(liveTicket);
  await put(a, tokenA, liveTicket, 'preview bytes');
  assert.equal(await (await pending).text(), 'preview bytes');
  const client = new AbortController();
  const disconnected = fetch(`${base}/api/preview/${fixture.channel.id}/index.m3u8`, {
    headers: { Cookie: fixture.owner.cookie },
    signal: client.signal,
  }).catch(() => null);
  for (let i = 0; i < 100; i++) {
    if ((await sql`select id from node_preview where "nodeId"=${a}`).length) break;
    await delay(10);
  }
  assert.equal((await sql`select id from node_preview where "nodeId"=${a}`).length, 1);
  client.abort();
  await disconnected;
  for (let i = 0; i < 100; i++) {
    if (!(await sql`select id from node_preview where "nodeId"=${a}`).length) break;
    await delay(20);
  }
  assert.equal((await sql`select id from node_preview where "nodeId"=${a}`).length, 0);
  console.log('PASS normal preview delivery and HTTP disconnect ticket cleanup');
} finally {
  await sql`update node_preview set status=503,body='' where "nodeId"=${a}`;
  await pending?.catch(() => {});
  await sql`update channel set "serverId"=${fixture.server.id} where id=${fixture.channel.id}`;
  await sql`delete from workspace where id=${other}`;
  await sql`delete from media_server where id=${a}`;
  await sql.end();
}
