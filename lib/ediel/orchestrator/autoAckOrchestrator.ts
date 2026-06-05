import { buildAckDraftForSource } from '@/lib/ediel/ack'
import type { AckFamily, AckOutcome } from '@/lib/ediel/core/ackPolicy'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import type { EdielEngineDecision } from '@/lib/ediel/decisionEngine'
import { ensureExpectedAckSent } from '@/lib/ediel/decisionEngine'
import { createEdielMessageEvent, listAckMessagesForSource } from '@/lib/ediel/db'
import { createOutboxItem } from '@/lib/ediel/outbox/createOutboxItem'
import { supersedeWrongDraftsForDecision } from '@/lib/ediel/outbox/supersedeWrongDrafts'
import type { EdielMessageRow } from '@/lib/ediel/types'

function isAckFamily(value: unknown): value is AckFamily {
  return value === 'CONTRL' || value === 'APERAK' || value === 'UTILTS_ERR'
}

function normalizeOutcome(value: unknown): AckOutcome | null {
  return value === 'positive' || value === 'negative' ? value : null
}

export async function runAutoAckOrchestratorForInboundMessage(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  decision: EdielEngineDecision
  autoSend?: boolean
  outbox?: boolean
}): Promise<{
  status: 'created' | 'queued' | 'already_sent_success' | 'blocked' | 'manual_review' | 'no_ack'
  ackMessageId: string | null
  lifecycleStatus: string | null
  reason: string
}> {
  if (params.decision.kind === 'manual_review') {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Backend decision requires manual review; no business ACK was auto-created.',
      payload: {
        reason: params.decision.reason,
        ruleKeys: params.decision.ruleKeys,
        classification: params.decision.classification,
      },
    })
    return { status: 'manual_review', ackMessageId: null, lifecycleStatus: 'manual_review', reason: params.decision.reason }
  }

  if (params.decision.kind !== 'ack' || !isAckFamily(params.decision.ackFamily)) {
    return { status: 'no_ack', ackMessageId: null, lifecycleStatus: 'no_ack', reason: params.decision.reason }
  }

  const desiredFamily = params.decision.ackFamily
  const desiredOutcome = normalizeOutcome(params.decision.outcome)
  const existingAcks = await listAckMessagesForSource({ sourceMessageId: params.sourceMessage.id })
  const lifecycle = ensureExpectedAckSent({
    desiredFamily,
    desiredOutcome,
    existingAcks,
  })

  if (lifecycle.status === 'already_sent_success') {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: 'manual_note',
      eventStatus: 'success',
      message: 'Rätt final ACK finns redan; automation skickar inte dubblett.',
      payload: { lifecycle, desiredFamily, desiredOutcome },
    })
    return { status: 'already_sent_success', ackMessageId: lifecycle.existingAckId, lifecycleStatus: lifecycle.status, reason: lifecycle.message }
  }

  if (lifecycle.status === 'blocked_final_ack_exists') {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: 'ACK automation blocked because an opposite final ACK already exists.',
      payload: { lifecycle, desiredFamily, desiredOutcome },
    })
    return { status: 'blocked', ackMessageId: lifecycle.existingAckId, lifecycleStatus: lifecycle.status, reason: lifecycle.message }
  }

  const supersedeResult = await supersedeWrongDraftsForDecision({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    desiredFamily,
    desiredOutcome,
  })

  if (supersedeResult.blockedFinalAckId) {
    return { status: 'blocked', ackMessageId: supersedeResult.blockedFinalAckId, lifecycleStatus: 'blocked_final_ack_exists', reason: 'Opposite final ACK exists.' }
  }

  const draft = buildAckDraftForSource({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: desiredFamily,
    outcome: desiredOutcome ?? undefined,
    messageText: params.decision.messageText,
    applicationErrors: params.decision.applicationErrors,
  })

  const ack = await createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: desiredFamily,
    outcome: desiredOutcome ?? undefined,
    draft,
  })

  if (params.outbox !== false) {
    await createOutboxItem({
      actorUserId: params.actorUserId,
      message: ack,
      sourceMessageId: params.sourceMessage.id,
      status: params.autoSend ? 'queued' : 'prepared',
      payload: {
        backendDecision: {
          kind: params.decision.kind,
          ackFamily: params.decision.ackFamily,
          outcome: params.decision.outcome,
          reason: params.decision.reason,
          ruleKeys: params.decision.ruleKeys,
          classification: params.decision.classification,
        },
      },
    })
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: desiredFamily === 'CONTRL' ? 'contrl_sent' : desiredFamily === 'APERAK' ? 'aperak_sent' : 'utilts_err_sent',
    eventStatus: params.autoSend ? 'info' : 'warning',
    message: params.autoSend
      ? 'Backend automation created ACK and queued it in outbox.'
      : 'Backend automation created ACK draft/prepared item but did not send automatically.',
    payload: {
      ackMessageId: ack.id,
      desiredFamily,
      desiredOutcome,
      lifecycle,
      supersededAckIds: supersedeResult.supersededIds,
      autoSend: params.autoSend === true,
      decisionReason: params.decision.reason,
      ruleKeys: params.decision.ruleKeys,
    },
  })

  return {
    status: params.autoSend ? 'queued' : 'created',
    ackMessageId: ack.id,
    lifecycleStatus: lifecycle.status,
    reason: params.decision.reason,
  }
}
