// lib/ediel/orchestrator.ts

import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import {
  buildAckDraftForSource,
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
  type EdielAperakApplicationError,
  type EdielAckScope,
} from '@/lib/ediel/ack'
import { createEdielMessageEvent, getEdielMessageById, updateEdielMessageStatus } from '@/lib/ediel/db'
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
  prepareAndQueueEdielZ13,
  prepareAndQueueEdielZ14,
  prepareAndQueueEdielZ15,
  prepareAndQueueEdielZ18,
} from '@/lib/ediel/flows/prodatSwitch'
import {
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
} from '@/lib/ediel/flows/utiltsDataRequest'
import { sendEdielMessageViaSmtp, type EdielSmtpMimeMode } from '@/lib/ediel/transport'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder'
import { evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'
import { assertCompanyCanSendProductionEdiel } from '@/lib/ediel/productionReadiness'
import { isProductionShadowMessage, markProductionShadowPrepared } from '@/lib/ediel/productionShadow'
import { recordEdielExchangeLog } from '@/lib/ediel/operations/exchangeLog'
import { assertEdielSendContextConsistency } from '@/lib/ediel/sendContextConsistency'

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
  prepareAndQueueEdielZ13,
  prepareAndQueueEdielZ14,
  prepareAndQueueEdielZ15,
  prepareAndQueueEdielZ18,
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
  ackScope?: EdielAckScope | null
  relatedTransactionReference?: string | null
}) {
  const draft = buildAckDraftForSource({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    messageText: params.messageText ?? null,
    applicationErrors: params.applicationErrors ?? null,
    ackScope: params.ackScope ?? null,
    relatedTransactionReference: params.relatedTransactionReference ?? null,
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
  ackScope?: EdielAckScope | null
  relatedTransactionReference?: string | null
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
    ackScope: params.ackScope ?? null,
    relatedTransactionReference: params.relatedTransactionReference ?? null,
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

  const alreadyFinalStatus = ['sent', 'acknowledged', 'validated'].includes(
    String(message.status ?? '').toLowerCase()
  )
  if (alreadyFinalStatus) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'success',
      message: 'Meddelandet är redan slutligt skickat/kvitterat. Ingen omsändning gjordes.',
      payload: {
        idempotency: 'already_sent_success',
        status: message.status,
        phase: 'send_queued_ediel_message',
      },
    }).catch(() => null)
    return message
  }

  const preflight = preflightEdielMessageRow(message, 'send')
  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: preflight.blocking ? 'error' : preflight.issues.length > 0 ? 'warning' : 'success',
    message: preflight.blocking
      ? 'Payload preflight blockerade utskick.'
      : 'Payload preflight godkändes före utskick.',
    payload: {
      batch: '2.5B.1',
      family: preflight.family,
      code: preflight.code,
      segmentCount: preflight.segmentCount,
      declaredUntCount: preflight.declaredUntCount,
      declaredUnzCount: preflight.declaredUnzCount,
      payloadSizeBytes: preflight.payloadSizeBytes,
      issues: preflight.issues,
      markers: preflight.markers,
    },
  }).catch(() => null)

  const sendLock = evaluateEdielProductionSendLock(message, preflight)
  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: sendLock.status === 'blocked' ? 'error' : sendLock.status === 'warning' ? 'warning' : 'success',
    message: sendLock.status === 'blocked'
      ? 'Live-send blockerades av production send-lock.'
      : sendLock.status === 'warning'
        ? 'Production send-lock passerade med varning.'
        : 'Production send-lock godkänd.',
    payload: {
      batch: '2.5D-1',
      environment: message.environment,
      status: sendLock.status,
      issues: sendLock.issues,
    },
  }).catch(() => null)

  if (sendLock.locked) {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: 'failed',
      failureReason: sendLock.issues
        .filter((issue) => issue.severity === 'blocked')
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join(' | '),
      failedAt: new Date().toISOString(),
      validationReport: {
        ...(message.validation_report ?? {}),
        payloadPreflight: preflight,
        productionSendLock: sendLock,
      },
    })
    throw new Error('Meddelandet stoppades av production send-lock och skickades inte.')
  }

  if (message.environment === 'production') {
    if (!message.company_id) {
      throw new Error('Produktionsmeddelande saknar company_id och kan inte skickas tenant-säkert.')
    }

    try {
      await assertCompanyCanSendProductionEdiel({
        actorUserId,
        companyId: message.company_id,
        message,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'error',
        message: `Production outbound guard blockerade skick: ${errorMessage}`,
        payload: {
          phase: 'production_outbound_guard',
          environment: message.environment,
          communicationRouteId: message.communication_route_id,
          errorMessage,
        },
      }).catch(() => null)
      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: 'failed',
        failureReason: errorMessage,
        failedAt: new Date().toISOString(),
        validationReport: {
          ...(message.validation_report ?? {}),
          payloadPreflight: preflight,
          productionSendLock: sendLock,
          productionOutboundGuard: {
            status: 'blocked',
            errorMessage,
          },
        },
      })
      throw error
    }
  }

  if (preflight.blocking) {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: 'failed',
      failureReason: preflight.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${issue.code}: ${issue.description}`)
        .join(' | '),
      failedAt: new Date().toISOString(),
      validationReport: {
        ...(message.validation_report ?? {}),
        payloadPreflight: preflight,
      },
    })
    throw new Error('Meddelandet stoppades av payload preflight och skickades inte.')
  }

  if (isProductionShadowMessage(message)) {
    await markProductionShadowPrepared({
      actorUserId,
      message,
    })
    const refreshed = await getEdielMessageById(message.id)
    if (!refreshed) {
      throw new Error('Kunde inte läsa tillbaka shadow-förberett meddelande.')
    }
    return refreshed
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

  const sendConsistency = await assertEdielSendContextConsistency({
    message,
    actorUserId,
    smtpMimeModeOverride: params.smtpMimeMode,
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: 'Ediel send context verifierades före SMTP-skick.',
    payload: {
      phase: 'send_context_consistency',
      selectedEncryptionMode: sendConsistency.selectedEncryptionMode,
      resolvedEncryptionMode: sendConsistency.resolvedEncryptionMode,
      resolvedSmtpMimeMode: sendConsistency.resolvedSmtpMimeMode,
      linkedTestRunIds: sendConsistency.linkedTestRunIds,
      routeProfileId: sendConsistency.routeProfileId,
      communicationRouteId: sendConsistency.communicationRouteId,
    },
  }).catch(() => null)

  await sendEdielMessageViaSmtp(message, {
    actorUserId,
    smtpMimeMode: sendConsistency.resolvedSmtpMimeMode,
  })

  await recordEdielExchangeLog({
    companyId: message.company_id ?? null,
    environmentType: message.environment === 'production' ? 'production' : 'agt_test',
    edielMessageId: message.id,
    routeProfileId: message.communication_route_id ?? null,
    direction: 'outbound',
    exchangeKind: 'smtp_send',
    rawPayload: message.raw_payload ?? null,
    senderEdielId: message.sender_ediel_id ?? null,
    receiverEdielId: message.receiver_ediel_id ?? null,
    interchangeReference: message.interchange_reference ?? null,
    messageReference: message.message_reference ?? null,
    messageType: message.message_family ?? null,
    businessCode: message.message_code ?? null,
    ackStatus: message.ack_status ?? null,
    metadata: {
      smtpMimeMode: params.smtpMimeMode ?? null,
      resolvedSmtpMimeMode: sendConsistency.resolvedSmtpMimeMode,
      selectedEncryptionMode: sendConsistency.selectedEncryptionMode,
      resolvedEncryptionMode: sendConsistency.resolvedEncryptionMode,
      linkedTestRunIds: sendConsistency.linkedTestRunIds,
      routeProfileId: sendConsistency.routeProfileId,
      statusBeforeSend: message.status,
    },
    actorUserId,
  }).catch(() => null)

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
  requestType: 'supplier_switch' | 'customer_masterdata' | 'meter_values' | 'billing_underlay'
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
export { runInboundEdielOrchestrator, inspectInboundEdielAutomation } from '@/lib/ediel/orchestrator/inboundOrchestrator'
export { analyzeEdielProcessingPipeline, recordDecisionTrace } from '@/lib/ediel/orchestrator/edielProcessingPipeline'
export { runAutoAckOrchestratorForInboundMessage } from '@/lib/ediel/orchestrator/autoAckOrchestrator'
export { processEdielOutbox, sendOutboxItem, createOutboxItem, supersedeWrongDraftsForDecision } from '@/lib/ediel/orchestrator/outboxProcessor'
export { createAckTimersForMessage, buildAckTimerPlan } from '@/lib/ediel/sla/createAckTimers'
export { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
export { parsePortalValidationReport, portalValidationReportStorageRows } from '@/lib/ediel/portal/parsePortalValidationReport'