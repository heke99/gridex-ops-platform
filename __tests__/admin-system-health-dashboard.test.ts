import type { getOpsHealth, OpsHealthRow } from '@/lib/ops/health'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HealthSnapshot = Awaited<ReturnType<typeof getOpsHealth>>
type ApiRequestRow = { company: string; status: number | null; time: string }
const windowStart = '2026-11-18T12:00:00.000Z'
const windowEnd = '2026-11-19T12:00:00.000Z'
const company = 'synthetic-company'

const io = vi.hoisted(() => ({
  health: vi.fn<() => Promise<HealthSnapshot>>(),
  platform: true,
  apiRequests: [] as ApiRequestRow[],
  apiReads: [] as URLSearchParams[],
  failedRange: null as string | null,
  missingCountRange: null as string | null,
}))

vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: () => io.platform,
  requireAdminPageAccess: async () => ({ email: 'operator@example.invalid' }),
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminTenantReadScope: async () => ({ companyId: io.platform ? null : 'synthetic-company', companyName: 'Testbolag' }),
}))
vi.mock('@/lib/ops/reconciliation', () => ({
  runProductionConsistencyChecks: async () => ({ checks: [], criticalCount: 0, warningCount: 0 }),
}))
vi.mock('@/lib/ops/health', () => ({ getOpsHealth: io.health }))
vi.mock('@/app/admin/system-health/actions', () => ({ requeueUncertainEmailAction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readFixture },
  }) }
})

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.test')
  if (!url.pathname.endsWith('/integration_api_requests')) {
    return init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-range': '*/0' } })
      : Response.json([])
  }
  expect(init?.method).toBe('HEAD')
  expect(new Headers(init?.headers).get('prefer')).toBe('count=exact')
  const query = url.searchParams
  io.apiReads.push(query)
  const statuses = query.getAll('status_code')
  const lowerStatus = statuses.find((filter) => filter.startsWith('gte.'))
  if (lowerStatus && lowerStatus === io.failedRange) {
    return Response.json({ code: '42501', message: 'Synthetic private counter failure' }, { status: 403 })
  }
  if (lowerStatus && lowerStatus === io.missingCountRange) return new Response(null)

  const companyFilter = query.get('company_id')
  const count = io.apiRequests.filter((row) => {
    if (companyFilter && companyFilter !== `eq.${row.company}`) return false
    for (const filter of statuses) {
      if (filter.startsWith('gte.') && (row.status === null || row.status < Number(filter.slice(4)))) return false
      if (filter.startsWith('lt.') && (row.status === null || row.status >= Number(filter.slice(3)))) return false
      if (filter.startsWith('in.(') && !filter.slice(4, -1).split(',').includes(String(row.status))) return false
    }
    for (const filter of query.getAll('created_at')) {
      if (filter.startsWith('gte.') && Date.parse(row.time) < Date.parse(filter.slice(4))) return false
      if (filter.startsWith('lt.') && Date.parse(row.time) >= Date.parse(filter.slice(3))) return false
    }
    return true
  }).length
  return new Response(null, { headers: { 'content-range': `*/${count}` } })
}

import SystemHealthPage from '@/app/admin/system-health/page'

const observedSpot: OpsHealthRow = {
  check_key: 'spot_current_day_missing',
  status: 'ok',
  issue_count: 0,
  details: { expected_areas: 4 },
}
const blockedSpot: OpsHealthRow = {
  check_key: 'spot_preview_stale',
  status: 'blocking',
  issue_count: 2,
}
const internalBlocker: OpsHealthRow = {
  check_key: 'ops_health_schema',
  status: 'blocking',
  issue_count: 1,
  details: { code: 'synthetic-private-diagnostic' },
}

async function renderMarketHealth() {
  const html = renderToStaticMarkup(await SystemHealthPage())
  const start = html.indexOf('Marknadspris och tenant-API')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

beforeEach(() => {
  io.platform = true
  io.health.mockReset()
  io.apiRequests = []
  io.apiReads = []
  io.failedRange = null
  io.missingCountRange = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(windowEnd))
})

afterEach(() => vi.useRealTimers())

describe('admin market health presentation', () => {
  it('shows the current individual spot result without a coverage notice on a complete v5 snapshot', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v5', schemaReady: true, rows: [observedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('spot_current_day_missing')
    expect(section).toContain('border-emerald-200')
    expect(section).not.toContain('role="status"')
  })

  it('identifies the older snapshot and makes OK observations neutral while retaining blocking readings', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v4', schemaReady: true, rows: [observedSpot, blockedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('role="status"')
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('Reservversion v4')
    expect(section).toContain('spot_current_day_missing')
    expect(section).toContain('spot_preview_stale')
    expect(section).toContain('border-red-200')
    expect(section).not.toContain('border-emerald-200')
  })

  it('shows a limited result for an incomplete v5 snapshot without exposing unrelated diagnostics', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v5', schemaReady: false, rows: [observedSpot, internalBlocker] })
    const section = await renderMarketHealth()
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('spot_current_day_missing')
    expect(section).not.toContain('ops_health_schema')
    expect(section).not.toContain('synthetic-private-diagnostic')
    expect(section).not.toContain('border-emerald-200')
  })

  it('shows unavailable coverage when an RPC failure prevents a snapshot', async () => {
    io.health.mockRejectedValue(new Error('synthetic-private-diagnostic'))
    const section = await renderMarketHealth()
    expect(section).toContain('role="status"')
    expect(section).toContain('Marknadspriskontrollerna är otillgängliga')
    expect(section).not.toContain('synthetic-private-diagnostic')
    expect(section).not.toContain('<table')
  })

  it('shows unavailable coverage when a snapshot lacks spot readings', async () => {
    io.health.mockResolvedValue({ checkVersion: null, schemaReady: false, rows: [internalBlocker] })
    const section = await renderMarketHealth()
    expect(section).toContain('Marknadspriskontrollerna är otillgängliga')
    expect(section).not.toContain('ops_health_schema')
    expect(section).not.toContain('<table')
  })

  it('shows the limited status to tenant admins with version metadata confined to platform operators', async () => {
    io.platform = false
    io.health.mockResolvedValue({ checkVersion: 'v3', schemaReady: true, rows: [observedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('spot_current_day_missing')
    expect(section).not.toContain('Reservversion')
    expect(section).not.toContain('border-emerald-200')
  })
})


describe('bounded integration API error measurements', () => {
  beforeEach(() => {
    io.platform = false
    io.health.mockResolvedValue({ checkVersion: null, schemaReady: false, rows: [] })
    io.apiRequests = [400, 418, 499, 500, 502, 503, 503, 599, 200, 301, 600, null].map((status) => ({
      company, status, time: windowStart,
    }))
    io.apiRequests.push(
      { company, status: 404, time: '2026-11-18T11:59:59.999Z' },
      { company, status: 500, time: windowEnd },
      { company: 'other-company', status: 429, time: windowStart },
      { company: 'other-company', status: 503, time: windowStart },
    )
  })

  async function renderCards() {
    const html = renderToStaticMarkup(await SystemHealthPage())
    const start = html.indexOf('<section')
    return html.slice(start, html.indexOf('</section>', start))
  }

  it('shows separate recent client and server totals within the selected company using one UTC window', async () => {
    const cards = await renderCards()
    expect(cards).toMatch(/API-klientfel<\/div><div[^>]+>3<\/div>/)
    expect(cards).toMatch(/API-serverfel<\/div><div[^>]+>5<\/div>/)
    expect(cards.match(/Senaste 24 timmarna/g)).toHaveLength(2)
    expect(io.apiReads).toHaveLength(2)
    expect(io.apiReads.map((query) => query.getAll('status_code'))).toEqual(expect.arrayContaining([
      ['gte.400', 'lt.500'], ['gte.500', 'lt.600'],
    ]))
    for (const query of io.apiReads) {
      expect(query.get('company_id')).toBe(`eq.${company}`)
      expect(query.getAll('created_at')).toEqual([`gte.${windowStart}`, `lt.${windowEnd}`])
    }
  })

  it('keeps the authorized platform-wide totals within that same UTC window', async () => {
    io.platform = true
    const cards = await renderCards()
    expect(cards).toMatch(/API-klientfel<\/div><div[^>]+>4<\/div>/)
    expect(cards).toMatch(/API-serverfel<\/div><div[^>]+>6<\/div>/)
    expect(io.apiReads.every((query) => !query.has('company_id'))).toBe(true)
  })

  it('shows verified zero values when the scoped window is empty', async () => {
    io.apiRequests = []
    const cards = await renderCards()
    expect(cards).toMatch(/API-klientfel<\/div><div[^>]+>0<\/div>/)
    expect(cards).toMatch(/API-serverfel<\/div><div[^>]+>0<\/div>/)
  })

  it('shows a failed read and an unverified count as unavailable', async () => {
    io.failedRange = 'gte.400'
    io.missingCountRange = 'gte.500'
    const cards = await renderCards()
    expect(cards).toMatch(/API-klientfel<\/div><div[^>]+>Otillgängligt<\/div>/)
    expect(cards).toMatch(/API-serverfel<\/div><div[^>]+>Otillgängligt<\/div>/)
    expect(cards).not.toContain('Synthetic private counter failure')
  })
})
