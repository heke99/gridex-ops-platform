import { describe, expect, it, vi } from 'vitest'
import { parseProviderTimestamp } from '@/lib/billing/providerEventProcessor'
import { stockholmLocalToUtc, stockholmMonthBounds } from '@/lib/time/stockholm'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

const autumn = { year: 2026, month: 10, day: 25 }
const spring = { year: 2026, month: 3, day: 29 }

describe('Stockholm civil timestamps', () => {
  it.each([[0, 0], [30, 0], [59, 59]])('rejects the repeated local 02:%i:%i without an offset', (minute, second) => {
    expect(() => stockholmLocalToUtc({ ...autumn, hour: 2, minute, second })).toThrow('tvetydig svensk lokal tid')
  })

  it('rejects the spring gap and preserves the instants immediately before and after it', () => {
    expect(() => stockholmLocalToUtc({ ...spring, hour: 2, minute: 30 })).toThrow('Ogiltig eller tvetydig svensk lokal tid')
    expect(stockholmLocalToUtc({ ...spring, hour: 1, minute: 59, second: 59 }).toISOString()).toBe('2026-03-29T00:59:59.000Z')
    expect(stockholmLocalToUtc({ ...spring, hour: 3 }).toISOString()).toBe('2026-03-29T01:00:00.000Z')
  })

  it.each([
    [{ year: 2026, month: 1, day: 15, hour: 12 }, '2026-01-15T11:00:00.000Z'],
    [{ year: 2026, month: 7, day: 4, hour: 15, minute: 12, second: 31 }, '2026-07-04T13:12:31.000Z'],
    [autumn, '2026-10-24T22:00:00.000Z'],
    [{ ...autumn, hour: 3 }, '2026-10-25T02:00:00.000Z'],
  ] as const)('maps valid date and time %j to the unique UTC instant', (local, expected) => {
    expect(stockholmLocalToUtc(local).toISOString()).toBe(expected)
  })

  it.each([
    ['2026-03', '2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z', 743],
    ['2026-10', '2026-09-30T22:00:00.000Z', '2026-10-31T23:00:00.000Z', 745],
  ] as const)('retains Stockholm midnight boundaries for billing month %s', (month, start, end, hours) => {
    const bounds = stockholmMonthBounds(month)
    expect(bounds).toMatchObject({ start, end, timeZone: 'Europe/Stockholm' })
    expect((Date.parse(bounds.end) - Date.parse(bounds.start)) / 3_600_000).toBe(hours)
  })

  it('keeps both physical provider timestamps when an explicit offset is supplied', () => {
    expect(parseProviderTimestamp('2026-10-25T02:30:00+02:00')).toBe('2026-10-25T00:30:00.000Z')
    expect(parseProviderTimestamp('2026-10-25T02:30:00+01:00')).toBe('2026-10-25T01:30:00.000Z')
  })

  it('rejects an offsetless timestamp when its provider event cannot be placed on one timeline', () => {
    expect(parseProviderTimestamp('2026-10-25T02:30:00')).toBeNull()
    expect(parseProviderTimestamp('2026-03-29T02:30:00')).toBeNull()
    expect(parseProviderTimestamp('2026-10-25T03:00:00')).toBe('2026-10-25T02:00:00.000Z')
  })
})
