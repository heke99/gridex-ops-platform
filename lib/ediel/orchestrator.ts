// lib/ediel/orchestrator.ts

import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import {
  buildAckDraftForSource,
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
} from '@/lib/ediel/ack'
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
import {
  prepareAndQueueAiList,
} from '@/lib/ediel/flows/aiListFlow'
import {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
} from '@/lib/ediel/flows/prodatSwitch'
import {
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
} from '@/lib/ediel/flows/utiltsDataRequest'

export type {
  AckFamily,
  AckOutcome,
  AckPolicy,
  EdielCanonicalAckState,
}

export {
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
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

export async function createAckForSourceMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}) {
  const draft = buildAckDraftForSource({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
  })

  return createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft,
  })
}

export async function createAutomaticAcksForInboundMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  negativeAperakText?: string | null
  utiltsErrText?: string | null
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
}) {
  return createAckForSourceMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: 'APERAK',
    outcome: 'negative',
    messageText: params.messageText ?? null,
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

/**
 * Legacy-stabil public helper.
 * Behåll denna tunn så att admin/actions och UI inte behöver veta
 * om underliggande ack/create nu går via core/kernel.
 */
export async function createAckDraftAndPersist(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}) {
  return createAckForSourceMessage(params)
}

/**
 * Tunn samlingspunkt om någon caller fortfarande förväntar sig att
 * orchestratorn ska kunna skapa generiska draftar.
 */
export function buildAckDraft(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
}): CreateEdielMessageInput {
  return buildAckDraftForSource(params)
}