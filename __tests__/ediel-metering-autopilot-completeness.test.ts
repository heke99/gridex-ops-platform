import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMeteringMarketDataAutopilot } from '@/lib/metering/monthlyAutopilot'

type Interval = {
  id: string
  company_id: string
  metering_point_id: string
  period_start: string
  period_end: string
  quantity_kwh: string
  quality_status: null
  revision_status: 'current' | 'replaced' | 'superseded' | 'void'
}

type PageRead = { startAfter: string | null; order: string | null; revision: string | null; ids: string[] }
const io = vi.hoisted(() => ({
  rows: [] as Interval[],
  pages: [] as PageRead[],
  serverCap: 1000,
  nextPageError: null as string | null,
  repeatPage: false,
  createRequest: vi.fn(),
  prepareRequest: vi.fn(),
  createTask: vi.fn(),
}))

vi.mock('@/lib/cis/db', () => ({ createGridOwnerDataRequest: io.createRequest }))
vi.mock('@/lib/cis/edielAutomation', () => ({ ensureAndPrepareUtiltsFromDataRequest: io.prepareRequest }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: io.createTask }))
vi.mock('@/lib/metering/contractMeteringResolution', async original => ({
  ...await original<object>(),
  loadMeteringResolutionRequirements: async () => new Map([[
    point, { contractResolution: 'quarter_hour', requestResolution: 'quarter_hour', source: 'synthetic-contract' },
  ]]),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://metering-fixture.invalid', 'unit-only', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: serveLocalQuery },
  }) }
})

function fixtureId(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`
}

const company = fixtureId(10_000)
const point = fixtureId(10_001)
const customer = fixtureId(10_002)
const site = fixtureId(10_003)
const gridOwner = fixtureId(10_004)
const month = '2028-02'
const start = '2028-01-31T23:00:00.000Z'
const end = '2028-02-29T23:00:00.000Z'
const quarterCount = 2784
const quarterMs = 15 * 60_000
const isoAt = (index: number) => new Date(Date.parse(start) + index * quarterMs).toISOString()

function interval(index: number, quantity = '1'): Interval {
  return {
    id: fixtureId(2 * (index + 1)),
    company_id: company,
    metering_point_id: point,
    period_start: isoAt(index),
    period_end: isoAt(index + 1),
    quantity_kwh: quantity,
    quality_status: null,
    revision_status: 'current',
  }
}

function completeMonth(quantity = '1'): Interval[] {
  return Array.from({ length: quarterCount }, (_, index) => interval(index, quantity))
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

async function serveLocalQuery(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  expect(url.origin).toBe('https://metering-fixture.invalid')
  const query = url.searchParams
  expect(query.get('company_id')).toBe(`eq.${company}`)
  if (url.pathname === '/rest/v1/metering_points') {
    return json([{ id: point, customer_id: customer, site_id: site, grid_owner_id: gridOwner, status: 'active' }])
  }
  expect(url.pathname).toBe('/rest/v1/normalized_metering_values')
  expect(query.get('metering_point_id')).toBe(`in.(${point})`)
  expect(query.get('period_start')).toBe(`lt.${end}`)
  expect(query.get('period_end')).toBe(`gt.${start}`)

  const revision = query.get('revision_status')
  const order = query.get('order')
  const startAfter = query.get('id')?.slice('gt.'.length) ?? null
  if (startAfter && io.nextPageError) return json({ code: io.nextPageError, message: 'synthetic next page unavailable' }, 500)

  const rows = io.rows.filter(row => row.company_id === company && row.metering_point_id === point &&
    row.period_start < end && row.period_end > start && (!revision || revision === `eq.${row.revision_status}`) &&
    (!startAfter || io.repeatPage || row.id > startAfter))
  if (order === 'id.asc') rows.sort((left, right) => left.id.localeCompare(right.id))
  const selected = rows.slice(0, Math.min(io.serverCap, Number(query.get('limit') ?? io.serverCap)))
  io.pages.push({ startAfter, order, revision, ids: selected.map(row => row.id) })
  const columns = query.get('select')?.split(',') ?? []
  return json(selected.map(row => Object.fromEntries(columns.map(column => [column, row[column as keyof Interval]]))))
}

beforeEach(() => {
  io.rows = []
  io.pages = []
  io.serverCap = 1000
  io.nextPageError = null
  io.repeatPage = false
  io.createRequest.mockReset().mockResolvedValue({ id: 'synthetic-request' })
  io.prepareRequest.mockReset().mockResolvedValue(undefined)
  io.createTask.mockReset().mockResolvedValue(undefined)
})

function decide() {
  return runMeteringMarketDataAutopilot({ companyId: company, billingMonth: month, actorUserId: 'synthetic-actor' })
}

function expectWholeMonthRequest() {
  expect(io.createRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    customerId: customer, siteId: site, meteringPointId: point, requestedPeriodStart: start, requestedPeriodEnd: end,
    automationKey: `meter-values:${company}:${point}:${month}`, requestScope: 'meter_values',
  }))
  expect(io.prepareRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ utiltsCode: 'E73', periodStart: start, periodEnd: end }))
}

describe('ordinary metering autopilot completeness through the PostgREST client', () => {
  it.each([['1', 1000], ['0', 1000], ['1', 73]] as const)('accepts a complete month with quantity %s and a server cap of %s', async (quantity, cap) => {
    const current = completeMonth(quantity)
    io.serverCap = cap
    io.rows = [...current].reverse()
    const row = current[0]
    io.rows.push(
      { ...row, id: fixtureId(3), revision_status: 'replaced' },
      { ...row, id: fixtureId(5), revision_status: 'superseded' },
      { ...row, id: fixtureId(7), revision_status: 'void' },
      { ...row, id: fixtureId(9), company_id: fixtureId(20_000) },
      { ...row, id: fixtureId(11), metering_point_id: fixtureId(20_001) },
      { ...row, id: fixtureId(13), period_start: end, period_end: isoAt(quarterCount + 1) },
    )
    const outcome = await decide()
    expect(outcome.decisions).toMatchObject([{ meteringPointId: point, decision: 'AUTO', issueCodes: [] }])
    expect(io.createRequest).not.toHaveBeenCalled()
    expect(io.prepareRequest).not.toHaveBeenCalled()
    expect(io.createTask).not.toHaveBeenCalled()
    expect(io.pages.flatMap(page => page.ids)).toEqual(current.map(value => value.id))
    expect(io.pages).toHaveLength(Math.ceil(quarterCount / cap) + 1)
    expect(io.pages.every(page => page.revision === 'eq.current' && page.order === 'id.asc')).toBe(true)
  })

  it.each([1, 2, 3])('requests data when %s required quarters are missing', async missing => {
    io.serverCap = 50_000
    io.rows = completeMonth().filter((_, index) => index < 999 || index >= 999 + missing)
    const outcome = await decide()
    expect(outcome.decisions).toMatchObject([{ meteringPointId: point, decision: 'RETRY', issueCodes: ['metering_gap'] }])
    expectWholeMonthRequest()
    expect(io.createTask).not.toHaveBeenCalled()
  })

  it('requests data for an empty month rather than treating absent values as zero', async () => {
    const outcome = await decide()
    expect(outcome.decisions).toMatchObject([{ meteringPointId: point, decision: 'RETRY', issueCodes: ['metering_values_missing'] }])
    expectWholeMonthRequest()
  })

  it('keeps both same-time current rows across the page edge so genuine overlap still needs review', async () => {
    const current = completeMonth()
    const duplicate = { ...current[999], id: fixtureId(2001) }
    io.rows = [duplicate, ...current.reverse()]
    const outcome = await decide()
    expect(outcome.decisions).toMatchObject([{ decision: 'REVIEW', issueCodes: ['metering_overlap'] }])
    expect(io.pages[0].ids.at(-1)).toBe(fixtureId(2000))
    expect(io.pages[1].startAfter).toBe(fixtureId(2000))
    expect(io.pages[1].ids[0]).toBe(duplicate.id)
    expect(io.createTask).toHaveBeenCalledTimes(1)
    expect(io.createRequest).not.toHaveBeenCalled()
  })

  it.each(['XX000', '42703'])('fails an intermediate page with %s before using partial data', async code => {
    io.rows = completeMonth()
    io.nextPageError = code
    await expect(decide()).rejects.toMatchObject({ code })
    expect(io.createRequest).not.toHaveBeenCalled()
    expect(io.createTask).not.toHaveBeenCalled()
  })

  it('fails if the server page does not advance', async () => {
    io.rows = completeMonth()
    io.repeatPage = true
    await expect(decide()).rejects.toThrow('metering_values_pagination_stalled')
    expect(io.createRequest).not.toHaveBeenCalled()
    expect(io.createTask).not.toHaveBeenCalled()
  })
})
