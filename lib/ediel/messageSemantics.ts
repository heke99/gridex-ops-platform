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
  environment: 'test' | 'production'
}

const FALLBACK_SEMANTICS: EdielMessageSemantics[] = [
  semantics('PRODAT', 'Z01', 'L', 'outbound', 'facility_contract_check', 'facility_lookup', ['CONTRL', 'APERAK', 'PRODAT:Z02'], ['waiting_grid_owner_response', 'facility_data_received'], ['customer_id', 'customer_site_id', 'grid_owner_id', 'power_of_attorney'], ['facility_id'], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z02', 'L', 'inbound', 'facility_contract_response', 'facility_lookup_response', ['CONTRL', 'APERAK'], ['facility_data_received', 'facility_data_invalid'], ['related_message_id'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z03', 'L', 'outbound', 'supplier_switch', 'supplier_switch', ['CONTRL', 'APERAK', 'PRODAT:Z04'], ['switch_requested', 'switch_confirmed'], ['customer_id', 'customer_site_id', 'facility_id', 'metering_point_id', 'grid_owner_id', 'contract_id', 'power_of_attorney'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z04', 'L', 'inbound', 'supplier_switch_response', 'supplier_switch_response', ['CONTRL', 'APERAK'], ['switch_confirmed', 'switch_rejected'], ['related_message_id'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z13', null, 'outbound', 'metering_access', 'metering_access_request', ['CONTRL', 'APERAK', 'PRODAT:Z14'], ['metering_access_requested'], ['customer_id', 'customer_site_id', 'metering_point_id', 'power_of_attorney'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z14', null, 'inbound', 'metering_access_response', 'metering_access_response', ['CONTRL', 'APERAK'], ['metering_access_confirmed', 'metering_access_rejected'], ['related_message_id'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z15', null, 'outbound', 'metering_access_end', 'metering_access_end', ['CONTRL', 'APERAK'], ['metering_access_end_requested'], ['customer_id', 'metering_point_id'], [], 'technical_and_application_ack'),
  semantics('PRODAT', 'Z18', null, 'both', 'permission_lifecycle', 'permission_lifecycle', ['CONTRL', 'APERAK'], ['permission_updated'], ['metering_point_id'], [], 'technical_and_application_ack'),
  semantics('UTILTS', 'E66', null, 'inbound', 'metering_values', 'metering_values', ['CONTRL', 'APERAK', 'UTILTS_ERR'], ['metering_values_received'], ['metering_point_id', 'period'], [], 'technical_and_application_ack'),
  semantics('UTILTS', 'E31', null, 'inbound', 'settlement_shares', 'settlement_shares', ['CONTRL', 'APERAK', 'UTILTS_ERR'], ['settlement_shares_received'], ['metering_point_id', 'period'], [], 'technical_and_application_ack'),
  semantics('CONTRL', 'CONTRL', null, 'both', 'technical_ack', 'technical_ack', [], ['technical_ack_received'], ['related_message_id'], [], 'technical_ack_only'),
  semantics('APERAK', 'APERAK', null, 'both', 'application_ack', 'application_ack', [], ['application_ack_received', 'negative_aperak_received'], ['related_message_id'], [], 'application_ack'),
  semantics('UTILTS_ERR', 'ERR', null, 'both', 'utilts_functional_error', 'utilts_functional_error', ['APERAK'], ['utilts_functional_error_received'], ['related_message_id', 'reason_code'], [], 'functional_error'),
]

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function semantics(
  family: EdielMessageFamily,
  code: string,
  subtype: string | null,
  direction: EdielMessageSemantics['direction'],
  businessProcess: string,
  requestType: string | null,
  expectedResponse: string[],
  allowedNextStatus: string[],
  requiredFields: string[],
  forbiddenIfMissing: string[],
  ackPolicy: string,
): EdielMessageSemantics {
  return {
    messageFamily: family,
    messageCode: code,
    subtype,
    direction,
    senderRole: null,
    receiverRole: null,
    businessProcess,
    requestType,
    expectedResponse,
    allowedNextStatus,
    requiredFields,
    forbiddenIfMissing,
    ackPolicy,
    timeoutPolicy: null,
    ruleVersion: 'fallback.production.v1',
    environment: 'production',
  }
}

function mapRow(row: Record<string, unknown>): EdielMessageSemantics {
  return {
    messageFamily: String(row.message_family).toUpperCase() as EdielMessageFamily,
    messageCode: String(row.message_code).toUpperCase(),
    subtype: typeof row.subtype === 'string' ? row.subtype : null,
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
    environment: (row.environment as 'test' | 'production') ?? 'production',
  }
}

export function fallbackMessageSemantics(input: { messageFamily: string; messageCode: string; subtype?: string | null }): EdielMessageSemantics | null {
  const family = input.messageFamily.toUpperCase()
  const code = input.messageCode.toUpperCase()
  const subtype = input.subtype?.toUpperCase() ?? null
  return FALLBACK_SEMANTICS.find((entry) => entry.messageFamily === family && entry.messageCode === code && (entry.subtype === subtype || entry.subtype === null)) ?? null
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

  const query = supabaseService
    .from('ediel_message_semantics')
    .select('*')
    .eq('message_family', family)
    .eq('message_code', code)
    .eq('environment', environment)
    .eq('is_active', true)
    .limit(10)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return fallbackMessageSemantics({ messageFamily: family, messageCode: code, subtype })
    throw error
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const exact = rows.find((row) => String(row.subtype ?? '').toUpperCase() === (subtype ?? ''))
  const generic = rows.find((row) => !row.subtype)
  const selected = exact ?? generic
  return selected ? mapRow(selected) : fallbackMessageSemantics({ messageFamily: family, messageCode: code, subtype })
}

export function messageForRequestType(requestType: string): { messageFamily: EdielMessageFamily; messageCode: string; subtype?: string | null } | null {
  switch (requestType) {
    case 'facility_lookup':
    case 'metering_point_lookup':
    case 'switch_prerequisite_check':
      return { messageFamily: 'PRODAT', messageCode: 'Z01', subtype: 'L' }
    case 'supplier_switch':
      return { messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'L' }
    case 'metering_access_request':
      return { messageFamily: 'PRODAT', messageCode: 'Z13' }
    case 'metering_values_request':
      return { messageFamily: 'UTILTS', messageCode: 'E66' }
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
