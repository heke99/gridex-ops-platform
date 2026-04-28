// lib/ediel/messages.ts

import { buildEdielInterchangeReference } from '@/lib/ediel/references'

type BuildEdifactEnvelopeInput = {
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  testFlag?: 0 | 1 | number | null
  messageTypeToken: string
  segments: string[]
}

type BuiltEdifactEnvelope = {
  raw: string
  interchangeReference: string
  messageReference: string
  segmentCount: number
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeSegment(value: string): string {
  return value.replace(/[\r\n]+/g, '').trim()
}

function utcDateYYMMDD(date = new Date()) {
  const year = String(date.getUTCFullYear()).slice(-2)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function utcTimeHHMM(date = new Date()) {
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}${minutes}`
}

function buildUnaSegment() {
  return "UNA:+.? '"
}

function buildUnbSegment(params: {
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  interchangeReference: string
  testFlag?: number | null
}) {
  const senderSub = trimOrNull(params.senderSubAddress)
  const receiverSub = trimOrNull(params.receiverSubAddress)

  const senderComposite = senderSub
    ? `${params.senderEdielId}:ZZ:${senderSub}`
    : `${params.senderEdielId}:ZZ`
  const receiverComposite = receiverSub
    ? `${params.receiverEdielId}:ZZ:${receiverSub}`
    : `${params.receiverEdielId}:ZZ`

  const applicationReference = trimOrNull(params.applicationReference)
  const testFlag = params.testFlag === 0 ? '0' : '1'

  const parts = [
    'UNB',
    'UNOC:3',
    senderComposite,
    receiverComposite,
    `${utcDateYYMMDD()}:${utcTimeHHMM()}`,
    params.interchangeReference,
    '',
    applicationReference ?? '',
    '',
    testFlag,
  ]

  return parts.join('+')
}

function buildUnzSegment(params: { messageCount: number; interchangeReference: string }) {
  return `UNZ+${params.messageCount}+${params.interchangeReference}`
}

function buildUntSegment(params: { segmentCount: number; messageReference: string }) {
  return `UNT+${params.segmentCount}+${params.messageReference}`
}

function messageRefToken() {
  return '1'
}

export function buildEdifactEnvelope(
  input: BuildEdifactEnvelopeInput
): BuiltEdifactEnvelope {
  const interchangeReference = buildEdielInterchangeReference({
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
  })

  const messageReference = messageRefToken()

  const bodySegments = input.segments.map(sanitizeSegment).filter(Boolean)
  const hasUnh = bodySegments[0]?.startsWith('UNH+')
  const normalizedBody = hasUnh
    ? bodySegments
    : [`UNH+${messageReference}+${input.messageTypeToken}`, ...bodySegments]

  const unt = buildUntSegment({
    segmentCount: normalizedBody.length + 1,
    messageReference,
  })

  const segments = [
    buildUnaSegment(),
    buildUnbSegment({
      senderEdielId: input.senderEdielId,
      senderSubAddress: input.senderSubAddress,
      receiverEdielId: input.receiverEdielId,
      receiverSubAddress: input.receiverSubAddress,
      applicationReference: input.applicationReference,
      interchangeReference,
      testFlag: input.testFlag ?? 1,
    }),
    ...normalizedBody,
    unt,
    buildUnzSegment({
      messageCount: 1,
      interchangeReference,
    }),
  ]

  const raw = segments.join("'") + "'"

  return {
    raw,
    interchangeReference,
    messageReference,
    segmentCount: normalizedBody.length + 2,
  }
}