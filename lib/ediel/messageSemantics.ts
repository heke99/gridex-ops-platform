import { supabaseService } from '@/lib/supabase/service'

export type EdielMessageFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR'

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
  timeoutPolicy: string | null
  ruleVersion: string
  environment: 'test' | 'production' | 'both'
}

function semantics(input: {
  family: EdielMessageFamily
  code: string
  subtype?: string | null
  direction: EdielMessageSemantics['direction']
  senderRole?: string | null
  receiverRole?: string | null
  businessProcess: string
  requestType?: string | null
  expectedResponse?: string[]
  allowedNextStatus?: string[]
  requiredFields?: string[]
  forbiddenIfMissing?: string[]
  ackPolicy?: string
}): EdielMessageSemantics {
  return {
    messageFamily: input.family,
    messageCode: input.code,
    subtype: input.subtype ?? null,
    direction: input.direction,
    senderRole: input.senderRole ?? null,
    receiverRole: input.receiverRole ?? null,
    businessProcess: input.businessProcess,
    requestType: input.requestType ?? null,
    expectedResponse: input.expectedResponse ?? [],
    allowedNextStatus: input.allowedNextStatus ?? [],
    requiredFields: input.requiredFields ?? [],
    forbiddenIfMissing: input.forbiddenIfMissing ?? [],
    ackPolicy: input.ackPolicy ?? 'technical_and_application_ack',
    timeoutPolicy: null,
    ruleVersion: 'fallback.prodat-26a.v2',
    environment: 'both',
  }
}

const FALLBACK_SEMANTICS: EdielMessageSemantics[] = [
  semantics({ family: 'PRODAT', code: 'Z01', subtype: 'L', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'facility_contract_check', requestType: 'facility_lookup', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z02'], allowedNextStatus: ['waiting_grid_owner_response', 'facility_data_received'], requiredFields: ['customer_id', 'customer_site_id', 'facility_id', 'grid_owner_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z01', subtype: 'LK', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'facility_contract_check', requestType: 'facility_lookup', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z02'], allowedNextStatus: ['waiting_grid_owner_response', 'facility_data_received'], requiredFields: ['customer_id', 'customer_site_id', 'facility_id', 'grid_owner_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z02', subtype: 'L', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'facility_contract_response', requestType: 'facility_lookup_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['facility_data_received', 'facility_data_invalid'], requiredFields: ['related_message_id'] }),
  semantics({ family: 'PRODAT', code: 'Z02', subtype: 'LK', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'facility_contract_response', requestType: 'facility_lookup_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['facility_data_received', 'facility_data_invalid'], requiredFields: ['related_message_id'] }),
  semantics({ family: 'PRODAT', code: 'Z03', subtype: 'L', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'supplier_switch', requestType: 'supplier_switch', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z04'], allowedNextStatus: ['switch_requested', 'switch_confirmed'], requiredFields: ['customer_id', 'customer_site_id', 'facility_id', 'metering_point_id', 'grid_owner_id', 'contract_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z03', subtype: 'LK', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'move_in', requestType: 'supplier_switch', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z04'], allowedNextStatus: ['switch_requested', 'switch_confirmed'], requiredFields: ['customer_id', 'customer_site_id', 'facility_id', 'metering_point_id', 'grid_owner_id', 'contract_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z03', subtype: 'C', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'supplier_switch_cancellation', requestType: 'supplier_switch_cancellation', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z04'], allowedNextStatus: ['cancellation_requested', 'cancelled_before_start'] }),
  semantics({ family: 'PRODAT', code: 'Z04', subtype: 'L', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supplier_switch_response', requestType: 'supplier_switch_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['switch_confirmed', 'switch_rejected'], requiredFields: ['related_message_id'] }),
  semantics({ family: 'PRODAT', code: 'Z04', subtype: 'LK', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supplier_switch_response', requestType: 'supplier_switch_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['switch_confirmed', 'switch_rejected'], requiredFields: ['related_message_id'] }),
  semantics({ family: 'PRODAT', code: 'Z04', subtype: 'C', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supplier_switch_cancellation_response', requestType: 'supplier_switch_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['cancelled_before_start'] }),
  semantics({ family: 'PRODAT', code: 'Z04', subtype: 'A', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'assigned_supply', requestType: 'supplier_switch_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['assigned_supply_confirmed'] }),
  semantics({ family: 'PRODAT', code: 'Z04', subtype: 'D', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'mandatory_purchase', requestType: 'supplier_switch_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['mandatory_purchase_confirmed'] }),
  semantics({ family: 'PRODAT', code: 'Z05', subtype: 'L', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supply_termination', requestType: 'supply_termination_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['supply_ending', 'supply_ended'] }),
  semantics({ family: 'PRODAT', code: 'Z05', subtype: 'LK', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supply_termination', requestType: 'supply_termination_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['supply_ending', 'supply_ended'] }),
  semantics({ family: 'PRODAT', code: 'Z05', subtype: 'C', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'supply_termination_reverted', requestType: 'supply_continuation_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['supply_active'] }),
  semantics({ family: 'PRODAT', code: 'Z06', subtype: 'E', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'customer_masterdata_update', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_reviewed'] }),
  semantics({ family: 'PRODAT', code: 'Z06', subtype: 'F', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'masterdata_with_reading', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_reviewed'] }),
  semantics({ family: 'PRODAT', code: 'Z06', subtype: 'G', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'masterdata_without_reading', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_reviewed'] }),
  semantics({ family: 'PRODAT', code: 'Z08', subtype: 'H', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'supplier_termination', requestType: 'supply_termination', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['termination_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z09', subtype: 'B', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'balance_responsible_change', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z09', subtype: 'D', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'producer_agreement', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z09', subtype: 'E', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'customer_masterdata_update', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z09', subtype: 'F', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'quarter_metering_requested', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z09', subtype: 'G', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'quarter_metering_ended', requestType: 'masterdata_update', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['masterdata_submitted'] }),
  semantics({ family: 'PRODAT', code: 'Z10', subtype: 'M', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'meter_change', requestType: 'meter_change', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['meter_change_reviewed'] }),
  semantics({ family: 'PRODAT', code: 'Z13', subtype: 'V', direction: 'outbound', senderRole: 'esco', receiverRole: 'grid_owner', businessProcess: 'metering_permission_current', requestType: 'metering_access_request', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z14'], allowedNextStatus: ['metering_access_requested'], requiredFields: ['customer_id', 'customer_site_id', 'metering_point_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z13', subtype: 'VH', direction: 'outbound', senderRole: 'esco', receiverRole: 'grid_owner', businessProcess: 'metering_permission_historic', requestType: 'metering_access_request', expectedResponse: ['CONTRL', 'APERAK', 'PRODAT:Z14'], allowedNextStatus: ['historical_metering_access_requested'], requiredFields: ['customer_id', 'customer_site_id', 'metering_point_id', 'power_of_attorney'] }),
  semantics({ family: 'PRODAT', code: 'Z14', subtype: 'V', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'metering_permission_current', requestType: 'metering_access_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['metering_access_confirmed'] }),
  semantics({ family: 'PRODAT', code: 'Z14', subtype: 'VH', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'metering_permission_historic', requestType: 'metering_access_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['historical_metering_access_confirmed'] }),
  semantics({ family: 'PRODAT', code: 'Z14', subtype: 'N', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'metering_permission_rejected', requestType: 'metering_access_response', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['metering_access_rejected'] }),
  semantics({ family: 'PRODAT', code: 'Z15', subtype: 'V', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'metering_permission_ended', requestType: 'metering_access_end_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['metering_access_ended'] }),
  semantics({ family: 'PRODAT', code: 'Z15', subtype: 'VH', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'historic_permission_ended', requestType: 'metering_access_end_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['historical_metering_access_ended'] }),
  semantics({ family: 'PRODAT', code: 'Z15', subtype: 'C', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'esco', businessProcess: 'permission_termination_cancelled', requestType: 'metering_access_continues_notice', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['metering_access_active'] }),
  semantics({ family: 'PRODAT', code: 'Z18', subtype: 'V', direction: 'outbound', senderRole: 'esco', receiverRole: 'grid_owner', businessProcess: 'metering_permission_termination', requestType: 'metering_access_end_request', expectedResponse: ['CONTRL', 'APERAK'], allowedNextStatus: ['metering_access_end_requested'] }),
  semantics({ family: 'UTILTS', code: 'E66', direction: 'inbound', senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'metering_values', requestType: 'metering_values', expectedResponse: ['CONTRL', 'APERAK', 'UTILTS_ERR'], allowedNextStatus: ['metering_values_received'], requiredFields: ['metering_point_id', 'period'] }),
  semantics({ family: 'UTILTS', code: 'E73', direction: 'outbound', senderRole: 'supplier', receiverRole: 'grid_owner', businessProcess: 'missing_metering_values', requestType: 'metering_values_request', expectedResponse: ['CONTRL', 'APERAK', 'UTILTS:E66'], allowedNextStatus: ['metering_values_requested'], requiredFields: ['metering_point_id', 'period'] }),
  semantics({ family: 'UTILTS', code: 'E31', direction: 'inbound', businessProcess: 'settlement_shares', requestType: 'settlement_shares', expectedResponse: ['CONTRL', 'APERAK', 'UTILTS_ERR'], allowedNextStatus: ['settlement_shares_received'], requiredFields: ['metering_point_id', 'period'] }),
  semantics({ family: 'CONTRL', code: 'CONTRL', direction: 'both', businessProcess: 'technical_ack', requestType: 'technical_ack', allowedNextStatus: ['technical_ack_received'], requiredFields: ['related_message_id'], ackPolicy: 'technical_ack_only' }),
  semantics({ family: 'APERAK', code: 'APERAK', direction: 'both', businessProcess: 'application_ack', requestType: 'application_ack', allowedNextStatus: ['application_ack_received', 'negative_aperak_received'], requiredFields: ['related_message_id'], ackPolicy: 'application_ack' }),
  semantics({ family: 'UTILTS_ERR', code: 'ERR', direction: 'both', businessProcess: 'utilts_functional_error', requestType: 'utilts_functional_error', expectedResponse: ['APERAK'], allowedNextStatus: ['utilts_functional_error_received'], requiredFields: ['related_message_id', 'reason_code'], ackPolicy: 'functional_error' }),
]

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function mapRow(row: Record<string, unknown>): EdielMessageSemantics {
  return {
    messageFamily: String(row.message_family).toUpperCase() as EdielMessageFamily,
    messageCode: String(row.message_code).toUpperCase(),
    subtype: typeof row.subtype === 'string' ? row.subtype.toUpperCase() : null,
    direction: (row.direction as EdielMessageSemantics['direction']) ?? 'both',
    senderRole: typeof row.sender_role === 'string' ? row.sender_role : null,
    receiverRole: typeof row.receiver_role === 'string' ? row.receiver_role : null,
    businessProcess: String(row.business_process ?? 'unknown'),
    requestType: typeof row.request_type === 'string' ? row.request_type : null,
    expectedResponse: Array.isArray(row.expected_response) ? row.expected_response.map(String) : [],
    allowedNextStatus: Array.isArray(row.allowed_next_status) ? row.allowed_next_status.map(String) : [],
    requiredFields: Array.isArray(row.required_fields) ? row.required_fields.map(String) : [],
    forbiddenIfMissing: Array.isArray(row.forbidden_if_missing) ? row.forbidden_if_missing.map(String) : [],
    ackPolicy: String(row.ack_policy ?? 'technical_and_application_ack'),
    timeoutPolicy: typeof row.timeout_policy === 'string' ? row.timeout_policy : null,
    ruleVersion: String(row.rule_version ?? 'db'),
    environment: (row.environment as EdielMessageSemantics['environment']) ?? 'both',
  }
}

export function fallbackMessageSemantics(input: { messageFamily: string; messageCode: string; subtype?: string | null }): EdielMessageSemantics | null {
  const family = input.messageFamily.toUpperCase()
  const code = input.messageCode.toUpperCase()
  const subtype = input.subtype?.toUpperCase() ?? null
  return FALLBACK_SEMANTICS.find((entry) =>
    entry.messageFamily === family
    && entry.messageCode === code
    && (entry.subtype === subtype || entry.subtype === null)
  ) ?? null
}

export async function resolveEdielMessageSemantics(input: {
  messageFamily: string
  messageCode: string
  subtype?: string | null
  environment?: 'test' | 'production'
}): Promise<EdielMessageSemantics | null> {
  const family = input.messageFamily.toUpperCase()
  const code = input.messageCode.toUpperCase()
  const subtype = input.subtype?.toUpperCase() ?? null
  const environment = input.environment ?? 'production'

  const { data, error } = await supabaseService
    .from('ediel_message_semantics')
    .select('*')
    .eq('message_family', family)
    .eq('message_code', code)
    .in('environment', [environment, 'both'])
    .eq('is_active', true)
    .limit(20)

  if (error) {
    if (missingSchema(error)) return fallbackMessageSemantics({ messageFamily: family, messageCode: code, subtype })
    throw error
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const matchingSubtype = rows.filter((row) => String(row.subtype ?? '').toUpperCase() === (subtype ?? ''))
  const generic = rows.filter((row) => !row.subtype)
  const candidates = matchingSubtype.length > 0 ? matchingSubtype : generic
  const selected = candidates.find((row) => row.environment === environment) ?? candidates.find((row) => row.environment === 'both')
  return selected ? mapRow(selected) : fallbackMessageSemantics({ messageFamily: family, messageCode: code, subtype })
}

export function messageForRequestType(requestType: string): { messageFamily: EdielMessageFamily; messageCode: string; subtype?: string | null } | null {
  switch (requestType) {
    case 'facility_lookup':
    case 'switch_prerequisite_check':
      return { messageFamily: 'PRODAT', messageCode: 'Z01', subtype: 'L' }
    case 'supplier_switch':
      return { messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'L' }
    case 'metering_access_request':
      return { messageFamily: 'PRODAT', messageCode: 'Z13' }
    case 'metering_values_request':
      // Missing validated metering values are requested with UTILTS E73, never
      // by sending E66. E73 still requires the separate bilateral/UTILTS gate.
      return { messageFamily: 'UTILTS', messageCode: 'E73' }
    default:
      return null
  }
}

export async function assertMessageMatchesRequestType(input: {
  requestType: string
  messageFamily: string
  messageCode: string
  subtype?: string | null
  environment?: 'test' | 'production'
}): Promise<{ ok: boolean; reason?: string; semantics?: EdielMessageSemantics | null }> {
  const expected = messageForRequestType(input.requestType)
  if (!expected) return { ok: false, reason: 'unknown_request_type' }
  const familyMatches = expected.messageFamily === input.messageFamily.toUpperCase()
  const codeMatches = expected.messageCode === input.messageCode.toUpperCase()
  const subtypeMatches = !expected.subtype || expected.subtype === input.subtype?.toUpperCase()
  const semantics = await resolveEdielMessageSemantics(input)
  if (!familyMatches || !codeMatches || !subtypeMatches) {
    return { ok: false, reason: 'message_code_request_type_mismatch', semantics }
  }
  if (!semantics) return { ok: false, reason: 'message_semantics_unknown', semantics }
  return { ok: true, semantics }
}
