import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'

/** DB-valid values for ediel_route_profiles.ack_mode. */
export type EdielAckMode = 'default' | 'none' | 'contrl_only' | 'contrl_and_aperak'

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * Transport projection of canonical ACK semantics.
 *
 * This module never defines the normative ACK matrix. It validates message
 * codes against the canonical rulebooks and projects canonical requirements to
 * the legacy DB ack_mode enum. The enum remains a route/runtime compatibility
 * field; canonical ACK policy can never be weakened by this projection.
 */
export function projectCanonicalAckMode(params: {
  messageFamily: string
  messageCode?: string | null
}): EdielAckMode {
  const family = normalize(params.messageFamily)
  const code = normalize(params.messageCode)

  // Non-Ediel compatibility families do not participate in the canonical ACK
  // matrix. CONTRL is explicitly no-ack in the canonical matrix.
  if (family === 'CONTRL' || family === 'AI_LIST' || family === 'OTHER') return 'none'

  if (family === 'PRODAT') {
    if (!code) throw new Error('ediel_ack_mode_prodat_code_required')
    if (!getCanonicalProdatProfile(code)) throw new Error(`ediel_ack_mode_prodat_profile_missing:${code}`)
  } else if (family === 'UTILTS') {
    if (!code) return 'default'
    if (!getCanonicalUtiltsProfile(code)) throw new Error(`ediel_ack_mode_utilts_profile_missing:${code}`)
  } else if (family !== 'APERAK' && family !== 'UTILTS_ERR') {
    throw new Error(`ediel_ack_mode_family_unsupported:${family || 'missing'}`)
  }

  const requirements = canonicalAckRequirements({ family, code: code || null })
  if (!requirements.requiresContrl && !requirements.requiresAperak) return 'none'
  if (requirements.requiresContrl && !requirements.requiresAperak) return 'contrl_only'
  if (requirements.requiresContrl && requirements.requiresAperak) return 'contrl_and_aperak'
  return 'default'
}

const VALID_ACK_MODES = new Set<string>(['default', 'none', 'contrl_only', 'contrl_and_aperak'])
export function isValidAckMode(value: unknown): value is EdielAckMode {
  return typeof value === 'string' && VALID_ACK_MODES.has(value)
}
