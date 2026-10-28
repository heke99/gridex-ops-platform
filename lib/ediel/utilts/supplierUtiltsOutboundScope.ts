// FINDINGS F48 / F35 (reality J2-13), owner decision 43: the first production scope
// of outbound UTILTS for an electricity supplier is E73 plus the prescribed UTILTS-ERR.
//
// - The only UTILTS message the supplier originates to a grid owner on a business
//   route is the one the canonical market matrix marks `outbound_only` (E73). E74 and
//   S07 stay `manual_review` and E66 stays grid-owner-originated (`inbound_only`), so
//   none of them is materialized as a supplier route or sent.
// - UTILTS-ERR is not a business route of its own: it answers a received UTILTS
//   transaction in the original's context (routeMatrix gives it no route scope;
//   lib/ediel/ack.ts builds it on the source message's route and Application
//   Reference) and is created only when the prescribed function check rejects it.
// - E73's field 311 is the reference of the REQUESTED type (E66 or S02), never a
//   generic E73 value (U-06, MASTERMASTERPLAN_v2 §9). Its S/T variant is taken from
//   the verified route profile and never inferred from a local reading frequency.
// - An S02 forecast request needs the supplier role (DDQ), an explicit agreement
//   for S02 on the bilateral E73 capability and a verified data right (the qualified
//   own dated structure for exactly the requested period).
import {
  UTILTS_25_A_3_REQUEST_TARGETS,
  getUtiltsApplicationReferenceTarget,
  isUtiltsRequestMessageCode,
  resolveVerifiedUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsApplicationReference'
import { UTILTS_CANONICAL_MARKET_PROFILES } from '@/lib/ediel/rulebook/utiltsMarketSemantics'

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/** UTILTS codes a supplier sends to a grid owner on a business route (derived, never typed in). */
export function supplierUtiltsRouteMessageCodes(): string[] {
  return UTILTS_CANONICAL_MARKET_PROFILES
    .filter((profile) => profile.supplierSupport === 'outbound_only')
    .map((profile) => profile.code)
}

export function isSupplierUtiltsRouteMessageCode(code: string | null | undefined): boolean {
  return supplierUtiltsRouteMessageCodes().includes(upper(code))
}

/** A UTILTS field-311 value has the shape 23-<role>-<E/S code>-<variant>; a PRODAT label (23-DDQ-PRODAT) does not. */
export function isUtiltsShapedApplicationReference(value: string | null | undefined): boolean {
  const candidate = upper(value)
  return /^23-[A-Z0-9]+-(?:E|S)\d\d-[A-Z0-9]+$/.test(candidate) && !candidate.endsWith('-PRODAT')
}

/**
 * The Application Reference a supplier's UTILTS route profile declares for `messageCode`.
 * The registry route's own value always applies. A sender-level value is a tenant-wide label:
 * it applies to UTILTS only when it is a UTILTS field-311 value (a PRODAT label such as
 * 23-DDQ-PRODAT is not one and is ignored, as F41 does for PRODAT). For a request code
 * (E73) no declared value is not an error: the reference follows the requested type and is
 * resolved per request. Any declared value is validated against the 25-A-3 registry and an
 * invalid one fails closed.
 */
export function supplierUtiltsRouteApplicationReference(input: {
  messageCode: string
  registryApplicationReference?: string | null
  senderApplicationReferences?: ReadonlyArray<string | null | undefined>
}): string | null {
  const registry = upper(input.registryApplicationReference) || null
  const sender = (input.senderApplicationReferences ?? []).map(upper).find((value) => isUtiltsShapedApplicationReference(value)) ?? null
  const declared = registry ?? sender
  if (!declared) {
    if (isUtiltsRequestMessageCode(input.messageCode)) return null
    return resolveVerifiedUtiltsApplicationReference({ messageCode: input.messageCode })
  }
  return resolveVerifiedUtiltsApplicationReference({ messageCode: input.messageCode, applicationReference: declared })
}

function roleCode(reference: string): string {
  return upper(reference).split('-')[1] ?? ''
}

/**
 * Field 311 of one E73: the reference of the requested type, from the verified route profile.
 * A profile verified for the other E73 target is refused (an E66 profile never becomes an S02
 * request); a profile without a declared value serves only a single-valued target (S02), so the
 * multi-valued E66 needs its exact verified S/T value and is never defaulted.
 */
export function resolveE73RequestApplicationReference(input: {
  requestedMessageCode: string
  routeApplicationReference?: string | null
}): string {
  const requested = upper(input.requestedMessageCode)
  if (!(UTILTS_25_A_3_REQUEST_TARGETS.E73 as readonly string[]).includes(requested)) {
    throw new Error(`utilts_e73_requested_message_unsupported:${requested || 'missing'}`)
  }
  const routeReference = upper(input.routeApplicationReference) || null
  if (routeReference) {
    const routeTarget = getUtiltsApplicationReferenceTarget({ messageCode: 'E73', applicationReference: routeReference })
    if (routeTarget !== requested) throw new Error(`utilts_e73_route_profile_requested_type_mismatch:${routeTarget}:${requested}`)
  }
  return resolveVerifiedUtiltsApplicationReference({ messageCode: 'E73', requestedMessageCode: requested, applicationReference: routeReference })
}

/** Requested types the bilateral E73 agreement covers; absent means the historical E66-only scope. */
export function e73AgreedRequestedTypes(capabilityMetadata: unknown): string[] {
  const metadata = capabilityMetadata && typeof capabilityMetadata === 'object' && !Array.isArray(capabilityMetadata)
    ? capabilityMetadata as Record<string, unknown>
    : {}
  const listed = metadata.requested_message_codes ?? metadata.requestedMessageCodes
  return Array.isArray(listed) ? [...new Set(listed.map(upper).filter(Boolean))] : ['E66']
}

/**
 * Owner decision 43: E73 for missing E66 values; an S02 forecast request only with the right
 * role (DDQ), an explicit S02 agreement and a verified data right. Throws when not authorized.
 */
export function assertE73RequestedTypeAuthorized(input: {
  requestedMessageCode: string
  applicationReference: string
  capabilityMetadata: unknown
  dataRightVerified: boolean
}): void {
  const requested = upper(input.requestedMessageCode)
  if (!(UTILTS_25_A_3_REQUEST_TARGETS.E73 as readonly string[]).includes(requested)) {
    throw new Error(`utilts_e73_requested_message_unsupported:${requested || 'missing'}`)
  }
  // Field 311 must be a registered reference of exactly the requested type.
  resolveVerifiedUtiltsApplicationReference({ messageCode: 'E73', requestedMessageCode: requested, applicationReference: input.applicationReference })
  if (!e73AgreedRequestedTypes(input.capabilityMetadata).includes(requested)) {
    throw new Error(`utilts_e73_requested_type_not_agreed:${requested}`)
  }
  if (input.dataRightVerified !== true) throw new Error(`utilts_e73_data_right_required:${requested}`)
  if (requested === 'S02' && roleCode(input.applicationReference) !== 'DDQ') {
    throw new Error(`utilts_e73_s02_supplier_role_required:${roleCode(input.applicationReference) || 'missing'}`)
  }
}
