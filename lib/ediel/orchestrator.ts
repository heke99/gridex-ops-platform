import {createHash} from 'node:crypto'
import {requireEdielSendActionAccess} from '@/lib/ediel/actionAccess'
import {assertUserCanOperateCompany} from '@/lib/tenant/scope'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {getEdielRouteProfileByCommunicationRouteId} from '@/lib/ediel/db'
import {evaluateEdielRouteContract} from '@/lib/ediel/outbox/routeContract'
import {evaluateControlledLiveReadiness, type ControlledLiveInput} from '@/lib/ediel/transport/controlledLiveReadiness'
import {SmtpDeliveryUncertainError, isSmtpDeliveryUncertain} from '@/lib/ediel/transport/smtpOutcome'
import type {AcceptedEdielTransportProjection} from '@/lib/ediel/transport/acceptedProjection'

import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft'
import {readFreshEdielSendValidationSources} from '@/lib/ediel/production/sendValidationSources'
import {loadRecoveryReportingValidationContext} from '@/lib/ediel/recovery/reportingContext'
import {resolveSourceQualifiedNegativeFixtureForMessage, sourceQualifiedNegativeFixtureAllowsPreflight} from '@/lib/ediel/testing/negativeFixtureAuthority'
import {loadTgtReportingValidationContext} from '@/lib/ediel/testing/tgtReportingPermissionContext'
import {loadProdatDateEventValidationContext} from '@/lib/ediel/production/dateEventContext'
import {loadServiceReportingValidationContext} from '@/lib/ediel/services/reporting'
import {readAcceptedEdielTransportProjection} from '@/lib/ediel/transport/acceptedProjection'
import {repairAcceptedEdielMessageProjection} from '@/lib/ediel/transport/acceptedProjectionRepair'
import {projectSentEdielSourceState} from '@/lib/ediel/outbox/projectSentSources'
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
export { prepareAndQueueProductionContractZ09 } from '@/lib/ediel/flows/prodatProductionContract'
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
import { supabaseService } from '@/lib/supabase/service'

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
  if(!params.actorUserId)throw new Error('ediel_tenant_actor_required')
  const prepared=await prepareSourceAckDraft({...params,actorUserId:params.actorUserId})
  if(prepared.kind==='existing')return prepared.message
  const draft=prepared.draft

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
  controlledBinding?: {
    readonly messageSnapshot: string
    readonly routeProfileSnapshot: string
    readonly certificateId: string
    readonly certificateFingerprint: string
  }
}) {
  const controlledBinding = params.controlledBinding ? structuredClone(params.controlledBinding) : null
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) {
    throw new Error('Ediel-meddelandet hittades inte')
  }
  if (controlledBinding && JSON.stringify(message) !== controlledBinding.messageSnapshot) {
    throw new Error('ops04_controlled_message_binding_changed')
  }

  if (message.direction !== 'outbound') {
    throw new Error(`Meddelande ${message.id} är inte outbound.`)
  }

  if (!message.company_id) throw new Error('ediel_transport_company_required')
  const established = await readAcceptedEdielTransportProjection({ companyId: message.company_id,
    environment: message.environment, actorUserId, messageId: message.id })
  if (established) {
    const repaired = await repairAcceptedEdielMessageProjection({ message, actorUserId, projection: established })
    await projectSentEdielSourceState({ message, actorUserId, sentAt: repaired.observedAt })
    return await getEdielMessageById(message.id, { companyId: message.company_id }) ?? message
  }
  if (['provider_accepted','sent','delivered','acknowledged'].includes(String(message.status))) {
    throw new Error('ediel_historical_transport_receipt_unavailable')
  }

  const sourceContext=await readFreshEdielSendValidationSources(message,actorUserId)
  const dateEventContext=await loadProdatDateEventValidationContext(message,actorUserId)
  const recoveryReporting = await loadRecoveryReportingValidationContext(message, actorUserId)
  const reportingContext=recoveryReporting?.status === 'qualified' ? recoveryReporting.context : message.parsed_payload?.sourcePermissionBasis
    ? await loadServiceReportingValidationContext(message,actorUserId)
    : await loadTgtReportingValidationContext(message)
  const preflight = preflightEdielMessageRow(message, 'send',dateEventContext,reportingContext,sourceContext.ackSourceQualification,sourceContext.deathStatusContext,sourceContext.prodatCommonHeaderRejectionEvidence,sourceContext.customerMasterdataContext)
  const negativeFixture = await resolveSourceQualifiedNegativeFixtureForMessage({message, actorUserId})
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

  if (preflight.blocking && !sourceQualifiedNegativeFixtureAllowsPreflight({message, preflight, qualification: negativeFixture})) {
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
  })

  await sendEdielMessageViaSmtp(message, {
    actorUserId,
    smtpMimeMode: sendConsistency.resolvedSmtpMimeMode,
    controlledBinding: controlledBinding ?? undefined,
  })

  // Outbox/direct-send bridge: the message was just sent over SMTP outside the
  // outbox worker. Any open ediel_outbox row for the same message must be
  // superseded so the cron can never send the message a second time.
  try {
    const { data: supersededRows, error: supersededError } = await supabaseService
      .from('ediel_outbox')
      .update({
        status: 'superseded',
        last_error: 'Superseded: meddelandet skickades direkt (manuellt/AGT) utanför outbox-kön.',
        updated_at: new Date().toISOString(),
        updated_by: actorUserId,
      })
      .eq('ediel_message_id', message.id)
      .in('status', ['draft', 'prepared', 'queued', 'sending'])
      .select('id')

    if (!supersededError && Array.isArray(supersededRows) && supersededRows.length > 0) {
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'info',
        message: 'Öppna outbox-poster markerades som superseded efter direkt skick.',
        payload: {
          phase: 'direct_send_outbox_bridge',
          supersededOutboxIds: supersededRows.map((row) => (row as { id?: unknown }).id ?? null),
        },
      }).catch(() => null)
    }
  } catch (bridgeError) {
    // SMTP may already have been accepted. Never throw into a caller that could
    // retry the direct send; the outbox worker also checks the message's
    // terminal transport status before sending. Surface the reconciliation
    // failure loudly so operations can repair the projection.
    console.error('[ediel] direct-send outbox reconciliation failed', {
      edielMessageId: message.id,
      companyId: message.company_id ?? null,
      error: bridgeError,
    })
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: 'Direktskick lyckades men outbox-projektionen kunde inte verifieras.',
      payload: {
        phase: 'direct_send_outbox_bridge',
        reconciliationRequired: true,
        error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
      },
    }).catch((eventError) => {
      console.error('[ediel] failed to persist direct-send reconciliation event', {
        edielMessageId: message.id,
        error: eventError,
      })
    })
  }

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
  }).catch((exchangeLogError) => {
    console.error('[ediel] SMTP accepted but exchange log persistence failed', {
      edielMessageId: message.id,
      companyId: message.company_id ?? null,
      error: exchangeLogError,
    })
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
  requestType: 'supplier_switch' | 'customer_masterdata' | 'meter_values' | 'billing_underlay'
  gridOwner?: { id?: string | null; name?: string | null; ediel_id?: string | null } | null
  preferredRouteId?: string | null
  companyId: string
}) {
  return resolveCanonicalOutboundContext({
    requestType: params.requestType,
    gridOwner: params.gridOwner ?? null,
    preferredRouteId: params.preferredRouteId ?? null,
    companyId: params.companyId,
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

// masterplan: OPS-04, AT-OPS-04
export type ControlledLiveExecution = {
  status: 'held' | 'already_observed' | 'transport_observed'
  messageId: string | null
  observedAt: string | null
  productionApproved: false
  reasons: string[]
}

function controlledExecutionHeld(messageId: string | null, reasons: string[]): ControlledLiveExecution {
  return {status: 'held', messageId, observedAt: null, productionApproved: false, reasons}
}

function controlledObservationMatches(observation: AcceptedEdielTransportProjection, message: EdielMessageRow): boolean {
  const recipient = message.receiver_email?.trim().toLowerCase()
  return Boolean(recipient && observation.originalHash === createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex')
    && observation.frozenRecipient?.trim().toLowerCase() === recipient
    && observation.deliveryProven === false && observation.authorizesProviderEntry === false
    && Array.isArray(observation.providerReceipt?.accepted) && observation.providerReceipt.accepted.length > 0
    && observation.providerReceipt.accepted.every(value => typeof value === 'string' && value.trim().toLowerCase() === recipient)
    && Array.isArray(observation.providerReceipt.rejected) && observation.providerReceipt.rejected.length === 0)
}

/** Explicit release-runbook entrypoint. Operator incident/agreement/mandate and
 * relay references are attestations, not externally issued approval. Actual
 * session/tenant, stored message and current route facts remain separate gates.
 * One accepted transport observation never proves delivery or market approval. */
export async function sendControlledLiveEdielMessage(input: ControlledLiveInput): Promise<ControlledLiveExecution> {
  // Capture caller-owned dates/arrays before the first asynchronous boundary.
  let packet: ControlledLiveInput
  try { packet = structuredClone(input) }
  catch { return controlledExecutionHeld(null, ['ops04_input_invalid']) }
  if (!packet || typeof packet.tenantId !== 'string' || !packet.tenantId.trim()
    || !['test', 'production'].includes(packet.environment) || !packet.plan
    || !['single_controlled', 'bulk_import'].includes(packet.plan.source)
    || !Array.isArray(packet.plan.references) || !packet.plan.references.every(value => typeof value === 'string')
    || packet.certificate && typeof packet.certificate.revoked !== 'boolean'
    || packet.route && (!Array.isArray(packet.route.permittedCertificateFingerprints)
      || !packet.route.permittedCertificateFingerprints.every(value => typeof value === 'string'))) {
    return controlledExecutionHeld(null, ['ops04_input_invalid'])
  }
  const messageId = packet.plan.references.length === 1 ? packet.plan.references[0] : null
  const currentVerdict = () => {
    try { return evaluateControlledLiveReadiness({...packet, now: new Date()}) }
    catch { return null }
  }
  const context = await requireEdielSendActionAccess()
  if (typeof context.userId !== 'string' || !context.userId.trim()) throw new Error('ops04_authenticated_actor_required')
  await assertUserCanOperateCompany(context.userId, packet.tenantId)
  await assertEdielTenantActor({companyId: packet.tenantId, actorUserId: context.userId,
    permissionAnyOf: ['ediel.send', 'communication.send']})
  const verdict = currentVerdict()
  if (!verdict) return controlledExecutionHeld(messageId, ['ops04_input_invalid'])
  if (!verdict.ready) return controlledExecutionHeld(messageId, verdict.reasons)
  if (!messageId || !packet.route || !packet.profile || !packet.certificate) {
    return controlledExecutionHeld(messageId, ['ops04_single_bound_message_required'])
  }

  const message = await getEdielMessageById(messageId, {companyId: packet.tenantId})
  if (!message || message.id !== messageId || message.company_id !== packet.tenantId
    || message.direction !== 'outbound' || message.environment !== packet.environment
    || message.communication_route_id !== packet.route.id) {
    return controlledExecutionHeld(messageId, ['ops04_stored_message_scope_mismatch'])
  }
  const [profile, routeContract] = await Promise.all([
    getEdielRouteProfileByCommunicationRouteId(packet.route.id, {companyId: packet.tenantId}),
    evaluateEdielRouteContract(message),
  ])
  if (!profile || profile.company_id !== packet.tenantId || profile.id !== packet.profile.id
    || profile.communication_route_id !== packet.route.id || profile.is_enabled !== true || profile.is_active === false) {
    return controlledExecutionHeld(messageId, ['ops04_stored_profile_scope_mismatch'])
  }
  // counterpartyId is the configured party UUID, never an inferred Ediel-id.
  if (!profile.party_id || profile.party_id !== packet.route.counterpartyId) {
    return controlledExecutionHeld(messageId, ['ops04_stored_counterparty_mismatch'])
  }
  const fingerprint = (value: string) => value.replace(/[:\s]/g, '').toLowerCase()
  if (!routeContract.ok || routeContract.routeId !== packet.route.id
    || !routeContract.certificateId || !routeContract.certificateFingerprint
    || fingerprint(routeContract.certificateFingerprint) !== fingerprint(packet.certificate.fingerprint)) {
    return controlledExecutionHeld(messageId, ['ops04_current_route_or_certificate_mismatch'])
  }
  const controlledBinding = {
    messageSnapshot: JSON.stringify(message),
    routeProfileSnapshot: JSON.stringify(profile),
    certificateId: routeContract.certificateId,
    certificateFingerprint: fingerprint(routeContract.certificateFingerprint),
  }
  const scope = {companyId: packet.tenantId, environment: packet.environment, actorUserId: context.userId, messageId}
  const historical = await readAcceptedEdielTransportProjection(scope)
  if (historical) {
    if (!controlledObservationMatches(historical, message)) {
      return controlledExecutionHeld(messageId, ['ops04_historical_transport_binding_mismatch'])
    }
    return {status: 'already_observed', messageId, observedAt: historical.observedAt, productionApproved: false, reasons: []}
  }
  if (isProductionShadowMessage(message)) {
    return controlledExecutionHeld(messageId, ['ops04_shadow_is_not_controlled_transport'])
  }
  // All controller preparation waits precede this real fresh-clock check.
  const finalVerdict = currentVerdict()
  if (!finalVerdict) return controlledExecutionHeld(messageId, ['ops04_input_invalid'])
  if (!finalVerdict.ready) return controlledExecutionHeld(messageId, finalVerdict.reasons)
  let sent: EdielMessageRow
  try {
    // This is the same source/capability/context/security/journal-fenced sender
    // used by ordinary operator actions. No batch, new provider path or retry.
    sent = await sendQueuedEdielMessage({actorUserId: context.userId, edielMessageId: messageId, controlledBinding})
  } catch (error) {
    if (isSmtpDeliveryUncertain(error)) throw error
    // A later bookkeeping failure may follow an accepted provider observation.
    // If that read itself fails, an unknown outcome cannot authorize a resend.
    let accepted: AcceptedEdielTransportProjection | null
    try { accepted = await readAcceptedEdielTransportProjection(scope) }
    catch (readError) { throw new SmtpDeliveryUncertainError(readError) }
    if (accepted) throw new SmtpDeliveryUncertainError(error, accepted.providerReceipt?.messageId ?? null)
    throw error
  }
  if (sent.id !== messageId || sent.company_id !== packet.tenantId || sent.environment !== packet.environment
    || sent.communication_route_id !== message.communication_route_id || sent.raw_payload !== message.raw_payload
    || sent.receiver_email !== message.receiver_email) {
    throw new SmtpDeliveryUncertainError(new Error('ops04_sender_readback_binding_mismatch'))
  }
  let observed: AcceptedEdielTransportProjection | null
  try { observed = await readAcceptedEdielTransportProjection(scope) }
  catch (error) { throw new SmtpDeliveryUncertainError(error) }
  if (!observed) {
    throw new SmtpDeliveryUncertainError(new Error('ops04_accepted_observation_missing'))
  }
  if (!controlledObservationMatches(observed, message)) {
    throw new SmtpDeliveryUncertainError(new Error('ops04_observed_transport_binding_mismatch'), observed.providerReceipt?.messageId ?? null)
  }
  return {status: 'transport_observed', messageId, observedAt: observed.observedAt, productionApproved: false, reasons: []}
}
