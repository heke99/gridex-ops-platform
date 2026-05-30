// lib/ediel/flows/inboundProcessing.ts

import { createEdielMessageEvent, getEdielMessageById, getEdielRouteProfileByCommunicationRouteId, listAckMessagesForSource, listEdielMessagesByIds } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'
import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller'
import { ensureActorUserId } from '@/lib/ediel/flows/shared'
import {
  createSupplierSwitchEvent,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  findMatchingSupplierSwitchRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import { linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'
import { buildContrlDraft, buildAperakDraft, buildUtiltsErrDraft, getAutomaticAckPolicy, getCanonicalAckState, type EdielAperakApplicationError } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { syncActorTestingForMessage } from '@/lib/ediel/actorTestingEngine'
import { EDIEL_AGT_PORTAL_EDIEL_ID } from '@/lib/ediel/agtRegistry'
import { resolveCanonicalRuntimeDecision, type CanonicalRuntimeDecision, type CanonicalResponsePlanItem } from '@/lib/ediel/core/runtimeDecision'
import { buildSafeMasterdataProposal } from '@/lib/ediel/operationalVerification'
import { createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'
import {
  applyInboundProdatZ02ToCustomerInfoRequest,
  applyInboundProdatZ14ToMeteringPermission,
} from '@/lib/onboarding/inboundEdielLinking'
import { resolveInboundTenantForMessage } from '@/lib/ediel/core/tenantResolver'

function shouldProcessInboundMessage(message: EdielMessageRow): boolean {
  return (
    isActiveEdielMessageFamily(message.message_family) &&
    message.direction === 'inbound' &&
    message.message_standard === 'edifact' &&
    message.status !== 'cancelled'
  )
}

function hasInboundAckParties(message: EdielMessageRow): boolean {
  return Boolean(message.sender_ediel_id?.trim() && message.receiver_ediel_id?.trim())
}

async function createAckBlockedEvent(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  reason: string
  details?: Record<string, unknown>
}) {
  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: `${params.ackFamily} skapades inte: ${params.reason}`,
    payload: {
      blockedBy: 'canonical_inbound_ack_guard',
      ackFamily: params.ackFamily,
      sourceMessageId: params.sourceMessage.id,
      messageFamily: params.sourceMessage.message_family,
      messageCode: params.sourceMessage.message_code,
      status: params.sourceMessage.status,
      senderEdielId: params.sourceMessage.sender_ediel_id,
      receiverEdielId: params.sourceMessage.receiver_ediel_id,
      ...params.details,
    },
  })
}

async function createAckIfMissing(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string | null
  applicationErrors?: readonly EdielAperakApplicationError[] | null
}) {
  const draft =
    params.ackFamily === 'CONTRL'
      ? buildContrlDraft({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          outcome: params.outcome ?? 'positive',
          messageText: params.messageText ?? null,
        })
      : params.ackFamily === 'APERAK'
        ? buildAperakDraft({
            actorUserId: params.actorUserId,
            sourceMessage: params.sourceMessage,
            outcome: params.outcome ?? 'positive',
            messageText: params.messageText ?? null,
            applicationErrors: params.applicationErrors ?? null,
          })
        : buildUtiltsErrDraft({
            actorUserId: params.actorUserId,
            sourceMessage: params.sourceMessage,
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

async function readCanonicalAckSnapshot(sourceMessageId: string) {
  const source = await getEdielMessageById(sourceMessageId)
  const ackMessages = await listAckMessagesForSource({ sourceMessageId })

  return {
    canonicalAckState: source ? getCanonicalAckState(source) : null,
    ackMessages: ackMessages.map((row) => ({
      id: row.id,
      family: row.message_family,
      code: row.message_code,
      status: row.status,
      functionalCheckStatus: row.functional_check_status,
      syntaxCheckStatus: row.syntax_check_status,
    })),
  }
}

function isActorTestingInboundCandidate(message: EdielMessageRow): boolean {
  const sender = String(message.sender_ediel_id ?? '').trim()
  const receiver = String(message.receiver_ediel_id ?? '').trim()
  const parsed = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}
  const fileEngine = parsed.fileEngine as { mode?: unknown } | undefined

  return (
    message.direction === 'inbound' &&
    message.environment === 'test' &&
    (
      sender === EDIEL_AGT_PORTAL_EDIEL_ID ||
      receiver === EDIEL_AGT_PORTAL_EDIEL_ID ||
      fileEngine?.mode === 'agt' ||
      report.fileEngineMode === 'agt'
    )
  )
}

async function syncActorTestingGlobally(params: {
  actorUserId: string
  message: EdielMessageRow
  phase: 'pre_business_processing' | 'post_ack_processing' | 'post_generic_processing'
  autoRespond?: boolean
  autoSend?: boolean
}): Promise<boolean> {
  if (!isActorTestingInboundCandidate(params.message)) return false

  try {
    const synced = await syncActorTestingForMessage({
      actorUserId: params.actorUserId,
      edielMessage: params.message,
      autoRespond: params.autoRespond,
      autoSend: params.autoSend,
    })

    if (!synced) return false

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'linked',
      eventStatus: 'success',
      message: 'Meddelandet synkades automatiskt till Aktörstest & Produktionssättning.',
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        companyId: synced.companyId,
        testKey: synced.testKey,
        status: synced.status,
        createdAckMessageIds: synced.createdAckMessages.map((message) => message.id),
      },
    })

    return true
  } catch (error) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Aktörstest-synk kunde inte köras automatiskt för inbound-meddelandet.',
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => null)

    return false
  }
}


function canonicalResponsePlanFromMessage(message: EdielMessageRow): CanonicalResponsePlanItem[] {
  const report = message.validation_report ?? {}
  const direct = report.responsePlan
  const nested = (report.canonicalRuntime as { responsePlan?: unknown } | undefined)?.responsePlan
  const candidate = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : []
  return candidate.filter((item): item is CanonicalResponsePlanItem => {
    if (!item || typeof item !== 'object') return false
    const family = (item as { family?: unknown }).family
    return family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR'
  })
}

function responsePlanItemFor(message: EdielMessageRow, family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'): CanonicalResponsePlanItem | null {
  return canonicalResponsePlanFromMessage(message).find((item) => item.family === family) ?? null
}

async function applyCanonicalRuntimeDecision(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<{ message: EdielMessageRow; decision: CanonicalRuntimeDecision }> {
  const decision = resolveCanonicalRuntimeDecision(params.message)
  const now = new Date().toISOString()
  const mergedParsedPayload = {
    ...(params.message.parsed_payload ?? {}),
    canonical: decision.parsedPayload,
  }
  const mergedValidationReport = {
    ...(params.message.validation_report ?? {}),
    canonicalRuntime: decision.validationReport,
    canonicalRuntimeVersion: '2.5B',
    syntaxDecision: decision.syntaxDecision,
    applicationDecision: decision.applicationDecision,
    functionalDecision: decision.functionalDecision,
    responsePlan: decision.responsePlan,
    decisionTrace: decision.decisionTrace,
    sourceRules: decision.sourceRules,
  }

  const nextStatus = decision.syntaxDecision === 'rejected' ? 'failed' : 'validated'
  const failureReason = decision.syntaxDecision === 'rejected'
    ? decision.issues.filter((item) => item.layer === 'syntax' && item.severity === 'error').map((item) => item.description).join(' | ') || 'EDIFACT syntaxfel.'
    : undefined

  const updated = await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: nextStatus,
    parsedPayload: mergedParsedPayload,
    validationReport: mergedValidationReport,
    parsedAt: params.message.parsed_at ?? now,
    validatedAt: now,
    failedAt: nextStatus === 'failed' ? now : undefined,
    failureReason,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'validated',
    eventStatus: decision.syntaxDecision === 'rejected' || decision.applicationDecision === 'rejected' || decision.functionalDecision === 'rejected' ? 'warning' : 'success',
    message: 'Canonical Ediel Runtime Engine kördes för inbound-meddelandet.',
    payload: {
      batch: '2.5B',
      family: decision.canonical.family,
      messageCode: decision.canonical.messageCode,
      processGroup: decision.canonical.processGroup,
      syntaxDecision: decision.syntaxDecision,
      applicationDecision: decision.applicationDecision,
      functionalDecision: decision.functionalDecision,
      responsePlan: decision.responsePlan,
      issueCount: decision.issues.length,
      sourceRules: decision.sourceRules,
      decisionTrace: decision.decisionTrace,
    },
  })

  return { message: updated, decision }
}

async function createAutomaticPositiveAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
}) {
  const createdIds: string[] = []
  const policy = await getAutomaticAckPolicy(params.sourceMessage)

  if ((policy.shouldSendContrl || policy.shouldSendPositiveAperak) && !hasInboundAckParties(params.sourceMessage)) {
    await createAckBlockedEvent({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: policy.shouldSendContrl ? 'CONTRL' : 'APERAK',
      reason: 'inbound sender/receiver saknas. Meddelandet kvitteras inte automatiskt.',
      details: {
        shouldSendContrl: policy.shouldSendContrl,
        shouldSendPositiveAperak: policy.shouldSendPositiveAperak,
      },
    })
    return createdIds
  }

  const contrlPlan = responsePlanItemFor(params.sourceMessage, 'CONTRL')
  if (policy.shouldSendContrl || contrlPlan) {
    try {
      const contrl = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'CONTRL',
        outcome: contrlPlan?.outcome === 'negative' ? 'negative' : 'positive',
        messageText: contrlPlan?.reason ?? 'Automatiskt CONTRL.',
      })
      createdIds.push(contrl.id)
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'CONTRL',
        reason: error instanceof Error ? error.message : 'Okänt fel vid CONTRL-skapande.',
      })
    }
  }

  const utiltsErrPlan = responsePlanItemFor(params.sourceMessage, 'UTILTS_ERR')
  if (utiltsErrPlan) {
    try {
      const utiltsErr = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'UTILTS_ERR',
        outcome: 'negative',
        messageText: utiltsErrPlan.reason,
      })
      createdIds.push(utiltsErr.id)
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'UTILTS_ERR',
        reason: error instanceof Error ? error.message : 'Okänt fel vid UTILTS_ERR-skapande.',
      })
    }

    return createdIds
  }

  const aperakPlan = responsePlanItemFor(params.sourceMessage, 'APERAK')
  const shouldSendAperakFromPlan = aperakPlan?.outcome === 'negative'
  if (policy.shouldSendPositiveAperak || shouldSendAperakFromPlan) {
    try {
      const aperak = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'APERAK',
        outcome: aperakPlan?.outcome === 'negative' ? 'negative' : 'positive',
        messageText: aperakPlan?.reason ?? 'Automatiskt APERAK.',
        applicationErrors: aperakPlan?.applicationErrors ?? null,
      })
      createdIds.push(aperak.id)
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'APERAK',
        reason: error instanceof Error ? error.message : 'Okänt fel vid APERAK-skapande.',
      })
    }
  }

  return createdIds
}

async function linkInboundProdatMessageCanonically(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const meteringPointId = await matchMeteringPointForEdielMessage(params.message)
  const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({
    meteringPointId,
    companyId: params.message.company_id ?? null,
  })
  const matchedSwitch = await findMatchingSupplierSwitchRequest(params.message)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    switchRequestId: matchedSwitch?.id ?? null,
    customerId: siteAndCustomer?.customerId ?? null,
    siteId: siteAndCustomer?.siteId ?? null,
    meteringPointId,
    gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
    relatedMessageId: null,
  })

  return {
    meteringPointId,
    siteAndCustomer,
    matchedSwitch,
  }
}

async function processInboundProdatMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const canonicalLinks = await linkInboundProdatMessageCanonically({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: 'parsed',
    parsedPayload: params.message.parsed_payload ?? {},
  })

  const inboundCase = await createOrUpdateInboundProdatCase({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  const customerInfoLink = await applyInboundProdatZ02ToCustomerInfoRequest({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  const meteringPermissionLink = await applyInboundProdatZ14ToMeteringPermission({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  if (!canonicalLinks.matchedSwitch) {
    const safeApplyProposalChanges = ['Z06', 'Z10'].includes(String(params.message.message_code))
      ? await buildSafeMasterdataProposal(params.message)
      : []

    if (safeApplyProposalChanges.length > 0) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Safe apply-förslag skapades för Z06/Z10 utan stark switch-koppling. Masterdata skrevs inte över automatiskt.',
        payload: {
          batch: '6B',
          safeApply: true,
          appliedAutomatically: false,
          proposedChanges: safeApplyProposalChanges,
          reviewRequired: true,
          inboundCaseId: inboundCase?.id ?? null,
          customerInfoRequestLink: customerInfoLink,
          meteringPermissionLink,
        },
      })
    }

    const ackIds = await createAutomaticPositiveAcks({
      actorUserId: params.actorUserId,
      sourceMessage: params.message,
    })
    const ackSnapshot = await readCanonicalAckSnapshot(params.message.id)

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound PRODAT kvitterades automatiskt och lades i admin-godkännande eftersom stark switch-koppling saknas.',
      payload: {
        createdAckMessageIds: ackIds,
        canonicalAckState: ackSnapshot.canonicalAckState,
        ackMessages: ackSnapshot.ackMessages,
        safeApplyProposalChanges,
        inboundCaseId: inboundCase?.id ?? null,
        customerInfoRequestLink: customerInfoLink,
        meteringPermissionLink,
      },
    })

    return
  }

  const supabase = await createSupabaseServerClient()

  if (params.message.message_code === 'Z04') {
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: canonicalLinks.matchedSwitch.id,
      status: 'accepted',
      externalReference:
        params.message.external_reference ?? canonicalLinks.matchedSwitch.external_reference,
    })
  }

  if (params.message.message_code === 'Z05') {
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: canonicalLinks.matchedSwitch.id,
      status: 'completed',
      externalReference:
        params.message.external_reference ?? canonicalLinks.matchedSwitch.external_reference,
    })
  }

  const safeApplyProposalChanges = ['Z06', 'Z10'].includes(String(params.message.message_code))
    ? await buildSafeMasterdataProposal(params.message)
    : []

  if (safeApplyProposalChanges.length > 0) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Safe apply-förslag skapades för Z06/Z10. Masterdata skrevs inte över automatiskt.',
      payload: {
        batch: '6B',
        safeApply: true,
        appliedAutomatically: false,
        proposedChanges: safeApplyProposalChanges,
        reviewRequired: true,
        inboundCaseId: inboundCase?.id ?? null,
        customerInfoRequestLink: customerInfoLink,
        meteringPermissionLink,
      },
    })
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId: params.actorUserId,
    sourceMessage: params.message,
  })
  const ackSnapshot = await readCanonicalAckSnapshot(params.message.id)

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: canonicalLinks.matchedSwitch.id,
    eventType: 'ediel_inbound_processed',
    eventStatus: 'success',
    message: 'Inbound PRODAT behandlad via canonical inbound flow och staging-case skapades för eventuell admin-granskning.',
    payload: {
      edielMessageId: params.message.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
      customerInfoRequestLink: customerInfoLink,
      meteringPermissionLink,
    },
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message: 'Inbound PRODAT processad via canonical inbound flow och staging-case skapat.',
    payload: {
      matchedSwitchRequestId: canonicalLinks.matchedSwitch.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
    },
  })
}

export async function processInboundEdielMessage(params: {
  actorUserId: string
  edielMessageId: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelandet hittades inte')

  if (!isActiveEdielMessageFamily(message.message_family)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Batch 6 hoppade över meddelandet eftersom familjen ligger utanför aktiv release.',
      payload: {
        messageFamily: message.message_family,
        activeFamilies: ACTIVE_EDIEL_MESSAGE_FAMILIES,
      },
    })
    return message
  }

  if (!shouldProcessInboundMessage(message)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Batch 6 hoppade över meddelandet eftersom det inte är inbound EDIFACT i aktivt flöde.',
      payload: {
        direction: message.direction,
        standard: message.message_standard,
      },
    })
    return message
  }

  const canonicalRuntime = await applyCanonicalRuntimeDecision({ actorUserId, message })
  const tenantResolution = await resolveInboundTenantForMessage({
    actorUserId,
    message: canonicalRuntime.message,
  })
  const runtimeMessage = tenantResolution.message

  if (tenantResolution.status !== 'tenant_resolved') {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: runtimeMessage.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Inbound Ediel processing stopped before business matching because tenant resolution failed.',
      payload: {
        tenantResolutionStatus: tenantResolution.status,
        evidence: tenantResolution.evidence,
      },
    })
    return runtimeMessage
  }

  if (canonicalRuntime.decision.syntaxDecision === 'rejected') {
    await createAutomaticPositiveAcks({
      actorUserId,
      sourceMessage: runtimeMessage,
    })
    return runtimeMessage
  }

  if (runtimeMessage.message_family === 'PRODAT' || runtimeMessage.message_family === 'UTILTS') {
    const handledByActorTesting = await syncActorTestingGlobally({
      actorUserId,
      message: runtimeMessage,
      phase: 'pre_business_processing',
      autoRespond: true,
      autoSend: true,
    })

    if (handledByActorTesting) {
      return runtimeMessage
    }
  }

  if (
    runtimeMessage.message_family === 'CONTRL' ||
    runtimeMessage.message_family === 'APERAK' ||
    runtimeMessage.message_family === 'UTILTS_ERR'
  ) {
    await processInboundAckMessage({ actorUserId, message: runtimeMessage })
    await syncActorTestingGlobally({
      actorUserId,
      message: runtimeMessage,
      phase: 'post_ack_processing',
      autoRespond: false,
      autoSend: false,
    })
    return runtimeMessage
  }

  if (runtimeMessage.message_family === 'PRODAT') {
    await processInboundProdatMessage({ actorUserId, message: runtimeMessage })
    return runtimeMessage
  }

  if (runtimeMessage.message_family === 'UTILTS') {
    await processInboundUtiltsMessage({ actorUserId, edielMessageId: runtimeMessage.id })
    return runtimeMessage
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId,
    sourceMessage: runtimeMessage,
  })
  const ackSnapshot = await readCanonicalAckSnapshot(runtimeMessage.id)

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: runtimeMessage.id,
    eventType: 'validated',
    eventStatus: 'warning',
    message: 'Inbound meddelande kvitterades automatiskt men saknar ännu stark processkoppling.',
    payload: {
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })

  return runtimeMessage
}

export async function pollAndIngestEdielMailbox(params: {
  actorUserId: string
  mailbox?: string | null
  mailboxId?: string | null
  communicationRouteId?: string | null
  companyId?: string | null
  environment?: 'test' | 'production' | null
  force?: boolean
  limit?: number
  sharedOnly?: boolean
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const routeProfile = params.communicationRouteId
    ? await getEdielRouteProfileByCommunicationRouteId(params.communicationRouteId, {
        companyId: params.companyId ?? null,
      })
    : null
  const legacyMailboxAsId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.mailbox ?? '')
    ? params.mailbox
    : null
  const resolvedMailboxId = params.mailboxId ?? routeProfile?.mailbox_id ?? legacyMailboxAsId
  const targetCompanyId = params.companyId ?? routeProfile?.company_id ?? null
  const useSharedMailbox = params.sharedOnly ?? !resolvedMailboxId

  const result = await runInboundEdielMailEngine({
    actorUserId,
    companyId: useSharedMailbox ? null : targetCompanyId,
    environment: params.environment ?? routeProfile?.environment ?? 'test',
    mailboxId: resolvedMailboxId,
    sharedOnly: useSharedMailbox,
    force: params.force ?? true,
    messageLimitPerMailbox: params.limit ?? 10,
  })
  const incoming = await listEdielMessagesByIds(result.edielMessageIds, {
    companyId: targetCompanyId,
  })

  for (const message of incoming) {
    await processInboundEdielMessage({
      actorUserId,
      edielMessageId: message.id,
    })
  }

  return incoming
}

export async function createNegativeUtiltsResponse(params: {
  actorUserId: string
  edielMessageId: string
  messageText: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const source = await getEdielMessageById(params.edielMessageId)
  if (!source) throw new Error('Källmeddelande hittades inte')
  if (source.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${source.id} är inte UTILTS.`)
  }

  const utiltsErr = await createAckIfMissing({
    actorUserId,
    sourceMessage: source,
    ackFamily: 'UTILTS_ERR',
    messageText: params.messageText,
  })

  const ackSnapshot = await readCanonicalAckSnapshot(source.id)

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: source.id,
    eventType: 'utilts_err_sent',
    eventStatus: 'warning',
    message: 'UTILTS-ERR-utkast skapat via canonical kernel.',
    payload: {
      utiltsErrMessageId: utiltsErr.id,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })

  return utiltsErr
}
