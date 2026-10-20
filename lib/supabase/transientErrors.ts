// Transport and gateway failures between the app and PostgREST/Postgres: the request never got a
// trustworthy answer, so an idempotent retry is safe and the caller should be told to retry
// (FINDINGS F43). Validation, business and authorization errors are never transient.
//
// supabase-js reports them in three shapes:
//  - fetch failed: { message: 'TypeError: fetch failed', details: '... UND_ERR_SOCKET ...', code: '' }
//  - gateway 502/504 body: { message: 'An invalid response was received from the upstream server' }
//    (the HTTP status is lost once callers rethrow the error object)
//  - Postgres/PostgREST connection codes: 08xxx, 57P01/57P03, 53300, PGRST000-PGRST003
const TRANSPORT_TEXT =
  /fetch failed|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|CLOSED)|other side closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|invalid response was received from the upstream server|upstream server is timing out|failure to get a peer from the ring-balancer|name resolution failed/i
const TRANSIENT_CODES = new Set(['57P01', '57P03', '53300', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])

function field(error: unknown, key: string): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined
}

export function isTransientSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = String(field(error, 'code') ?? '')
  if (TRANSIENT_CODES.has(code) || /^08/.test(code)) return true
  const status = Number(field(error, 'status'))
  if (status === 502 || status === 503 || status === 504) return true
  const text = [field(error, 'message'), field(error, 'details'), field(field(error, 'cause'), 'code'), field(field(error, 'cause'), 'message')]
    .filter((value): value is string => typeof value === 'string').join(' ')
  return TRANSPORT_TEXT.test(text)
}
