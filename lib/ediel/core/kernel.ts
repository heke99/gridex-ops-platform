import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalRouteRequestType } from '@/lib/ediel/core/routeRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import {
  createCanonicalOutboundMessage,
  createCanonicalAckMessage as createLegacyCanonicalAckMessage,
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
 * Public ACK gateway. ACK/error families never select an independent normative
 * rule pack: they validate their own protocol semantics through
 * resolveCanonicalEdielPolicy and inherit the exact activation/evidence
 * snapshot of the business message they acknowledge.
 */
export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const sourceSnapshot = inheritedSourceRulePackSnapshot(params.sourceMessage)
  return createLegacyCanonicalAckMessage({
    ...params,
    draft: {
      ...params.draft,
      parsedPayload: {
        ...(params.draft.parsedPayload ?? {}),
        canonicalSourceRulePackSnapshot: sourceSnapshot,
      },
    },
  })
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
  const actorUserId = params.actorUserId && params.actorUserId.trim() ? params.actorUserId.trim() : 'system'
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
