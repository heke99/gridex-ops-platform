// lib/ediel/profiles/messageProfileCatalog.ts
//
// Central Ediel message profile catalog.
//
// One declarative source of truth describing WHICH messages Gridex may send or
// receive, for WHICH actor role, in WHICH business process, with WHICH field
// requirements and acknowledgement/route rules. The customer-operations and
// intent layers consult this catalog instead of hardcoding rules per button.
//
// A message_code existing here does NOT make it sendable on its own. Sending
// additionally requires: subtype, business process, actor role, route/profile/
// certificate readiness and the field requirements declared below.
//
// This catalog reconciles with (and never contradicts) the canonical PRODAT
// rulebook (`PRODAT_CANONICAL_PROFILES`) and the UTILTS/PRODAT support
// registries. It is intentionally self-contained and side-effect free so it can
// be asserted in regression without a database.

export type MessageFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS-ERR'

export type MessageDirection = 'outbound' | 'inbound'

export type ActorRole =
  | 'potential_supplier'
  | 'new_supplier'
  | 'old_supplier'
  | 'supplier'
  | 'grid_owner'
  | 'esco'

export type MessageField =
  | 'facility_id'
  | 'metering_point_id'
  | 'grid_area_code'
  | 'customer_identity'
  | 'customer_name'
  | 'requested_effective_date'
  | 'meter_values'

export type AcknowledgementPolicy =
  | 'contrl_then_aperak'
  | 'contrl_only'
  | 'aperak_only'
  | 'none'

// The supported_status vocabulary mandated by the product spec.
export type SupportedStatus =
  | 'supported_outbound'
  | 'supported_inbound'
  | 'receive_only'
  | 'manual_review'
  | 'unsupported_for_actor_role'
  | 'unsupported_until_certified'

export type SendWindowRule = 'immediate' | 'effective_date_window' | 'reporting_window'

export type EncryptionRule = 'route_profile_controlled' | 'not_required'

export type RouteReadinessRule = 'requires_production_route' | 'inbound_no_route_required'

export type EdielMessageProfile = {
  messageFamily: MessageFamily
  messageCode: string
  subtype: string | null
  direction: MessageDirection
  senderRole: ActorRole
  receiverRole: ActorRole
  businessProcess: string
  requiredFields: MessageField[]
  conditionalFields: MessageField[]
  allowedMissingFields: MessageField[]
  applicationReference: string | null
  acknowledgementPolicy: AcknowledgementPolicy
  expectedResponse: string | null
  sendWindow: SendWindowRule
  encryption: EncryptionRule
  routeReadiness: RouteReadinessRule
  supportedStatus: SupportedStatus
  notes?: string
}

// Helper builders keep the table readable and consistent.
function outboundProdat(
  code: string,
  partial: Partial<EdielMessageProfile> & {
    senderRole: ActorRole
    receiverRole: ActorRole
    businessProcess: string
  },
): EdielMessageProfile {
  return {
    messageFamily: 'PRODAT',
    messageCode: code,
    subtype: null,
    direction: 'outbound',
    requiredFields: [],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: '23-DDQ-PRODAT',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: null,
    sendWindow: 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: 'requires_production_route',
    supportedStatus: 'supported_outbound',
    ...partial,
  }
}

function inboundProdat(
  code: string,
  partial: Partial<EdielMessageProfile> & {
    senderRole: ActorRole
    receiverRole: ActorRole
    businessProcess: string
  },
): EdielMessageProfile {
  return {
    messageFamily: 'PRODAT',
    messageCode: code,
    subtype: null,
    direction: 'inbound',
    requiredFields: [],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: '23-DDQ-PRODAT',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: null,
    sendWindow: 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
    ...partial,
  }
}

export const EDIEL_MESSAGE_PROFILE_CATALOG: EdielMessageProfile[] = [
  // --- PRODAT customer masterdata / facility request ---
  outboundProdat('Z01', {
    subtype: 'customer_identity_request',
    senderRole: 'potential_supplier',
    receiverRole: 'grid_owner',
    businessProcess: 'customer_masterdata',
    // Swedish PRODAT requirements: anläggnings-id/facility_id is mandatory for a
    // renderable Z01. It is NOT an allowed-missing field. When it is missing the
    // manual e-mail pipeline must be used instead (see prodatZ01Guard).
    requiredFields: ['facility_id', 'customer_identity'],
    conditionalFields: ['metering_point_id', 'grid_area_code'],
    allowedMissingFields: [],
    expectedResponse: 'Z02',
    supportedStatus: 'supported_outbound',
    notes:
      'Potential Supplier -> Netowner. Outbound only when required identifiers and legal/fullmakt readiness exist.',
  }),
  inboundProdat('Z02', {
    subtype: 'customer_identity_response',
    senderRole: 'grid_owner',
    receiverRole: 'potential_supplier',
    businessProcess: 'customer_masterdata',
    expectedResponse: null,
    notes: 'Netowner -> Potential Supplier. Inbound response to Z01.',
  }),
  outboundProdat('Z03', {
    subtype: 'supplier_switch',
    senderRole: 'new_supplier',
    receiverRole: 'grid_owner',
    businessProcess: 'supplier_switch',
    requiredFields: ['metering_point_id', 'customer_identity', 'requested_effective_date'],
    conditionalFields: ['facility_id', 'grid_area_code'],
    expectedResponse: 'Z04',
    sendWindow: 'effective_date_window',
    notes: 'New Supplier -> Netowner. Supplier switch / move-in / cancellation depending on subtype.',
  }),
  inboundProdat('Z04', {
    subtype: 'change_of_supplier_ack',
    senderRole: 'grid_owner',
    receiverRole: 'new_supplier',
    businessProcess: 'supplier_switch',
    notes: 'Netowner -> New Supplier. Inbound acknowledgement / change of supplier / masterdata.',
  }),
  inboundProdat('Z05', {
    subtype: 'loss_of_supplier',
    senderRole: 'grid_owner',
    receiverRole: 'old_supplier',
    businessProcess: 'supplier_switch',
    notes: 'Netowner -> Old Supplier. Inbound when Gridex is losing supplier.',
  }),
  inboundProdat('Z06', {
    subtype: 'portfolio_masterdata',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'masterdata',
    notes: 'Netowner -> Supplier. Inbound portfolio / masterdata.',
  }),
  outboundProdat('Z08', {
    subtype: 'delivery_contract_closure',
    senderRole: 'supplier',
    receiverRole: 'grid_owner',
    businessProcess: 'delivery_contract',
    requiredFields: ['metering_point_id', 'requested_effective_date'],
    expectedResponse: 'APERAK',
    notes: 'Supplier -> Netowner. Outbound delivery contract closure.',
  }),
  outboundProdat('Z09', {
    subtype: 'masterdata_update',
    senderRole: 'supplier',
    receiverRole: 'grid_owner',
    businessProcess: 'masterdata',
    requiredFields: ['metering_point_id'],
    expectedResponse: 'APERAK',
    notes: 'Supplier -> Netowner. Outbound masterdata update.',
  }),
  inboundProdat('Z10', {
    subtype: 'meter_change',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'metering',
    notes: 'Netowner -> Supplier. Inbound meter change.',
  }),
  inboundProdat('Z11', {
    subtype: 'meter_information',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'metering',
    notes: 'Netowner -> Supplier. Inbound meter information.',
  }),
  inboundProdat('Z12', {
    subtype: 'move_information',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'move',
    notes: 'Netowner -> Supplier. Inbound move information.',
  }),
  outboundProdat('Z13', {
    subtype: 'esco_metering_access_request',
    senderRole: 'esco',
    receiverRole: 'grid_owner',
    businessProcess: 'metering_access',
    applicationReference: '23-DGI-PRODAT',
    requiredFields: ['metering_point_id'],
    // ESCO/entitled-party role required; otherwise unsupported for actor role.
    supportedStatus: 'unsupported_for_actor_role',
    notes: 'ESCO -> Netowner. Only if Gridex has ESCO/entitled-party role.',
  }),
  inboundProdat('Z14', {
    subtype: 'esco_metering_access_response',
    senderRole: 'grid_owner',
    receiverRole: 'esco',
    businessProcess: 'metering_access',
    applicationReference: '23-DGI-PRODAT',
    supportedStatus: 'receive_only',
    notes: 'Netowner -> ESCO. Receive/manual review unless ESCO role enabled.',
  }),
  inboundProdat('Z15', {
    subtype: 'esco_metering_access_revocation',
    senderRole: 'grid_owner',
    receiverRole: 'esco',
    businessProcess: 'metering_access',
    applicationReference: '23-DGI-PRODAT',
    supportedStatus: 'receive_only',
    notes: 'Netowner -> ESCO. Receive/manual review unless ESCO role enabled.',
  }),
  outboundProdat('Z18', {
    subtype: 'esco_metering_access_request',
    senderRole: 'esco',
    receiverRole: 'grid_owner',
    businessProcess: 'metering_access',
    applicationReference: '23-DGI-PRODAT',
    requiredFields: ['metering_point_id'],
    supportedStatus: 'unsupported_for_actor_role',
    notes: 'ESCO -> Netowner. Only if Gridex has ESCO/entitled-party role.',
  }),

  // --- UTILTS metering value flows ---
  {
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    subtype: 'metered_data',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'metering_values',
    requiredFields: ['metering_point_id', 'meter_values'],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: '23-DGM-UTILTS',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: null,
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },
  {
    messageFamily: 'UTILTS',
    messageCode: 'S02',
    subtype: 'metered_data_request',
    direction: 'outbound',
    senderRole: 'supplier',
    receiverRole: 'grid_owner',
    businessProcess: 'metering_values',
    requiredFields: ['metering_point_id'],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: '23-DGM-UTILTS',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: 'E66',
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: 'requires_production_route',
    supportedStatus: 'supported_outbound',
  },
  {
    messageFamily: 'UTILTS',
    messageCode: 'E30',
    subtype: 'aggregated_data',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'metering_values',
    requiredFields: ['metering_point_id', 'meter_values'],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: '23-DGM-UTILTS',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: null,
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },
  {
    messageFamily: 'UTILTS',
    messageCode: 'E73',
    subtype: 'metering_status',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'metering_values',
    requiredFields: ['metering_point_id'],
    conditionalFields: ['meter_values'],
    allowedMissingFields: [],
    applicationReference: '23-DGM-UTILTS',
    acknowledgementPolicy: 'contrl_then_aperak',
    expectedResponse: null,
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },

  // --- Acknowledgement families ---
  {
    messageFamily: 'CONTRL',
    messageCode: 'CONTRL',
    subtype: 'syntax_ack',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'acknowledgement',
    requiredFields: [],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: null,
    acknowledgementPolicy: 'none',
    expectedResponse: null,
    sendWindow: 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },
  {
    messageFamily: 'APERAK',
    messageCode: 'APERAK',
    subtype: 'application_ack',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'acknowledgement',
    requiredFields: [],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: null,
    acknowledgementPolicy: 'none',
    expectedResponse: null,
    sendWindow: 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },
  {
    messageFamily: 'UTILTS-ERR',
    messageCode: 'UTILTS-ERR',
    subtype: 'application_error',
    direction: 'inbound',
    senderRole: 'grid_owner',
    receiverRole: 'supplier',
    businessProcess: 'acknowledgement',
    requiredFields: [],
    conditionalFields: [],
    allowedMissingFields: [],
    applicationReference: null,
    acknowledgementPolicy: 'none',
    expectedResponse: null,
    sendWindow: 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: 'inbound_no_route_required',
    supportedStatus: 'supported_inbound',
  },
]

export function getMessageProfile(
  messageFamily: string | null | undefined,
  messageCode: string | null | undefined,
  direction?: MessageDirection,
): EdielMessageProfile | null {
  const family = String(messageFamily ?? '').toUpperCase()
  const code = String(messageCode ?? '').toUpperCase()
  return (
    EDIEL_MESSAGE_PROFILE_CATALOG.find(
      (profile) =>
        profile.messageFamily === family &&
        profile.messageCode === code &&
        (direction ? profile.direction === direction : true),
    ) ?? null
  )
}

// A message is only outbound-sendable when its profile explicitly allows it.
// Existence of a message_code is never sufficient on its own.
export function isOutboundSendableProfile(profile: EdielMessageProfile | null): boolean {
  return Boolean(profile && profile.direction === 'outbound' && profile.supportedStatus === 'supported_outbound')
}

export function requiresFieldForRender(
  profile: EdielMessageProfile | null,
  field: MessageField,
): boolean {
  if (!profile) return false
  if (profile.allowedMissingFields.includes(field)) return false
  return profile.requiredFields.includes(field)
}
