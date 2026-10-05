// Compatibility registry for the PRODAT renderer.
// Message support, version tokens and ACK semantics are projected from canonical
// rulebook modules; do not add independent protocol matrices here.

import type { ProdatEngineAckExpectation, ProdatEngineCode } from '@/lib/ediel/prodat/types'
import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'

export const ACTIVE_PRODAT_ENGINE_CODES: readonly ProdatEngineCode[] = PRODAT_CANONICAL_PROFILES.map(
  (profile) => profile.messageCode as ProdatEngineCode,
)

export function isProdatEngineCode(value: string | null | undefined): value is ProdatEngineCode {
  const normalized = String(value ?? '').trim().toUpperCase()
  return ACTIVE_PRODAT_ENGINE_CODES.includes(normalized as ProdatEngineCode)
}

export function prodatMessageTypeToken(version: string | null | undefined): string {
  const canonical = PRODAT_CANONICAL_PROFILES[0]
  if (!canonical) throw new Error('canonical_prodat_profile_catalog_empty')

  const normalized = String(version ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const canonicalGuideVersion = canonical.guideVersion.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (!normalized) throw new Error('prodat_message_version_required')
  if (normalized !== canonicalGuideVersion && normalized !== canonical.associationAssignedCode) {
    throw new Error(`prodat_message_version_not_supported:${version}`)
  }
  return `PRODAT:D:${canonical.edifactDirectory.slice(1)}:UN:${canonical.associationAssignedCode}`
}

export function deriveProdatAckExpectation(code?: ProdatEngineCode | string | null): ProdatEngineAckExpectation {
  const canonical = canonicalAckRequirements({ family: 'PRODAT', code })
  return {
    requiresContrl: canonical.requiresContrl,
    requiresAperak: canonical.requiresAperak,
    contrlStatus: canonical.requiresContrl ? 'pending' : 'not_required',
    aperakStatus: canonical.requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
    ackDueAt: null,
  }
}
