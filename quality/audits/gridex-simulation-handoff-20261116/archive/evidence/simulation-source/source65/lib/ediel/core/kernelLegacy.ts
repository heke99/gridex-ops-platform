import {requiresBilateralProdatOutboundOwner,createAtomicBilateralProdatOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import { recordInboundReception, requireFirstReception } from '@/lib/ediel/inbound/receptions'
// lib/ediel/core/kernel.ts

import type {
  CreateEdielMessageInput,
  EdielEnvironment,
  EdielMessageRow,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import {
  createCanonicalDuplicateBlockEvent,
  createEdielMessage,
} from '@/lib/ediel/db'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import {
  type CanonicalRouteRequestType,
  resolveCanonicalRouteContext,
} from '@/lib/ediel/core/routeRegistry'
import {
  buildCanonicalOutboundReferences,
} from '@/lib/ediel/core/referenceRegistry'
import {
  buildInboundCanonicalIdentity,
  findInboundDuplicateByCanonicalIdentity,
  findOutboundEdielMessageDuplicate,
} from '@/lib/ediel/core/dedupe'
import {
  resolveCanonicalInboundAcceptedVersions,
  resolveCanonicalOutboundVersion,
} from '@/lib/ediel/core/versionRegistry'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { prepareAiBiInboundReconciliation, processAiBiInboundReconciliation } from '@/lib/ediel/aiBiInboundReconciliation'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import type {EdielAckRouteProfileSelection} from '@/lib/ediel/config'

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
  ackProfile?: Pick<EdielAckRouteProfileSelection, 'family' | 'code'>
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
    ...(params.ackProfile !== undefined ? {ackProfile: params.ackProfile} : {}),
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
  reception?: {inboundEmailMessageId:string;parseResultId:string}
}) {
  const actorUserId=ensureActorUserId(params.actorUserId),input=params.input
  if(input.direction!=='inbound' || !['test','production'].includes(input.environment??''))
    throw new Error('canonical_inbound_scope_required')
  if(input.companyId)await assertEdielTenantActor({companyId:input.companyId,actorUserId,permission:'communication.write'})
  const isAiBiSource=input.messageStandard==='ai_list'||input.messageFamily==='AI_LIST'||/^\uFEFF?(AI|BI);/.test(input.rawPayload??'')
  if(isAiBiSource&&!input.companyId)throw new Error('ai_bi_reconciliation_tenant_source_required')
  const identity=buildInboundCanonicalIdentity({...input,senderEdielId:input.senderEdielId,
    receiverEdielId:input.receiverEdielId,applicationReference:input.applicationReference})
  const observe=async(message:EdielMessageRow)=>{
    if(!params.reception)return
    if(!input.companyId||isAiBiSource)throw new Error('canonical_inbound_reception_scope_required')
    const r=await recordInboundReception({companyId:input.companyId,messageId:message.id,actorUserId,...params.reception})
    requireFirstReception(r)
  }
  const reuse=async(duplicate:EdielMessageRow)=>{
    await observe(duplicate)
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
    await observe(message)
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
      if(requiresBilateralProdatOutboundOwner(params.baseInput))return createAtomicBilateralProdatOriginal(params.baseInput,actorUserId)
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

  if(requiresBilateralProdatOutboundOwner(params.baseInput))return createAtomicBilateralProdatOriginal(params.baseInput,actorUserId)
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

/** Keep the compatibility entry on the same protected source/replay gateway.
 * Lazy import avoids the route/outbound facade's static module dependency. */
export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const gateway = await import('./kernel')
  return gateway.createCanonicalAckMessage(params)
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
