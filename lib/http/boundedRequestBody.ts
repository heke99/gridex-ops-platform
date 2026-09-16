export type BoundedRequestBody = {
  readonly headers: { get(name: string): string | null }
  readonly body: ReadableStream<Uint8Array> | null
}

export type BoundedRequestBodyResult =
  | { ok: true; text: string }
  | { ok: false; code: 'payload_too_large' }

export class InvalidRequestBodyLimitError extends RangeError {
  constructor() {
    super('Request body byte limit must be a non-negative safe integer.')
    this.name = 'InvalidRequestBodyLimitError'
  }
}

function assertValidLimit(limitBytes: number): void {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new InvalidRequestBodyLimitError()
  }
}

function declaredContentLength(request: BoundedRequestBody): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function cancelBody(body: ReadableStream<Uint8Array>): void {
  try {
    void body.cancel().catch(() => undefined)
  } catch {
    // A locked or already failed stream cannot be canceled from this path.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined)
  } catch {
    // Cancellation is best effort after the size decision has been made.
  }
}

/**
 * Read a request body without retaining more than the configured number of
 * received bytes. Stream failures are deliberately propagated to the caller.
 */
export async function readTextBodyWithLimit(
  request: BoundedRequestBody,
  limitBytes: number,
): Promise<BoundedRequestBodyResult> {
  assertValidLimit(limitBytes)

  const declared = declaredContentLength(request)
  if (declared !== null && declared > limitBytes) {
    if (request.body) cancelBody(request.body)
    return { ok: false, code: 'payload_too_large' }
  }

  if (!request.body) return { ok: true, text: '' }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const decodedChunks: string[] = []
  let receivedBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        const finalChunk = decoder.decode()
        if (finalChunk) decodedChunks.push(finalChunk)
        return { ok: true, text: decodedChunks.join('') }
      }

      if (!(value instanceof Uint8Array)) {
        throw new TypeError('Request body stream produced a non-byte chunk.')
      }
      if (value.byteLength > limitBytes - receivedBytes) {
        cancelReader(reader)
        return { ok: false, code: 'payload_too_large' }
      }

      receivedBytes += value.byteLength
      const decoded = decoder.decode(value, { stream: true })
      if (decoded) decodedChunks.push(decoded)
    }
  } finally {
    reader.releaseLock()
  }
}
