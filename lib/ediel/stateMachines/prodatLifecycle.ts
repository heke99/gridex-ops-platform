import type { EdielMessageRow } from '@/lib/ediel/types'

export type ProdatProcessKind =
  | 'information'
  | 'supplier_switch'
  | 'cancellation'
  | 'assigned_supply'
  | 'mandatory_purchase'
  | 'termination'
  | 'permission'
  | 'masterdata'
  | 'metering'
  | 'unexpected_direction'
  | 'unknown'

export type ProdatLifecycleState =
  | 'information_received'
  | 'switch_accepted'
  | 'cancelled_before_start'
  | 'assigned_supply_active'
  | 'mandatory_purchase_active'
  | 'termination_requested'
  | 'supply_ended'
  | 'supply_continues'
  | 'permission_requested'
  | 'permission_confirmed'
  | 'permission_rejected'
  | 'permission_ended'
  | 'permission_continues'
  | 'masterdata_update_received'
  | 'meter_change_received'
  | 'manual_review'

export type ProdatLifecycleOutcome =
  | 'grid_owner_information_received'
  | 'supplier_switch_accepted'
  | 'supplier_switch_cancelled_before_start'
  | 'assigned_supply_started'
  | 'mandatory_purchase_supply_started'
  | 'supply_termination_requested'
  | 'supply_terminated'
  | 'supply_continuation_confirmed'
  | 'masterdata_update_received'
  | 'meter_change_received'
  | 'permission_requested'
  | 'permission_confirmed'
  | 'permission_rejected'
  | 'permission_ended'
  | 'permission_continues'
  | 'unexpected_direction_review'
  | 'manual_review_required'

export type ProdatLifecycleDecision = {
  code: string
  subtype: string | null
  process: ProdatProcessKind
  state: ProdatLifecycleState
  outcome: ProdatLifecycleOutcome
  createSupplyPeriod: boolean
  endSupplyPeriod: boolean
  requiresCorrelation: boolean
}

type ProdatLifecycleMessage = Pick<EdielMessageRow, 'message_code' | 'parsed_payload' | 'raw_payload'> & {
  direction?: string | null
}

const SUBTYPE_ALIASES: Record<string, string> = {
  Z22: 'L',
  Z23: 'LK',
  Z24: 'C',
  Z25: 'H',
  Z26: 'A',
  Z27: 'B',
  Z70: 'D',
  Z96: 'N',
  E34: 'E',
  E58: 'M',
  E64: 'F',
  E32: 'G',
  S17: 'V',
  S18: 'VH',
  CANCEL: 'C',
  CANCELLATION: 'C',
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = firstText(entry)
      if (nested) return nested
    }
  }
  const valueRecord = record(value)
  if (valueRecord) {
    for (const key of [
      'subtype', 'variant', 'prodatVariant', 'message_subtype', 'messageSubtype',
      'transaction_subtype', 'transactionSubtype', 'transaction_type', 'transactionType',
      'reason_for_transaction', 'reasonForTransaction', 'function', 'messageFunction',
    ]) {
      const nested = firstText(valueRecord[key])
      if (nested) return nested
    }
  }
  return null
}

export function normalizeProdatSubtype(code: string, value: string | null): string | null {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  const withoutCode = normalized.startsWith(code) ? normalized.slice(code.length) : normalized
  const mapped = withoutCode || normalized
  return SUBTYPE_ALIASES[mapped] ?? mapped
}

export function extractProdatSubtype(message: ProdatLifecycleMessage): string | null {
  const rawCode = String(message.message_code ?? '').trim().toUpperCase()
  const code = rawCode.slice(0, 3)
  if (rawCode.length > 3) return normalizeProdatSubtype(code, rawCode.slice(3))

  const fromPayload = normalizeProdatSubtype(code, firstText(message.parsed_payload))
  if (fromPayload) return fromPayload

  const raw = String(message.raw_payload ?? '').toUpperCase()
  // Compact function forms used by some fixtures, e.g. Z04L.
  const compactCode = raw.match(new RegExp(`(?:BGM\\+|\\b)${code}([A-Z]{1,2})(?:[+':]|\\b)`))?.[1] ?? null
  if (compactCode) return normalizeProdatSubtype(code, compactCode)

  // Swedish PRODAT 26.A transaction type is commonly carried as a CAV value.
  for (const transactionCode of Object.keys(SUBTYPE_ALIASES)) {
    if (raw.includes(`CAV+${transactionCode}`) || raw.includes(`:${transactionCode}`)) {
      return normalizeProdatSubtype(code, transactionCode)
    }
  }
  return null
}

function decision(
  input: Omit<ProdatLifecycleDecision, 'code' | 'subtype'>,
  code: string,
  subtype: string | null,
): ProdatLifecycleDecision {
  return { code, subtype, ...input }
}

function manualDirectionReview(code: string, subtype: string | null): ProdatLifecycleDecision {
  return decision({
    process: 'unexpected_direction',
    state: 'manual_review',
    outcome: 'unexpected_direction_review',
    createSupplyPeriod: false,
    endSupplyPeriod: false,
    requiresCorrelation: false,
  }, code, subtype)
}

/**
 * Decide only the business effect of an inbound PRODAT message for Gridex's
 * supplier/eligible-party roles. Outbound-origin messages observed inbound are
 * quarantined for review and never mutate customer/supply state.
 */
export function decideProdatLifecycle(message: ProdatLifecycleMessage): ProdatLifecycleDecision | null {
  const code = String(message.message_code ?? '').trim().toUpperCase().slice(0, 3)
  const subtype = extractProdatSubtype(message)
  const inbound = !message.direction || String(message.direction).toLowerCase() === 'inbound'

  if (inbound && ['Z01', 'Z03', 'Z08', 'Z09', 'Z13', 'Z18'].includes(code)) {
    return manualDirectionReview(code, subtype)
  }

  if (code === 'Z02') {
    return decision({ process: 'information', state: 'information_received', outcome: 'grid_owner_information_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }

  if (code === 'Z04' && (subtype === 'L' || subtype === 'LK')) {
    return decision({ process: 'supplier_switch', state: 'switch_accepted', outcome: 'supplier_switch_accepted', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z04' && subtype === 'C') {
    return decision({ process: 'cancellation', state: 'cancelled_before_start', outcome: 'supplier_switch_cancelled_before_start', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z04' && subtype === 'A') {
    return decision({ process: 'assigned_supply', state: 'assigned_supply_active', outcome: 'assigned_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  }
  if (code === 'Z04' && subtype === 'D') {
    return decision({ process: 'mandatory_purchase', state: 'mandatory_purchase_active', outcome: 'mandatory_purchase_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  }
  if (code === 'Z04') {
    return decision({ process: 'unknown', state: 'manual_review', outcome: 'manual_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }

  if (code === 'Z05' && (subtype === 'L' || subtype === 'LK')) {
    return decision({ process: 'termination', state: 'supply_ended', outcome: 'supply_terminated', createSupplyPeriod: false, endSupplyPeriod: true, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z05' && subtype === 'C') {
    return decision({ process: 'cancellation', state: 'supply_continues', outcome: 'supply_continuation_confirmed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z05') {
    return decision({ process: 'supplier_switch', state: 'manual_review', outcome: 'manual_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }

  if (code === 'Z06' && ['E', 'F', 'G'].includes(subtype ?? '')) {
    return decision({ process: 'masterdata', state: 'masterdata_update_received', outcome: 'masterdata_update_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  }
  if (code === 'Z10' && subtype === 'M') {
    return decision({ process: 'metering', state: 'meter_change_received', outcome: 'meter_change_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  }

  if (code === 'Z14' && subtype === 'N') {
    return decision({ process: 'permission', state: 'permission_rejected', outcome: 'permission_rejected', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z14' && (subtype === 'V' || subtype === 'VH')) {
    return decision({ process: 'permission', state: 'permission_confirmed', outcome: 'permission_confirmed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z15' && (subtype === 'V' || subtype === 'VH')) {
    return decision({ process: 'permission', state: 'permission_ended', outcome: 'permission_ended', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z15' && subtype === 'C') {
    return decision({ process: 'permission', state: 'permission_continues', outcome: 'permission_continues', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }
  if (code === 'Z14' || code === 'Z15') {
    return decision({ process: 'permission', state: 'manual_review', outcome: 'manual_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  }

  if (code === 'Z06' || code === 'Z10') {
    return decision({ process: code === 'Z10' ? 'metering' : 'masterdata', state: 'manual_review', outcome: 'manual_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  }

  return null
}
