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
  resolveCanonicalInboundAcceptedVersions,
  resolveCanonicalOutboundVersion,
} from '@/lib/ediel/core/versionRegistry'

function ensureActorUserId(value?: string | null) {
  return value && value.trim() ? value.trim() : 'system'
}

function isCanonicalAckFamily(
  family: string | null | undefined
): family is 'CONTRL' | 'APERAK' | 'UTILTS_ERR' {
  return family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR'
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

  const inboundAckFamily = isCanonicalAckFamily(params.input.messageFamily)
    ? params.input.messageFamily
    : null

  if (
    params.input.direction === 'inbound' &&
    inboundAckFamily &&
    params.input.relatedMessageId
  ) {
    const duplicateAck = await hasCanonicalAckDuplicate({
      sourceMessageId: params.input.relatedMessageId,
      ackFamily: inboundAckFamily,
    })

    if (duplicateAck) {
      await createCanonicalDuplicateBlockEvent({
        actorUserId,
        edielMessageId: duplicateAck.id,
        layer: 'canonical_inbound',
        message: 'Inbound ACK-dublett blockerad i canonical kernel.',
        payload: {
          mailbox: identity.mailbox,
          mailboxMessageId: identity.mailboxMessageId,
          senderEdielId: identity.senderEdielId,
          interchangeReference: identity.interchangeReference,
          transactionReference: identity.transactionReference,
          externalReference: identity.externalReference,
          relatedMessageId: params.input.relatedMessageId,
          ackFamily: inboundAckFamily,
          existingAckMessageId: duplicateAck.id,
        },
      })
      return duplicateAck
    }
  }

  try {
    return await createEdielMessage({
      ...params.input,
      actorUserId,
    })
  } catch (error) {
    if (
      isPostgresUniqueViolation(error) &&
      params.input.direction === 'inbound' &&
      inboundAckFamily &&
      params.input.relatedMessageId
    ) {
      const duplicateAck = await hasCanonicalAckDuplicate({
        sourceMessageId: params.input.relatedMessageId,
        ackFamily: inboundAckFamily,
      })

      if (duplicateAck) {
        await createCanonicalDuplicateBlockEvent({
          actorUserId,
          edielMessageId: duplicateAck.id,
          layer: 'canonical_inbound',
          message: 'Inbound ACK-dublett blockerad av databasens unikhetsregel och återanvändes.',
          payload: {
            mailbox: identity.mailbox,
            mailboxMessageId: identity.mailboxMessageId,
            senderEdielId: identity.senderEdielId,
            interchangeReference: identity.interchangeReference,
            transactionReference: identity.transactionReference,
            externalReference: identity.externalReference,
            relatedMessageId: params.input.relatedMessageId,
            ackFamily: inboundAckFamily,
            existingAckMessageId: duplicateAck.id,
          },
        })
        return duplicateAck
      }
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
    baseInput: {
      ...params.draft,
      actorUserId,
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
    },
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
      duplicate.ack_outcome === 'positive' || duplicate.ack_outcome === 'negative'
        ? duplicate.ack_outcome
        : parsedPayload.ackOutcome === 'positive' || parsedPayload.ackOutcome === 'negative'
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
    ackOutcome: params.outcome ?? params.draft.ackOutcome ?? null,
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