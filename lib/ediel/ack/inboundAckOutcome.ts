import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

export type CanonicalInboundAckFamily = 'APERAK' | 'CONTRL'
export type CanonicalInboundAckOutcome = 'positive' | 'negative' | 'invalid' | 'not_ack'
export type CanonicalInboundAperakProfile = 'PRODAT_16_B' | 'UTILTS_25_A' | null

export type CanonicalInboundAckClassification = {
  family: CanonicalInboundAckFamily | null
  profile: CanonicalInboundAperakProfile
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

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function resolveAperakProfile(parsed: Pick<
  ParsedEdifactEnvelope,
  'applicationReference' | 'messageTypeVersion'
>): CanonicalInboundAperakProfile {
  const appRef = normalize(parsed.applicationReference)
  const release = normalize(parsed.messageTypeVersion.release)
  const association = normalize(parsed.messageTypeVersion.associationAssignedCode)

  const prodatEvidence =
    (release === '96A' && association === 'E2SE6A') ||
    appRef === '23-DDQ-PRODAT' ||
    appRef === '23-DGI-PRODAT'
  const utiltsEvidence =
    (release === '04A' && association === 'E5SE5A') ||
    (/^23-[A-Z0-9]+-(?:E\d\d|S\d\d)-/.test(appRef) && !appRef.endsWith('-PRODAT'))

  if (prodatEvidence === utiltsEvidence) return null
  return prodatEvidence ? 'PRODAT_16_B' : 'UTILTS_25_A'
}

/**
 * Canonical Swedish Ediel ACK outcome classification.
 *
 * APERAK is family-specific:
 * - UTILTS APERAK (D04A/E5SE5A): BGM/1001 = 312 positive, 313 negative.
 * - PRODAT APERAK 16.B (D96A/E2SE6A): BGM/1225 = 34 for both positive and
 *   negative APERAK. ERC determines the application result: 100 means accepted;
 *   any non-100 ERC is a rejection/error. This deliberately prevents the
 *   UTILTS 312/313 convention from leaking into PRODAT.
 *
 * CONTRL:
 * - UCI/0083 = 1 => accepted interchange.
 * - UCI/0083 = 4 => rejected interchange.
 * - Missing, conflicting or unknown action codes fail closed as invalid.
 *
 * Sources: Svenska kraftnät Generella tekniska regler 24-A-6,
 * PRODAT/APERAK 26.A/16.B and UTILTS/APERAK 25-A-3.
 */
export function classifyCanonicalInboundAck(
  parsed: Pick<
    ParsedEdifactEnvelope,
    | 'messageFamily'
    | 'messageCode'
    | 'messageFunctionCode'
    | 'applicationReference'
    | 'messageTypeVersion'
    | 'errorCodes'
    | 'references'
  >,
): CanonicalInboundAckClassification {
  if (parsed.messageFamily === 'APERAK') {
    const profile = resolveAperakProfile(parsed)
    if (!profile) {
      return {
        family: 'APERAK',
        profile: null,
        outcome: 'invalid',
        code: normalize(parsed.messageCode) || null,
        reason: 'aperak_profile_unresolved_or_ambiguous',
      }
    }

    if (profile === 'UTILTS_25_A') {
      const code = normalize(parsed.messageCode) || null
      if (code === '312') return { family: 'APERAK', profile, outcome: 'positive', code, reason: null }
      if (code === '313') return { family: 'APERAK', profile, outcome: 'negative', code, reason: null }
      return {
        family: 'APERAK',
        profile,
        outcome: 'invalid',
        code,
        reason: `utilts_aperak_bgm_message_type_invalid:${code ?? 'missing'}`,
      }
    }

    const functionCode = normalize(parsed.messageFunctionCode) || null
    if (functionCode !== '34') {
      return {
        family: 'APERAK',
        profile,
        outcome: 'invalid',
        code: functionCode,
        reason: `prodat_aperak_bgm_function_invalid:${functionCode ?? 'missing'}`,
      }
    }

    const ercCodes = normalizedUnique(parsed.errorCodes)
    if (ercCodes.length === 0) {
      return {
        family: 'APERAK',
        profile,
        outcome: 'invalid',
        code: null,
        reason: 'prodat_aperak_erc_missing',
      }
    }

    const rejected = ercCodes.some((code) => code !== '100')
    return {
      family: 'APERAK',
      profile,
      outcome: rejected ? 'negative' : 'positive',
      code: ercCodes.join(','),
      reason: null,
    }
  }

  if (parsed.messageFamily === 'CONTRL') {
    const actions = normalizedUnique(parsed.references.UCI_ACTION)
    if (actions.length !== 1) {
      return {
        family: 'CONTRL',
        profile: null,
        outcome: 'invalid',
        code: actions.length === 0 ? null : actions.join(','),
        reason: actions.length === 0 ? 'contrl_uci_action_missing' : 'contrl_uci_action_conflicting',
      }
    }

    const code = actions[0]
    if (code === '1') return { family: 'CONTRL', profile: null, outcome: 'positive', code, reason: null }
    if (code === '4') return { family: 'CONTRL', profile: null, outcome: 'negative', code, reason: null }
    return {
      family: 'CONTRL',
      profile: null,
      outcome: 'invalid',
      code,
      reason: `contrl_uci_action_invalid:${code}`,
    }
  }

  return { family: null, profile: null, outcome: 'not_ack', code: null, reason: null }
}

export function isCanonicalPositiveAck(parsed: Parameters<typeof classifyCanonicalInboundAck>[0]): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'positive'
}

export function isCanonicalNegativeAck(parsed: Parameters<typeof classifyCanonicalInboundAck>[0]): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'negative'
}

export function isCanonicalInvalidAck(parsed: Parameters<typeof classifyCanonicalInboundAck>[0]): boolean {
  return classifyCanonicalInboundAck(parsed).outcome === 'invalid'
}
