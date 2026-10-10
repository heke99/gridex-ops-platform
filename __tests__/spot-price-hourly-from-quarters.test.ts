// spot-price review: hourly contracts after the 2025-10-01 quarter-hour switch; öre rounding
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { hourlyPriceFromQuarters } from '@/lib/pricing/intervalPricing'

const day = JSON.parse(fs.readFileSync('__tests__/fixtures/elprisetjustnu/2025-10-01_SE3.json', 'utf8')) as Array<{ SEK_per_kWh: number; time_start: string; time_end: string }>
const rows = day.map((r, i) => ({ id: `q${i}`, source: 'elprisetjustnu', resolution: 'quarter_hour', sek_per_kwh: r.SEK_per_kWh, time_start: r.time_start, time_end: r.time_end }))
const priority = new Map([['elprisetjustnu', 1]])
const hour = (h: number) => [Date.parse(day[h * 4].time_start), Date.parse(day[h * 4 + 3].time_end)] as const

describe('hourly price from four quarter-hours', () => {
  it('is the arithmetic mean of the four provider quarters (real 2025-10-01 SE3 data)', () => {
    const [start, end] = hour(0)
    const expected = Math.round(((day[0].SEK_per_kWh + day[1].SEK_per_kWh + day[2].SEK_per_kWh + day[3].SEK_per_kWh) / 4) * 1e6) / 1e6
    expect(hourlyPriceFromQuarters(rows, start, end, priority)).toEqual({ value: expected, ids: ['q0', 'q1', 'q2', 'q3'] })
  })
  it('returns no price when a quarter is missing', () => {
    const [start, end] = hour(5)
    expect(hourlyPriceFromQuarters(rows.filter((r) => r.id !== 'q21'), start, end, priority)).toBeNull()
  })
  it('never mixes quarters from different sources', () => {
    const [start, end] = hour(1)
    const mixed = rows.map((r) => r.id === 'q6' ? { ...r, source: 'other' } : r)
    expect(hourlyPriceFromQuarters(mixed, start, end, new Map([['elprisetjustnu', 1], ['other', 2]]))).toBeNull()
  })
  it('keeps negative prices', () => {
    const [start, end] = hour(2)
    const negative = rows.map((r) => ['q8', 'q9', 'q10', 'q11'].includes(r.id) ? { ...r, sek_per_kwh: -0.01 } : r)
    expect(hourlyPriceFromQuarters(negative, start, end, priority)?.value).toBe(-0.01)
  })
})
