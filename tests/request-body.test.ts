import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCommandBody, MAX_COMMAND_BODY_BYTES } from '../src/lib/request-body';
import { ApiError } from '../src/lib/access';
const request = (body: BodyInit, headers?: HeadersInit) =>
  new Request('http://localhost', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
test('command body accepts the exact byte boundary and preserves UTF-8/BOM JSON semantics', async () => {
  const prefix = '{"padding":"',
    suffix = '"}';
  const body = prefix + 'x'.repeat(MAX_COMMAND_BODY_BYTES - prefix.length - suffix.length) + suffix;
  assert.equal((await readCommandBody(request(body))).padding, JSON.parse(body).padding);
  assert.deepEqual(await readCommandBody(request('\ufeff{"value":"🌍"}')), { value: '🌍' });
});
test('declared oversize is rejected before body reading', async () => {
  await assert.rejects(
    readCommandBody(request('{}', { 'content-length': String(MAX_COMMAND_BODY_BYTES + 1) })),
    (e: unknown) => e instanceof ApiError && e.status === 413,
  );
});
test('chunked bodies cannot bypass the byte limit and are cancelled', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(MAX_COMMAND_BODY_BYTES));
      c.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readCommandBody(request(stream)),
    (e: unknown) => e instanceof ApiError && e.status === 413,
  );
  assert.equal(cancelled, true);
});
