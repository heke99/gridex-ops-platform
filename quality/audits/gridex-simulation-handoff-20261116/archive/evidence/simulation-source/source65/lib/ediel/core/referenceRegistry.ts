// lib/ediel/core/referenceRegistry.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { randomBytes, randomUUID } from 'node:crypto'

export type BuildReferenceInput = {
  family: string
  code: string
  relatedMessageId?: string | null
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
  partnerExportId?: string | null
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function compactToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12)
}

function shortContextId(input: BuildReferenceInput): string | null {
  const candidates = [
    input.relatedMessageId,
    input.switchRequestId,
    input.gridOwnerDataRequestId,
    input.outboundRequestId,
    input.partnerExportId,
  ]

  for (const value of candidates) {
    const clean = trimOrNull(value)
    if (!clean) continue

    const normalized = clean.replace(/-/g, '').toUpperCase()
    const shortened = normalized.slice(0, 10)
    if (shortened) return shortened
  }

  return null
}

function utcTimestampToken(date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

export function normalizeEdielReference(value?: string | null): string | null {
  return trimOrNull(value)
}

export function normalizeInterchangeReference(value?: string | null): string | null {
  // Original physical identities must remain lossless. Admission validates the
  // source profile's length; normalization may not silently invent a new ID.
  return trimOrNull(value)
}

export function buildEdielExternalReference(input: BuildReferenceInput): string {
  const family = compactToken(input.family)
  const code = compactToken(input.code)
  const contextId = shortContextId(input)
  const timestamp = utcTimestampToken().slice(2)
  const suffix = randomUUID().replace(/-/g, '').toUpperCase()

  if (contextId) {
    return `${family.slice(0, 6)}-${code.slice(0, 6)}-${contextId}-${timestamp}-${suffix}`
  }

  return `${family.slice(0, 6)}-${code.slice(0, 6)}-${timestamp}-${suffix}`
}

export function buildEdielTransactionReference(input: BuildReferenceInput): string {
  // Context stays in its UUID columns. Keep all UUID entropy on wire rather
  // than truncating the random suffix after a long family/context prefix.
  const prefix = compactToken(input.code || input.family).slice(0, 3)
  return `${prefix}${randomUUID().replace(/-/g, '').toUpperCase()}`
}

export function buildEdielInterchangeReference(_params?: {
  senderEdielId?: string | null
  receiverEdielId?: string | null
}) {
  void _params
  // UNB/0020 is bounded to 14. Durable namespace reservation remains the
  // collision authority; cryptographic allocation avoids tenant counters.
  return randomBytes(7).toString('hex').toUpperCase()
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
      relatedMessageId: params.relatedMessageId ?? null,
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


/** Format only newly allocated own ACK group identities. The caller supplies
 * its canonical field-owner limit; no original/correlated identity is cut. */
export function buildEdielAckGroupReference(input:{parentReference:string;groupIndex:number;groupCount:number;maxLength:number}):string {
 const {parentReference,groupIndex,groupCount,maxLength}=input
 if(!/^[A-Za-z0-9_.\/-]{1,35}$/.test(parentReference)||!Number.isSafeInteger(groupCount)||groupCount<1||!Number.isSafeInteger(groupIndex)||groupIndex<0||groupIndex>=groupCount||!Number.isSafeInteger(maxLength)||maxLength<1)throw new Error('ediel_own_ack_group_reference_invalid')
 const reference=groupCount===1?parentReference:`${parentReference}-${groupIndex+1}`
 if(reference.length>maxLength)throw new Error('ediel_own_ack_group_reference_invalid')
 return reference
}

export function buildCanonicalAckReferences(params: {
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
}): CanonicalReferenceSet {
  const ackFamily = params.ackFamily === 'UTILTS_ERR' ? 'UTILTS_ERR' : params.ackFamily

  return {
    externalReference: buildEdielTransactionReference({
      family: ackFamily,
      code: params.ackFamily,
      relatedMessageId: params.sourceMessage.id,
    }),
    transactionReference: buildEdielTransactionReference({
      family: ackFamily,
      code: params.ackFamily,
      relatedMessageId: params.sourceMessage.id,
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

export function normalizeInboundMailboxIdentity(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function normalizeInboundEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function inferInboundAiListExternalReference(params: {
  subject?: string | null
  mailboxMessageId?: string | null
}): string | null {
  const subjectToken =
    typeof params.subject === 'string'
      ? params.subject.match(/[A-Z0-9._-]{6,}/)?.[0] ?? null
      : null

  return trimOrNull(subjectToken) ?? trimOrNull(params.mailboxMessageId)
}
