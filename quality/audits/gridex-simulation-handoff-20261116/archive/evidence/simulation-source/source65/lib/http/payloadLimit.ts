import type { NextRequest } from 'next/server'

// Conservative default request body cap for externally callable JSON endpoints.
// Customer application / sync payloads are small structured JSON; 256 KB leaves
// generous headroom while preventing abusive large-body requests.
export const DEFAULT_JSON_PAYLOAD_LIMIT_BYTES = 256 * 1024

export type PayloadLimitResult =
  | { ok: true; body: unknown }
  | { ok: false; code: 'payload_too_large' | 'invalid_json'; limitBytes: number }

function declaredContentLength(request: NextRequest): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// Reads and JSON-parses a request body while enforcing a byte cap. Checks the
// declared Content-Length first (cheap, short-circuits oversized uploads) and
// then verifies the actual decoded byte length as a defence-in-depth measure.
export async function readJsonWithLimit(
  request: NextRequest,
  limitBytes: number = DEFAULT_JSON_PAYLOAD_LIMIT_BYTES
): Promise<PayloadLimitResult> {
  const declared = declaredContentLength(request)
  if (declared !== null && declared > limitBytes) {
    return { ok: false, code: 'payload_too_large', limitBytes }
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, code: 'invalid_json', limitBytes }
  }

  if (Buffer.byteLength(raw, 'utf8') > limitBytes) {
    return { ok: false, code: 'payload_too_large', limitBytes }
  }

  if (!raw.trim()) return { ok: true, body: {} }

  try {
    return { ok: true, body: JSON.parse(raw) }
  } catch {
    return { ok: false, code: 'invalid_json', limitBytes }
  }
}
