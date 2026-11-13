import { describe, expect, it } from 'vitest'
import { consumptionWindows, meterValueWithinSupply } from '@/lib/customer-portal/consumptionAccess'
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
