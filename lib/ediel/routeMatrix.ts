/**
 * EDIEL route projection.
 *
 * This module maps an already-known canonical business message to DB transport
 * scopes. It does not own message-code, Application Reference, version or ACK
 * semantics. Those are resolved from the canonical rulebooks.
 */

import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'

/** DB-valid values for communication_routes.route_scope */
export type CommunicationRouteScope =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'metering_access'
  | 'meter_values'
  | 'metering_values'
  | 'billing_underlay'

/** DB-valid values for communication_routes.route_type (EDIEL operational routes) */
export const EDIEL_PARTNER_ROUTE_TYPE = 'ediel_partner' as const

/** DB-valid target_system values for production vs test EDIEL routes */
export function targetSystemForEnvironment(environment: string): string {
  return environment === 'production' ? 'production_ediel' : 'ediel'
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function prodatRouteScope(messageCode: string): CommunicationRouteScope {
  const profile = getCanonicalProdatProfile(messageCode)
  if (!profile) throw new Error(`ediel_route_scope_prodat_profile_missing:${messageCode || 'missing'}`)

  if (profile.processGroup === 'customer_masterdata' || profile.processGroup === 'delivery_contract') {
    return 'customer_masterdata'
  }
  if (profile.processGroup === 'metering_access') return 'metering_access'
  if (profile.processGroup === 'supplier_switch' || profile.processGroup === 'masterdata' || profile.processGroup === 'metering') {
    return 'supplier_switch'
  }
  throw new Error(`ediel_route_scope_prodat_process_unsupported:${profile.processGroup}`)
}

/**
 * Project a canonical message to a transport route scope.
 * Unknown PRODAT codes/families fail closed instead of choosing a safe default.
 */
export function routeScopeForProcess(params: {
  messageFamily: string
  messageCode?: string | null
  applicationReference?: string | null
}): CommunicationRouteScope | null {
  const family = normalize(params.messageFamily)
  const code = normalize(params.messageCode)

  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') return null
  if (family === 'PRODAT') {
    if (!code) throw new Error('ediel_route_scope_prodat_code_required')
    return prodatRouteScope(code)
  }
  if (family === 'UTILTS') {
    // billing_underlay is a Gridex transport/business lane marker, not an
    // Ediel Application Reference. Exact field-311 values are resolved elsewhere.
    if (String(params.applicationReference ?? '').trim().toLowerCase() === 'billing_underlay') return 'billing_underlay'
    return 'meter_values'
  }
  if (family === 'AI_LIST' || family === 'OTHER') return 'customer_masterdata'

  throw new Error(`ediel_route_scope_family_unsupported:${family || 'missing'}`)
}

export function shouldMaterializePerGridOwner(params: {
  messageFamily: string
  messageCode?: string | null
}): boolean {
  const family = normalize(params.messageFamily)
  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') return false
  if (family === 'PRODAT' && params.messageCode) getCanonicalProdatProfile(params.messageCode)
  return true
}

export function isSupplierSwitchCode(messageCode: string | null | undefined): boolean {
  const profile = getCanonicalProdatProfile(messageCode)
  return Boolean(profile && ['supplier_switch', 'masterdata', 'metering'].includes(profile.processGroup))
}

export function isMeteringAccessCode(messageCode: string | null | undefined): boolean {
  return getCanonicalProdatProfile(messageCode)?.processGroup === 'metering_access'
}

export function isCustomerMasterdataCode(messageCode: string | null | undefined): boolean {
  const profile = getCanonicalProdatProfile(messageCode)
  return Boolean(profile && ['customer_masterdata', 'delivery_contract'].includes(profile.processGroup))
}

const VALID_ROUTE_SCOPES = new Set<string>([
  'customer_masterdata',
  'supplier_switch',
  'metering_access',
  'meter_values',
  'metering_values',
  'billing_underlay',
])
export function isValidCommunicationRouteScope(value: unknown): value is CommunicationRouteScope {
  return typeof value === 'string' && VALID_ROUTE_SCOPES.has(value)
}
