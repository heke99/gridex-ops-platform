import {
  firstCompositeComponent,
  splitComposite,
  tokenizeEdifact,
  type EdifactTokenizedSegment,
} from '@/lib/ediel/core/edifactTokenizer'

export type ParsedEdifactEnvelope = {
  rawPayload: string
  messageFamily: 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | 'OTHER'
  messageCode: string | null
  interchangeReference: string | null
  transactionReference: string | null
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  applicationReference: string | null
  bgmReference: string | null
  messageTypeVersion: {
    syntaxIdentifier: string | null
    directoryVersion: string | null
    release: string | null
    controllingAgency: string | null
    associationAssignedCode: string | null
  }
  references: Record<string, string[]>
  parties: Record<string, string[]>
  dates: Record<string, string[]>
  locations: Record<string, string[]>
  quantities: Array<{ qualifier: string | null; value: number | null; rawValue: string | null; unit: string | null }>
  errorCodes: string[]
  freeText: string[]
  segments: string[]
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeEdifactMessageCode(
  messageFamily: ParsedEdifactEnvelope['messageFamily'] | string | null | undefined,
  messageCode: string | null | undefined,
): string {
  const code = cleanText(messageCode)
  if (code) return code

  const family = String(messageFamily ?? '').trim().toUpperCase()
  if (family === 'CONTRL') return 'CONTRL'
  if (family === 'APERAK') return 'APERAK'
  if (family === 'UTILTS_ERR') return 'ERR'
  if (family === 'PRODAT') return 'PRODAT_UNKNOWN'
  if (family === 'UTILTS') return 'UTILTS_UNKNOWN'
  return 'OTHER'
}

function pushRecord(record: Record<string, string[]>, key: string | null, value: string | null) {
  if (!key || !value) return
  record[key] = [...(record[key] ?? []), value]
}

function normalizeMimeText(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=27/g, "'")
    .replace(/=2B/gi, '+')
    .replace(/=3A/gi, ':')
    .replace(/=0D=0A/gi, '\n')
}

function edifactStartIndex(candidate: string): number {
  const unaIndex = candidate.indexOf('UNA')
  const unbIndex = candidate.indexOf('UNB')
  if (unaIndex >= 0 && unbIndex >= 0) return Math.min(unaIndex, unbIndex)
  return unaIndex >= 0 ? unaIndex : unbIndex
}

function segmentTerminatorForPayload(payload: string): string {
  // UNA is exactly nine characters including the segment terminator.
  return payload.startsWith('UNA') && payload.length >= 9 ? payload[8] : "'"
}

export function extractEdifactPayload(input: string | null | undefined): string | null {
  const raw = cleanText(input)
  if (!raw) return null

  const candidates = [raw, normalizeMimeText(raw)]

  for (const candidate of candidates) {
    const start = edifactStartIndex(candidate)
    if (start < 0) continue

    const fromStart = candidate.slice(start)
    const terminator = segmentTerminatorForPayload(fromStart)
    const unzIndex = fromStart.lastIndexOf('UNZ')
    if (unzIndex < 0) return fromStart.trim()

    const end = fromStart.indexOf(terminator, unzIndex)
    if (end < 0) return fromStart.trim()

    return fromStart.slice(0, end + 1).trim()
  }

  return null
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null
  const normalized = value.replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function element(segment: EdifactTokenizedSegment, index: number): string | null {
  return cleanText(segment.elements[index] ?? null)
}

export function parseEdifactPayload(rawPayload: string): ParsedEdifactEnvelope {
  const tokenized = tokenizeEdifact(rawPayload)
  const { una } = tokenized
  const references: Record<string, string[]> = {}
  const parties: Record<string, string[]> = {}
  const dates: Record<string, string[]> = {}
  const locations: Record<string, string[]> = {}
  const quantities: ParsedEdifactEnvelope['quantities'] = []
  const errorCodes: string[] = []
  const freeText: string[] = []
  let messageFamily: ParsedEdifactEnvelope['messageFamily'] = 'OTHER'
  let messageCode: string | null = null
  let interchangeReference: string | null = null
  let transactionReference: string | null = null
  let senderEdielId: string | null = null
  let senderSubAddress: string | null = null
  let receiverEdielId: string | null = null
  let receiverSubAddress: string | null = null
  let applicationReference: string | null = null
  let bgmReference: string | null = null
  let syntaxIdentifier: string | null = null
  let directoryVersion: string | null = null
  let release: string | null = null
  let controllingAgency: string | null = null
  let associationAssignedCode: string | null = null

  for (const segment of tokenized.segments) {
    if (segment.tag === 'UNB') {
      const syntax = splitComposite(segment.elements[1], una)
      const sender = splitComposite(segment.elements[2], una)
      const receiver = splitComposite(segment.elements[3], una)
      syntaxIdentifier = cleanText(syntax[0] ?? null)
      senderEdielId = cleanText(sender[0] ?? null)
      senderSubAddress = cleanText(sender[2] ?? null)
      receiverEdielId = cleanText(receiver[0] ?? null)
      receiverSubAddress = cleanText(receiver[2] ?? null)
      interchangeReference = element(segment, 5)
      applicationReference = element(segment, 7) ?? applicationReference
    }

    if (segment.tag === 'UNH') {
      transactionReference = element(segment, 1) ?? transactionReference
      const typeParts = splitComposite(segment.elements[2], una)
      const family = cleanText(typeParts[0] ?? null)?.toUpperCase() ?? 'OTHER'
      messageFamily = family === 'PRODAT' || family === 'UTILTS' || family === 'CONTRL' || family === 'APERAK'
        ? family
        : family === 'UTILTS_ERR'
          ? 'UTILTS_ERR'
          : 'OTHER'
      directoryVersion = cleanText(typeParts[1] ?? null)
      release = cleanText(typeParts[2] ?? null)
      controllingAgency = cleanText(typeParts[3] ?? null)
      associationAssignedCode = cleanText(typeParts[4] ?? null)
    }

    if (segment.tag === 'BGM') {
      const code = firstCompositeComponent(segment.elements[1], una)
      messageCode = code ?? messageCode
      bgmReference = element(segment, 2) ?? bgmReference
      if (String(code ?? '').toUpperCase() === 'ERR') messageFamily = 'UTILTS_ERR'
    }

    if (segment.tag === 'RFF') {
      const parts = splitComposite(segment.elements[1], una)
      const qualifier = cleanText(parts[0] ?? null)
      const value = cleanText(parts.slice(1).join(una.componentDataElementSeparator))
      pushRecord(references, qualifier, value)
    }

    if (segment.tag === 'DOC') {
      const qualifier = firstCompositeComponent(segment.elements[1], una)
      const value = firstCompositeComponent(segment.elements[2], una)
      pushRecord(references, qualifier ? `DOC_${qualifier}` : 'DOC', value)
    }

    if (segment.tag === 'UCI') {
      pushRecord(references, 'UCI', element(segment, 1))
      const actionCode = firstCompositeComponent(segment.elements[4], una)
      if (actionCode) pushRecord(references, 'UCI_ACTION', actionCode)
    }

    if (segment.tag === 'UCM') {
      pushRecord(references, 'UCM', element(segment, 1))
      const actionCode = firstCompositeComponent(segment.elements[4], una)
      if (actionCode) pushRecord(references, 'UCM_ACTION', actionCode)
    }

    if (segment.tag === 'UCS') {
      const code = firstCompositeComponent(segment.elements[2] ?? segment.elements[1], una)
      if (code) errorCodes.push(code)
    }

    if (segment.tag === 'DTM') {
      const parts = splitComposite(segment.elements[1], una)
      pushRecord(dates, cleanText(parts[0] ?? null), cleanText(parts[1] ?? null))
    }

    if (segment.tag === 'LOC') {
      const qualifier = firstCompositeComponent(segment.elements[1], una)
      const value = firstCompositeComponent(segment.elements[2], una)
      pushRecord(locations, qualifier, value)
    }

    if (segment.tag === 'QTY') {
      const parts = splitComposite(segment.elements[1], una)
      const qualifier = cleanText(parts[0] ?? null)
      const value = cleanText(parts[1] ?? null)
      const unit = cleanText(parts[2] ?? null)
      quantities.push({ qualifier, rawValue: value, value: parseNumeric(value), unit })
    }

    if (segment.tag === 'ERC') {
      const code = firstCompositeComponent(segment.elements[1], una)
      if (code) errorCodes.push(code)
    }

    if (segment.tag === 'FTX') {
      const text = segment.elements
        .slice(3)
        .flatMap((value) => splitComposite(value, una))
        .map((part) => cleanText(part))
        .filter((part): part is string => Boolean(part))
        .join(' ')
      if (text) freeText.push(text)
    }

    if (segment.tag === 'NAD') {
      const qualifier = firstCompositeComponent(segment.elements[1], una)
      const value = firstCompositeComponent(segment.elements[2], una)
      pushRecord(parties, qualifier, value)
    }
  }

  return {
    rawPayload,
    messageFamily,
    messageCode: normalizeEdifactMessageCode(messageFamily, messageCode),
    interchangeReference,
    transactionReference,
    senderEdielId,
    senderSubAddress,
    receiverEdielId,
    receiverSubAddress,
    applicationReference,
    bgmReference,
    messageTypeVersion: {
      syntaxIdentifier,
      directoryVersion,
      release,
      controllingAgency,
      associationAssignedCode,
    },
    references,
    parties,
    dates,
    locations,
    quantities,
    errorCodes,
    freeText,
    segments: tokenized.segments.map((segment) => segment.raw),
  }
}

export function parseInboundEmailContent(input: {
  rawEmail?: string | null
  bodyText?: string | null
  attachmentText?: string | null
}): ParsedEdifactEnvelope | null {
  const payload =
    extractEdifactPayload(input.attachmentText) ??
    extractEdifactPayload(input.bodyText) ??
    extractEdifactPayload(input.rawEmail)

  if (!payload) return null
  return parseEdifactPayload(payload)
}
