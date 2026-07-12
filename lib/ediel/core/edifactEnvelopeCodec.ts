import { tokenizeEdifact, splitComposite, firstCompositeComponent, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { DEFAULT_UNA, parseUna, serializeUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type EdifactEnvironment = 'test' | 'production'

export type EdifactEnvelopeMessageInput = {
  messageReference: string
  messageTypeToken: string
  businessSegments: readonly string[]
}

export type EdifactEnvelopeEncodeInput = {
  sender: string
  receiver: string
  interchangeReference: string
  messages: readonly EdifactEnvelopeMessageInput[]
  senderQualifier?: string | null
  receiverQualifier?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  applicationReference?: string | null
  environment: EdifactEnvironment
  createdAt?: Date
  timeZone?: string
  una?: Partial<EdifactServiceStringAdvice>
}

export type ParsedEdifactEnvelope = {
  una: EdifactServiceStringAdvice
  sender: string | null
  senderQualifier: string | null
  senderSubAddress: string | null
  receiver: string | null
  receiverQualifier: string | null
  receiverSubAddress: string | null
  date: string | null
  time: string | null
  interchangeReference: string | null
  recipientReference: string | null
  applicationReference: string | null
  processingPriorityCode: string | null
  acknowledgementRequest: string | null
  communicationsAgreementId: string | null
  testIndicator: string | null
  environment: EdifactEnvironment
  messageCount: number | null
  rawPayload: string
  segments: EdifactTokenizedSegment[]
}

const UNB = {
  SYNTAX: 1,
  SENDER: 2,
  RECEIVER: 3,
  DATETIME: 4,
  INTERCHANGE_REFERENCE: 5,
  RECIPIENT_REFERENCE: 6,
  APPLICATION_REFERENCE: 7,
  PROCESSING_PRIORITY: 8,
  ACK_REQUEST: 9,
  COMMUNICATIONS_AGREEMENT: 10,
  TEST_INDICATOR: 11,
} as const

const ENVELOPE_TAGS = new Set(['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'])

function trimOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function sanitizeSegment(value: string): string {
  const segment = String(value ?? '').replace(/\r?\n/g, '').trim().replace(/'+$/g, '')
  if (!segment) throw new Error('edifact_empty_business_segment')
  const tag = segment.split('+', 1)[0]?.toUpperCase()
  if (tag && ENVELOPE_TAGS.has(tag)) {
    throw new Error(`edifact_business_segment_contains_envelope_tag:${tag}`)
  }
  return segment
}

function localDateTimeParts(date: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${String(values.year ?? '').slice(-2)}${values.month ?? ''}${values.day ?? ''}`,
    time: `${values.hour ?? ''}${values.minute ?? ''}`,
  }
}

function partyComposite(id: string, qualifier: string, subAddress?: string | null): string {
  const cleanId = trimOrNull(id)
  if (!cleanId) throw new Error('edifact_party_identifier_required')
  const cleanQualifier = trimOrNull(qualifier) ?? 'ZZ'
  const cleanSubAddress = trimOrNull(subAddress)
  return cleanSubAddress
    ? `${cleanId}:${cleanQualifier}:${cleanSubAddress}`
    : `${cleanId}:${cleanQualifier}`
}

function serializeUnb(input: EdifactEnvelopeEncodeInput): string {
  const local = localDateTimeParts(input.createdAt ?? new Date(), input.timeZone ?? 'Europe/Stockholm')
  const elements = new Array<string>(UNB.TEST_INDICATOR + 1).fill('')
  elements[0] = 'UNB'
  elements[UNB.SYNTAX] = 'UNOC:3'
  elements[UNB.SENDER] = partyComposite(input.sender, input.senderQualifier ?? 'ZZ', input.senderSubAddress)
  elements[UNB.RECEIVER] = partyComposite(input.receiver, input.receiverQualifier ?? 'ZZ', input.receiverSubAddress)
  elements[UNB.DATETIME] = `${local.date}:${local.time}`
  elements[UNB.INTERCHANGE_REFERENCE] = trimOrNull(input.interchangeReference) ?? ''
  elements[UNB.APPLICATION_REFERENCE] = trimOrNull(input.applicationReference) ?? ''
  // ISO 9735 / Ediel: production omits 0035. Test uses 1.
  elements[UNB.TEST_INDICATOR] = input.environment === 'test' ? '1' : ''

  while (elements.length > UNB.INTERCHANGE_REFERENCE + 1 && elements.at(-1) === '') {
    // Keep all positions through application reference. For production, trailing
    // empty service elements are intentionally omitted rather than encoded as 0.
    if (elements.length - 1 <= UNB.APPLICATION_REFERENCE) break
    elements.pop()
  }

  return elements.join('+')
}

function countMessageSegments(message: EdifactEnvelopeMessageInput): number {
  return 1 + message.businessSegments.length + 1
}

function encodeMessage(message: EdifactEnvelopeMessageInput): string[] {
  const messageReference = trimOrNull(message.messageReference)
  const messageTypeToken = trimOrNull(message.messageTypeToken)
  if (!messageReference) throw new Error('edifact_message_reference_required')
  if (!messageTypeToken) throw new Error('edifact_message_type_token_required')
  const businessSegments = message.businessSegments.map(sanitizeSegment)
  return [
    `UNH+${messageReference}+${messageTypeToken}`,
    ...businessSegments,
    `UNT+${countMessageSegments({ ...message, businessSegments })}+${messageReference}`,
  ]
}

function parseParty(value: string | null | undefined, una: EdifactServiceStringAdvice): {
  id: string | null
  qualifier: string | null
  subAddress: string | null
} {
  const parts = splitComposite(value, una)
  return {
    id: firstCompositeComponent(value, una),
    qualifier: trimOrNull(parts[1]),
    subAddress: trimOrNull(parts[2]),
  }
}

export class EdifactEnvelopeCodec {
  static encode(input: EdifactEnvelopeEncodeInput): string {
    if (input.messages.length === 0) throw new Error('edifact_at_least_one_message_required')
    const una = { ...DEFAULT_UNA, ...(input.una ?? {}) }
    const messageSegments = input.messages.flatMap(encodeMessage)
    const segments = [
      serializeUnb(input),
      ...messageSegments,
      `UNZ+${input.messages.length}+${trimOrNull(input.interchangeReference) ?? ''}`,
    ]
    return `${serializeUna(una)}${segments.map((segment) => `${segment}${una.segmentTerminator}`).join('')}`
  }

  static decode(rawPayload: string | null | undefined): ParsedEdifactEnvelope {
    const raw = String(rawPayload ?? '')
    const tokenized = tokenizeEdifact(raw)
    const unb = tokenized.segments.find((segment) => segment.tag === 'UNB') ?? null
    const unz = tokenized.segments.find((segment) => segment.tag === 'UNZ') ?? null
    const sender = parseParty(unb?.elements[UNB.SENDER], tokenized.una)
    const receiver = parseParty(unb?.elements[UNB.RECEIVER], tokenized.una)
    const datetime = splitComposite(unb?.elements[UNB.DATETIME], tokenized.una)
    const testIndicator = trimOrNull(unb?.elements[UNB.TEST_INDICATOR])
    const declaredMessageCount = Number(unz?.elements[1])

    return {
      una: parseUna(raw),
      sender: sender.id,
      senderQualifier: sender.qualifier,
      senderSubAddress: sender.subAddress,
      receiver: receiver.id,
      receiverQualifier: receiver.qualifier,
      receiverSubAddress: receiver.subAddress,
      date: trimOrNull(datetime[0]),
      time: trimOrNull(datetime[1]),
      interchangeReference: trimOrNull(unb?.elements[UNB.INTERCHANGE_REFERENCE]),
      recipientReference: trimOrNull(unb?.elements[UNB.RECIPIENT_REFERENCE]),
      applicationReference: trimOrNull(unb?.elements[UNB.APPLICATION_REFERENCE]),
      processingPriorityCode: trimOrNull(unb?.elements[UNB.PROCESSING_PRIORITY]),
      acknowledgementRequest: trimOrNull(unb?.elements[UNB.ACK_REQUEST]),
      communicationsAgreementId: trimOrNull(unb?.elements[UNB.COMMUNICATIONS_AGREEMENT]),
      testIndicator,
      environment: testIndicator === '1' ? 'test' : 'production',
      messageCount: Number.isFinite(declaredMessageCount) ? declaredMessageCount : null,
      rawPayload: raw,
      segments: tokenized.segments,
    }
  }

  static environmentFromLegacyTestFlag(value: string | number | null | undefined): EdifactEnvironment {
    return String(value ?? '').trim() === '1' ? 'test' : 'production'
  }
}

export const EDIFACT_UNB_POSITIONS = UNB
