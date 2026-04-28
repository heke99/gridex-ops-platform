// lib/ediel/core/referenceRegistry.ts

import type { EdielMessageRow } from '@/lib/ediel/types'

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

function randomToken(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
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
  const normalized = trimOrNull(value)
  return normalized ? normalized.slice(0, 35) : null
}

export function buildEdielExternalReference(input: BuildReferenceInput): string {
  const family = compactToken(input.family)
  const code = compactToken(input.code)
  const contextId = shortContextId(input)
  const timestamp = utcTimestampToken().slice(2)
  const suffix = randomToken(4)

  if (contextId) {
    return `${family}-${code}-${contextId}-${timestamp}-${suffix}`.slice(0, 70)
  }

  return `${family}-${code}-${timestamp}-${suffix}`.slice(0, 70)
}

export function buildEdielTransactionReference(input: BuildReferenceInput): string {
  const family = compactToken(input.family)
  const code = compactToken(input.code)
  const contextId = shortContextId(input)
  const timestamp = utcTimestampToken()
  const suffix = randomToken(6)

  if (contextId) {
    return `${family}${code}${contextId}${timestamp}${suffix}`.slice(0, 35)
  }

  return `${family}${code}${timestamp}${suffix}`.slice(0, 35)
}

export function buildEdielInterchangeReference(_params?: {
  senderEdielId?: string | null
  receiverEdielId?: string | null
}) {
  // Ediel PRODAT validation flags UNB/0020 and UNZ/0020 when the reference is too long.
  // Keep it compact like the official examples. YYMMDDHHMMSS + two safe random chars = 14.
  const timestamp = utcTimestampToken().slice(2)
  return `${timestamp}${randomToken(2)}`.slice(0, 14)
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