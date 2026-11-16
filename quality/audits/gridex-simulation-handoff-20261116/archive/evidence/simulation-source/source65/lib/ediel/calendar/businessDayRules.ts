import { addBusinessDays, isBusinessDay } from '@/lib/ediel/calendar/marketCalendar'

export async function earliestBusinessDate(params: {
  fromDate: Date
  minLeadBusinessDays: number
  market?: string
}): Promise<Date> {
  return addBusinessDays(params.fromDate, params.minLeadBusinessDays, params.market)
}

export async function dateSatisfiesBusinessLead(params: {
  requestedDate: Date
  fromDate?: Date
  minLeadBusinessDays: number
  market?: string
}): Promise<boolean> {
  const earliest = await earliestBusinessDate({
    fromDate: params.fromDate ?? new Date(),
    minLeadBusinessDays: params.minLeadBusinessDays,
    market: params.market,
  })
  const requested = new Date(params.requestedDate)
  requested.setUTCHours(0, 0, 0, 0)
  earliest.setUTCHours(0, 0, 0, 0)
  return requested.getTime() >= earliest.getTime() && await isBusinessDay(requested, params.market)
}
