// masterplan: AT-Z10M-SUPPLIER
// Ten-business-day Z10M send deadline across the Swedish Christmas/New Year
// market calendar: day 10 is accepted, day 11 is flagged late.
import { beforeEach, expect, it, vi } from 'vitest'

const calendar = vi.hoisted(() => ({ holidays: new Map<string, string>(), reads: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (table !== 'ediel_market_calendar_entries') throw new Error(`unexpected table:${table}`)
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters[column] = value; return query },
        maybeSingle: async () => {
          const date = String(filters.calendar_date)
          calendar.reads.push(date)
          if (filters.market !== 'electricity' || filters.country !== 'SE') return { data: null, error: null }
          const label = calendar.holidays.get(date)
          return { data: label ? { calendar_date: date, is_business_day: false, label } : null, error: null }
        },
      }
      return query
    },
  },
}))

import { classifyZ10mSend, z10mLatestSendDate, z10mSendDeadlineConstraint } from '../scripts/helpers/ediel-z10m-calendar-chronology'

beforeEach(() => {
  calendar.reads.length = 0
  calendar.holidays = new Map([
    ['2026-12-24', 'Julafton'], ['2026-12-25', 'Juldagen'], ['2026-12-31', 'Nyårsafton'],
    ['2027-01-01', 'Nyårsdagen'], ['2027-01-06', 'Trettondedag jul'],
  ])
})

it('reads the canonical PRODAT Z10 M inbound ten-business-day row', () => {
  const { rule, offset } = z10mSendDeadlineConstraint()
  expect(rule).toMatchObject({ family: 'PRODAT', code: 'Z10', subtype: 'M', direction: 'inbound' })
  expect(offset).toBe(10)
})

it('counts only market business days across weekends and holidays (day 10 accepted, day 11 late)', async () => {
  // Replacement Mon 2026-12-21. Business days: 22,23,28,29,30 Dec; 4,5,7,8,11 Jan.
  expect(await z10mLatestSendDate('2026-12-21')).toBe('2027-01-11')
  expect(calendar.reads).toContain('2027-01-06')
  await expect(classifyZ10mSend('2026-12-21', '2027-01-11')).resolves.toEqual({ latest: '2027-01-11', ordinal: 10, late: false })
  await expect(classifyZ10mSend('2026-12-21', '2027-01-12')).resolves.toEqual({ latest: '2027-01-11', ordinal: 11, late: true })
  // A weekend send after day 10 is still late; holidays never extend the ordinal.
  await expect(classifyZ10mSend('2026-12-21', '2027-01-09')).resolves.toMatchObject({ ordinal: 9, late: false })
  await expect(classifyZ10mSend('2026-12-21', '2026-12-25')).resolves.toMatchObject({ ordinal: 2, late: false })
})

it('without the holiday rows the same chronology would end on an earlier day', async () => {
  calendar.holidays = new Map()
  expect(await z10mLatestSendDate('2026-12-21')).toBe('2027-01-04')
  await expect(classifyZ10mSend('2026-12-21', '2027-01-05')).resolves.toMatchObject({ ordinal: 11, late: true })
})
