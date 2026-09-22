import { createEdielMessageEvent, getEdielMessageById, updateEdielMessageStatus } from '@/lib/ediel/db'
import { ensureActorUserId } from '@/lib/ediel/flows/shared'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { applyCertifiedUtiltsAckPolicy } from '@/lib/ediel/rulebook/utiltsAckPolicy'
import { resolveUtiltsInboundBusinessOutcome } from '@/lib/ediel/utilts/inboundBusinessOutcome'
import {
  buildUtiltsTransactionPersistencePayload,
  persistUtiltsTransactionResults,
  resolveUtiltsTransactionId,
} from '@/lib/ediel/utilts/transactionPersistence'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsProcessResult } from './utiltsDataRequest.part-1'
import {
  createUtiltsRuntimeAcks,
  resolveUtiltsRuntimeTestCaseCode,
  stringOrNull,
} from './utiltsDataRequest.part-1'
import { processInboundUtiltsMessage as processActualMeteringUtiltsMessage } from './utiltsDataRequest.part-2'

function resolveInboundPolicy(message: EdielMessageRow, retained?: CanonicalEdielPolicy | null) {
  if (message.message_family !== 'UTILTS') {
    throw new Error(`utilts_inbound_policy_family_invalid:${message.message_family}`)
  }
  const policy = retained ?? resolveCanonicalMessagePolicy(message)
  if (!policy || policy.family !== 'UTILTS' || policy.direction !== 'inbound' || policy.code !== message.message_code) {
    throw new Error(`utilts_inbound_policy_context_mismatch:${message.id}`)
  }
  return policy
}

function hasIndividualLink(message: EdielMessageRow): boolean {
  return Boolean(message.customer_id || message.site_id || message.metering_point_id)
}

async function persistNonBillingTransactions(params: {
  message: EdielMessageRow
  messageCode: string
  runtime: ReturnType<typeof runUtiltsRuntimeForMessage>
}) {
  const companyId = stringOrNull(params.message.company_id)
  if (!companyId || params.runtime.transactionDispositions.length === 0) {
    return {
      dispositions: params.runtime.transactionDispositions,
      persistenceResults: [] as Awaited<ReturnType<typeof persistUtiltsTransactionResults>>,
    }
  }

  const persistenceResults = await persistUtiltsTransactionResults({
    companyId,
    environment: params.message.environment,
    sourceMessageId: params.message.id,
    messageCode: params.messageCode,
    transactions: buildUtiltsTransactionPersistencePayload({
      messageCode: params.messageCode,
      transactions: params.runtime.facts.transactions,
      dispositions: params.runtime.transactionDispositions,
      // Non-billing outcomes deliberately persist only protocol/business
      // identity. They never acquire tenant customer/metering-point links here.
      matches: [],
    }),
  })

  const dispositions = params.runtime.transactionDispositions.map((disposition, index) => {
    const transactionId = resolveUtiltsTransactionId(disposition.transactionId, index)
    const persisted = persistenceResults.find((item) => item.transactionId === transactionId)
    if (!persisted || persisted.persistenceStatus !== 'failed') {
      return transactionId === disposition.transactionId
        ? disposition
        : { ...disposition, transactionId }
    }
    return {
      ...disposition,
      transactionId,
      disposition: 'processability_rejected' as const,
      responseType: 'utilts_err' as const,
      issueCodes: [...new Set([...disposition.issueCodes, ...(persisted.issueCodes ?? ['UTILTS_PERSISTENCE_FAILED'])])],
    }
  })

  return { dispositions, persistenceResults }
}

async function processExplicitNonBillingOutcome(params: {
  actorUserId: string
  message: EdielMessageRow
  testCaseCode?: string | null
  canonicalPolicy?: CanonicalEdielPolicy | null
}): Promise<UtiltsProcessResult> {
  const policy = resolveInboundPolicy(params.message, params.canonicalPolicy)
  const outcome = resolveUtiltsInboundBusinessOutcome(policy)

  if (outcome.allowBillingConsumption || outcome.allowMeteringValueIngest) {
    throw new Error(`utilts_non_billing_processor_received_actual_values:${policy.code}:${outcome.kind}`)
  }
  if (!outcome.allowIndividualCustomerLink && hasIndividualLink(params.message)) {
    throw new Error(`utilts_individual_customer_link_forbidden:${policy.code}:${outcome.kind}`)
  }

  const runtimeTestCaseCode = await resolveUtiltsRuntimeTestCaseCode({
    sourceMessage: params.message,
    explicitTestCaseCode: params.testCaseCode ?? null,
  })
  const structuralQualification = await qualifyReceivedUtiltsStructure({
    message: params.message, canonicalPolicy: policy,
    runtime: runUtiltsRuntimeForMessage(params.message, { canonicalPolicy: policy }),
  })
  const runtime = structuralQualification.runtime
  const ackPlan = structuralQualification.hasInternalReview || structuralQualification.hasNationalMismatch
    ? runtime.ackPlan : applyCertifiedUtiltsAckPolicy({ runtime, testCaseCode: runtimeTestCaseCode })
  const persisted = await persistNonBillingTransactions({
    message: params.message,
    messageCode: policy.code,
    runtime,
  })
  const normalizedPayload = {
    ...runtime.normalizedPayload,
    receivedStructureQualification: structuralQualification.evidence,
    utiltsBusinessOutcome: outcome,
    utiltsCanonicalPolicy: {
      profileKey: policy.profileKey,
      guideRevision: policy.guide.guideRevision,
      businessProcess: policy.processGroup,
      dataScope: policy.semantics.dataScope,
    },
    utiltsTransactionDispositions: persisted.dispositions,
    utiltsTransactionPersistenceResults: persisted.persistenceResults,
    billingConsumptionAllowed: false,
    meteringValueIngestAllowed: false,
  }

  const ackIds = await createUtiltsRuntimeAcks({
    actorUserId: params.actorUserId,
    sourceMessage: params.message,
    ackPlan,
    transactionDispositions: persisted.dispositions,
    testCaseCode: runtimeTestCaseCode,
  })

  const failed = runtime.validation.classification === 'syntax_rejected'
  const updated = await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: failed ? 'failed' : 'validated',
    failureReason: failed || structuralQualification.hasInternalReview ? ackPlan.reason : undefined,
    parsedPayload: {
      ...(params.message.parsed_payload ?? {}),
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntimeFacts: runtime.facts,
      utiltsRuntimeTestCaseCode: runtimeTestCaseCode,
      utiltsBusinessOutcome: outcome,
    },
    validationReport: {
      ...(params.message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan,
        createdAckMessageIds: ackIds,
        businessOutcome: outcome,
      },
      utiltsSideEffectPolicy: {
        individualCustomerLinkAllowed: outcome.allowIndividualCustomerLink,
        meteringValueIngestAllowed: false,
        billingConsumptionAllowed: false,
        gridAreaScopeRequired: outcome.requireGridAreaScope,
      },
    },
    parsedAt: params.message.parsed_at ?? new Date().toISOString(),
    validatedAt: failed ? undefined : new Date().toISOString(),
    failedAt: failed ? new Date().toISOString() : undefined,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'validated',
    eventStatus: !runtime.validation.ok ? 'warning' : 'success',
    message: structuralQualification.hasInternalReview
      ? `Inbound UTILTS ${policy.code} väntar på godkänt strukturunderlag utan mätvärdes- eller faktureringsskrivningar.`
      : `Inbound UTILTS ${policy.code} hanterades som ${outcome.kind} via canonical side-effect policy.`,
    payload: {
      canonicalPolicy: {
        profileKey: policy.profileKey,
        guideRevision: policy.guide.guideRevision,
        dataScope: policy.semantics.dataScope,
      },
      businessOutcome: outcome,
      createdAckMessageIds: ackIds,
      transactionPersistenceResults: persisted.persistenceResults,
      billingUnderlayCreated: false,
      meteringValuesCreated: false,
    },
  })

  return {
    message: updated,
    matchedDataRequest: null,
    ackIds,
    internalReviewRequired: structuralQualification.hasInternalReview,
    outboundRequestId: null,
    ingestedMeterValueId: null,
    ingestedMeterValueIds: [],
    billingUnderlayId: null,
  }
}

/**
 * Sole public supplier-side inbound UTILTS dispatcher.
 * Actual E30/E66 metering data keeps the characterized ingestion path. Every
 * other known canonical outcome is processed explicitly without billing/meter
 * side effects; there is no ignored fallback.
 */
export async function processInboundUtiltsMessageByCanonicalPolicy(params: {
  actorUserId: string
  edielMessageId: string
  testCaseCode?: string | null
  canonicalPolicy?: CanonicalEdielPolicy | null
}): Promise<UtiltsProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') throw new Error(`Meddelande ${message.id} är inte UTILTS.`)

  const policy = resolveInboundPolicy(message, params.canonicalPolicy)
  const outcome = resolveUtiltsInboundBusinessOutcome(policy)

  if (outcome.kind === 'actual_metering_values') {
    if (!outcome.allowMeteringValueIngest || !outcome.allowBillingConsumption) {
      throw new Error(`utilts_actual_metering_side_effect_policy_invalid:${policy.code}`)
    }
    return processActualMeteringUtiltsMessage({
      actorUserId,
      edielMessageId: params.edielMessageId,
      testCaseCode: params.testCaseCode ?? null,
      canonicalPolicy: policy,
    })
  }

  return processExplicitNonBillingOutcome({
    actorUserId,
    message,
    testCaseCode: params.testCaseCode ?? null,
    canonicalPolicy: policy,
  })
}
