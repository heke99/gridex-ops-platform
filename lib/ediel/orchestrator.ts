// lib/ediel/orchestrator.ts

import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import {
  buildAckDraftForSource,
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
  type EdielAperakApplicationError,
} from '@/lib/ediel/ack'
import { getEdielMessageById, updateEdielMessageStatus } from '@/lib/ediel/db'
import {
  createCanonicalAckMessage,
  resolveCanonicalOutboundContext,
} from '@/lib/ediel/core/kernel'
import type {
  AckFamily,
  AckOutcome,
  AckPolicy,
  EdielCanonicalAckState,
} from '@/lib/ediel/core/ackPolicy'
import {
  findExistingAckForSource,
  getAutomaticAckPolicy,
  getCanonicalAckState,
} from '@/lib/ediel/core/ackPolicy'
import {
  createNegativeUtiltsResponse,
  pollAndIngestEdielMailbox,
} from '@/lib/ediel/flows/inboundProcessing'
import { prepareAndQueueAiList } from '@/lib/ediel/flows/aiListFlow'
import {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ04,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ06,
  prepareAndQueueEdielZ09,
  prepareAndQueueEdielZ10,
} from '@/lib/ediel/flows/prodatSwitch'
import {
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
} from '@/lib/ediel/flows/utiltsDataRequest'
import { sendEdielMessageViaSmtp, type EdielSmtpMimeMode } from '@/lib/ediel/transport'

export type {
  AckFamily,
  AckOutcome,
  AckPolicy,
  EdielCanonicalAckState,
}

export {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ04,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ06,
  prepareAndQueueEdielZ09,
  prepareAndQueueEdielZ10,
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
  prepareAndQueueAiList,
  pollAndIngestEdielMailbox,
  createNegativeUtiltsResponse,
  getAutomaticAckPolicy,
  findExistingAckForSource,
  getCanonicalAckState,
  buildContrlDraft,
  buildAperakDraft,
  buildUtiltsErrDraft,
  buildAckDraftForSource,
}

function ensureActorUserId(value?: string | null): string {
  return value && value.trim() ? value.trim() : 'system'
}

export async function createAckForSourceMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}) {
  const draft = buildAckDraftForSource({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
  })

  return createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft,
  })
}

export async function createAckDraftForMessage(params: {
  actorUserId?: string | null
  sourceMessageId: string
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}) {
  const sourceMessage = await getEdielMessageById(params.sourceMessageId)
  if (!sourceMessage) {
    throw new Error('Källmeddelande hittades inte')
  }

  return createAckForSourceMessage({
    actorUserId: params.actorUserId,
    sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
  })
}

export async function createAutomaticAcksForInboundMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
}) {
  const policy = await getAutomaticAckPolicy(params.sourceMessage)
  const created: EdielMessageRow[] = []

  if (policy.shouldSendContrl) {
    const contrl = await createAckForSourceMessage({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'CONTRL',
      outcome: 'positive',
    })
    created.push(contrl)
  }

  if (policy.shouldSendPositiveAperak) {
    const aperak = await createAckForSourceMessage({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'APERAK',
      outcome: 'positive',
    })
    created.push(aperak)
  }

  return {
    policy,
    created,
  }
}

export async function createNegativeApplicationAck(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}) {
  return createAckForSourceMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'APERAK',
    outcome: 'negative',
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
  })
}

export async function createUtiltsErrAck(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  messageText?: string | null
}) {
  return createAckForSourceMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'UTILTS_ERR',
    outcome: 'negative',
    messageText: params.messageText ?? null,
  })
}

export async function sendQueuedEdielMessage(params: {
  actorUserId?: string | null
  edielMessageId: string
  smtpMimeMode?: EdielSmtpMimeMode | string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) {
    throw new Error('Ediel-meddelandet hittades inte')
  }

  if (message.direction !== 'outbound') {
    throw new Error(`Meddelande ${message.id} är inte outbound.`)
  }

  if (message.status === 'draft') {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: 'queued',
    })
  } else if (message.status !== 'queued' && message.status !== 'prepared') {
    throw new Error(
      `Meddelande ${message.id} kan inte skickas från status ${message.status}.`
    )
  }

  await sendEdielMessageViaSmtp(message, {
    actorUserId,
    smtpMimeMode: 'ediel-singlepart-base64',
  })

  const refreshed = await getEdielMessageById(message.id)
  if (!refreshed) {
    throw new Error('Kunde inte läsa tillbaka skickat meddelande.')
  }

  return refreshed
}

export async function prepareManualProdatMessage(params: {
  actorUserId: string
  switchRequestId: string
  messageCode: 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10'
  communicationRouteId?: string | null
}) {
  if (params.messageCode === 'Z03') {
    return prepareAndQueueEdielZ03({
      actorUserId: params.actorUserId,
      switchRequestId: params.switchRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  if (params.messageCode === 'Z04') {
    return prepareAndQueueEdielZ04({
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

  if (params.messageCode === 'Z06') {
    return prepareAndQueueEdielZ06({
      actorUserId: params.actorUserId,
      switchRequestId: params.switchRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  if (params.messageCode === 'Z09') {
    return prepareAndQueueEdielZ09({
      actorUserId: params.actorUserId,
      switchRequestId: params.switchRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  return prepareAndQueueEdielZ10({
    actorUserId: params.actorUserId,
    switchRequestId: params.switchRequestId,
    communicationRouteId: params.communicationRouteId ?? null,
  })
}

export async function prepareManualUtiltsMessage(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  messageCode: 'E66' | 'E73'
  communicationRouteId?: string | null
}) {
  if (params.messageCode === 'E66') {
    return prepareAndQueueUtiltsE66({
      actorUserId: params.actorUserId,
      gridOwnerDataRequestId: params.gridOwnerDataRequestId,
      communicationRouteId: params.communicationRouteId ?? null,
    })
  }

  return prepareAndQueueUtiltsE73({
    actorUserId: params.actorUserId,
    gridOwnerDataRequestId: params.gridOwnerDataRequestId,
    communicationRouteId: params.communicationRouteId ?? null,
  })
}

export async function inspectManualRouteRuntime(params: {
  requestType: 'supplier_switch' | 'meter_values' | 'billing_underlay'
  gridOwner?: { id?: string | null; name?: string | null; ediel_id?: string | null } | null
  preferredRouteId?: string | null
}) {
  return resolveCanonicalOutboundContext({
    requestType: params.requestType,
    gridOwner: params.gridOwner ?? null,
    preferredRouteId: params.preferredRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })
}

export async function createAckDraftAndPersist(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}) {
  return createAckForSourceMessage(params)
}

export function buildAckDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckDraftForSource(params)
}