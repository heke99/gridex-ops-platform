import type { NextRequest } from 'next/server'
import {
  InvalidRequestBodyLimitError,
  readTextBodyWithLimit,
} from './boundedRequestBody'

// Conservative default request body cap for externally callable JSON endpoints.
// Customer application / sync payloads are small structured JSON; 256 KB leaves
// generous headroom while preventing abusive large-body requests.
export const DEFAULT_JSON_PAYLOAD_LIMIT_BYTES = 256 * 1024

export type PayloadLimitResult =
  | { ok: true; body: unknown }
  | { ok: false; code: 'payload_too_large' | 'invalid_json'; limitBytes: number }

// Reads and JSON-parses a request body while enforcing a byte cap. Checks the
// declared Content-Length first (cheap, short-circuits oversized uploads) and
// then stops the stream as soon as the actual received bytes exceed the cap.
export async function readJsonWithLimit(
  request: NextRequest,
  limitBytes: number = DEFAULT_JSON_PAYLOAD_LIMIT_BYTES
): Promise<PayloadLimitResult> {
  let raw: string
  try {
    const result = await readTextBodyWithLimit(request, limitBytes)
    if (!result.ok) return { ok: false, code: result.code, limitBytes }
    raw = result.text
  } catch (error) {
    if (error instanceof InvalidRequestBodyLimitError) throw error
    return { ok: false, code: 'invalid_json', limitBytes }
  }

  if (!raw.trim()) return { ok: true, body: {} }

  try {
    return { ok: true, body: JSON.parse(raw) }
  } catch {
    return { ok: false, code: 'invalid_json', limitBytes }
  }
}
