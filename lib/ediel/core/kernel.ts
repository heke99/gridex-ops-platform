import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalRouteRequestType } from '@/lib/ediel/core/routeRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import {
  buildCanonicalAckReferences,
  buildCanonicalOutboundReferences,
} from '@/lib/ediel/core/referenceRegistry'
import {
  createCanonicalAckConflictEvent,
  createEdielMessage,
  findSequencedAckForSource,
} from '@/lib/ediel/db'
import {
  hasCanonicalAckDuplicate,
} from '@/lib/ediel/core/dedupe'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import {
  createCanonicalOutboundMessage,
  resolveCanonicalOutboundContext,
} from './kernelLegacy'

export {
  resolveCanonicalOutboundContext,
  resolveCanonicalInboundActor,
  resolveOutboundMessageVersion,
  resolveInboundAcceptedVersions,
  registerInboundCanonicalMessage,
  createCanonicalOutboundMessage,
  buildCanonicalReferencesForOutbound,
} from './kernelLegacy'

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
  return postgresErrorMessage(error).includes('uq_ediel_messages_outbound_ack_per_source')
}

function sequenceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const FINAL_CANONICAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])

function isFinalCanonicalAckStatus(value: unknown): boolean {
  return FINAL_CANONICAL_ACK_STATUSES.has(String(value ?? '').toLowerCase())
}

async function assertOutboundDraftAllowedByCanonicalPolicy(params: {
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
    parsedPayload: params.draft.parsedPayload ?? null,
    mode: 'send',
    direction: 'outbound',
    environment: params.draft.environment ?? null,
    version: params.messageVersion ?? params.draft.messageVersion ?? null,
    companyId: params.draft.companyId ?? null,
  })

  if (validation.fieldRuleSource !== 'registry' || !validation.rulePackSnapshot) {
    throw new Error(`outbound_ediel_canonical_policy_evidence_missing:${params.draft.messageFamily}:${params.draft.messageCode}`)
  }
  const blocking = validation.issues.filter((item) => item.severity === 'error' || item.blocking)
  if (blocking.length > 0) {
    const first = blocking[0]
    throw new Error(
      `Outbound ${params.draft.messageFamily} ${params.draft.messageCode} blockerades av canonical Ediel-policy: ${first.code} - ${first.description}`,
    )
  }
  return validation.rulePackSnapshot
}

function inheritedSourceRulePackSnapshot(sourceMessage: EdielMessageRow) {
  const embedded = sourceMessage.rule_pack_snapshot ?? {}
  const profileKey = String(sourceMessage.rule_profile_key ?? embedded.profileKey ?? '').trim()
  const profileVersionId = String(sourceMessage.rule_profile_version_id ?? embedded.profileVersionId ?? '').trim()
  const version = String(sourceMessage.rule_profile_version ?? embedded.version ?? '').trim()
  const checksum = String(sourceMessage.rule_pack_checksum ?? embedded.checksum ?? '').trim()
  if (!profileKey || !profileVersionId || !version || !checksum) {
    throw new Error(`canonical_ack_source_rule_pack_snapshot_missing:${sourceMessage.id}`)
  }
  return {
    profileKey,
    profileVersionId,
    version,
    checksum,
    inheritedFromSourceMessage: true as const,
    sourceMessageId: sourceMessage.id,
  }
}

/**
 * Public ACK gateway. ACK/error families inherit the exact activated rule-pack
 * evidence from the business message they acknowledge. They never select an
 * independent mutable business rule pack.
 */
export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const sourceSnapshot = inheritedSourceRulePackSnapshot(params.sourceMessage)
  const companyId = params.draft.companyId ?? params.sourceMessage.company_id ?? null
  if (!companyId) throw new Error('canonical_ack_company_required')
  const canonicalRulePackId = params.sourceMessage.canonical_rule_pack_id ?? null
  if (!canonicalRulePackId) throw new Error(`canonical_ack_source_rule_pack_id_missing:${params.sourceMessage.id}`)
  const environment = params.draft.environment ?? params.sourceMessage.environment
  const routeContext = await resolveCanonicalOutboundContext({
  requestType: 'ediel_ack',
  companyId,
  environment,
  messageStandard: params.draft.messageStandard ?? 'edifact',
  receiverEdielId: params.draft.receiverEdielId ?? params.sourceMessage.sender_ediel_id ?? null,
  applicationReference: params.draft.applicationReference ?? params.sourceMessage.application_reference ?? null,
})
  const routeProfileId = routeContext.routeRuntime?.route_profile_id ?? null
  if (!routeProfileId) throw new Error(`canonical_ack_route_profile_required:${routeContext.route.id}`)

  const draftWithSourceSnapshot: CreateEdielMessageInput = {
    ...params.draft,
    parsedPayload: {
      ...(params.draft.parsedPayload ?? {}),
      canonicalSourceRulePackSnapshot: sourceSnapshot,
    },
  }

  const allowSequencedUtiltsErr =
    params.ackFamily === 'UTILTS_ERR' &&
    typeof draftWithSourceSnapshot.parsedPayload?.utiltsErrSequenceToken === 'string' &&
    draftWithSourceSnapshot.parsedPayload.utiltsErrSequenceToken.trim().length > 0

  const allowSequencedAperak =
    params.ackFamily === 'APERAK' &&
    draftWithSourceSnapshot.parsedPayload?.ackScope === 'transaction' &&
    typeof draftWithSourceSnapshot.parsedPayload?.relatedTransactionReference === 'string' &&
    draftWithSourceSnapshot.parsedPayload.relatedTransactionReference.trim().length > 0

  const sequenceToken = allowSequencedAperak
    ? sequenceString(draftWithSourceSnapshot.parsedPayload?.relatedTransactionReference)
    : allowSequencedUtiltsErr
      ? sequenceString(draftWithSourceSnapshot.parsedPayload?.utiltsErrSequenceToken)
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
        externalReference: draftWithSourceSnapshot.externalReference ?? baseRefs.externalReference,
        transactionReference: draftWithSourceSnapshot.transactionReference ?? baseRefs.transactionReference,
        correlationReference: draftWithSourceSnapshot.correlationReference ?? baseRefs.correlationReference,
      }
    : baseRefs

  const input: CreateEdielMessageInput = {
    ...draftWithSourceSnapshot,
    actorUserId,
    companyId,
    communicationRouteId: routeContext.route.id,
    routeProfileId,
    canonicalRulePackId,
    sourceOperationId: `ediel_ack:${params.sourceMessage.id}:${params.ackFamily}:${sequenceToken ?? 'message'}`,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    relatedMessageId: params.sourceMessage.id,
    ackOutcome: params.outcome ?? draftWithSourceSnapshot.ackOutcome ?? null,
  }

  const rulePackSnapshot = await assertOutboundDraftAllowedByCanonicalPolicy({
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
      inheritedFromSourceMessage: true,
      sourceMessageId: params.sourceMessage.id,
      authority: 'resolveCanonicalEdielPolicy',
      databaseRole: 'evidence_only',
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

/**
 * Canonical outbound gateway. Version/reference ownership stays in their
 * dedicated canonical registries, while field/D-condition validation consumes
 * the policy snapshot created by the renderer. The persisted DB rule pack is
 * evidence only and cannot redefine protocol semantics.
 */
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

  const baseInput: CreateEdielMessageInput = {
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

  const rulePackSnapshot = await assertOutboundDraftAllowedByCanonicalPolicy({
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
      authority: 'resolveCanonicalEdielPolicy',
      databaseRole: 'evidence_only',
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
