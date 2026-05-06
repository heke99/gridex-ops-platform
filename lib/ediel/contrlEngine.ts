// lib/ediel/contrlEngine.ts

export type ContrlEngineOutcome = 'positive' | 'negative'

export type ContrlEngineSource = {
  rawPayload?: string | null
  interchangeReference?: string | null
  externalReference?: string | null
  id?: string | null
  senderEdielId?: string | null
  senderSubAddress?: string | null
  receiverEdielId?: string | null
  receiverSubAddress?: string | null
}

export type ContrlEngineResult = {
  segments: string[]
  diagnostics: {
    engine: 'contrl'
    renderer: 'contrlEngine.renderContrl2Ediel2'
    originalInterchangeReference: string
    originalSenderComposite: string
    originalReceiverComposite: string
    syntaxActionCode: '1' | '4'
  }
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeEdifactToken(value?: string | null, maxLength = 35): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const sanitized = trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9_.\/-]/g, '')
    .slice(0, maxLength)

  return sanitized.length > 0 ? sanitized : null
}

function segmentsFromRawPayload(rawPayload?: string | null): string[] {
  if (!rawPayload) return []

  const normalized = rawPayload
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')

  return normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function edielPartyCompositeFromUnb(value?: string | null): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const parts = trimmed
    .split(':')
    .map((part) => sanitizeEdifactToken(part))
    .filter(Boolean)

  return parts.length > 0 ? parts.join(':') : null
}

function fallbackPartyComposite(params: {
  edielId?: string | null
  subAddress?: string | null
}): string | null {
  const edielId = sanitizeEdifactToken(params.edielId)
  if (!edielId) return null

  const subAddress = sanitizeEdifactToken(params.subAddress)
  if (!subAddress) return edielId

  return `${edielId}:ZZ:${subAddress}`
}

export function renderContrl2Ediel2(params: {
  source: ContrlEngineSource
  outcome: ContrlEngineOutcome
  parsedInterchangeReference?: string | null
}): ContrlEngineResult {
  const sourceSegments = segmentsFromRawPayload(params.source.rawPayload)
  const sourceUnb = sourceSegments.find((segment) => segment.toUpperCase().startsWith('UNB+'))
  const sourceUnbParts = sourceUnb?.split('+') ?? []

  const originalInterchangeReference =
    sanitizeEdifactToken(params.parsedInterchangeReference, 14) ??
    sanitizeEdifactToken(params.source.interchangeReference, 14) ??
    sanitizeEdifactToken(sourceUnbParts[5] ?? null, 14) ??
    sanitizeEdifactToken(params.source.externalReference, 14) ??
    sanitizeEdifactToken(params.source.id, 14) ??
    'UNKNOWN'

  const originalSenderComposite =
    edielPartyCompositeFromUnb(sourceUnbParts[2]) ??
    fallbackPartyComposite({
      edielId: params.source.senderEdielId,
      subAddress: params.source.senderSubAddress,
    }) ??
    'UNKNOWN'

  const originalReceiverComposite =
    edielPartyCompositeFromUnb(sourceUnbParts[3]) ??
    fallbackPartyComposite({
      edielId: params.source.receiverEdielId,
      subAddress: params.source.receiverSubAddress,
    }) ??
    'UNKNOWN'

  const syntaxActionCode = params.outcome === 'positive' ? '1' : '4'

  return {
    segments: [
      `UCI+${originalInterchangeReference}+${originalSenderComposite}+${originalReceiverComposite}+${syntaxActionCode}`,
    ],
    diagnostics: {
      engine: 'contrl',
      renderer: 'contrlEngine.renderContrl2Ediel2',
      originalInterchangeReference,
      originalSenderComposite,
      originalReceiverComposite,
      syntaxActionCode,
    },
  }
}
