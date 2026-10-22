import { isDeliveryStatusNotification } from './dsnClassifier'
import {
  extractCanonicalEdifactPayload,
  parseCanonicalEdifactAst,
} from '@/lib/ediel/core/canonicalEdifactAst'
import {
  segmentComposite,
  type EdifactTokenizedSegment,
} from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

/** One CONTRL syntax error at its own level (ISO 9735 CONTRL: UCI/UCM 0085,
 * UCS 0096+0085, UCD 0085+S011). Positions are never reported as codes. */
export type ParsedContrlSyntaxError = {
  level: 'interchange' | 'message' | 'segment' | 'data_element'
  code: string | null
  messageReference: string | null
  segmentPosition: string | null
  elementPosition: string | null
  componentPosition: string | null
}

/** One APERAK ERC group: its ERC/9321, the FTX C107/4441 application code and
 * C108 text, and the RFF references that follow it until the next ERC. */
export type ParsedApplicationError = {
  errorCode: string | null
  freeTextCode: string | null
  text: string | null
  references: Record<string, string[]>
}

export type ParsedEdifactEnvelope = {
  rawPayload: string
  messageFamily: 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | 'OTHER'
  messageCode: string | null
  messageFunctionCode: string | null
  acknowledgementRequestCode: string | null
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
  /** FTX/C108 text only; the coded C107 reference and language are separate. */
  freeText: string[]
  freeTextEntries?: Array<{ qualifier: string | null; code: string | null; text: string | null }>
  applicationErrors?: ParsedApplicationError[]
  contrlErrors?: ParsedContrlSyntaxError[]
  segments: string[]
  lineGroups: Array<{
    lineNumber: string | null
    itemId: string | null
    references: Record<string, string[]>
    cciCavCodes: Record<string, string[]>
  }>
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

export function extractEdifactPayload(input: string | null | undefined): string | null {
  return extractCanonicalEdifactPayload(input)
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

// Composites are decoded once from the wire segment. Splitting the already
// decoded `elements` would decode release characters twice: `??` at the end of
// a text threw edifact_dangling_release_character and `?:` lost its colon.
function composite(segment: EdifactTokenizedSegment, index: number, una: EdifactServiceStringAdvice): string[] {
  return segmentComposite(segment, index, una)
}

function firstComponent(segment: EdifactTokenizedSegment, index: number, una: EdifactServiceStringAdvice): string | null {
  return cleanText(composite(segment, index, una)[0] ?? null)
}

export function parseEdifactPayload(rawPayload: string): ParsedEdifactEnvelope {
  const ast = parseCanonicalEdifactAst(rawPayload)
  const { una } = ast
  const references: Record<string, string[]> = {}
  const parties: Record<string, string[]> = {}
  const dates: Record<string, string[]> = {}
  const locations: Record<string, string[]> = {}
  const quantities: ParsedEdifactEnvelope['quantities'] = []
  const errorCodes: string[] = []
  const freeText: string[] = []
  const freeTextEntries: NonNullable<ParsedEdifactEnvelope['freeTextEntries']> = []
  const applicationErrors: ParsedApplicationError[] = []
  const contrlErrors: ParsedContrlSyntaxError[] = []
  let currentApplicationError: ParsedApplicationError | null = null
  let currentContrlMessage: string | null = null
  let messageFamily: ParsedEdifactEnvelope['messageFamily'] = 'OTHER'
  let messageCode: string | null = null
  let messageFunctionCode: string | null = null
  let acknowledgementRequestCode: string | null = null
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

  for (const segment of ast.segments) {
    if (segment.tag === 'UNB') {
      const syntax = composite(segment, 1, una)
      const sender = composite(segment, 2, una)
      const receiver = composite(segment, 3, una)
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
      const typeParts = composite(segment, 2, una)
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
      const code = firstComponent(segment, 1, una)
      messageCode = code ?? messageCode
      bgmReference = element(segment, 2) ?? bgmReference
      messageFunctionCode = firstComponent(segment, 3, una) ?? messageFunctionCode
      acknowledgementRequestCode = firstComponent(segment, 4, una) ?? acknowledgementRequestCode
      if (String(code ?? '').toUpperCase() === 'ERR') messageFamily = 'UTILTS_ERR'
    }

    if (segment.tag === 'RFF') {
      const parts = composite(segment, 1, una)
      const qualifier = cleanText(parts[0] ?? null)
      const value = cleanText(parts.slice(1).join(una.componentDataElementSeparator))
      pushRecord(references, qualifier, value)
      if (currentApplicationError) pushRecord(currentApplicationError.references, qualifier, value)
    }

    if (segment.tag === 'DOC') {
      const qualifier = firstComponent(segment, 1, una)
      const value = firstComponent(segment, 2, una)
      pushRecord(references, qualifier ? `DOC_${qualifier}` : 'DOC', value)
    }

    // CONTRL (ISO 9735 / Ediel CONTRL:2:2): UCI 0020,S002,S003,0083,0085;
    // UCM 0062,S009,0083,0085; UCS 0096,0085; UCD 0085,S011(0098:0104).
    if (segment.tag === 'UCI') {
      pushRecord(references, 'UCI', element(segment, 1))
      const actionCode = firstComponent(segment, 4, una)
      if (actionCode) pushRecord(references, 'UCI_ACTION', actionCode)
      const code = firstComponent(segment, 5, una)
      if (code) {
        errorCodes.push(code)
        contrlErrors.push({ level: 'interchange', code, messageReference: null, segmentPosition: null, elementPosition: null, componentPosition: null })
      }
    }

    if (segment.tag === 'UCM') {
      currentContrlMessage = element(segment, 1)
      pushRecord(references, 'UCM', currentContrlMessage)
      const actionCode = firstComponent(segment, 3, una)
      if (actionCode) pushRecord(references, 'UCM_ACTION', actionCode)
      const code = firstComponent(segment, 4, una)
      if (code) {
        errorCodes.push(code)
        contrlErrors.push({ level: 'message', code, messageReference: currentContrlMessage, segmentPosition: null, elementPosition: null, componentPosition: null })
      }
    }

    if (segment.tag === 'UCS') {
      // 0096 is a position, never an error code; 0085 is conditional.
      const code = firstComponent(segment, 2, una)
      if (code) errorCodes.push(code)
      contrlErrors.push({ level: 'segment', code, messageReference: currentContrlMessage, segmentPosition: firstComponent(segment, 1, una),
        elementPosition: null, componentPosition: null })
    }

    if (segment.tag === 'UCD') {
      const code = firstComponent(segment, 1, una)
      if (code) errorCodes.push(code)
      const position = composite(segment, 2, una)
      const segmentPosition = [...contrlErrors].reverse().find((entry) => entry.level === 'segment')?.segmentPosition ?? null
      contrlErrors.push({ level: 'data_element', code, messageReference: currentContrlMessage, segmentPosition,
        elementPosition: cleanText(position[0] ?? null), componentPosition: cleanText(position[1] ?? null) })
    }

    if (segment.tag === 'DTM') {
      const parts = composite(segment, 1, una)
      pushRecord(dates, cleanText(parts[0] ?? null), cleanText(parts[1] ?? null))
    }

    if (segment.tag === 'LOC') {
      const qualifier = firstComponent(segment, 1, una)
      const value = firstComponent(segment, 2, una)
      pushRecord(locations, qualifier, value)
    }

    if (segment.tag === 'QTY') {
      const parts = composite(segment, 1, una)
      const qualifier = cleanText(parts[0] ?? null)
      const value = cleanText(parts[1] ?? null)
      const unit = cleanText(parts[2] ?? null)
      quantities.push({ qualifier, rawValue: value, value: parseNumeric(value), unit })
    }

    if (segment.tag === 'ERC') {
      const code = firstComponent(segment, 1, una)
      if (code) errorCodes.push(code)
      currentApplicationError = { errorCode: code, freeTextCode: null, text: null, references: {} }
      applicationErrors.push(currentApplicationError)
    }

    if (segment.tag === 'FTX') {
      // FTX 4451 + 4453 + C107(4441:1131:3055) + C108(4440 x5) + 3453.
      // Only C108 is free text; the coded C107 reference is its own field.
      const text = composite(segment, 4, una)
        .map((part) => cleanText(part))
        .filter((part): part is string => Boolean(part))
        .join(' ') || null
      const code = firstComponent(segment, 3, una)
      if (text) freeText.push(text)
      freeTextEntries.push({ qualifier: firstComponent(segment, 1, una), code, text })
      if (currentApplicationError && currentApplicationError.text === null && currentApplicationError.freeTextCode === null) {
        currentApplicationError.freeTextCode = code
        currentApplicationError.text = text
      }
    }

    if (segment.tag === 'NAD') {
      const qualifier = firstComponent(segment, 1, una)
      const value = firstComponent(segment, 2, una)
      pushRecord(parties, qualifier, value)
    }

    if (segment.tag === 'UNT' || segment.tag === 'UNH') {
      currentApplicationError = null
      currentContrlMessage = null
    }
  }

  const lineGroups = (ast.messages[0]?.lineGroups ?? []).map((group) => ({
    lineNumber: group.lineNumber,
    itemId: group.itemId,
    references: group.references,
    cciCavCodes: group.cciCavCodes,
  }))

  return {
    rawPayload,
    messageFamily,
    messageCode: normalizeEdifactMessageCode(messageFamily, messageCode),
    messageFunctionCode,
    acknowledgementRequestCode,
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
    freeTextEntries,
    applicationErrors,
    contrlErrors,
    segments: ast.segments.map((segment) => segment.raw),
    lineGroups,
  }
}

export function parseInboundEmailContent(input: {
  rawEmail?: string | null
  bodyText?: string | null
  attachmentText?: string | null
}): ParsedEdifactEnvelope | null {
  if (isDeliveryStatusNotification(input.rawEmail) || isDeliveryStatusNotification(input.bodyText) ||
      isDeliveryStatusNotification(input.attachmentText)) return null
  const payload =
    extractCanonicalEdifactPayload(input.attachmentText) ??
    extractCanonicalEdifactPayload(input.bodyText) ??
    extractCanonicalEdifactPayload(input.rawEmail)

  if (!payload) return null
  return parseEdifactPayload(payload)
}
