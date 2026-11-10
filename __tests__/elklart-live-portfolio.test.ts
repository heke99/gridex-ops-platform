import { describe, expect, it } from 'vitest'
import { buildLiveDemoPortfolio, demoDayBounds, parseDemoBindings, type DemoSupply, type DemoReading } from '@/lib/demo/elklartLivePortfolio'

const companyId = '00000000-0000-0000-0000-000000000001'
const customerId = '00000000-0000-0000-0000-000000000002'
const pointId = '00000000-0000-0000-0000-000000000003'
const bindings = [{ profile: 'anna' as const, customerId, meteringPointId: pointId }]
const supply: DemoSupply = { companyId, customerId, meteringPointId: pointId, startAt: '2026-11-10T11:00:00Z', endAt: null, confirmed: false, cancelled: false, updatedAt: '2026-11-09T10:00:00Z' }
function portfolio(supplies = [supply], readings: DemoReading[] = [], day = '2026-11-10') {
  return buildLiveDemoPortfolio({ companyId, bindings, supplies, readings, day, zone: 'SE4' })
}

describe('OPS-backed demo portfolio', () => {
  it('moves Anna from planned to confirmed on the actual exclusive supply interval', () => {
    expect(portfolio()[48]).toMatchObject({ forecastKwh: 0, plannedKwh: 3, actualKwh: 0 })
    const rows = portfolio([{ ...supply, confirmed: true, endAt: '2026-11-10T11:30:00Z' }])
    expect(rows[47].forecastKwh).toBe(0)
    expect(rows[48]).toMatchObject({ forecastKwh: 3, plannedKwh: 0, actualKwh: null })
    expect(rows[49].forecastKwh).toBe(3)
    expect(rows[50].forecastKwh).toBe(0)
    expect(rows[48].contributions[0].updatedAt).toBe('2026-11-09T10:00:00Z')
  })
  it('counts a confirmed overlap once and ignores cancelled periods', () => {
    expect(portfolio([supply, { ...supply, confirmed: true }, { ...supply, cancelled: true }])[48]).toMatchObject({ forecastKwh: 3, plannedKwh: 0 })
    expect(portfolio([{ ...supply, confirmed: true, cancelled: true }])[48].forecastKwh).toBe(0)
  })
  it('uses only current consumption and distinguishes zero from missing coverage', () => {
    const reading: DemoReading = { companyId, customerId, meteringPointId: pointId, startAt: '2026-11-10T11:00:00Z', endAt: '2026-11-10T11:15:00Z', kwh: 4, current: true }
    const rows = portfolio([{ ...supply, confirmed: true }], [{ ...reading, current: false, kwh: 99 }, reading])
    expect(rows[48]).toMatchObject({ forecastKwh: 3, actualKwh: 4, deviationKwh: 1 })
    expect(rows[49].actualKwh).toBeNull()
    expect(portfolio([{ ...supply, confirmed: true }], [{ ...reading, kwh: 0 }])[48].actualKwh).toBe(0)
    expect(portfolio([{ ...supply, confirmed: true }], [{ ...reading, endAt: '2026-11-10T11:10:00Z' }])[48].actualKwh).toBeNull()
  })
  it('refuses overlapping current readings and foreign tenant/customer evidence', () => {
    const reading: DemoReading = { companyId, customerId, meteringPointId: pointId, startAt: '2026-11-10T11:00:00Z', endAt: '2026-11-10T11:15:00Z', kwh: 4, current: true }
    expect(() => portfolio([{ ...supply, confirmed: true }], [reading, reading])).toThrow(/overlap/)
    expect(() => portfolio([{ ...supply, companyId: pointId }])).toThrow(/scope/)
    expect(() => portfolio([{ ...supply, customerId: pointId }])).toThrow(/scope/)
    expect(() => portfolio([supply], [{ ...reading, customerId: pointId }])).toThrow(/scope/)
  })
  it('handles Swedish DST day lengths and validates dates and manifests', () => {
    expect(portfolio([], [], '2026-03-29')).toHaveLength(92)
    expect(portfolio([], [], '2026-10-25')).toHaveLength(100)
    expect(demoDayBounds('2026-11-10')).toEqual({ start: '2026-11-09T23:00:00.000Z', end: '2026-11-10T23:00:00.000Z' })
    expect(() => demoDayBounds('2026-02-30')).toThrow()
    expect(parseDemoBindings(JSON.stringify(bindings))).toEqual(bindings)
    expect(() => parseDemoBindings(JSON.stringify([bindings[0], bindings[0]]))).toThrow()
    expect(() => parseDemoBindings('[{"profile":"anna","customerId":"bad"}]')).toThrow()
    expect(parseDemoBindings(undefined)).toEqual([])
  })
})

it('excludes measured energy outside the customer confirmed supply', () => {
  const reading: DemoReading = { companyId, customerId, meteringPointId: pointId, startAt: '2026-11-10T10:45:00Z', endAt: '2026-11-10T11:00:00Z', kwh: 10, current: true }
  expect(portfolio([{ ...supply, confirmed: true }], [reading])[47].actualKwh).toBe(0)
  expect(portfolio([supply], [{ ...reading, startAt: '2026-11-10T11:00:00Z', endAt: '2026-11-10T11:15:00Z' }])[48].actualKwh).toBe(0)
})
