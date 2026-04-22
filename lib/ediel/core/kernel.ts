// lib/ediel/core/kernel.ts

import type {
  CreateEdielMessageInput,
  EdielEnvironment,
  EdielMessageRow,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import { createEdielMessage, createEdielMessageEvent } from '@/lib/ediel/db'
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
import { resolveMessageVersion } from '@/lib/ediel/config'

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

  return resolveMessageVersion({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    fallback: params.fallback ?? null,
    environment: params.environment ?? 'test',
  })
}

export async function resolveInboundAcceptedVersions(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}) {
  const { resolveInboundAcceptedMessageRules } = await import('@/lib/ediel/config')
  return resolveInboundAcceptedMessageRules({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
    date: params.date ?? null,
  })
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
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: duplicate.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
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
    receiverEdielId?: string | null
    messageFamily: string
    messageCode: string
    messageVersion?: string | null
  }
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)

  if (params.duplicateCheck) {
    const duplicate = await findOutboundEdielMessageDuplicate({
      outboundRequestId: params.duplicateCheck.outboundRequestId ?? null,
      receiverEdielId: params.duplicateCheck.receiverEdielId ?? null,
      messageFamily: params.duplicateCheck.messageFamily,
      messageCode: params.duplicateCheck.messageCode,
      messageVersion: params.duplicateCheck.messageVersion ?? null,
    })

    if (duplicate) {
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: duplicate.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Outbound dublett blockerad i canonical kernel.',
        payload: params.duplicateCheck,
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
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: `Ack-dublett blockerad i canonical kernel för ${params.ackFamily}.`,
      payload: {
        ackFamily: params.ackFamily,
        outcome: params.outcome ?? null,
        existingAckMessageId: duplicate.id,
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