// Swedish UTILTS market/runtime projection for Gridex.
//
// Normative actor/capability semantics live in utiltsMarketSemantics. This
// compatibility module delegates those semantics and keeps only runtime input
// normalization / outbound assertions.

import { resolveVerifiedUtiltsApplicationReference } from '@/lib/ediel/rulebook/utiltsApplicationReference'
import {
  getCanonicalSupplierUtiltsSupport,
  getCanonicalUtiltsMarketProfile,
  UTILTS_CANONICAL_MARKET_PROFILES,
  type SupplierUtiltsSupport,
  type UtiltsMarketProfile,
} from '@/lib/ediel/rulebook/utiltsMarketSemantics'

export type UtiltsRequestedMessageCode = 'S02' | 'E66'
export type UtiltsResolutionClass = 'monthly' | 'daily' | 'hourly' | 'quarter_hour'
export type { SupplierUtiltsSupport, UtiltsMarketProfile }

/** Compatibility alias; values are owned by utiltsMarketSemantics. */
export const UTILTS_MARKET_PROFILES = UTILTS_CANONICAL_MARKET_PROFILES

export function getUtiltsMarketProfile(code: string | null | undefined): UtiltsMarketProfile | null {
  return getCanonicalUtiltsMarketProfile(code)
}

export function getSupplierUtiltsSupport(code: string | null | undefined): SupplierUtiltsSupport {
  return getCanonicalSupplierUtiltsSupport(code)
}

export function normalizeUtiltsResolutionClass(value: unknown): UtiltsResolutionClass {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['15', 'PT15M', 'QUARTER_HOUR', 'QUARTER-HOUR', 'KVART'].includes(normalized)) return 'quarter_hour'
  if (['60', 'PT60M', 'HOURLY', 'HOUR'].includes(normalized)) return 'hourly'
  if (['1440', 'P1D', 'DAILY', 'DAY'].includes(normalized)) return 'daily'
  return 'monthly'
}

/**
 * Backwards-compatible entry point with corrected semantics.
 *
 * Field 311 is an explicit allowlist and S/T is not licensed to be inferred
 * merely from a local reading-frequency value. Callers must either provide an
 * exact candidate or target a single-valued profile such as S02.
 */
export function resolveCanonicalUtiltsApplicationReference(input: {
  code: string
  actorRole?: string | null
  requestedMessageCode?: string | null
  resolution?: unknown
  applicationReference?: string | null
}): string {
  return resolveVerifiedUtiltsApplicationReference({
    messageCode: input.code,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.applicationReference,
  })
}

export function assertSupplierUtiltsOutboundAllowed(input: {
  code: string
  bilateralCapabilityVerified?: boolean
  requestedMessageCode?: string | null
}): { requestedMessageCode: UtiltsRequestedMessageCode | null } {
  const code = String(input.code ?? '').trim().toUpperCase()
  const profile = getCanonicalUtiltsMarketProfile(code)
  if (!profile || profile.supplierSupport !== 'outbound_only') {
    throw new Error(`utilts_supplier_outbound_not_allowed:${code || 'missing'}`)
  }
  if (profile.bilateralRequired && input.bilateralCapabilityVerified !== true) {
    throw new Error(`utilts_bilateral_capability_required:${code}`)
  }
  if (code === 'E73') {
    const requested = String(input.requestedMessageCode ?? '').trim().toUpperCase()
    if (requested !== 'S02' && requested !== 'E66') {
      throw new Error('utilts_e73_requested_message_required')
    }
    return { requestedMessageCode: requested }
  }
  return { requestedMessageCode: null }
}
