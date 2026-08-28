// lib/ediel/profiles/messageProfileCatalog.ts
//
// Compatibility projection for UI/intents. Normative Ediel rules live in the
// canonical dated rulebooks. Do not add independent message semantics here.

import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
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

type FieldProjection = {
  field: MessageField
  canonicalFieldKeys: readonly string[]
}

const PRODAT_FIELD_PROJECTIONS: readonly FieldProjection[] = [
  { field: 'facility_id', canonicalFieldKeys: ['installation_id'] },
  { field: 'metering_point_id', canonicalFieldKeys: ['line_item', 'installation_id'] },
  { field: 'grid_area_code', canonicalFieldKeys: ['net_area'] },
  { field: 'customer_identity', canonicalFieldKeys: ['end_user_id'] },
  { field: 'customer_name', canonicalFieldKeys: ['end_user_name'] },
  { field: 'requested_effective_date', canonicalFieldKeys: ['contract_start_date', 'contract_stop_date', 'report_start_date', 'report_end_date', 'validity_start_date'] },
]

function prodatFields(code: string): Pick<EdielMessageProfile, 'requiredFields' | 'conditionalFields' | 'allowedMissingFields'> {
  const rules = canonicalProdat26AFieldRules(code)
  const requiredFields: MessageField[] = []
  const conditionalFields: MessageField[] = []

  for (const projection of PRODAT_FIELD_PROJECTIONS) {
    const matching = rules.filter((rule) => projection.canonicalFieldKeys.includes(rule.fieldKey))
    if (matching.some((rule) => rule.requirement === 'required')) {
      requiredFields.push(projection.field)
    } else if (matching.some((rule) => rule.requirement === 'dependent')) {
      conditionalFields.push(projection.field)
    }
  }
  return { requiredFields, conditionalFields, allowedMissingFields: [] }
}

function ackPolicy(family: string, code: string): { policy: AcknowledgementPolicy; response: string | null } {
  const ack = canonicalAckRequirements({ family, code })
  const policy: AcknowledgementPolicy = ack.requiresContrl && ack.requiresAperak
    ? 'contrl_then_aperak'
    : ack.requiresContrl
      ? 'contrl_only'
      : ack.requiresAperak
        ? 'aperak_only'
        : 'none'
  return { policy, response: ack.businessResponses[0] ?? null }
}

const prodatProfiles: EdielMessageProfile[] = PRODAT_CANONICAL_PROFILES.map((canonical) => {
  const direction: MessageDirection = canonical.direction === 'actor_to_portal' ? 'outbound' : 'inbound'
  const fields = prodatFields(canonical.messageCode)
  const ack = ackPolicy('PRODAT', canonical.messageCode)
  return {
    messageFamily: 'PRODAT',
    messageCode: canonical.messageCode,
    subtype: null,
    direction,
    senderRole: actorRole(canonical.senderRole),
    receiverRole: actorRole(canonical.receiverRole),
    businessProcess: canonical.processGroup,
    ...fields,
    applicationReference: canonical.applicationReference,
    acknowledgementPolicy: ack.policy,
    expectedResponse: ack.response,
    sendWindow: canonical.processGroup === 'supplier_switch' ? 'effective_date_window' : 'immediate',
    encryption: 'route_profile_controlled',
    routeReadiness: direction === 'outbound' ? 'requires_production_route' : 'inbound_no_route_required',
    supportedStatus: direction === 'outbound' ? 'supported_outbound' : 'supported_inbound',
    notes: `Projection of ${canonical.profileKey}; exact subtype, field R/D/O/X rules and tenant capability are resolved canonically at runtime.`,
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
  const family = canonical.messageCode === 'ERR' ? 'UTILTS_ERR' : 'UTILTS'
  const ack = ackPolicy(family, canonical.messageCode)
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
    applicationReference: null,
    acknowledgementPolicy: ack.policy,
    expectedResponse: ack.response,
    sendWindow: 'reporting_window',
    encryption: 'route_profile_controlled',
    routeReadiness: direction === 'outbound' ? 'requires_production_route' : 'inbound_no_route_required',
    supportedStatus: utiltsSupportedStatus(canonical.messageCode),
    notes: `${canonical.officialMeaning} Exact Application Reference and R/D/O/X are resolved from the dated canonical UTILTS registries.`,
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
    notes: 'Outcome is classified by the family-specific canonical APERAK semantics; this catalog does not define a global 312/313 rule.',
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
