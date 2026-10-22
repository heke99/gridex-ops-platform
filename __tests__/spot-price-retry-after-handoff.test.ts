import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  attemptCount: 1,
  claims: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  priceWrites: [] as string[],
}))

// The client, importer and job adapter are real. Only external I/O is modeled.
// Unexpected RPCs/tables/writes fail rather than silently acquiring fixtures.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'gridex_claim_spot_price_import_job') throw new Error(`unexpected RPC: ${name}`)
    ports.claims.push(args)
    return { error: null, data: [{ id: 'job-1', claimed: true, status: 'running', attempt_count: ports.attemptCount, correlation_id: 'corr-1' }] }
  },
  from: (table: string) => {
    if (table === 'spot_price_import_jobs') return {
      update: (patch: Record<string, unknown>) => ({
        eq: async (key: string, value: unknown) => {
          if (key !== 'id' || value !== 'job-1') throw new Error('unexpected job update scope')
          ports.updates.push(patch)
          return { error: null }
        },
      }),
    }
    if (table === 'canonical_energy_flow_events') return {
      insert: async (event: Record<string, unknown>) => { ports.events.push(event); return { error: null } },
    }
    if (table === 'spot_price_daily_summaries') {
      const query: Record<string, unknown> = {}
      query.select = () => query
      query.eq = () => query
      query.maybeSingle = async () => ({ data: null, error: null })
      query.upsert = () => { ports.priceWrites.push(table); throw new Error('unexpected summary write') }
      return query
    }
    if (table === 'spot_price_intervals') return {
      upsert: () => { ports.priceWrites.push(table); throw new Error('unexpected interval write') },
    }
    throw new Error(`unexpected table: ${table}`)
  },
} }))
vi.mock('@/lib/pricing/spot/marketPreviewBuilder', () => ({ rebuildMarketPreviews: () => { throw new Error('unexpected preview rebuild') } }))

import { importSpotPricesForDayArea } from '@/lib/pricing/spot/spotPriceImporter'
import { failSpotImportJob } from '@/lib/pricing/spot/spotImportJobs'

const now = Date.parse('2026-10-20T12:00:00Z')
const at = (delay: number) => new Date(now + delay).toISOString()

beforeEach(() => {
  ports.attemptCount = 1
  ports.claims = []
  ports.updates = []
  ports.events = []
  ports.priceWrites = []
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

// Capture attempted sleeps without waiting or advancing the date by huge values.
// Fetch abort timers (the unchanged default 10s budget) remain inert here; this
// test does not qualify real timer scheduling, provider latency or DB behavior.
function captureTimers() {
  const delays: number[] = []
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    const ms = Number(delay ?? 0)
    delays.push(ms)
    if (ms !== 10_000) void Promise.resolve().then(() => callback(...args))
    return delays.length as unknown as ReturnType<typeof setTimeout>
  })
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)
  return delays
}

describe('429 client -> importer -> durable job handoff', () => {
  it.each([
    ['short seconds', '1', at(60_000)],
    ['long seconds', '3600', at(3_600_000)],
    ['future HTTP date', new Date(now + 3_600_000).toUTCString(), at(3_600_000)],
    ['finite delay beyond the 24 h cap', '8640000000000', at(24 * 3_600_000)],
    ['finite seconds overflowing milliseconds', '1e308', at(24 * 3_600_000)],
    ['huge unsigned seconds', '9'.repeat(400), at(24 * 3_600_000)],
    ['invalid header', 'not-a-delay', at(15 * 60_000)],
  ] as const)('saves %s without another fetch, inline sleep or price writes', async (_name, header, expected) => {
    const timers = captureTimers()
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}', { status: 429, headers: { 'retry-after': header } }))
    const result = await importSpotPricesForDayArea({ calendarDate: '2026-10-20', priceArea: 'SE3', fetchImpl, force: true })
    expect(result).toMatchObject({ imported: 0, status: 'retry_wait' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(timers).toEqual([10_000])
    expect(ports.claims).toEqual([{ p_provider: 'elprisetjustnu', p_price_area: 'SE3', p_calendar_date: '2026-10-20', p_company_id: null, p_force: true }])
    expect(ports.updates).toEqual([expect.objectContaining({
      status: 'retry_wait', next_attempt_at: expected, completed_at: null,
      last_error_code: 'provider_rate_limited', updated_at: at(0),
    })])
    expect(ports.priceWrites).toEqual([])
    expect(ports.updates.some(update => update.status === 'completed')).toBe(false)
    expect(ports.events.map(event => event.event_type)).toEqual(['market_price.import.started', 'market_price.import.failed'])
    expect(Date.now()).toBe(now)
  })
})

describe('durable retry dates and unchanged job policy', () => {
  it.each([
    ['normal delay', 3_600_000, at(3_600_000)],
    ['zero delay', 0, at(60_000)],
    ['negative delay', -1, at(60_000)],
    ['negative infinity', Number.NEGATIVE_INFINITY, at(60_000)],
    ['NaN delay', Number.NaN, at(15 * 60_000)],
    ['missing delay', undefined, at(15 * 60_000)],
    ['null delay', null, at(15 * 60_000)],
    ['positive infinity', Number.POSITIVE_INFINITY, at(24 * 3_600_000)],
    ['just over 24 h', 24 * 3_600_000 + 1, at(24 * 3_600_000)],
    ['exactly 24 h', 24 * 3_600_000, at(24 * 3_600_000)],
    ['positive Date overflow', 8_640_000_000_000_000, at(24 * 3_600_000)],
  ] as const)('saves %s with the intended durable date', async (_name, delay, expected) => {
    await expect(failSpotImportJob({ jobId: 'job-1', errorCode: 'provider_rate_limited', message: 'synthetic', retryable: true, attemptCount: 1, retryAfterMs: delay })).resolves.toBe('retry_wait')
    expect(ports.updates).toEqual([expect.objectContaining({ status: 'retry_wait', next_attempt_at: expected, completed_at: null })])
  })

  it.each([
    [true, 5],
    [false, 1],
  ] as const)('preserves terminal policy: retryable=%s, attempt=%s', async (retryable, attemptCount) => {
    await expect(failSpotImportJob({ jobId: 'job-1', errorCode: 'provider_rate_limited', message: 'synthetic', retryable, attemptCount, retryAfterMs: Number.POSITIVE_INFINITY })).resolves.toBe('failed')
    // PERF005: the terminal classification is unchanged, but the provider's
    // explicit not-before deadline survives on the failed row.
    expect(ports.updates).toEqual([expect.objectContaining({ status: 'failed', next_attempt_at: at(24 * 3_600_000), completed_at: at(0) })])
  })

  it('keeps a finite 429 deadline on the fifth (terminal) failure', async () => {
    await expect(failSpotImportJob({ jobId: 'job-1', errorCode: 'provider_rate_limited', message: 'synthetic', retryable: true, attemptCount: 5, retryAfterMs: 3_600_000 })).resolves.toBe('failed')
    expect(ports.updates).toEqual([expect.objectContaining({ status: 'failed', next_attempt_at: at(3_600_000), completed_at: at(0) })])
  })

  it.each([
    ['429 without Retry-After', 'provider_rate_limited', null],
    ['429 with NaN Retry-After', 'provider_rate_limited', Number.NaN],
    ['non-rate-limit error with a delay', 'provider_unavailable', 3_600_000],
  ] as const)('clears next_attempt_at on terminal failure: %s', async (_name, errorCode, retryAfterMs) => {
    await expect(failSpotImportJob({ jobId: 'job-1', errorCode, message: 'synthetic', retryable: true, attemptCount: 5, retryAfterMs })).resolves.toBe('failed')
    expect(ports.updates).toEqual([expect.objectContaining({ status: 'failed', next_attempt_at: null, completed_at: at(0) })])
  })

  it('retains the existing exponential fallback for later attempts', async () => {
    await failSpotImportJob({ jobId: 'job-1', errorCode: 'provider_unavailable', message: 'synthetic', retryable: true, attemptCount: 4 })
    expect(ports.updates[0].next_attempt_at).toBe(at(2 * 60 * 60_000))
  })
})

describe('canonical claim source contract, without executing a database claim', () => {
  it('keeps the future retry_wait guard independent of force', () => {
    const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
    const start = schema.indexOf('CREATE FUNCTION public.gridex_claim_spot_price_import_job(')
    expect(start).toBeGreaterThanOrEqual(0)
    const sql = schema.slice(start, schema.indexOf('$$;', start) + 3)
    expect(sql).toContain('p_force boolean DEFAULT false')
    const futureGuard = sql.match(/if (\(?v_job\.status='retry_wait'[\s\S]*?) then\s*return query select v_job\.id,false,v_job\.status,v_job\.attempt_count,v_job\.correlation_id;\s*return;\s*end if;/)?.[1]
    expect(futureGuard).toBeDefined()
    expect(futureGuard).toContain('v_job.next_attempt_at is not null and v_job.next_attempt_at > now()')
    expect(futureGuard).toContain("v_job.status='failed' and v_job.last_error_code='provider_rate_limited'")
    expect(futureGuard).not.toContain('p_force')
    expect(sql.indexOf(`if ${futureGuard} then`)).toBeLessThan(sql.indexOf('update public.spot_price_import_jobs j'))
  })
})
