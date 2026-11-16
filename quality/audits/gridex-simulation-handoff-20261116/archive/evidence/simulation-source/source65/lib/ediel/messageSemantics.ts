import {
  canonicalBusinessSemanticsCatalog,
  canonicalBusinessSemanticsProjection,
  type CanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessFamily,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EdielMessageFamily = CanonicalEdielBusinessFamily

export type EdielMessageSemantics = {
  messageFamily: EdielMessageFamily
  messageCode: string
  subtype: string | null
  direction: 'inbound' | 'outbound' | 'both'
  senderRole: string | null
  receiverRole: string | null
  businessProcess: string
  requestType: string | null
  expectedResponse: string[]
  allowedNextStatus: string[]
  requiredFields: string[]
  forbiddenIfMissing: string[]
  ackPolicy: string
  supplierUtiltsSupport: string | null
  timeoutPolicy: string | null
  ruleVersion: string
  environment: 'test' | 'production' | 'both'
}

function requestTypeFor(entry: CanonicalEdielBusinessSemantics): string | null {
  if (entry.family === 'PRODAT') {
    const key = `${entry.code}:${entry.subtype ?? ''}`
    const mapping: Record<string, string> = {
      'Z01:L': 'switch_prerequisite_check',
      'Z01:LK': 'customer_supplier_change_prerequisite_check',
      'Z02:L': 'switch_prerequisite_response',
      'Z02:LK': 'customer_supplier_change_prerequisite_response',
      'Z03:L': 'supplier_switch',
      'Z03:LK': 'customer_and_supplier_change',
      'Z03:C': 'supplier_switch_cancellation',
      'Z04:L': 'supplier_switch_response',
      'Z04:LK': 'customer_and_supplier_change_response',
      'Z04:C': 'supplier_switch_cancellation_response',
      'Z04:A': 'assigned_supply_notice',
      'Z04:D': 'production_receipt_obligation_notice',
      'Z05:L': 'supply_termination_notice',
      'Z05:LK': 'customer_supply_end_notice',
      'Z05:C': 'supply_continuation_notice',
      'Z06:E': 'customer_masterdata_update',
      'Z06:F': 'metering_point_update_with_reading',
      'Z06:G': 'metering_point_masterdata_update',
      'Z08:H': 'contract_rescission',
      'Z09:B': 'balance_responsible_change',
      'Z09:D': 'production_purchase_agreement_change',
      'Z09:E': 'customer_masterdata_update',
      'Z09:F': 'high_resolution_values_agreement_start',
      'Z09:G': 'high_resolution_values_agreement_end',
      'Z10:M': 'meter_change',
      'Z13:V': 'metering_access_request',
      'Z13:VH': 'historical_metering_access_request',
      'Z14:V': 'metering_access_response',
      'Z14:VH': 'historical_metering_access_response',
      'Z14:N': 'metering_access_rejection',
      'Z15:V': 'metering_access_end_notice',
      'Z15:VH': 'historical_metering_access_end_notice',
      'Z15:C': 'metering_access_continues_notice',
      'Z18:V': 'metering_access_end_request',
    }
    return mapping[key] ?? (entry.operationKind === 'manual_bilateral_process' ? 'manual_bilateral_review' : null)
  }

  const utilts: Record<string, string> = {
    E30: 'collected_metering_values',
    E31: 'aggregated_metering_values',
    E66: 'metering_values',
    E72: 'collected_metering_values_request',
    E73: 'metering_values_request',
    E74: 'aggregated_metering_values_request',
    S01: 'aggregated_settlement_values',
    S02: 'consumption_forecast',
    S03: 'preliminary_aggregate_values',
    S04: 'preliminary_settlement_values',
    S05: 'aggregated_settlement_values',
    S06: 'aggregated_settlement_values_request',
    S07: 'object_time_series',
    ERR: 'utilts_functional_error',
  }
  if (entry.family === 'UTILTS' || entry.family === 'UTILTS_ERR') return utilts[entry.code] ?? null
  if (entry.family === 'CONTRL') return 'technical_ack'
  if (entry.family === 'APERAK') return 'application_ack'
  return null
}

function requiredFieldsFor(entry: CanonicalEdielBusinessSemantics): string[] {
  if (entry.family === 'PRODAT') {
    if (entry.code === 'Z01') return ['customer_id', 'customer_site_id', 'facility_id', 'grid_owner_id']
    if (entry.code === 'Z03') return ['customer_id', 'customer_site_id', 'facility_id', 'metering_point_id', 'grid_owner_id', 'contract_id']
    if (['Z13', 'Z18'].includes(entry.code)) return ['customer_id', 'customer_site_id', 'metering_point_id']
    if (['Z02', 'Z04', 'Z05', 'Z14', 'Z15'].includes(entry.code)) return ['related_message_id']
    return []
  }

  if (entry.family === 'CONTRL' || entry.family === 'APERAK') return ['related_message_id']
  if (entry.family === 'UTILTS_ERR') return ['related_message_id']
  if (entry.dataScope === 'metering_point') return ['metering_point_id', 'period']
  if (entry.dataScope === 'grid_area') return ['grid_area_id', 'period']
  // Alternative identities such as metering point OR regulating object are
  // enforced by the canonical UTILTS field/identity validator, not by a false
  // compatibility requirement for one side of the alternative.
  return []
}

function allowedNextStatusFor(entry: CanonicalEdielBusinessSemantics): string[] {
  const mapping: Partial<Record<CanonicalEdielBusinessSemantics['businessEffect'], string[]>> = {
    request_grid_contract_check: ['waiting_grid_owner_response'],
    record_grid_contract_response: ['grid_contract_check_received'],
    request_supplier_switch: ['switch_requested'],
    request_customer_and_supplier_change: ['switch_requested'],
    cancel_pending_supplier_change: ['cancellation_requested'],
    confirm_supplier_change: ['switch_confirmed'],
    confirm_customer_and_supplier_change: ['switch_confirmed'],
    confirm_change_cancellation: ['cancelled_before_start'],
    start_assigned_supply: ['assigned_supply_confirmed'],
    start_production_receipt_obligation: ['production_receipt_obligation_active'],
    end_existing_supply: ['supply_ended'],
    continue_existing_supply: ['supply_active'],
    request_supply_end: ['termination_submitted'],
    update_customer_masterdata: ['masterdata_reviewed'],
    update_metering_point_with_reading: ['masterdata_reviewed'],
    update_metering_point_masterdata: ['masterdata_reviewed'],
    update_meter_masterdata: ['meter_change_reviewed'],
    request_metering_reporting: ['metering_access_requested'],
    request_historical_metering_data: ['historical_metering_access_requested'],
    approve_metering_reporting: ['metering_access_confirmed'],
    approve_historical_metering_data: ['historical_metering_access_confirmed'],
    reject_metering_reporting: ['metering_access_rejected'],
    stop_metering_reporting: ['metering_access_ended'],
    stop_historical_metering_reporting: ['historical_metering_access_ended'],
    continue_metering_reporting: ['metering_access_active'],
    request_stop_metering_reporting: ['metering_access_end_requested'],
    deliver_values: ['data_received'],
    request_missing_values: ['data_requested'],
    technical_acknowledgement: ['technical_ack_received'],
    application_acknowledgement: ['application_ack_received', 'negative_aperak_received'],
    functional_rejection: ['functional_error_received'],
    manual_review_only: ['manual_review'],
  }
  return mapping[entry.businessEffect] ?? []
}

function ackPolicyFor(entry: CanonicalEdielBusinessSemantics): string {
  const expected = new Set(entry.expectedAcknowledgements)
  if (expected.size === 0) return 'none'
  if (expected.size === 1 && expected.has('CONTRL')) return 'technical_ack_only'
  if (expected.size === 1 && expected.has('APERAK')) return 'application_ack'
  if (expected.has('CONTRL') && expected.has('APERAK')) return 'technical_and_application_ack'
  return 'canonical_ack_policy'
}

function project(entry: CanonicalEdielBusinessSemantics): EdielMessageSemantics {
  return {
    messageFamily: entry.family,
    messageCode: entry.code,
    subtype: entry.subtype,
    direction: entry.direction,
    senderRole: entry.senderRoles[0] ?? null,
    receiverRole: entry.receiverRoles[0] ?? null,
    businessProcess: entry.businessProcess,
    requestType: requestTypeFor(entry),
    expectedResponse: [...entry.expectedAcknowledgements, ...entry.expectedBusinessResponses],
    allowedNextStatus: allowedNextStatusFor(entry),
    requiredFields: requiredFieldsFor(entry),
    forbiddenIfMissing: [],
    ackPolicy: ackPolicyFor(entry),
    supplierUtiltsSupport: entry.supplierUtiltsSupport,
    timeoutPolicy: null,
    ruleVersion: 'canonical.business-semantics.v1',
    environment: 'both',
  }
}

/**
 * Compatibility projection from the source-controlled canonical business
 * semantics. There is deliberately no second hand-maintained fallback table.
 */
export function fallbackMessageSemantics(input: {
  messageFamily: string
  messageCode: string
  subtype?: string | null
}): EdielMessageSemantics | null {
  const entry = canonicalBusinessSemanticsProjection({
    family: input.messageFamily,
    code: input.messageCode,
    subtype: input.subtype,
  })
  return entry ? project(entry) : null
}

/**
 * Canonical runtime semantics are source-controlled. Persisted DB rows are
 * evidence/admin projections and must not override protocol/business meaning.
 */
export async function resolveEdielMessageSemantics(input: {
  messageFamily: string
  messageCode: string
  subtype?: string | null
  environment?: 'test' | 'production'
}): Promise<EdielMessageSemantics | null> {
  return fallbackMessageSemantics(input)
}

export function listFallbackMessageSemantics(): EdielMessageSemantics[] {
  return canonicalBusinessSemanticsCatalog().map(project)
}

export function messageForRequestType(requestType: string): {
  messageFamily: EdielMessageFamily
  messageCode: string
  subtype?: string | null
} | null {
  switch (requestType) {
    // Legacy name retained as a compatibility alias only. Z01 does not discover
    // an unknown facility id; it checks the customer's valid grid agreement.
    case 'facility_lookup':
    case 'switch_prerequisite_check':
      return { messageFamily: 'PRODAT', messageCode: 'Z01', subtype: 'L' }
    case 'customer_supplier_change_prerequisite_check':
      return { messageFamily: 'PRODAT', messageCode: 'Z01', subtype: 'LK' }
    case 'supplier_switch':
      return { messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'L' }
    case 'customer_and_supplier_change':
    case 'move_in':
      return { messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'LK' }
    case 'supplier_switch_cancellation':
      return { messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'C' }
    case 'contract_rescission':
    case 'supply_termination':
      return { messageFamily: 'PRODAT', messageCode: 'Z08', subtype: 'H' }
    case 'metering_access_request':
      return { messageFamily: 'PRODAT', messageCode: 'Z13', subtype: 'V' }
    case 'historical_metering_access_request':
      return { messageFamily: 'PRODAT', messageCode: 'Z13', subtype: 'VH' }
    case 'metering_access_end_request':
      return { messageFamily: 'PRODAT', messageCode: 'Z18', subtype: 'V' }
    case 'metering_values_request':
      // Missing S02/E66 is requested with UTILTS E73. The requested target
      // series must be supplied in the request payload/field rules.
      return { messageFamily: 'UTILTS', messageCode: 'E73' }
    case 'collected_metering_values_request':
      return { messageFamily: 'UTILTS', messageCode: 'E72' }
    case 'aggregated_metering_values_request':
      return { messageFamily: 'UTILTS', messageCode: 'E74' }
    case 'aggregated_settlement_values_request':
      return { messageFamily: 'UTILTS', messageCode: 'S06' }
    default:
      return null
  }
}

/**
 * Compatibility guard retained for callers that validate a business request
 * against an EDIFACT message choice. It now validates against canonical
 * source-controlled semantics rather than mutable DB rows.
 */
export async function assertMessageMatchesRequestType(input: {
  requestType: string
  messageFamily: string
  messageCode: string
  subtype?: string | null
  environment?: 'test' | 'production'
}): Promise<{ ok: boolean; reason?: string; semantics?: EdielMessageSemantics | null }> {
  const expected = messageForRequestType(input.requestType)
  if (!expected) return { ok: false, reason: 'unknown_request_type' }

  const family = input.messageFamily.toUpperCase()
  const code = input.messageCode.toUpperCase()
  const subtype = input.subtype?.toUpperCase() ?? null
  const familyMatches = expected.messageFamily === family
  const codeMatches = expected.messageCode === code
  const subtypeMatches = !expected.subtype || expected.subtype === subtype
  const semantics = await resolveEdielMessageSemantics(input)

  if (!familyMatches || !codeMatches || !subtypeMatches) {
    return { ok: false, reason: 'message_code_request_type_mismatch', semantics }
  }
  if (!semantics) return { ok: false, reason: 'message_semantics_unknown', semantics }
  return { ok: true, semantics }
}
