import { requestMeteringAccess } from '@/lib/operations/businessActions/requestMeteringAccess'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'

function dateOnly(value: string): Date {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error('Ogiltig historisk period.')
  return date
}

export async function requestHistoricalMeteringAccess(input: Parameters<typeof requestMeteringAccess>[0] & {
  startDate: string
  endDate: string
}) {
  const start = dateOnly(input.startDate)
  const end = dateOnly(input.endDate)
  const yesterday = new Date()
  yesterday.setUTCHours(0, 0, 0, 0)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const oldest = new Date(yesterday)
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 3)

  if (start > yesterday || end > yesterday || end < start || start < oldest) {
    return {
      ok: false,
      decision: decideBusinessAction('request_historical_metering_access'),
      message: 'Historisk period måste vara avslutad, i rätt ordning och högst tre år bakåt.',
    }
  }

  return requestMeteringAccess(input)
}
