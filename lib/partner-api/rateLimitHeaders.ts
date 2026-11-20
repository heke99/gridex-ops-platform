import type { IntegrationApiAuthResult } from '@/lib/integrations/apiAuth'

const resetTimestamp = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:[0-5]\d)$/

export function withPartnerThrottleHeaders<T extends Response>(
  response: T,
  access: Extract<IntegrationApiAuthResult, { ok: false }>,
): T {
  if (response.status !== 429 || access.status !== 429 || access.errorCode !== 'rate_limited') return response

  const resetAt = access.rateLimit?.resetAt
  const delay = access.retryAfterSeconds
  if (typeof resetAt !== 'string' || typeof delay !== 'number' || !Number.isSafeInteger(delay) || delay < 1) return response
  const day = resetTimestamp.exec(resetAt)?.[1]
  if (!day || resetAt !== resetAt.trim() || !Number.isFinite(Date.parse(resetAt))) return response

  // Date.parse may normalize impossible dates. Check the supplied calendar day before applying its offset.
  const midnight = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) return response

  response.headers.set('Retry-After', String(delay))
  response.headers.set('X-RateLimit-Reset', resetAt)
  return response
}
