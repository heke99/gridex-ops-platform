// lib/ediel/orchestrator.ts

import {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
} from '@/lib/ediel/flows/prodatSwitch'
import {
  prepareAndQueueUtiltsE73,
  prepareAndQueueUtiltsE66,
} from '@/lib/ediel/flows/utiltsDataRequest'
import { prepareAndQueueAiList } from '@/lib/ediel/flows/aiListFlow'
import {
  pollAndIngestEdielMailbox,
  createNegativeUtiltsResponse,
} from '@/lib/ediel/flows/inboundProcessing'

export {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
  prepareAndQueueUtiltsE73,
  prepareAndQueueUtiltsE66,
  prepareAndQueueAiList,
  pollAndIngestEdielMailbox,
  createNegativeUtiltsResponse,
}

import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  createCanonicalAckConflictEvent,
  createCanonicalDuplicateBlockEvent,
  createEdielMessageEvent,
  getEdielMessageById,
} from '@/lib/ediel/db'
import { updateSupplierSwitchRequestStatus } from '@/lib/operations/db'
import { updateOutboundRequestStatus } from '@/lib/cis/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { buildAckDraftForSource, findExistingAckForSource, type AckFamily, type AckOutcome } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'

function ensureActorUserId(value?: string | null): string {
  return value && value.trim() ? value.trim() : 'system'
}

function assertActiveFamily(
  family: string | null | undefined,
  context: string
): asserts family is typeof ACTIVE_EDIEL_MESSAGE_FAMILIES[number] {
  if (!isActiveEdielMessageFamily(family)) {
    throw new Error(
      `${context}: message family ${family ?? 'null'} ligger utanför aktiv release (${ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')})`
    )
  }
}

async function logAckCreateOutcome(params: {
  actorUserId: string
  sourceMessageId: string
  ackMessageId: string
  ackFamily: AckFamily
  outcome: AckOutcome | 'negative'
  dedupeBlocked: boolean
  conflictReason?: 'duplicate_same_outcome' | 'conflicting_outcome' | 'duplicate_same_family'
  existingAckMessageId?: string | null
}) {
  const eventType =
    params.ackFamily === 'CONTRL'
      ? 'contrl_sent'
      : params.ackFamily === 'APERAK'
        ? 'aperak_sent'
        : 'utilts_err_sent'

  if (params.dedupeBlocked) {
    if (params.conflictReason) {
      await createCanonicalAckConflictEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.sourceMessageId,
        ackFamily: params.ackFamily,
        sourceMessageId: params.sourceMessageId,
        attemptedOutcome: params.outcome,
        existingAckMessageId: params.existingAckMessageId ?? null,
        existingOutcome:
          params.conflictReason === 'conflicting_outcome'
            ? params.outcome === 'positive'
              ? 'negative'
              : 'positive'
            : params.outcome,
        reason: params.conflictReason,
      })
      return
    }

    await createCanonicalDuplicateBlockEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessageId,
      layer: 'canonical_ack',
      message: `${params.ackFamily}-skapande blockerades som canonical dublett.`,
      payload: {
        ackFamily: params.ackFamily,
        attemptedOutcome: params.outcome,
        existingAckMessageId: params.existingAckMessageId ?? null,
      },
    })
    return
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessageId,
    eventType,
    eventStatus: params.ackFamily === 'UTILTS_ERR' ? 'warning' : 'success',
    message: `${params.ackFamily}-utkast skapat via canonical kernel.`,
    payload: {
      ackMessageId: params.ackMessageId,
      ackFamily: params.ackFamily,
      outcome: params.outcome,
      dedupeBlocked: false,
    },
  })
}

export async function sendQueuedEdielMessage(params: {
  actorUserId: string
  edielMessageId: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelande hittades inte')

  assertActiveFamily(message.message_family, 'sendQueuedEdielMessage')

  const result = await sendEdielMessageViaSmtp(message)

  if (message.outbound_request_id) {
    await updateOutboundRequestStatus({
      actorUserId,
      outboundRequestId: message.outbound_request_id,
      status: 'sent',
      externalReference: message.external_reference,
      responsePayload: {
        smtpMessageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      },
    })
  }

  if (message.switch_request_id) {
    const supabase = await createSupabaseServerClient()
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: message.switch_request_id,
      status: 'submitted',
      externalReference: message.external_reference,
    })
  }

  return result
}

export async function createAckDraftForMessage(params: {
  actorUserId: string
  sourceMessageId: string
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const sourceMessage = await getEdielMessageById(params.sourceMessageId)

  if (!sourceMessage) {
    throw new Error('Källmeddelande hittades inte')
  }

  const effectiveOutcome =
    params.ackFamily === 'UTILTS_ERR'
      ? 'negative'
      : (params.outcome ?? 'positive')

  const sameOutcomeExisting = await findExistingAckForSource({
    sourceMessageId: sourceMessage.id,
    ackFamily: params.ackFamily,
    outcome: effectiveOutcome,
  })

  if (sameOutcomeExisting) {
    await logAckCreateOutcome({
      actorUserId,
      sourceMessageId: sourceMessage.id,
      ackMessageId: sameOutcomeExisting.id,
      ackFamily: params.ackFamily,
      outcome: effectiveOutcome,
      dedupeBlocked: true,
      conflictReason: 'duplicate_same_outcome',
      existingAckMessageId: sameOutcomeExisting.id,
    })
    return sameOutcomeExisting
  }

  if (params.ackFamily === 'APERAK' || params.ackFamily === 'CONTRL') {
    const conflictingOutcome = effectiveOutcome === 'positive' ? 'negative' : 'positive'
    const oppositeExisting = await findExistingAckForSource({
      sourceMessageId: sourceMessage.id,
      ackFamily: params.ackFamily,
      outcome: conflictingOutcome,
    })

    if (oppositeExisting) {
      await logAckCreateOutcome({
        actorUserId,
        sourceMessageId: sourceMessage.id,
        ackMessageId: oppositeExisting.id,
        ackFamily: params.ackFamily,
        outcome: effectiveOutcome,
        dedupeBlocked: true,
        conflictReason: 'conflicting_outcome',
        existingAckMessageId: oppositeExisting.id,
      })
      return oppositeExisting
    }
  }

  const familyExisting = await findExistingAckForSource({
    sourceMessageId: sourceMessage.id,
    ackFamily: params.ackFamily,
  })

  const draft = buildAckDraftForSource({
    actorUserId,
    sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
  })

  const ackMessage = await createCanonicalAckMessage({
    actorUserId,
    sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft,
  })

  const dedupeBlocked = ackMessage.id === sourceMessage.id || ackMessage.id === familyExisting?.id

  if (dedupeBlocked) {
    await logAckCreateOutcome({
      actorUserId,
      sourceMessageId: sourceMessage.id,
      ackMessageId: ackMessage.id,
      ackFamily: params.ackFamily,
      outcome: effectiveOutcome,
      dedupeBlocked: true,
      conflictReason: familyExisting ? 'duplicate_same_family' : 'duplicate_same_outcome',
      existingAckMessageId: ackMessage.id,
    })
    return ackMessage
  }

  await logAckCreateOutcome({
    actorUserId,
    sourceMessageId: sourceMessage.id,
    ackMessageId: ackMessage.id,
    ackFamily: params.ackFamily,
    outcome: effectiveOutcome,
    dedupeBlocked: false,
  })

  return ackMessage
}

export async function prepareManualProdatMessage(params: {
  actorUserId: string
  switchRequestId: string
  messageCode: 'Z03' | 'Z05' | 'Z09'
  communicationRouteId?: string | null
}) {
  if (params.messageCode === 'Z03') {
    return prepareAndQueueEdielZ03({
      actorUserId: params.actorUserId,
      switchRequestId: params.switchRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  if (params.messageCode === 'Z05') {
    return prepareAndQueueEdielZ05({
      actorUserId: params.actorUserId,
      switchRequestId: params.switchRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  return prepareAndQueueEdielZ09({
    actorUserId: params.actorUserId,
    switchRequestId: params.switchRequestId,
    communicationRouteId: params.communicationRouteId ?? null,
  })
}