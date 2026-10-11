// spot-price review: autumn DST provider time_end quirk (elprisetjustnu, real payloads)
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fetchElprisetJustNuDay } from '@/lib/pricing/spot/elprisetJustNuClient'
import { validateSpotPriceDay } from '@/lib/pricing/spot/intervalCoverage'

function fixtureFetch(name: string): typeof fetch {
  const body = fs.readFileSync(`__tests__/fixtures/elprisetjustnu/${name}.json`, 'utf8')
  return (async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

describe('elprisetjustnu DST days', () => {
  it.each(['SE1', 'SE3'] as const)('autumn 2025-10-26 %s: 100 quarter-hours covering 25 hours without overlap', async (area) => {
    const intervals = await fetchElprisetJustNuDay({ date: '2025-10-26', priceArea: area, fetchImpl: fixtureFetch(`2025-10-26_${area}`), maxAttempts: 1 })
    expect(intervals).toHaveLength(100)
    expect(intervals.every((i) => i.resolution === 'quarter_hour')).toBe(true)
    for (let i = 1; i < intervals.length; i += 1) expect(intervals[i].timeStart).toBe(intervals[i - 1].timeEnd)
    const coverage = validateSpotPriceDay({ calendarDate: '2025-10-26', priceArea: area, intervals })
    expect(coverage.issues).toEqual([])
  })
  it('spring 2026-03-29 SE3 still validates with 92 quarter-hours', async () => {
    const intervals = await fetchElprisetJustNuDay({ date: '2026-03-29', priceArea: 'SE3', fetchImpl: fixtureFetch('2026-03-29_SE3'), maxAttempts: 1 })
    expect(intervals).toHaveLength(92)
    expect(validateSpotPriceDay({ calendarDate: '2026-03-29', priceArea: 'SE3', intervals }).issues).toEqual([])
  })
  it('keeps provider prices unchanged', async () => {
    const raw = JSON.parse(fs.readFileSync('__tests__/fixtures/elprisetjustnu/2025-10-01_SE3.json', 'utf8'))
    const intervals = await fetchElprisetJustNuDay({ date: '2025-10-01', priceArea: 'SE3', fetchImpl: fixtureFetch('2025-10-01_SE3'), maxAttempts: 1 })
    expect(intervals.map((i) => i.sekPerKwh)).toEqual(raw.map((r: { SEK_per_kWh: number }) => r.SEK_per_kWh))
  })
})
