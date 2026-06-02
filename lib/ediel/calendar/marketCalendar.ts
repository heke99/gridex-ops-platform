import { supabaseService } from '@/lib/supabase/service'

export type MarketCalendarDay = {
  date: string
  isBusinessDay: boolean
  label: string | null
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function weekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

export async function getMarketCalendarDay(date: Date, market = 'electricity'): Promise<MarketCalendarDay> {
  const dateOnly = isoDate(date)
  const { data, error } = await supabaseService
    .from('ediel_market_calendar_entries')
    .select('calendar_date,is_business_day,label')
    .eq('market', market)
    .eq('country', 'SE')
    .eq('calendar_date', dateOnly)
    .maybeSingle()

  if (!error && data) {
    return {
      date: dateOnly,
      isBusinessDay: data.is_business_day === true,
      label: typeof data.label === 'string' ? data.label : null,
    }
  }

  return {
    date: dateOnly,
    isBusinessDay: !weekend(date),
    label: weekend(date) ? 'Helg' : null,
  }
}

export async function addBusinessDays(date: Date, days: number, market = 'electricity'): Promise<Date> {
  const next = new Date(date)
  let remaining = Math.max(0, days)

  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + 1)
    const calendarDay = await getMarketCalendarDay(next, market)
    if (calendarDay.isBusinessDay) remaining -= 1
  }

  return next
}

export async function isBusinessDay(date: Date, market = 'electricity'): Promise<boolean> {
  return (await getMarketCalendarDay(date, market)).isBusinessDay
}
