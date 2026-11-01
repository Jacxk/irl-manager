import { ApiError } from './access';

// Route handlers do not inherit the server-action limit. Bound transport input
// before parsing; legitimate command fields (including SSH keys) fit well below it.
export const MAX_COMMAND_BODY_BYTES = 2 * 1024 * 1024;

/** Parse a bounded command envelope without misclassifying client input as a server failure. */
export async function readCommandBody(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_COMMAND_BODY_BYTES)
    throw new ApiError(413, 'Request body is too large.');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_COMMAND_BODY_BYTES) {
          await reader.cancel();
          throw new ApiError(413, 'Request body is too large.');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError(400, 'Invalid JSON request body.');
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'Request body must be an object.');
  return body as Record<string, unknown>;
}
