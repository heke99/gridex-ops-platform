import { beforeEach, describe, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: ports }))
import { resolveIntervalSpotPricing } from '@/lib/pricing/intervalPricing'

const hourMs = 60 * 60 * 1000
const quarterMs = hourMs / 4
const companyId = 'company'
const billingUnderlayId = 'underlay'

function fixture(start: string, hours: number) {
  const startMs = Date.parse(start)
  const periods = Array.from({ length: hours * 4 }, (_, index) => {
    const period_start = new Date(startMs + index * quarterMs).toISOString()
    const period_end = new Date(startMs + (index + 1) * quarterMs).toISOString()
    return { period_start, period_end }
  })
  const items = periods.map((period, index) => ({
    ...period, id: `meter-${index}`, company_id: companyId, billing_underlay_id: billingUnderlayId,
    quantity_kwh: [1, 3, 2, 4][index % 4],
  }))
  const prices = periods.map((period, index) => ({
    time_start: period.period_start, time_end: period.period_end, source: 'market',
    price_area: 'SE3', resolution: 'quarter_hour', id: `price-${index}`,
    sek_per_kwh: (index % 4) + 1,
  }))
  const periodEnd = periods.at(-1)!.period_end
  return { start, periodEnd, items, prices }
}

type Proof = ReturnType<typeof fixture>
function resolve(proof: Proof, requiredResolution: 'hourly' | 'quarterly' = 'hourly') {
  ports.rpc.mockResolvedValue({
    error: null,
    data: {
      items: proof.items, prices: proof.prices, policies: [{ source_key: 'market', priority: 1 }],
      receipt: {
        schema_version: 1, company_id: companyId, billing_underlay_id: billingUnderlayId,
        period_start: proof.start, period_end: proof.periodEnd, price_area: 'SE3',
        required_resolution: requiredResolution, item_count: proof.items.length,
        price_count: proof.prices.length, policy_count: 1, fingerprint: 'a'.repeat(64),
      },
    },
  })
  return resolveIntervalSpotPricing({
    companyId, billingUnderlayId, priceArea: 'SE3', periodStart: proof.start,
    periodEnd: proof.periodEnd, requiredResolution, spotWeightPercent: 100, expectedUnderlay: {},
    expectedQuantityKwh: proof.items.reduce((sum, item) => sum + item.quantity_kwh, 0),
  })
}

beforeEach(() => ports.rpc.mockReset())
describe('hourly contracts with physical quarter-hour measurements', () => {
  it('keeps all 2,880 individual readings and identifies four market prices for each market hour', async () => {
    const proof = fixture('2026-10-31T23:00:00.000Z', 720)
    const priced = await resolve(proof)
    expect(priced.errors).toHaveLength(0)
    expect(priced.weightedAverageSekPerKwh).toBe(2.5)
    expect(priced.evidence).toHaveLength(2880)
    expect(priced.evidence.reduce((sum, row) => sum + row.amount_ex_vat, 0)).toBe(18000)
    for (const [i, evidence] of priced.evidence.entries()) {
      const item = proof.items[i]
      const hourStart = Math.floor(i / 4) * 4
      expect(evidence).toMatchObject({
        billing_underlay_item_id: item.id, metering_interval_start: item.period_start,
        metering_interval_end: item.period_end, consumption_kwh: item.quantity_kwh,
        resolution: 'quarter', price_sek_per_kwh: 2.5,
        price_source_ids: proof.prices.slice(hourStart, hourStart + 4).map((price) => price.id),
        evidence_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    }
  })

  it('uses different four-price groups across the two Stockholm 02:00 hours', async () => {
    const proof = fixture('2026-10-25T00:00:00.000Z', 2)
    proof.prices.slice(4).forEach((price) => { price.sek_per_kwh += 10 })
    const priced = await resolve(proof)
    expect(priced.errors).toEqual([])
    expect(priced.evidence.map((row) => row.price_sek_per_kwh)).toEqual([2.5, 2.5, 2.5, 2.5, 12.5, 12.5, 12.5, 12.5])
    expect(priced.evidence[3].price_source_ids).toEqual(['price-0', 'price-1', 'price-2', 'price-3'])
    expect(priced.evidence[4].price_source_ids).toEqual(['price-4', 'price-5', 'price-6', 'price-7'])
  })

  it('rejects an incomplete market hour without dropping the source evidence for complete hours', async () => {
    const proof = fixture('2026-10-25T00:00:00.000Z', 2)
    proof.prices.splice(1, 1)
    const priced = await resolve(proof)
    expect(priced.weightedAverageSekPerKwh).toBeNull()
    expect(priced.errors.filter((error) => error.startsWith('Spotpris saknas'))).toHaveLength(4)
    expect(priced.evidence.map((row) => row.billing_underlay_item_id)).toEqual(['meter-4', 'meter-5', 'meter-6', 'meter-7'])
  })

  it('retains explicit hourly market rows and the native quarter-price contract behavior', async () => {
    const proof = fixture('2026-11-01T00:00:00.000Z', 1)
    const quarterly = await resolve(proof, 'quarterly')
    expect(quarterly.weightedAverageSekPerKwh).toBe(2.9)
    expect(quarterly.evidence.map((row) => row.price_source_id)).toEqual(['price-0', 'price-1', 'price-2', 'price-3'])
    const hourly = await resolve({ ...proof, prices: [{
      ...proof.prices[0], resolution: 'hourly', id: 'stored-hour', time_end: proof.periodEnd, sek_per_kwh: 5,
    }] })
    expect(hourly.weightedAverageSekPerKwh).toBe(5)
    expect(hourly.evidence.every((row) => row.price_source_id === 'stored-hour' && !row.price_source_ids)).toBe(true)
  })
})
