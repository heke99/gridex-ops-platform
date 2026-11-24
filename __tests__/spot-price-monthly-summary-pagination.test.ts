import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importSpotPricesForMonth } from '@/lib/pricing/spot/spotPriceImporter'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

const io = vi.hoisted(() => ({ from: vi.fn(), rebuildMarketPreviews: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/pricing/spot/marketPreviewBuilder', () => ({ rebuildMarketPreviews: io.rebuildMarketPreviews }))

type Row = Record<string, unknown>
type Interval = {
  source: string; price_area: string; time_start: string; time_end: string; sek_per_kwh: number;
  eur_per_kwh: null; exchange_rate: null; resolution: string;
}
const quarterHour = 15 * 60_000

function monthIntervals(month: string) {
  const { start, end } = stockholmMonthBounds(month)
  const clock = Date.parse(start)
  const count = (Date.parse(end) - clock) / quarterHour
  return Array.from({ length: count }, (_, i): Interval => ({
    source: 'elprisetjustnu', price_area: 'SE3',
    time_start: new Date(clock + i * quarterHour).toISOString(), time_end: new Date(clock + (i + 1) * quarterHour).toISOString(),
    sek_per_kwh: 0.82, eur_per_kwh: null, exchange_rate: null, resolution: 'quarter_hour',
  }))
}

function database(intervals: Interval[], stored: { status: string; interval_count: number }, serverPageSize = 700) {
  const pageSizes: number[] = []
  const runUpdates: Row[] = []
  const summaries: Row[] = []
  io.from.mockImplementation((table: string) => {
    const equals = new Map<string, string>()
    const order: string[] = []
    let floor = ''
    let ceiling = ''
    let after: [string, string] | undefined
    let limit = Number.POSITIVE_INFINITY
    let write: Row | undefined
    let selection: string | undefined
    const reply = (data: unknown) => ({ data, error: null })
    const execute = () => {
      if (table === 'spot_price_daily_summaries') return reply({ status: 'verified', interval_count: 96, source_checksum: 'prior-day' })
      if (table === 'spot_price_import_runs') {
        expect(write?.status).toBeDefined()
        if (write?.status !== 'running') {
          expect(equals.get('id')).toBe('monthly-run')
          runUpdates.push(write!)
        }
        return reply({ id: 'monthly-run' })
      }
      if (table === 'spot_price_intervals') {
        expect(equals.get('source')).toBe('elprisetjustnu')
        expect(equals.get('price_area')).toBe('SE3')
        expect(order[0]).toBe('time_start')
        if (after) expect(order).toEqual(['time_start', 'time_end'])
        const candidates = intervals.filter(row => row.time_start >= floor && row.time_start < ceiling &&
          (!after || row.time_start > after[0] || (row.time_start === after[0] && row.time_end > after[1])))
          .sort((a, b) => a.time_start.localeCompare(b.time_start) || a.time_end.localeCompare(b.time_end))
          .slice(0, Math.min(limit, serverPageSize))
        pageSizes.push(candidates.length)
        return reply(candidates)
      }
      if (table === 'spot_price_monthly_summaries') {
        if (!write) throw new Error('Expected a monthly summary upsert')
        summaries.push(write)
        // Actual canonical DB trigger overwrites client status/count in its write statement.
        if (selection) expect(selection).toBe('interval_count,status')
        return reply(selection ? stored : null)
      }
      throw new Error(`Unexpected fixture table ${table}`)
    }
    const query = {
      select(columns: string) { selection = columns; return query },
      eq(column: string, value: string) { equals.set(column, value); return query },
      gte(column: string, value: string) { expect(column).toBe('time_start'); floor = value; return query },
      lt(column: string, value: string) { expect(column).toBe('time_start'); ceiling = value; return query },
      order(column: string, options: { ascending: boolean }) { expect(options.ascending).toBe(true); order.push(column); return query },
      limit(value: number) { limit = value; return query },
      or(condition: string) {
        const match = /^time_start\.gt\.([^,]+),and\(time_start\.eq\.([^,]+),time_end\.gt\.([^)]+)\)$/.exec(condition)
        if (!match || match[1] !== match[2]) throw new Error('Expected exact composite interval cursor')
        after = [match[1], match[3]]
        return query
      },
      insert(value: Row) { write = value; return query },
      update(value: Row) { write = value; return query },
      upsert(value: Row, options: { onConflict: string }) {
        expect(options.onConflict).toBe('source,price_area,billing_month')
        write = value
        return query
      },
      single: async () => execute(),
      maybeSingle: async () => execute(),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(execute).then(resolve, reject),
    }
    return query
  })
  return { pageSizes, summaries, runUpdates }
}

const fetchImpl = vi.fn<typeof fetch>()
function run(billingMonth: string) {
  return importSpotPricesForMonth({ billingMonth, priceAreas: ['SE3'], fetchImpl })
}

beforeEach(() => {
  vi.resetAllMocks()
  fetchImpl.mockRejectedValue(new Error('External market calls are absent from this fixture'))
  io.rebuildMarketPreviews.mockResolvedValue(undefined)
})

describe('monthly spot import completeness and actual persisted result', () => {
  it.each([['2026-03', 2972], ['2026-10', 2980]] as const)('loads all %s Stockholm intervals past the service cap', async (month, count) => {
    const { pageSizes, runUpdates, summaries } = database(monthIntervals(month), { status: 'verified', interval_count: count })

    expect(await run(month)).toMatchObject({ status: 'completed', result: { SE3: { imported: count, status: 'verified' } }, errors: [] })
    expect(pageSizes).toEqual([700, 700, 700, 700, count - 2800, 0])
    expect(summaries[0]).toMatchObject({ interval_count: count, expected_interval_count: count, status: 'verified' })
    expect(runUpdates[0]).toMatchObject({ status: 'completed', result_summary: { SE3: { imported: count, status: 'verified' } }, error_log: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the actual database return and reports incomplete even when the original read was complete', async () => {
    const month = '2026-03'
    const { runUpdates } = database(monthIntervals(month), { status: 'incomplete', interval_count: 2971 })

    expect(await run(month)).toMatchObject({
      status: 'completed_with_warnings', result: { SE3: { imported: 2971, status: 'incomplete' } },
      errors: [expect.stringContaining('SE3 2026-03')],
    })
    expect(runUpdates[0]).toMatchObject({ status: 'completed_with_warnings', error_log: [expect.stringContaining('SE3 2026-03')] })
  })

  it('keeps both rows at a tied cursor and leaves an overlap or coverage gap incomplete', async () => {
    const [first, second] = monthIntervals('2026-10')
    const overlapping = { ...first, time_end: second.time_end }
    const { pageSizes } = database([first, overlapping, second], { status: 'verified', interval_count: 3 }, 1)

    expect(await run('2026-10')).toMatchObject({ status: 'completed_with_warnings', result: { SE3: { imported: 3, status: 'incomplete' } } })
    expect(pageSizes).toEqual([1, 1, 1, 0])
  })

  it('reports a balanced gap and overlap even if the server count and duration still match', async () => {
    const month = '2026-03'
    const intervals = monthIntervals(month)
    const shifted = intervals[900]
    shifted.time_start = new Date(Date.parse(shifted.time_start) + 5 * 60_000).toISOString()
    shifted.time_end = new Date(Date.parse(shifted.time_end) + 5 * 60_000).toISOString()
    database(intervals, { status: 'verified', interval_count: intervals.length })

    expect(await run(month)).toMatchObject({
      status: 'completed_with_warnings', result: { SE3: { imported: 2972, status: 'incomplete' } },
    })
  })

  it('reports an absent interval source rather than completing successfully', async () => {
    const { summaries } = database([], { status: 'incomplete', interval_count: 0 })
    expect(await run('2026-03')).toMatchObject({ status: 'completed_with_warnings', result: { SE3: { imported: 0, status: 'incomplete' } } })
    expect(summaries).toHaveLength(0)
  })
})
