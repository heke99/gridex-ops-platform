// Minimal, dependency-free performance observability.
//
// PII safety: only safe metadata is ever logged here — route name, duration in
// milliseconds, result count, status and cache status. Never pass customer
// names, personal numbers, addresses, invoice data, document content, Ediel
// payloads or tokens/secrets through this helper. company_id may be included
// only where it is already considered safe in existing server logs.

export type CacheStatus = 'hit' | 'miss' | 'bypass' | 'n/a'

export type RouteTimingFields = {
  route: string
  durationMs: number
  status?: number
  count?: number
  cache?: CacheStatus
  companyId?: string | null
  // Extra safe scalar metadata (no PII). Values are emitted as-is.
  meta?: Record<string, string | number | boolean | null>
}

function now(): number {
  return Date.now()
}

// Starts a timer and returns a stop() that emits a structured, PII-free log line.
export function startRouteTimer(route: string) {
  const startedAt = now()
  return {
    startedAt,
    elapsedMs(): number {
      return Math.max(0, now() - startedAt)
    },
    stop(fields: Omit<RouteTimingFields, 'route' | 'durationMs'> = {}): number {
      const durationMs = Math.max(0, now() - startedAt)
      logRouteTiming({ route, durationMs, ...fields })
      return durationMs
    },
  }
}

export function logRouteTiming(fields: RouteTimingFields): void {
  const payload: Record<string, unknown> = {
    route: fields.route,
    duration_ms: Math.round(fields.durationMs),
  }
  if (typeof fields.status === 'number') payload.status = fields.status
  if (typeof fields.count === 'number') payload.count = fields.count
  if (fields.cache) payload.cache = fields.cache
  if (fields.companyId) payload.company_id = fields.companyId
  if (fields.meta) {
    for (const [key, value] of Object.entries(fields.meta)) {
      if (value !== undefined) payload[key] = value
    }
  }
  console.info('[perf]', payload)
}

// Times a single async DB/operation and emits a PII-free log line.
export async function timeOperation<T>(
  route: string,
  operation: string,
  fn: () => Promise<T>,
  extract?: (result: T) => { count?: number }
): Promise<T> {
  const startedAt = now()
  try {
    const result = await fn()
    const extra = extract ? extract(result) : {}
    logRouteTiming({ route, durationMs: now() - startedAt, meta: { operation }, count: extra.count })
    return result
  } catch (error) {
    logRouteTiming({ route, durationMs: now() - startedAt, status: 500, meta: { operation, failed: true } })
    throw error
  }
}
