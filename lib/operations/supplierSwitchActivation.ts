import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

export type SupplierSwitchActivationReadiness = {
  ready: boolean
  code:
    | 'ready'
    | 'not_accepted'
    | 'missing_z04_confirmation'
    | 'missing_effective_start_date'
    | 'awaiting_effective_start_date'
  effectiveStartDate: string | null
  marketDate: string
  reason: string
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)
  return match?.[1] ?? null
}

export function stockholmMarketDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('stockholm_market_date_resolution_failed')
  return `${year}-${month}-${day}`
}

export function supplierSwitchEffectiveStartDate(
  request: Pick<SupplierSwitchRequestRow, 'confirmed_start_date' | 'requested_start_date'>
): string | null {
  return dateOnly(request.confirmed_start_date) ?? dateOnly(request.requested_start_date)
}

export function getSupplierSwitchActivationReadiness(
  request: Pick<
    SupplierSwitchRequestRow,
    'status' | 'inbound_z04_message_id' | 'confirmed_start_date' | 'requested_start_date'
  >,
  now = new Date()
): SupplierSwitchActivationReadiness {
  const marketDate = stockholmMarketDate(now)
  const effectiveStartDate = supplierSwitchEffectiveStartDate(request)

  if (request.status !== 'accepted') {
    return {
      ready: false,
      code: 'not_accepted',
      effectiveStartDate,
      marketDate,
      reason: 'Leverantörsbytet måste vara affärsmässigt bekräftat av nätägaren med inbound PRODAT Z04.',
    }
  }

  if (!request.inbound_z04_message_id) {
    return {
      ready: false,
      code: 'missing_z04_confirmation',
      effectiveStartDate,
      marketDate,
      reason: 'Accepted-status saknar korrelerad inbound PRODAT Z04 och får inte aktivera leveransen.',
    }
  }

  if (!effectiveStartDate) {
    return {
      ready: false,
      code: 'missing_effective_start_date',
      effectiveStartDate: null,
      marketDate,
      reason: 'Nätägaren har bekräftat bytet men ett verifierat startdatum saknas.',
    }
  }

  if (effectiveStartDate > marketDate) {
    return {
      ready: false,
      code: 'awaiting_effective_start_date',
      effectiveStartDate,
      marketDate,
      reason: `Nätägaren har bekräftat bytet. Leveransen aktiveras tidigast ${effectiveStartDate}.`,
    }
  }

  return {
    ready: true,
    code: 'ready',
    effectiveStartDate,
    marketDate,
    reason: `Inbound PRODAT Z04 är korrelerad och startdatum ${effectiveStartDate} är uppnått.`,
  }
}
