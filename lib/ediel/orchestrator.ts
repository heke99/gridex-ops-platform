// lib/ediel/orchestrator.ts

export {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
} from '@/lib/ediel/flows/prodatSwitch'

export {
  prepareAndQueueUtiltsE73,
  prepareAndQueueUtiltsE66,
} from '@/lib/ediel/flows/utiltsDataRequest'

export { prepareAndQueueAiList } from '@/lib/ediel/flows/aiListFlow'

export {
  pollAndIngestEdielMailbox,
  createNegativeUtiltsResponse,
} from '@/lib/ediel/flows/inboundProcessing'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createEdielMessageEvent, getEdielMessageById } from '@/lib/ediel/db'
import { updateSupplierSwitchRequestStatus } from '@/lib/operations/db'
import { updateOutboundRequestStatus } from '@/lib/cis/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { buildAckDraftForSource, type AckFamily, type AckOutcome } from '@/lib/ediel/ack'
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

  const eventType =
    params.ackFamily === 'CONTRL'
      ? 'contrl_sent'
      : params.ackFamily === 'APERAK'
        ? 'aperak_sent'
        : 'utilts_err_sent'

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: sourceMessage.id,
    eventType,
    eventStatus: params.ackFamily === 'UTILTS_ERR' ? 'warning' : 'success',
    message: `${params.ackFamily}-utkast skapat via canonical kernel.`,
    payload: {
      ackMessageId: ackMessage.id,
      ackFamily: params.ackFamily,
      outcome: params.outcome ?? (params.ackFamily === 'UTILTS_ERR' ? 'negative' : 'positive'),
    },
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
