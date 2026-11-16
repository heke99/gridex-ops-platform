// lib/ediel/ack/acknowledgementEngine.ts
//
// Batch 6: AcknowledgementEngine. Deterministic classification of inbound ACKs
// (CONTRL / APERAK / UTILTS_ERR / XML acknowledgement) into a single business
// effect, with admin-action generation, duplicate/late/unmatched safety and a
// 30-minute SLA check. This composes existing canonical ACK rules; it does not
// duplicate parsing/correlation.

import { buildEdielAdminAction, type EdielAdminAction } from '@/lib/ediel/ack/adminActionEngine'

export type AckFamilyInput = 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | 'ESETT_XML_ACK' | string
export type AckOutcomeInput = 'positive' | 'negative' | null

export type AckBusinessEffect =
  | 'continue' // syntax ok (CONTRL positive) — not business-final
  | 'next_step' // business positive (APERAK positive) — drive next step
  | 'stop_automation' // negative ACK — stop automation
  | 'manual_review' // unmatched / unknown — never guess
  | 'noop' // duplicate / already-final

export type AcknowledgementClassification = {
  family: string
  outcome: AckOutcomeInput
  businessEffect: AckBusinessEffect
  isFinal: boolean
  adminAction: EdielAdminAction | null
  reason: string
}

export const EXPECTED_ACK_SLA_MINUTES = 30

export function classifyAcknowledgement(input: {
  family: AckFamilyInput
  outcome: AckOutcomeInput
  matchedSourceMessageId?: string | null
  duplicate?: boolean
  late?: boolean
  sourceReference?: string | null
}): AcknowledgementClassification {
  const family = String(input.family ?? '').toUpperCase()

  // Duplicate ACKs are safe no-ops (idempotency).
  if (input.duplicate) {
    return { family, outcome: input.outcome, businessEffect: 'noop', isFinal: false, adminAction: null, reason: 'duplicate_ack_ignored' }
  }

  // Unmatched ACKs must never drive business updates — route to manual review.
  if (!input.matchedSourceMessageId) {
    return {
      family,
      outcome: input.outcome,
      businessEffect: 'manual_review',
      isFinal: false,
      adminAction: buildEdielAdminAction({
        actionCode: 'ack_unmatched_manual_review',
        title: 'Omatchad kvittens kräver manuell granskning',
        detail: `Inkommande ${family}-kvittens kunde inte kopplas till ett känt utskick (ref ${input.sourceReference ?? 'okänd'}).`,
        severity: 'warning',
        requiresManualReview: true,
        idempotencyKey: `ack-unmatched:${family}:${input.sourceReference ?? 'unknown'}`,
        payload: { family, outcome: input.outcome, sourceReference: input.sourceReference ?? null },
      }),
      reason: 'unmatched_ack',
    }
  }

  if (family === 'CONTRL') {
    if (input.outcome === 'negative') {
      return {
        family,
        outcome: 'negative',
        businessEffect: 'stop_automation',
        isFinal: true,
        adminAction: buildEdielAdminAction({
          actionCode: 'negative_contrl_stops_automation',
          title: 'Negativ CONTRL stoppar automationen',
          detail: 'Mottagaren avvisade meddelandets syntax/struktur. Affärsautomationen stoppas tills felet är åtgärdat.',
          severity: 'error',
          requiresManualReview: true,
          idempotencyKey: `negative-contrl:${input.matchedSourceMessageId}`,
          payload: { family },
        }),
        reason: 'negative_contrl',
      }
    }
    // Positive CONTRL = syntax OK, NOT business OK.
    return { family, outcome: 'positive', businessEffect: 'continue', isFinal: false, adminAction: null, reason: 'positive_contrl_syntax_ok' }
  }

  if (family === 'APERAK') {
    if (input.outcome === 'negative') {
      return {
        family,
        outcome: 'negative',
        businessEffect: 'stop_automation',
        isFinal: true,
        adminAction: buildEdielAdminAction({
          actionCode: 'negative_aperak_admin_action',
          title: 'Negativ APERAK kräver åtgärd',
          detail: 'Mottagaren avvisade meddelandets innehåll (APERAK). Automationen stoppas och ärendet kräver manuell hantering.',
          severity: 'error',
          requiresManualReview: true,
          idempotencyKey: `negative-aperak:${input.matchedSourceMessageId}`,
          payload: { family },
        }),
        reason: 'negative_aperak',
      }
    }
    // Positive APERAK = business OK — drive next step.
    return { family, outcome: 'positive', businessEffect: 'next_step', isFinal: true, adminAction: null, reason: 'positive_aperak' }
  }

  if (family === 'UTILTS_ERR') {
    return {
      family,
      outcome: 'negative',
      businessEffect: 'stop_automation',
      isFinal: true,
      adminAction: buildEdielAdminAction({
        actionCode: 'utilts_err_admin_action',
        title: 'UTILTS_ERR funktionellt fel kräver åtgärd',
        detail: 'Mottagaren rapporterade ett funktionellt/processfel (UTILTS_ERR). Automationen stoppas.',
        severity: 'error',
        requiresManualReview: true,
        idempotencyKey: `utilts-err:${input.matchedSourceMessageId}`,
        payload: { family },
      }),
      reason: 'utilts_err',
    }
  }

  if (family === 'ESETT_XML_ACK') {
    if (input.outcome === 'negative') {
      return {
        family,
        outcome: 'negative',
        businessEffect: 'stop_automation',
        isFinal: true,
        adminAction: buildEdielAdminAction({
          actionCode: 'negative_esett_xml_ack',
          title: 'Negativ eSett XML-kvittens',
          detail: 'eSett/NBS avvisade XML-meddelandet. Automationen stoppas.',
          severity: 'error',
          requiresManualReview: true,
          idempotencyKey: `negative-esett-xml:${input.matchedSourceMessageId}`,
          payload: { family },
        }),
        reason: 'negative_esett_xml_ack',
      }
    }
    return { family, outcome: input.outcome, businessEffect: 'next_step', isFinal: true, adminAction: null, reason: 'positive_esett_xml_ack' }
  }

  // Unknown ACK family — never guess.
  return {
    family,
    outcome: input.outcome,
    businessEffect: 'manual_review',
    isFinal: false,
    adminAction: buildEdielAdminAction({
      actionCode: 'unknown_ack_family_manual_review',
      title: 'Okänd kvittenstyp kräver manuell granskning',
      detail: `Kvittenstypen ${family} hanteras inte automatiskt.`,
      severity: 'warning',
      requiresManualReview: true,
      idempotencyKey: `ack-unknown-family:${family}:${input.matchedSourceMessageId}`,
      payload: { family },
    }),
    reason: 'unknown_ack_family',
  }
}

// 30-minute SLA: is an expected ACK overdue?
export function isExpectedAckOverdue(input: {
  sentAt: string | null | undefined
  now?: Date
  slaMinutes?: number
}): boolean {
  if (!input.sentAt) return false
  const sent = new Date(input.sentAt)
  if (Number.isNaN(sent.getTime())) return false
  const now = input.now ?? new Date()
  const slaMs = (input.slaMinutes ?? EXPECTED_ACK_SLA_MINUTES) * 60 * 1000
  return now.getTime() - sent.getTime() > slaMs
}
