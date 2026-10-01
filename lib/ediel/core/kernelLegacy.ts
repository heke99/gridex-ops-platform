// lib/ediel/core/kernel.ts

import type {
  CreateEdielMessageInput,
  EdielEnvironment,
  EdielMessageRow,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import {
  createCanonicalAckConflictEvent,
  createCanonicalDuplicateBlockEvent,
  createEdielMessage,
  findSequencedAckForSource,
} from '@/lib/ediel/db'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import {
  CanonicalRouteRequestType,
  resolveCanonicalRouteContext,
} from '@/lib/ediel/core/routeRegistry'
import {
  buildCanonicalAckReferences,
  buildCanonicalOutboundReferences,
} from '@/lib/ediel/core/referenceRegistry'
import {
  buildInboundCanonicalIdentity,
  findInboundDuplicateByCanonicalIdentity,
  findOutboundEdielMessageDuplicate,
  hasCanonicalAckDuplicate,
} from '@/lib/ediel/core/dedupe'
import {
  resolveCanonicalInboundAcceptedVersions,
  resolveCanonicalOutboundVersion,
} from '@/lib/ediel/core/versionRegistry'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { prepareAiBiInboundReconciliation, processAiBiInboundReconciliation } from '@/lib/ediel/aiBiInboundReconciliation'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'

function ensureActorUserId(value?: string | null) {
  return value && value.trim() ? value.trim() : 'system'
}

function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === '23505' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('duplicate key value violates unique constraint'))
  )
}

function postgresErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const candidate = error as { message?: unknown; details?: unknown }
  return [candidate.message, candidate.details]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
}

function isLegacyAckPerSourceConstraint(error: unknown): boolean {
  const text = postgresErrorMessage(error)
  return text.includes('uq_ediel_messages_outbound_ack_per_source')
}

function sequenceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const FINAL_CANONICAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])

function isFinalCanonicalAckStatus(value: unknown): boolean {
  return FINAL_CANONICAL_ACK_STATUSES.has(String(value ?? '').toLowerCase())
}

export async function resolveCanonicalOutboundContext(params: {
  requestType: CanonicalRouteRequestType
  gridOwner?: { id?: string | null; name?: string | null; ediel_id?: string | null } | null
  preferredRouteId?: string | null
  companyId: string
  /**
   * Required: outbound routing must never fall back to a silent test
   * environment. Every caller resolves the runtime environment explicitly
   * (resolveOutboundRuntimeEnvironment or an admin/test action choice).
   */
  environment: EdielEnvironment
  messageStandard?: EdielMessageStandard
  receiverEdielId?: string | null
  applicationReference?: string | null
}) {
  if (!params.environment) {
    throw new Error('ediel_outbound_environment_required')
  }
  return resolveCanonicalRouteContext({
    requestType: params.requestType,
    gridOwner: (params.gridOwner ?? null) as never,
    preferredRouteId: params.preferredRouteId ?? null,
    companyId: params.companyId,
    environment: params.environment,
    messageStandard: params.messageStandard ?? 'edifact',
    receiverEdielId: params.receiverEdielId ?? null,
    applicationReference: params.applicationReference ?? null,
  })
}

export async function resolveCanonicalInboundActor(params?: {
  environment?: EdielEnvironment
  companyId?: string | null
}) {
  return resolveCanonicalActorContext(params?.environment ?? 'test', params?.companyId ?? null)
}

export async function resolveOutboundMessageVersion(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  routeDefaultMessageVersion?: string | null
}) {
  return resolveCanonicalOutboundVersion(params)
}

export async function resolveInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  return resolveCanonicalInboundAcceptedVersions(params)
}

function assertInboundDuplicateScope(duplicate:EdielMessageRow,input:CreateEdielMessageInput) {
  if(duplicate.direction!=='inbound' || duplicate.company_id!==(input.companyId??null)
    || duplicate.environment!==input.environment || duplicate.message_standard!==(input.messageStandard??'edifact')
    || duplicate.message_family!==input.messageFamily || duplicate.message_code!==String(input.messageCode)
    || (duplicate.receiver_ediel_id??null)!==(input.receiverEdielId??null)
    || (duplicate.application_reference??null)!==(input.applicationReference??null)
    || duplicate.raw_payload!==input.rawPayload)
    throw new Error('canonical_inbound_duplicate_scope_or_original_conflict')
}

export async function registerInboundCanonicalMessage(params: {
  actorUserId?: string | null
  input: CreateEdielMessageInput
}) {
  const actorUserId=ensureActorUserId(params.actorUserId),input=params.input
  if(input.direction!=='inbound' || !['test','production'].includes(input.environment??''))
    throw new Error('canonical_inbound_scope_required')
  if(input.companyId)await assertEdielTenantActor({companyId:input.companyId,actorUserId,permission:'communication.write'})
  const isAiBiSource=input.messageStandard==='ai_list'||input.messageFamily==='AI_LIST'||/^\uFEFF?(AI|BI);/.test(input.rawPayload??'')
  if(isAiBiSource&&!input.companyId)throw new Error('ai_bi_reconciliation_tenant_source_required')
  const identity=buildInboundCanonicalIdentity({...input,senderEdielId:input.senderEdielId,
    receiverEdielId:input.receiverEdielId,applicationReference:input.applicationReference})
  const reuse=async(duplicate:EdielMessageRow)=>{
    assertInboundDuplicateScope(duplicate,input)
    if(isAiBiSource)await processAiBiInboundReconciliation({actorUserId,message:duplicate})
    await createCanonicalDuplicateBlockEvent({actorUserId,edielMessageId:duplicate.id,layer:'canonical_inbound',
      message:'Inbound dublett blockerad i canonical kernel.',payload:{...identity}})
    return duplicate
  }
  const duplicate=await findInboundDuplicateByCanonicalIdentity(identity)
  if(duplicate)return reuse(duplicate)
  if(isAiBiSource)await prepareAiBiInboundReconciliation({companyId:input.companyId!,
    environment:input.environment as 'test'|'production',actorUserId,rawPayload:input.rawPayload??''})
  try {
    const message=await createEdielMessage({...input,actorUserId})
    if(isAiBiSource)await processAiBiInboundReconciliation({actorUserId,message})
    return message
  } catch(error) {
    // Only the same whole original in the same actual scope may satisfy a
    // uniqueness race. ACK family/source alone merges distinct IDE responses.
    if(isPostgresUniqueViolation(error)){
      const raced=await findInboundDuplicateByCanonicalIdentity(identity)
      if(raced)return reuse(raced)
    }
    throw error
  }
}


export async function createCanonicalOutboundMessage(params: {
  actorUserId?: string | null
  baseInput: CreateEdielMessageInput
  requestType: CanonicalRouteRequestType
  duplicateCheck?: {
    outboundRequestId?: string | null
    sourceType?: string | null
    sourceId?: string | null
    receiverEdielId?: string | null
    messageFamily: string
    messageCode: string
    messageVersion?: string | null
    periodStart?: string | null
    periodEnd?: string | null
  }
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const operationId = params.baseInput.sourceOperationId
    ?? params.baseInput.parsedPayload?.operation_id ?? params.baseInput.parsedPayload?.operationId

  if (params.duplicateCheck) {
    const duplicate = await findOutboundEdielMessageDuplicate({
      companyId: params.baseInput.companyId, environment: params.baseInput.environment,
      sourceOperationId: typeof operationId === 'string' ? operationId : null,
      outboundRequestId: params.duplicateCheck.outboundRequestId ?? null,
      sourceType: params.duplicateCheck.sourceType ?? null,
      sourceId: params.duplicateCheck.sourceId ?? null,
      requestType: params.requestType,
      receiverEdielId: params.duplicateCheck.receiverEdielId ?? null,
      messageFamily: params.baseInput.messageFamily,
      messageCode: String(params.baseInput.messageCode),
      messageVersion: null,
    })

    if (duplicate) {
      if (duplicate.company_id !== params.baseInput.companyId || duplicate.environment !== params.baseInput.environment
        || duplicate.direction !== 'outbound' || duplicate.message_family !== params.baseInput.messageFamily
        || duplicate.message_code !== String(params.baseInput.messageCode)
        || typeof operationId === 'string' && duplicate.source_operation_id !== operationId
        || params.duplicateCheck.outboundRequestId && duplicate.outbound_request_id !== params.duplicateCheck.outboundRequestId)
        throw new Error('canonical_outbound_existing_operation_scope_conflict')
      if (duplicate.raw_payload !== params.baseInput.rawPayload) throw new Error('canonical_outbound_existing_operation_wire_conflict')
      await createCanonicalDuplicateBlockEvent({
        actorUserId,
        edielMessageId: duplicate.id,
        layer: 'canonical_outbound',
        message: 'Outbound dublett blockerad i canonical kernel.',
        payload: {
          canonicalBusinessKey: [
            params.duplicateCheck.sourceType ?? 'unknown-source-type',
            params.duplicateCheck.sourceId ?? 'unknown-source-id',
            params.requestType,
            params.duplicateCheck.receiverEdielId ?? 'unknown-receiver',
            params.duplicateCheck.messageFamily,
            params.duplicateCheck.messageCode,
            params.duplicateCheck.messageVersion ?? 'unknown-version',
            params.duplicateCheck.periodStart ?? 'no-period-start',
            params.duplicateCheck.periodEnd ?? 'no-period-end',
          ].join('|'),
          requestType: params.requestType,
          ...params.duplicateCheck,
        },
      })
      return duplicate
    }
  }

  return createEdielMessage({
    ...params.baseInput,
    actorUserId,
  })
}

async function assertOutboundDraftAllowedByFieldRules(params: {
  draft: CreateEdielMessageInput
  messageVersion?: string | null
}) {
  if (!params.draft.rawPayload) throw new Error('outbound_ediel_raw_payload_required')

  const validation = await validateRulebookMessageWithRegistry({
    family: params.draft.messageFamily,
    code: String(params.draft.messageCode),
    processGroup: params.draft.processType ?? null,
    applicationReference: params.draft.applicationReference ?? null,
    rawPayload: params.draft.rawPayload,
    mode: 'send',
    direction: 'outbound',
    environment: params.draft.environment ?? null,
    version: params.messageVersion ?? params.draft.messageVersion ?? null,
    companyId: params.draft.companyId ?? null,
  })

  if (validation.fieldRuleSource !== 'registry' || !validation.rulePackSnapshot) {
    throw new Error(`outbound_ediel_rule_pack_snapshot_missing:${params.draft.messageFamily}:${params.draft.messageCode}`)
  }
  const blocking = validation.issues.filter((item) => item.severity === 'error' || item.blocking)
  if (blocking.length > 0) {
    const first = blocking[0]
    throw new Error(
      `Outbound ${params.draft.messageFamily} ${params.draft.messageCode} blockerades av aktivt Ediel-regelpaket: ${first.code} - ${first.description}`
    )
  }
  return validation.rulePackSnapshot
}

export async function finalizeCanonicalOutboundDraft(params: {
  actorUserId?: string | null
  requestType: CanonicalRouteRequestType
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  draft: CreateEdielMessageInput
  outboundRequestId?: string | null
  duplicateCheck: {
    sourceType?: string | null
    sourceId?: string | null
    receiverEdielId?: string | null
    messageFamily: string
    messageCode: string
    messageVersion?: string | null
    periodStart?: string | null
    periodEnd?: string | null
  }
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const messageFamily = params.draft.messageFamily
  const messageCode = String(params.draft.messageCode)

  const resolvedVersion = await resolveCanonicalOutboundVersion({
    family: messageFamily,
    code: messageCode,
    standard: params.draft.messageStandard,
    fallback: params.draft.messageVersion ?? null,
    environment: params.draft.environment ?? params.routeContext.environment,
    routeDefaultMessageVersion: params.routeContext.defaultMessageVersion,
  })

  const refs = buildCanonicalOutboundReferences({
    family: messageFamily,
    code: messageCode,
    relatedMessageId: null,
    preferredExternalReference: params.draft.externalReference ?? null,
    preferredTransactionReference: params.draft.transactionReference ?? null,
    correlationReference: params.draft.correlationReference ?? null,
    originalMessageId: params.draft.originalMessageId ?? null,
    originalTransactionId: params.draft.originalTransactionId ?? null,
    originalMessageCode: params.draft.originalMessageCode ?? null,
  })

  const baseInput = {
    ...params.draft,
    actorUserId,
    companyId: params.draft.companyId ?? params.routeContext.companyId ?? null,
    messageVersion: resolvedVersion ?? params.draft.messageVersion ?? null,
    applicationReference:
      params.draft.applicationReference ??
      params.routeContext.applicationReference ??
      null,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    senderEdielId: params.draft.senderEdielId ?? params.routeContext.senderEdielId,
    senderName: params.draft.senderName ?? params.routeContext.senderName,
    senderSubAddress:
      params.draft.senderSubAddress ?? params.routeContext.senderSubAddress,
    receiverEdielId: params.draft.receiverEdielId ?? params.routeContext.receiverEdielId,
    receiverName: params.draft.receiverName ?? params.routeContext.receiverName,
    receiverSubAddress:
      params.draft.receiverSubAddress ?? params.routeContext.receiverSubAddress,
    receiverEmail: params.draft.receiverEmail ?? params.routeContext.receiverEmail,
    mailbox: params.draft.mailbox ?? params.routeContext.mailbox,
    communicationRouteId:
      params.draft.communicationRouteId ?? params.routeContext.route.id,
    environment: params.draft.environment ?? params.routeContext.environment,
    messageStandard:
      params.draft.messageStandard ?? params.routeContext.messageStandard,
    testFlag: params.draft.testFlag ?? params.routeContext.actor.testFlag,
  }

  const rulePackSnapshot = await assertOutboundDraftAllowedByFieldRules({
    draft: baseInput,
    messageVersion: resolvedVersion ?? params.duplicateCheck.messageVersion ?? null,
  })

  const canonicalInput: CreateEdielMessageInput = {
    ...baseInput,
    ruleProfileKey: rulePackSnapshot.profileKey,
    ruleProfileVersionId: rulePackSnapshot.profileVersionId,
    ruleProfileVersion: rulePackSnapshot.version,
    rulePackChecksum: rulePackSnapshot.checksum,
    rulePackSnapshot: {
      ...rulePackSnapshot,
      resolvedAt: new Date().toISOString(),
      family: messageFamily,
      code: messageCode,
    },
  }

  return createCanonicalOutboundMessage({
    actorUserId,
    requestType: params.requestType,
    duplicateCheck: {
      outboundRequestId: params.outboundRequestId ?? null,
      sourceType: params.duplicateCheck.sourceType ?? null,
      sourceId: params.duplicateCheck.sourceId ?? null,
      receiverEdielId: params.duplicateCheck.receiverEdielId ?? null,
      messageFamily,
      messageCode,
      messageVersion: resolvedVersion ?? params.duplicateCheck.messageVersion ?? null,
      periodStart: params.duplicateCheck.periodStart ?? null,
      periodEnd: params.duplicateCheck.periodEnd ?? null,
    },
    baseInput: canonicalInput,
  })
}

export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)

  const allowSequencedUtiltsErr =
    params.ackFamily === 'UTILTS_ERR' &&
    typeof params.draft.parsedPayload?.utiltsErrSequenceToken === 'string' &&
    params.draft.parsedPayload.utiltsErrSequenceToken.trim().length > 0

  const allowSequencedAperak =
    params.ackFamily === 'APERAK' &&
    params.draft.parsedPayload?.ackScope === 'transaction' &&
    typeof params.draft.parsedPayload?.relatedTransactionReference === 'string' &&
    params.draft.parsedPayload.relatedTransactionReference.trim().length > 0

  const sequenceToken = allowSequencedAperak
    ? sequenceString(params.draft.parsedPayload?.relatedTransactionReference)
    : allowSequencedUtiltsErr
      ? sequenceString(params.draft.parsedPayload?.utiltsErrSequenceToken)
      : null

  const sequencedDuplicate =
    allowSequencedAperak && sequenceToken
      ? await findSequencedAckForSource({
          sourceMessageId: params.sourceMessage.id,
          ackFamily: 'APERAK',
          outcome: params.outcome ?? null,
          sequenceField: 'relatedTransactionReference',
          sequenceValue: sequenceToken,
        })
      : allowSequencedUtiltsErr && sequenceToken
        ? await findSequencedAckForSource({
            sourceMessageId: params.sourceMessage.id,
            ackFamily: 'UTILTS_ERR',
            outcome: params.outcome ?? null,
            sequenceField: 'utiltsErrSequenceToken',
            sequenceValue: sequenceToken,
          })
        : null

  const duplicate = sequencedDuplicate ?? (allowSequencedUtiltsErr || allowSequencedAperak
    ? null
    : await hasCanonicalAckDuplicate({
        sourceMessageId: params.sourceMessage.id,
        ackFamily: params.ackFamily,
        outcome: params.outcome,
      }))

  if (duplicate) {
    const attemptedOutcome = params.outcome ?? null
    const parsedPayload = duplicate.parsed_payload ?? {}
    const existingOutcome =
      duplicate.ack_outcome === 'positive' || duplicate.ack_outcome === 'negative'
        ? duplicate.ack_outcome
        : parsedPayload.ackOutcome === 'positive' || parsedPayload.ackOutcome === 'negative'
          ? parsedPayload.ackOutcome
          : null

    const conflictingOutcome = Boolean(
      attemptedOutcome &&
        existingOutcome &&
        attemptedOutcome !== existingOutcome
    )
    const finalDuplicate = isFinalCanonicalAckStatus(duplicate.status)

    await createCanonicalAckConflictEvent({
      actorUserId,
      edielMessageId: params.sourceMessage.id,
      ackFamily: params.ackFamily,
      sourceMessageId: params.sourceMessage.id,
      attemptedOutcome,
      existingAckMessageId: duplicate.id,
      existingOutcome,
      reason: conflictingOutcome
        ? 'conflicting_outcome'
        : attemptedOutcome
          ? 'duplicate_same_outcome'
          : 'duplicate_same_family',
      payload: {
        duplicateBlockedIn: 'kernel',
        existingAckStatus: duplicate.status,
        finalDuplicate,
        blockReason: finalDuplicate && conflictingOutcome ? 'blocked_final_ack_exists' : null,
      },
    })

    if (conflictingOutcome) {
      throw new Error(
        finalDuplicate
          ? `blocked_final_ack_exists: Final ${params.ackFamily} finns redan med outcome ${existingOutcome}. Nytt outcome ${attemptedOutcome} blockeras.`
          : `conflicting_ack_draft_exists: ${params.ackFamily} finns redan med outcome ${existingOutcome}. Nytt outcome ${attemptedOutcome} blockeras tills den gamla draften ersätts.`
      )
    }

    return duplicate
  }

  const baseRefs = buildCanonicalAckReferences({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  const refs = allowSequencedUtiltsErr || allowSequencedAperak
    ? {
        ...baseRefs,
        externalReference: params.draft.externalReference ?? baseRefs.externalReference,
        transactionReference: params.draft.transactionReference ?? baseRefs.transactionReference,
        correlationReference: params.draft.correlationReference ?? baseRefs.correlationReference,
      }
    : baseRefs

  const input: CreateEdielMessageInput = {
    ...params.draft,
    actorUserId,
    companyId: params.draft.companyId ?? params.sourceMessage.company_id ?? null,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    relatedMessageId: params.sourceMessage.id,
    ackOutcome: params.outcome ?? params.draft.ackOutcome ?? null,
  }

  const rulePackSnapshot = await assertOutboundDraftAllowedByFieldRules({
    draft: input,
    messageVersion: input.messageVersion ?? null,
  })
  const canonicalAckInput: CreateEdielMessageInput = {
    ...input,
    ruleProfileKey: rulePackSnapshot.profileKey,
    ruleProfileVersionId: rulePackSnapshot.profileVersionId,
    ruleProfileVersion: rulePackSnapshot.version,
    rulePackChecksum: rulePackSnapshot.checksum,
    rulePackSnapshot: {
      ...rulePackSnapshot,
      resolvedAt: new Date().toISOString(),
      family: params.ackFamily,
      code: String(input.messageCode),
    },
  }

  try {
    return await createEdielMessage(canonicalAckInput)
  } catch (error) {
    if (isPostgresUniqueViolation(error) && sequenceToken) {
      const existing = allowSequencedAperak
        ? await findSequencedAckForSource({
            sourceMessageId: params.sourceMessage.id,
            ackFamily: 'APERAK',
            outcome: params.outcome ?? null,
            sequenceField: 'relatedTransactionReference',
            sequenceValue: sequenceToken,
          })
        : allowSequencedUtiltsErr
          ? await findSequencedAckForSource({
              sourceMessageId: params.sourceMessage.id,
              ackFamily: 'UTILTS_ERR',
              outcome: params.outcome ?? null,
              sequenceField: 'utiltsErrSequenceToken',
              sequenceValue: sequenceToken,
            })
          : null

      if (existing) return existing
    }

    if (isPostgresUniqueViolation(error) && isLegacyAckPerSourceConstraint(error) && allowSequencedAperak) {
      throw new Error(
        'Databasen blockerar fortfarande flera APERAK per källmeddelande via uq_ediel_messages_outbound_ack_per_source. Kör SQL-migrationen ediel_ack_transaction_scope.sql i Supabase och kör sedan engine igen.'
      )
    }

    throw error
  }
}

export function buildCanonicalReferencesForOutbound(params: {
  family: string
  code: string
  relatedMessageId?: string | null
  preferredExternalReference?: string | null
  preferredTransactionReference?: string | null
  correlationReference?: string | null
  originalMessageId?: string | null
  originalTransactionId?: string | null
  originalMessageCode?: string | null
}) {
  return buildCanonicalOutboundReferences(params)
}
