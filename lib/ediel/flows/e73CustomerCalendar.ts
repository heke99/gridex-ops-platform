import { addCalendarDays, stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'

export const CUSTOMER_CALENDAR_E73_ORIGIN = 'customer_document_e73_calendar_v1'

function stockholmStartOfDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return stockholmLocalToUtc({ year, month, day }).toISOString()
}

export function customerCalendarE73Period(from: string | null, through: string | null) {
  const fromDate = strictIsoDate(from, 'Periodens första dag')
  const throughDate = strictIsoDate(through, 'Periodens sista dag')
  if (fromDate > throughDate) throw new Error('Periodens sista dag kan inte vara före den första.')
  return {
    fromDate,
    throughDate,
    start: stockholmStartOfDate(fromDate),
    end: stockholmStartOfDate(addCalendarDays(throughDate, 1)),
  }
}

export function customerCalendarE73Selection(from: string | null, through: string | null, environment: string | null): ReturnType<typeof customerCalendarE73Period> & { environment: 'test' | 'production' } {
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('Välj Ediel-miljö för mätvärdesbegäran.')
  }
  return { ...customerCalendarE73Period(from, through), environment }
}
