// lib/ediel/profiles/messageProfileCatalog.ts
//
// Compatibility projection for UI/intents. Normative Ediel rules live in the
// canonical dated rulebooks. Do not add independent message semantics here.

import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'
import { getSupplierUtiltsSupport, getUtiltsMarketProfile } from '@/lib/ediel/rulebook/utiltsMarketEngine'

export type MessageFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS-ERR'
export type MessageDirection = 'outbound' | 'inbound'

export type ActorRole =
  | 'potential_supplier'
  | 'new_supplier'
  | 'old_supplier'
  | 'supplier'
  | 'grid_owner'
  | 'esco'
  | 'balance_responsible'
  | 'imbalance_settlement_responsible'
  | 'metering_collector'
  | 'producer'
  | 'customer'
  | 'system_operator'
  | 'unknown'

export type MessageField =
  | 'facility_id'
  | 'metering_point_id'
  | 'grid_area_code'
  | 'customer_identity'
  | 'customer_name'
  | 'requested_effective_date'
  | 'meter_values'

export type AcknowledgementPolicy = 'contrl_then_aperak' | 'contrl_only' | 'aperak_only' | 'none'
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

function actorRole(value: string | null | undefined): ActorRole {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'energy_service_company') return 'esco'
  const known: ActorRole[] = [
    'potential_supplier', 'new_supplier', 'old_supplier', 'supplier', 'grid_owner', 'esco',
    'balance_responsible', 'imbalance_settlement_responsible', 'metering_collector',
    'producer', 'customer', 'system_operator', 'unknown',
  ]
  return known.includes(normalized as ActorRole) ? normalized as ActorRole : 'unknown'
}

function prodatFields(code: string): Pick<EdielMessageProfile, 'requiredFields' | 'conditionalFields' | 'allowedMissingFields'> {
  switch (code) {
    case 'Z01':
      return { requiredFields: ['facility_id', 'customer_identity'], conditionalFields: ['metering_point_id', 'grid_area_code'], allowedMissingFields: [] }
    case 'Z03':
      return { requiredFields: ['metering_point_id', 'customer_identity', 'requested_effective_date'], conditionalFields: ['facility_id', 'grid_area_code'], allowedMissingFields: [] }
    case 'Z08':
      return { requiredFields: ['metering_point_id', 'requested_effective_date'], conditionalFields: [], allowedMissingFields: [] }
    case 'Z09':
    case 'Z13':
    case 'Z18':
      return { requiredFields: ['metering_point_id'], conditionalFields: [], allowedMissingFields: [] }
    default:
      return { requiredFields: [], conditionalFields: [], allowedMissingFields: [] }
  }
}

const prodatProfiles: EdielMessageProfile[] = PRODAT_CANONICAL_PROFILES.map((canonical) => {
  const direction: MessageDirection = canonical.direction === 'actor_to_portal' ? 'outbound' : 'inbound'
  const fields = prodatFields(canonical.messageCode)
  return {
    messageFamily: 'PRODAT',
    messageCode: canonical.messageCode,
    subtype: canonical.profileKey.replace(/^prodat_[a-z0-9]+_/, ''),
    direction,
    senderRole: actorRole(canonical.senderRole),
    receiverRole: actorRole(canonical.receiverRole),
    businessProcess: canonical.processGroup,
    ...fields,
    applicationReference: canonical.applicationReference,
    acknowledgementPolicy: canonical.z01AperakException ? 'contrl_only' : 'contrl_then_aperak',
    expectedResponse: canonical.z01AperakException ? null : 'APERAK',
    sendWindow: canonical.messageCode === 'Z03' ? 'effective_date_window' : 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: direction === 'outbound' ? 'requires_production_route' : 'inbound_no_route_required',
    supportedStatus: direction === 'outbound' ? 'supported_outbound' : 'supported_inbound',
    notes: `Projection of ${canonical.profileKey}; tenant DDQ/DGI capability and dated rule-pack validation remain mandatory at runtime.`,
  }
})

function utiltsDirection(code: string): MessageDirection {
  const support = getSupplierUtiltsSupport(code)
  return support === 'outbound_only' || (support === 'manual_review' && ['S06', 'S07', 'E74'].includes(code))
    ? 'outbound'
    : 'inbound'
}

function utiltsSupportedStatus(code: string): SupportedStatus {
  const support = getSupplierUtiltsSupport(code)
  if (support === 'inbound_only') return 'supported_inbound'
  if (support === 'outbound_only') return 'supported_outbound'
  if (support === 'ack_only') return 'supported_inbound'
  return 'manual_review'
}

function utiltsFields(code: string): Pick<EdielMessageProfile, 'requiredFields' | 'conditionalFields' | 'allowedMissingFields'> {
  const canonical = UTILTS_CANONICAL_PROFILES.find((entry) => entry.messageCode === code)
  if (!canonical) return { requiredFields: [], conditionalFields: [], allowedMissingFields: [] }

  const requiredFields: MessageField[] = []
  const conditionalFields: MessageField[] = []
  if (canonical.location172Requirement === 'required') requiredFields.push('metering_point_id')
  if (canonical.location172Requirement === 'conditional') conditionalFields.push('metering_point_id')
  if (canonical.requiresGridArea) requiredFields.push('grid_area_code')
  if (canonical.messageCode !== 'ERR' && canonical.scope !== 'request') {
    if (canonical.requiresQuantities) requiredFields.push('meter_values')
    else conditionalFields.push('meter_values')
  }
  return { requiredFields, conditionalFields, allowedMissingFields: [] }
}

const utiltsProfiles: EdielMessageProfile[] = UTILTS_CANONICAL_PROFILES.map((canonical) => {
  const market = getUtiltsMarketProfile(canonical.messageCode)
  const direction = utiltsDirection(canonical.messageCode)
  const fields = utiltsFields(canonical.messageCode)
  return {
    messageFamily: canonical.messageCode === 'ERR' ? 'UTILTS-ERR' : 'UTILTS',
    messageCode: canonical.messageCode === 'ERR' ? 'ERR' : canonical.messageCode,
    subtype: canonical.businessProcess,
    direction,
    senderRole: actorRole(market?.senderRoles[0]),
    receiverRole: direction === 'inbound'
      ? actorRole(market?.receiverRoles.find((role) => role === 'supplier' || role === 'energy_service_company') ?? market?.receiverRoles[0])
      : actorRole(market?.receiverRoles[0]),
    businessProcess: canonical.businessProcess,
    ...fields,
    // UTILTS field 311 has a message/role/product-specific allowlist. A single
    // catalog default would be incorrect, so runtime must resolve it canonically.
    applicationReference: null,
    acknowledgementPolicy: canonical.messageCode === 'ERR' ? 'contrl_only' : 'contrl_then_aperak',
    expectedResponse: canonical.messageCode === 'ERR' ? 'CONTRL' : null,
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: direction === 'outbound' ? 'requires_production_route' : 'inbound_no_route_required',
    supportedStatus: utiltsSupportedStatus(canonical.messageCode),
    notes: `${canonical.officialMeaning} Identity=${canonical.identityRequirement}; LOC+172=${canonical.location172Requirement}. Exact Application Reference is resolved from the dated canonical field-311 registry.`,
  }
})

const ackProfiles: EdielMessageProfile[] = [
  {
    messageFamily: 'CONTRL', messageCode: 'CONTRL', subtype: 'syntax_ack', direction: 'inbound',
    senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'acknowledgement',
    requiredFields: [], conditionalFields: [], allowedMissingFields: [], applicationReference: null,
    acknowledgementPolicy: 'none', expectedResponse: null, sendWindow: 'immediate',
    encryption: 'route_profile_controlled', routeReadiness: 'inbound_no_route_required', supportedStatus: 'supported_inbound',
    notes: 'Outcome is determined only from canonical CONTRL UCI action semantics.',
  },
  {
    messageFamily: 'APERAK', messageCode: 'APERAK', subtype: 'application_ack', direction: 'inbound',
    senderRole: 'grid_owner', receiverRole: 'supplier', businessProcess: 'acknowledgement',
    requiredFields: [], conditionalFields: [], allowedMissingFields: [], applicationReference: null,
    acknowledgementPolicy: 'none', expectedResponse: null, sendWindow: 'immediate',
    encryption: 'route_profile_controlled', routeReadiness: 'inbound_no_route_required', supportedStatus: 'supported_inbound',
    notes: 'BGM 312 is positive and BGM 313 negative; ERC presence must not determine outcome.',
  },
]

export const EDIEL_MESSAGE_PROFILE_CATALOG: EdielMessageProfile[] = [
  ...prodatProfiles,
  ...utiltsProfiles,
  ...ackProfiles,
]

export function getMessageProfile(
  messageFamily: string | null | undefined,
  messageCode: string | null | undefined,
  direction?: MessageDirection,
): EdielMessageProfile | null {
  const rawFamily = String(messageFamily ?? '').toUpperCase()
  const family = rawFamily === 'UTILTS_ERR' ? 'UTILTS-ERR' : rawFamily
  const rawCode = String(messageCode ?? '').toUpperCase()
  const code = family === 'APERAK' && (rawCode === '312' || rawCode === '313') ? 'APERAK' : rawCode
  return EDIEL_MESSAGE_PROFILE_CATALOG.find(
    (profile) => profile.messageFamily === family && profile.messageCode === code && (!direction || profile.direction === direction),
  ) ?? null
}

export function isOutboundSendableProfile(profile: EdielMessageProfile | null): boolean {
  return Boolean(profile && profile.direction === 'outbound' && profile.supportedStatus === 'supported_outbound')
}

export function requiresFieldForRender(profile: EdielMessageProfile | null, field: MessageField): boolean {
  if (!profile || profile.allowedMissingFields.includes(field)) return false
  return profile.requiredFields.includes(field)
}
