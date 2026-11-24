import { describe, expect, it } from 'vitest'
import { consumptionWindows, meterValueWithinSupply, needsVerifiedSupplyEnd } from '@/lib/customer-portal/consumptionAccess'
const scope = { companyId: 'company-a', customerId: 'customer-a' }
const site = { id: 'site-a', company_id: scope.companyId, customer_id: scope.customerId }
const point = { id: 'point-a', company_id: scope.companyId, customer_site_id: site.id }
const period = { id: 'period-a', company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: point.id, status: 'ended', market_start_at: '2026-03-28T23:00:00Z', actual_start_date: '2026-03-29', actual_end_date: '2026-03-29' }
const window = () => consumptionWindows(scope, [site], [point], [period])
describe('confirmed customer consumption authority', () => {
  it('uses the inclusive Swedish supply end across the 23-hour DST day', () => {
    const [w] = window(); expect(w.from).toBe('2026-03-28T23:00:00.000Z'); expect(w.to).toBe('2026-03-29T22:00:00.000Z')
    expect(Date.parse(w.to!) - Date.parse(w.from)).toBe(23 * 3600000)
  })
  it('keeps all 25 physical hours on the autumn transition', () => {
    const [w] = consumptionWindows(scope, [site], [point], [{ ...period, market_start_at: '2026-10-24T22:00:00Z', actual_start_date: '2026-10-25', actual_end_date: '2026-10-25' }])
    expect(Date.parse(w.to!) - Date.parse(w.from)).toBe(25 * 3600000)
  })
  it('never grants access from a planned start, contract or move-in', () => {
    expect(consumptionWindows(scope, [site], [point], [{ ...period, status: 'planned', actual_start_date: null, start_date: '2026-03-01' }])).toEqual([])
  })
  it.each(['planned', 'cancelled', 'rejected', 'terminated'])('does not grant %s supply', status => {
    expect(consumptionWindows(scope, [site], [point], [{ ...period, status }])).toEqual([])
  })
  it('holds a confirmed period without a canonical market instant', () => {
    expect(() => consumptionWindows(scope, [site], [point], [{ ...period, market_start_at: null }])).toThrow('Confirmed supply authority unavailable')
  })
  it('requires the actual end for ended supply', () => {
    expect(() => consumptionWindows(scope, [site], [point], [{ ...period, actual_end_date: null }])).toThrow('Unverified supply end')
  })
  it('uses the current version of an independently verified exclusive end', () => {
    const ended = {
      ...period, actual_end_date: null, market_state_version: 4,
      market_end_at: '2026-03-29T10:00:00.000341+02:00',
    }
    const proof = {
      period_id: ended.id, market_state_version: 4, effective_end_at: '2026-03-29T08:00:00.000341Z',
    }
    const windows = consumptionWindows(scope, [site], [point], [ended], [proof])
    expect(windows[0]?.to).toBe('2026-03-29T08:00:00.000341Z')
    const row = {
      company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: point.id,
      period_start: '2026-03-29T08:00:00.000340Z', period_end: proof.effective_end_at,
    }
    expect(meterValueWithinSupply(scope, row, windows)).toBe(true)
    expect(meterValueWithinSupply(scope, { ...row, period_end: '2026-03-29T08:00:00.000342Z' }, windows)).toBe(false)
    expect(() => consumptionWindows(scope, [site], [point], [ended], [{ ...proof, market_state_version: 3 }])).toThrow()
  })
  it('preserves an exact market start while the delivery is active', () => {
    const active = {
      ...period, status: 'active', actual_end_date: null, market_start_at: '2026-03-29T10:00:00.000341+02:00',
    }
    const windows = consumptionWindows(scope, [site], [point], [active])
    const row = {
      company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: point.id,
      period_start: '2026-03-29T08:00:00.000340Z', period_end: '2026-03-29T08:15:00Z',
    }
    expect(meterValueWithinSupply(scope, row, windows)).toBe(false)
    expect(meterValueWithinSupply(scope, { ...row, period_start: active.market_start_at }, windows)).toBe(true)
  })
  it('rejects a foreign customer period and foreign tenant point', () => {
    expect(() => consumptionWindows(scope, [site], [point], [{ ...period, customer_id: 'customer-b' }])).toThrow()
    expect(() => consumptionWindows(scope, [site], [{ ...point, company_id: 'company-b' }], [period])).toThrow()
  })
  it('narrows dates by exact market bounds without extending them', () => {
    const [w] = consumptionWindows(scope, [site], [point], [{ ...period, market_start_at: '2026-03-29T01:00:00Z', market_end_at: '2026-03-29T10:00:00Z' }])
    expect(w.from).toBe('2026-03-29T01:00:00.000Z'); expect(w.to).toBe('2026-03-29T10:00:00.000Z')
  })
  it('keeps separate meter histories and excludes intervals crossing the supply end', () => {
    const row = { company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: point.id, period_start: '2026-03-29T21:00:00Z', period_end: '2026-03-29T22:00:00Z' }
    expect(meterValueWithinSupply(scope, row, window())).toBe(true)
    expect(meterValueWithinSupply(scope, { ...row, period_end: '2026-03-29T23:00:00Z' }, window())).toBe(false)
    expect(meterValueWithinSupply(scope, { ...row, metering_point_id: 'previous-meter' }, window())).toBe(false)
    expect(() => meterValueWithinSupply(scope, { ...row, customer_id: 'customer-b' }, window())).toThrow()
  })
})

describe('normal Z05 delivery day and exclusive market cutoff', () => {
  const end = {
    ...period, actual_start_date: '2024-07-01', actual_end_date: null,
    market_start_at: '2024-06-30T22:00:00Z', end_date: '2024-07-31',
    market_state_version: 4, market_end_at: '2024-07-31T22:30:00Z',
  }
  const proof = {
    period_id: end.id, market_state_version: 4, effective_end_at: end.market_end_at,
  }
  const lastQuarter = {
    company_id: scope.companyId, customer_id: scope.customerId, metering_point_id: point.id,
    period_start: '2024-07-31T22:15:00Z', period_end: '2024-07-31T22:30:00Z',
  }

  it.each(['ending', 'ended'])('includes the last complete quarter up to the proved cutoff while %s', status => {
    const supply = { ...end, status }
    expect(needsVerifiedSupplyEnd(supply)).toBe(true)
    const windows = consumptionWindows(scope, [site], [point], [supply], [proof])
    expect(windows[0].to).toBe('2024-07-31T22:30:00.000Z')
    expect(meterValueWithinSupply(scope, lastQuarter, windows)).toBe(true)
    expect(meterValueWithinSupply(scope, { ...lastQuarter, period_end: '2024-07-31T22:30:00.000001Z' }, windows)).toBe(false)
  })

  it('keeps an unproved pending period at the earlier calendar ceiling', () => {
    const windows = consumptionWindows(scope, [site], [point], [{ ...end, status: 'ending' }])
    expect(windows[0].to).toBe('2024-07-31T22:00:00.000Z')
    expect(meterValueWithinSupply(scope, lastQuarter, windows)).toBe(false)
  })

  it('holds ended supply when the exact proof is absent or stale', () => {
    expect(() => consumptionWindows(scope, [site], [point], [end])).toThrow('Unverified supply end')
    expect(() => consumptionWindows(scope, [site], [point], [end], [
      { ...proof, market_state_version: end.market_state_version - 1 },
    ])).toThrow('Mismatched verified supply end')
  })

  it.each(['2024-07-31T21:45:00Z', '2024-07-31T22:00:00Z'])('retains an earlier or equal boundary %s without proof', market_end_at => {
    const supply = { ...end, status: 'ending', market_end_at }
    expect(needsVerifiedSupplyEnd(supply)).toBe(false)
    const windows = consumptionWindows(scope, [site], [point], [supply])
    expect(windows[0].to).toBe(new Date(market_end_at).toISOString())
  })

  it('preserves the independently recorded actual end ceiling', () => {
    const supply = { ...end, actual_end_date: '2024-07-31', end_date: '2024-08-01' }
    expect(needsVerifiedSupplyEnd(supply)).toBe(false)
    const windows = consumptionWindows(scope, [site], [point], [supply])
    expect(windows[0].to).toBe('2024-07-31T22:00:00.000Z')
    expect(meterValueWithinSupply(scope, lastQuarter, windows)).toBe(false)
  })
})
