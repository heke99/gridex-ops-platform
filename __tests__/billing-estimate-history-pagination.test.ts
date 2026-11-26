import { createClient } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'
import { estimateMissingConsumption } from '@/lib/billing/consumptionEstimate'

const fixture = vi.hoisted(() => ({
  readings: [] as Array<{ id: string; period_start: string; period_end: string; quantity_kwh: number; quality_status: string; direction: string }>,
  requests: [] as Array<Record<string, string>>,
  cap: 1000,
  cursorFailure: "none" as "none" | "repeat" | "backwards",
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: createClient('http://127.0.0.1:54321', 'inert-history-fixture', {
  auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false },
  global: { fetch: async (input, options) => {
    const url = new URL(String(input))
    if (url.origin !== 'http://127.0.0.1:54321' || options?.method !== 'GET') throw new Error('Unexpected lookup')
    if (url.pathname.endsWith('/metering_points')) {
      return Response.json({ estimated_annual_consumption_kwh: null, customer_site_id: null, site_id: null })
    }
    if (!url.pathname.endsWith('/normalized_metering_values')) throw new Error('Unexpected table')
    const params = Object.fromEntries(url.searchParams)
    fixture.requests.push(params)
    expect(params).toMatchObject({
      company_id: 'eq.company', metering_point_id: 'eq.point', revision_status: 'eq.current',
    })
    const lower = params.period_end.slice(3), upper = params.period_start.slice(3)
    const after = /^\(period_start\.gt\.([^,]+),and\(period_start\.eq\.([^,]+),id\.gt\.([^,)]+)\)\)$/.exec(params.or ?? '')
    if (params.or && !after) throw new Error('Unrecognized cursor')
    const requestedDirections = /^in\.\(([^)]+)\)$/.exec(params.direction ?? '')?.[1].split(',')
    const minimumQuantity = params.quantity_kwh?.startsWith('gte.') ? Number(params.quantity_kwh.slice(4)) : -Infinity
    const selected = fixture.readings.filter(row =>
      (!requestedDirections || requestedDirections.includes(row.direction)) && row.quantity_kwh >= minimumQuantity &&
      row.period_end > lower && row.period_start < upper &&
      (fixture.cursorFailure !== "none" || !after || row.period_start > after[1] || (row.period_start === after[2] && row.id > after[3])))
    const page = selected.slice(0, Math.min(fixture.cap, Number(params.limit ?? '1000')))
    if (after && fixture.cursorFailure === 'backwards') page.pop()
    return Response.json(page)
  } },
}) }))

const stepMs = 900_000
const day = 24 * 60 * 60 * 1_000
const start = Date.parse('2026-10-01T00:00:00.000Z')
const input = { companyId: 'company', meteringPointId: 'point', windows: [{ start, end: start + stepMs }], stepMs }

beforeEach(() => {
  fixture.requests.length = 0
  fixture.cap = 1000
  fixture.cursorFailure = "none"
  const old = Date.parse('2026-03-01T00:00:00.000Z')
  const readings = (first: number, count: number, initialId: number) => Array.from({ length: count }, (_, index) => ({
    id: `48000000-0000-4000-8000-${String(initialId + index).padStart(12, '0')}`,
    period_start: new Date(first + index * stepMs).toISOString(),
    period_end: new Date(first + (index + 1) * stepMs).toISOString(),
    quantity_kwh: 0.25,
    quality_status: 'measured',
    direction: 'consumption',
  }))
  fixture.readings = [...readings(old, 1000, 1), ...readings(start - 28 * day, 2688, 1001)]
})

it.each([[1000, 5], [750, 6]])('reads all recent quarter-hours through a PostgREST cap of %i', async (cap, requestCount) => {
  fixture.cap = cap
  await expect(estimateMissingConsumption(input)).resolves.toMatchObject({
    method: 'recent_four_weeks', estimatedKwh: 0.25,
    referenceStart: '2026-09-03T00:00:00.000Z', referenceEnd: '2026-10-01T00:00:00.000Z',
  })
  expect(fixture.requests).toHaveLength(requestCount)
  expect(fixture.requests.every(params => params.order === 'period_start.asc,id.asc')).toBe(true)
  expect(fixture.requests.filter(params => params.or)).toHaveLength(requestCount - 2)
})

it.each(['repeat', 'backwards'] as const)('rejects a %s cursor before returning a partial estimate', async (mode) => {
  fixture.cursorFailure = mode
  await expect(estimateMissingConsumption(input)).rejects.toThrow('billing_estimate_history_cursor_not_advanced')
  expect(fixture.requests).toHaveLength(3)
})

it('uses metered import history without treating export or credit quantities as consumption', async () => {
  const reference = fixture.readings.slice(-2688).map(row => ({ ...row, direction: 'net_consumption' }))
  const outsideConsumption = reference.flatMap((row, index) =>
    [
      { direction: 'production', quantity_kwh: 4 },
      { direction: 'net_production', quantity_kwh: 8 },
      { direction: 'consumption', quantity_kwh: -3 },
    ].map((source, variant) => ({
      ...row,
      ...source,
      id: `58000000-0000-4000-8000-${String(index * 3 + variant).padStart(12, '0')}`,
    })),
  )
  fixture.readings = [...reference, ...outsideConsumption].sort((left, right) =>
    left.period_start.localeCompare(right.period_start) || left.id.localeCompare(right.id),
  )

  await expect(estimateMissingConsumption(input)).resolves.toMatchObject({
    method: 'recent_four_weeks', estimatedKwh: 0.25,
  })
  expect(fixture.requests.every(params =>
    params.direction === 'in.(consumption,net_consumption)' && params.quantity_kwh === 'gte.0',
  )).toBe(true)

  fixture.readings = fixture.readings.filter(row => row.direction !== 'net_consumption')
  await expect(estimateMissingConsumption(input)).resolves.toBeNull()
})
