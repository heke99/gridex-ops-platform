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
  resolveInboundAcceptedVersionsRuntime,
  resolveOutboundMessageVersionRuntime,
} from '@/lib/ediel/config'

function ensureActorUserId(value?: string | null) {
  return value && value.trim() ? value.trim() : 'system'
}

export async function resolveCanonicalOutboundContext(params: {
  requestType: CanonicalRouteRequestType
  gridOwner?: { id?: string | null; name?: string | null; ediel_id?: string | null } | null
  preferredRouteId?: string | null
  environment?: EdielEnvironment
  messageStandard?: EdielMessageStandard
}) {
  return resolveCanonicalRouteContext({
    requestType: params.requestType,
    gridOwner: (params.gridOwner ?? null) as never,
    preferredRouteId: params.preferredRouteId ?? null,
    environment: params.environment ?? 'test',
    messageStandard: params.messageStandard ?? 'edifact',
  })
}

export async function resolveCanonicalInboundActor(params?: {
  environment?: EdielEnvironment
}) {
  return resolveCanonicalActorContext(params?.environment ?? 'test')
}

export async function resolveOutboundMessageVersion(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  routeDefaultMessageVersion?: string | null
}) {
  if (params.routeDefaultMessageVersion?.trim()) {
    return params.routeDefaultMessageVersion.trim()
  }

  const runtime = await resolveOutboundMessageVersionRuntime({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? null,
    environment: params.environment ?? 'test',
  })

  return runtime.selectedVersion
}

export async function resolveInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  const runtime = await resolveInboundAcceptedVersionsRuntime({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    date: params.date ?? null,
  })

  return runtime.acceptedVersions.map((versionCode, index) => ({
    id: `accepted-${params.family}-${params.code}-${index}`,
    version_code: versionCode,
    valid_from: index === 0 ? params.date ?? null : null,
    valid_to: null,
    requires_contrl: false,
    requires_aperak: false,
    supports_negative_response: false,
  }))
}

export async function registerInboundCanonicalMessage(params: {
  actorUserId?: string | null
  input: CreateEdielMessageInput
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const identity = buildInboundCanonicalIdentity({
    mailbox: params.input.mailbox,
    mailboxMessageId: params.input.mailboxMessageId,
    senderEdielId: params.input.senderEdielId,
    interchangeReference: params.input.interchangeReference,
    transactionReference: params.input.transactionReference,
    externalReference: params.input.externalReference,
  })

  const duplicate = await findInboundDuplicateByCanonicalIdentity(identity)
  if (duplicate) {
    await createCanonicalDuplicateBlockEvent({
      actorUserId,
      edielMessageId: duplicate.id,
      layer: 'canonical_inbound',
      message: 'Inbound dublett blockerad i canonical kernel.',
      payload: {
        mailbox: identity.mailbox,
        mailboxMessageId: identity.mailboxMessageId,
        senderEdielId: identity.senderEdielId,
        interchangeReference: identity.interchangeReference,
        transactionReference: identity.transactionReference,
        externalReference: identity.externalReference,
      },
    })
    return duplicate
  }

  return createEdielMessage({
    ...params.input,
    actorUserId,
  })
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

  if (params.duplicateCheck) {
    const duplicate = await findOutboundEdielMessageDuplicate({
      outboundRequestId: params.duplicateCheck.outboundRequestId ?? null,
      sourceType: params.duplicateCheck.sourceType ?? null,
      sourceId: params.duplicateCheck.sourceId ?? null,
      requestType: params.requestType,
      receiverEdielId: params.duplicateCheck.receiverEdielId ?? null,
      messageFamily: params.duplicateCheck.messageFamily,
      messageCode: params.duplicateCheck.messageCode,
      messageVersion: params.duplicateCheck.messageVersion ?? null,
    })

    if (duplicate) {
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

export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)

  const duplicate = await hasCanonicalAckDuplicate({
    sourceMessageId: params.sourceMessage.id,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
  })

  if (duplicate) {
    const attemptedOutcome = params.outcome ?? null
    const parsedPayload = duplicate.parsed_payload ?? {}
    const existingOutcome =
      parsedPayload.ackOutcome === 'positive' || parsedPayload.ackOutcome === 'negative'
        ? parsedPayload.ackOutcome
        : null

    await createCanonicalAckConflictEvent({
      actorUserId,
      edielMessageId: params.sourceMessage.id,
      ackFamily: params.ackFamily,
      sourceMessageId: params.sourceMessage.id,
      attemptedOutcome,
      existingAckMessageId: duplicate.id,
      existingOutcome,
      reason:
        attemptedOutcome &&
        existingOutcome &&
        attemptedOutcome !== existingOutcome
          ? 'conflicting_outcome'
          : attemptedOutcome
            ? 'duplicate_same_outcome'
            : 'duplicate_same_family',
      payload: {
        duplicateBlockedIn: 'kernel',
      },
    })

    return duplicate
  }

  const refs = buildCanonicalAckReferences({
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
  })

  return createEdielMessage({
    ...params.draft,
    actorUserId,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    relatedMessageId: params.sourceMessage.id,
  })
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