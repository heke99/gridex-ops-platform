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
  | 'unknown'

export type ProdatLifecycleState =
  | 'information_received'
  | 'switch_accepted'
  | 'cancelled_before_start'
  | 'assigned_supply_active'
  | 'mandatory_purchase_active'
  | 'termination_requested'
  | 'supply_ended'
  | 'permission_requested'
  | 'permission_confirmed'
  | 'permission_rejected'
  | 'permission_ended'
  | 'manual_review'

export type ProdatLifecycleDecision = {
  code: string
  subtype: string | null
  process: ProdatProcessKind
  state: ProdatLifecycleState
  outcome:
    | 'grid_owner_information_received'
    | 'supplier_switch_accepted'
    | 'supplier_switch_cancelled_before_start'
    | 'assigned_supply_started'
    | 'mandatory_purchase_supply_started'
    | 'supply_termination_requested'
    | 'supply_terminated'
    | 'supplier_switch_changed'
    | 'supplier_switch_review_required'
    | 'permission_requested'
    | 'permission_confirmed'
    | 'permission_rejected'
    | 'permission_ended'
    | 'manual_review_required'
  createSupplyPeriod: boolean
  endSupplyPeriod: boolean
  requiresCorrelation: boolean
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
      'subtype', 'variant', 'message_subtype', 'messageSubtype',
      'transaction_type', 'transactionType', 'reason_for_transaction',
      'reasonForTransaction', 'function', 'messageFunction',
    ]) {
      const nested = firstText(valueRecord[key])
      if (nested) return nested
    }
  }
  return null
}

function normalizeSubtype(code: string, value: string | null): string | null {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  const withoutCode = normalized.startsWith(code) ? normalized.slice(code.length) : normalized
  const mapped = withoutCode || normalized
  if (mapped === 'Z22') return 'L'
  if (mapped === 'Z23') return 'LK'
  if (mapped === 'Z24' || mapped === 'CANCEL' || mapped === 'CANCELLATION') return 'C'
  if (mapped === 'S17') return 'V'
  if (mapped === 'S18') return 'VH'
  if (mapped === 'E64') return 'F'
  if (mapped === 'E32') return 'G'
  if (mapped === 'Z70') return 'D'
  return mapped
}

export function extractProdatSubtype(message: Pick<EdielMessageRow, 'message_code' | 'parsed_payload' | 'raw_payload'>): string | null {
  const rawCode = String(message.message_code ?? '').trim().toUpperCase()
  const code = rawCode.slice(0, 3)
  if (rawCode.length > 3) return normalizeSubtype(code, rawCode.slice(3))

  const fromPayload = normalizeSubtype(code, firstText(message.parsed_payload))
  if (fromPayload) return fromPayload

  const raw = String(message.raw_payload ?? '').toUpperCase()
  const compactCode = raw.match(new RegExp(`(?:BGM\\+|\\b)${code}([A-Z]{1,2})(?:[+':]|\\b)`))?.[1] ?? null
  if (compactCode) return normalizeSubtype(code, compactCode)
  const reason = raw.match(/CCI\+\+Z13'?(?:\r?\n)?CAV\+([A-Z0-9]+)/)?.[1] ?? null
  return normalizeSubtype(code, reason)
}

function decision(input: Omit<ProdatLifecycleDecision, 'code' | 'subtype'>, code: string, subtype: string | null): ProdatLifecycleDecision {
  return { code, subtype, ...input }
}

export function decideProdatLifecycle(message: Pick<EdielMessageRow, 'message_code' | 'parsed_payload' | 'raw_payload'>): ProdatLifecycleDecision | null {
  const code = String(message.message_code ?? '').trim().toUpperCase().slice(0, 3)
  const subtype = extractProdatSubtype(message)

  if (code === 'Z02') return decision({ process: 'information', state: 'information_received', outcome: 'grid_owner_information_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z04' && (subtype === 'L' || subtype === 'LK')) return decision({ process: 'supplier_switch', state: 'switch_accepted', outcome: 'supplier_switch_accepted', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z04' && subtype === 'C') return decision({ process: 'cancellation', state: 'cancelled_before_start', outcome: 'supplier_switch_cancelled_before_start', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z04' && subtype === 'A') return decision({ process: 'assigned_supply', state: 'assigned_supply_active', outcome: 'assigned_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  if (code === 'Z04' && subtype === 'D') return decision({ process: 'mandatory_purchase', state: 'mandatory_purchase_active', outcome: 'mandatory_purchase_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  if (code === 'Z04') return decision({ process: 'unknown', state: 'manual_review', outcome: 'manual_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)

  if (code === 'Z08' && subtype === 'H') return decision({ process: 'termination', state: 'termination_requested', outcome: 'supply_termination_requested', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z05' && (subtype === 'L' || subtype === 'LK')) return decision({ process: 'termination', state: 'supply_ended', outcome: 'supply_terminated', createSupplyPeriod: false, endSupplyPeriod: true, requiresCorrelation: true }, code, subtype)
  if (code === 'Z05') return decision({ process: 'supplier_switch', state: 'manual_review', outcome: 'supplier_switch_review_required', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)

  if (code === 'Z13') return decision({ process: 'permission', state: 'permission_requested', outcome: 'permission_requested', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z14' && subtype === 'N') return decision({ process: 'permission', state: 'permission_rejected', outcome: 'permission_rejected', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z14') return decision({ process: 'permission', state: 'permission_confirmed', outcome: 'permission_confirmed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
  if (code === 'Z15' || code === 'Z18') return decision({ process: 'permission', state: 'permission_ended', outcome: 'permission_ended', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)

  if (code === 'Z06' || code === 'Z09' || code === 'Z10') return decision({ process: 'masterdata', state: 'manual_review', outcome: 'supplier_switch_changed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
  return null
}
