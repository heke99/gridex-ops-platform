import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

export type CanonicalInboundAckFamily = 'APERAK' | 'CONTRL'
export type CanonicalInboundAckOutcome = 'positive' | 'negative' | 'invalid' | 'not_ack'

export type CanonicalInboundAckClassification = {
  family: CanonicalInboundAckFamily | null
  outcome: CanonicalInboundAckOutcome
  code: string | null
  reason: string | null
}

function normalizedUnique(values: readonly string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => String(value ?? '').trim().toUpperCase())
        .filter(Boolean),
    ),
  )
}

/**
 * Canonical Swedish Ediel ACK outcome classification.
 *
 * APERAK:
 * - BGM/1001 = 312 => positive application acknowledgement.
 * - BGM/1001 = 313 => negative application acknowledgement.
 * - ERC/FTX content does not determine the sign. Positive UTILTS APERAK may
 *   legitimately contain ERC 100 and FTX AAO/OK.
 *
 * CONTRL:
 * - UCI/0083 = 1 => accepted interchange.
 * - UCI/0083 = 4 => rejected interchange.
 * - Missing, conflicting or unknown action codes fail closed as invalid.
 *
 * Sources: Svenska kraftnät Generella tekniska regler 24-A-6 and current
 * Swedish UTILTS/APERAK 25-A-3/TGT 6.0.5 examples.
 */
export function classifyCanonicalInboundAck(
  parsed: Pick<ParsedEdifactEnvelope, 'messageFamily' | 'messageCode' | 'references'>,
): CanonicalInboundAckClassification {
  if (parsed.messageFamily === 'APERAK') {
    const code = String(parsed.messageCode ?? '').trim().toUpperCase() || null
    if (code === '312') return { family: 'APERAK', outcome: 'positive', code, reason: null }
    if (code === '313') return { family: 'APERAK', outcome: 'negative', code, reason: null }
    return {
      family: 'APERAK',
      outcome: 'invalid',
      code,
      reason: `aperak_bgm_message_type_invalid:${code ?? 'missing'}`,
    }
  }

  if (parsed.messageFamily === 'CONTRL') {
    const actions = normalizedUnique(parsed.references.UCI_ACTION)
    if (actions.length !== 1) {
      return {
        family: 'CONTRL',
        outcome: 'invalid',
        code: actions.length === 0 ? null : actions.join(','),
        reason: actions.length === 0 ? 'contrl_uci_action_missing' : 'contrl_uci_action_conflicting',
      }
    }

    const code = actions[0]
    if (code === '1') return { family: 'CONTRL', outcome: 'positive', code, reason: null }
    if (code === '4') return { family: 'CONTRL', outcome: 'negative', code, reason: null }
    return {
      family: 'CONTRL',
      outcome: 'invalid',
      code,
      reason: `contrl_uci_action_invalid:${code}`,
    }
  }

  return { family: null, outcome: 'not_ack', code: null, reason: null }
}

export function isCanonicalPositiveAck(parsed: Pick<ParsedEdifactEnvelope, 'messageFamily' | 'messageCode' | 'references'>): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'positive'
}

export function isCanonicalNegativeAck(parsed: Pick<ParsedEdifactEnvelope, 'messageFamily' | 'messageCode' | 'references'>): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'negative'
}

export function isCanonicalInvalidAck(parsed: Pick<ParsedEdifactEnvelope, 'messageFamily' | 'messageCode' | 'references'>): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'invalid'
}
