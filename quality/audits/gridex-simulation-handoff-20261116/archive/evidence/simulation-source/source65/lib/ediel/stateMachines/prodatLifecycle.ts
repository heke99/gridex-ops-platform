import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {
  canonicalBusinessSemanticsProjection,
  canonicalProdatSubtypeForMessage,
  canonicalProdatTransactionReasonCodes,
  type ProdatBusinessContext,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'

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

type ProdatLifecycleMessage = Pick<EdielMessageRow, 'message_code' | 'parsed_payload' | 'raw_payload'> &
  Partial<Pick<EdielMessageRow,
    | 'direction'
    | 'application_reference'
    | 'message_version'
    | 'message_received_at'
    | 'created_at'
    | 'validation_report'
  >>

// Product/workflow aliases only. Ediel reason-code aliases are resolved by the
// canonical subtype registry behind canonicalEdielFacade.
const APPLICATION_SUBTYPE_ALIASES: Record<string, string> = {
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
  return APPLICATION_SUBTYPE_ALIASES[mapped] ?? canonicalProdatSubtypeForMessage(code, mapped) ?? mapped
}

export function extractProdatSubtype(message: ProdatLifecycleMessage): string | null {
  const rawCode = String(message.message_code ?? '').trim().toUpperCase()
  const code = rawCode.slice(0, 3)
  if (rawCode.length > 3) return normalizeProdatSubtype(code, rawCode.slice(3))

  const fromPayload = normalizeProdatSubtype(code, firstText(message.parsed_payload))
  if (fromPayload) return fromPayload

  const raw = String(message.raw_payload ?? '').toUpperCase()
  const compactCode = raw.match(new RegExp(`(?:BGM\\+|\\b)${code}([A-Z]{1,2})(?:[+':]|\\b)`))?.[1] ?? null
  if (compactCode) return normalizeProdatSubtype(code, compactCode)

  for (const transactionCode of canonicalProdatTransactionReasonCodes()) {
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

function manualReview(code: string, subtype: string | null, process: ProdatProcessKind = 'unknown'): ProdatLifecycleDecision {
  return decision({
    process,
    state: 'manual_review',
    outcome: 'manual_review_required',
    createSupplyPeriod: false,
    endSupplyPeriod: false,
    requiresCorrelation: true,
  }, code, subtype)
}

function lifecycleFromBusinessEffect(input: {
  code: string
  subtype: string | null
  businessEffect: string
}): ProdatLifecycleDecision {
  const { code, subtype, businessEffect } = input
  switch (businessEffect) {
    case 'record_grid_contract_response':
      return decision({ process: 'information', state: 'information_received', outcome: 'grid_owner_information_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'confirm_supplier_change':
    case 'confirm_customer_and_supplier_change':
      return decision({ process: 'supplier_switch', state: 'switch_accepted', outcome: 'supplier_switch_accepted', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'confirm_change_cancellation':
      return decision({ process: 'cancellation', state: 'cancelled_before_start', outcome: 'supplier_switch_cancelled_before_start', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'start_assigned_supply':
      return decision({ process: 'assigned_supply', state: 'assigned_supply_active', outcome: 'assigned_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
    case 'start_production_receipt_obligation':
      return decision({ process: 'mandatory_purchase', state: 'mandatory_purchase_active', outcome: 'mandatory_purchase_supply_started', createSupplyPeriod: true, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
    case 'request_supply_end':
      return decision({ process: 'termination', state: 'termination_requested', outcome: 'supply_termination_requested', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'end_existing_supply':
      return decision({ process: 'termination', state: 'supply_ended', outcome: 'supply_terminated', createSupplyPeriod: false, endSupplyPeriod: true, requiresCorrelation: true }, code, subtype)
    case 'continue_existing_supply':
      return decision({ process: 'cancellation', state: 'supply_continues', outcome: 'supply_continuation_confirmed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'update_customer_masterdata':
    case 'update_metering_point_with_reading':
    case 'update_metering_point_masterdata':
      return decision({ process: 'masterdata', state: 'masterdata_update_received', outcome: 'masterdata_update_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
    case 'update_meter_masterdata':
      return decision({ process: 'metering', state: 'meter_change_received', outcome: 'meter_change_received', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: false }, code, subtype)
    case 'request_metering_reporting':
    case 'request_historical_metering_data':
      return decision({ process: 'permission', state: 'permission_requested', outcome: 'permission_requested', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'approve_metering_reporting':
    case 'approve_historical_metering_data':
      return decision({ process: 'permission', state: 'permission_confirmed', outcome: 'permission_confirmed', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'reject_metering_reporting':
      return decision({ process: 'permission', state: 'permission_rejected', outcome: 'permission_rejected', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'stop_metering_reporting':
    case 'stop_historical_metering_reporting':
      return decision({ process: 'permission', state: 'permission_ended', outcome: 'permission_ended', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    case 'continue_metering_reporting':
      return decision({ process: 'permission', state: 'permission_continues', outcome: 'permission_continues', createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true }, code, subtype)
    default:
      return manualReview(code, subtype)
  }
}

function referenceDate(message: ProdatLifecycleMessage): string | null {
  for (const value of [message.message_received_at, message.created_at]) {
    const candidate = String(value ?? '').trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate
  }
  const rawDate = String(message.raw_payload ?? '').match(/DTM\+137:(\d{8})/)?.[1]
  return rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : null
}

function boolFact(message: ProdatLifecycleMessage, key: string): boolean | undefined {
  const payload = record(message.parsed_payload)
  const report = record(message.validation_report)
  const values = [
    payload?.[key],
    record(payload?.prodatDependentFacts)?.[key],
    record(report?.prodatDependentFacts)?.[key],
  ]
  return values.find((value): value is boolean => typeof value === 'boolean')
}

function contextFact(message: ProdatLifecycleMessage): ProdatBusinessContext | null {
  const payload = record(message.parsed_payload)
  const value = String(payload?.businessContext ?? record(payload?.prodatDependentFacts)?.businessContext ?? '').trim().toLowerCase()
  return ['death', 'bankruptcy', 'identity_change', 'other_masterdata', 'unknown'].includes(value)
    ? value as ProdatBusinessContext
    : null
}

export function decideProdatLifecycleFromPolicy(policy: CanonicalEdielPolicy): ProdatLifecycleDecision {
  const code = policy.code
  const subtype = policy.subtype
  if (policy.family !== 'PRODAT') return manualReview(code, subtype)
  if (policy.direction === 'inbound' && policy.semantics.direction === 'outbound') {
    return manualDirectionReview(code, subtype)
  }
  return lifecycleFromBusinessEffect({
    code,
    subtype,
    businessEffect: policy.semantics.businessEffect,
  })
}

/**
 * Active runtime path: resolve one canonical policy and project its business
 * effect into Gridex workflow states. No Ediel code/subtype matrix is owned by
 * this state machine. If required policy facts are unavailable, state mutation
 * fails closed to manual review instead of guessing.
 *
 * Partial synthetic test objects without protocol metadata use the same
 * canonical business-semantics registry as a compatibility projection only.
 */
export function decideProdatLifecycle(message: ProdatLifecycleMessage): ProdatLifecycleDecision | null {
  const code = String(message.message_code ?? '').trim().toUpperCase().slice(0, 3)
  const subtype = extractProdatSubtype(message)
  if (!code || !subtype) return null

  const date = referenceDate(message)
  const applicationReference = String(message.application_reference ?? '').trim() || null
  const version = String(message.message_version ?? '').trim() || null
  const direction = String(message.direction ?? 'inbound').toLowerCase() === 'outbound' ? 'outbound' : 'inbound'

  if (date && applicationReference && version) {
    try {
      const policy = resolveCanonicalEdielPolicy({
        family: 'PRODAT',
        messageCode: code,
        subtypeOrReasonCode: subtype,
        direction,
        referenceDate: date,
        associationAssignedCode: version,
        applicationReference,
        businessContext: contextFact(message),
        bilateralCapabilityVerified: boolFact(message, 'bilateralCapabilityVerified'),
        mode: 'parse',
      })
      return decideProdatLifecycleFromPolicy(policy)
    } catch {
      return manualDirectionReview(code, subtype)
    }
  }

  const semantics = canonicalBusinessSemanticsProjection({ family: 'PRODAT', code, subtype })
  if (!semantics) return null
  if (direction === 'inbound' && semantics.direction === 'outbound') return manualDirectionReview(code, subtype)
  return lifecycleFromBusinessEffect({ code, subtype, businessEffect: semantics.businessEffect })
}
