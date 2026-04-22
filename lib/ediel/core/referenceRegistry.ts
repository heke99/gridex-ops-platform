// lib/ediel/core/referenceRegistry.ts

import {
  buildEdielExternalReference,
  buildEdielTransactionReference,
} from '@/lib/ediel/references'
import type { EdielMessageRow } from '@/lib/ediel/types'

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type CanonicalReferenceSet = {
  externalReference: string | null
  transactionReference: string | null
  correlationReference: string | null
  originalMessageId: string | null
  originalTransactionId: string | null
  originalMessageCode: string | null
}

export function buildCanonicalOutboundReferences(params: {
  family: string
  code: string
  relatedMessageId?: string | null
  preferredExternalReference?: string | null
  preferredTransactionReference?: string | null
  correlationReference?: string | null
  originalMessageId?: string | null
  originalTransactionId?: string | null
  originalMessageCode?: string | null
}): CanonicalReferenceSet {
  const externalReference =
    trimOrNull(params.preferredExternalReference) ??
    buildEdielExternalReference({
      family: params.family,
      code: params.code,
      relatedMessageId: params.relatedMessageId ?? null,
    })

  const transactionReference =
    trimOrNull(params.preferredTransactionReference) ??
    buildEdielTransactionReference({
      family: params.family,
      code: params.code,
    })

  return {
    externalReference,
    transactionReference,
    correlationReference:
      trimOrNull(params.correlationReference) ?? params.relatedMessageId ?? externalReference,
    originalMessageId: trimOrNull(params.originalMessageId),
    originalTransactionId: trimOrNull(params.originalTransactionId),
    originalMessageCode: trimOrNull(params.originalMessageCode),
  }
}

export function buildCanonicalAckReferences(params: {
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
}): CanonicalReferenceSet {
  const ackFamily = params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily

  return {
    externalReference: buildEdielExternalReference({
      family: ackFamily,
      code: params.ackFamily,
      relatedMessageId: params.sourceMessage.id,
    }),
    transactionReference: buildEdielTransactionReference({
      family: ackFamily,
      code: params.ackFamily,
    }),
    correlationReference:
      trimOrNull(params.sourceMessage.correlation_reference) ?? params.sourceMessage.id,
    originalMessageId:
      trimOrNull(params.sourceMessage.external_reference) ??
      trimOrNull(params.sourceMessage.interchange_reference) ??
      params.sourceMessage.id,
    originalTransactionId: trimOrNull(params.sourceMessage.transaction_reference),
    originalMessageCode: trimOrNull(String(params.sourceMessage.message_code)),
  }
}

export function normalizeInboundReferenceIdentity(params: {
  senderEdielId?: string | null
  interchangeReference?: string | null
  transactionReference?: string | null
  externalReference?: string | null
}) {
  return {
    senderEdielId: trimOrNull(params.senderEdielId),
    interchangeReference: trimOrNull(params.interchangeReference),
    transactionReference: trimOrNull(params.transactionReference),
    externalReference: trimOrNull(params.externalReference),
  }
}