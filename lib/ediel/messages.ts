// lib/ediel/messages.ts

import { buildEdielInterchangeReference } from '@/lib/ediel/references'

export type EdifactEnvelopeInput = {
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  testFlag?: 0 | 1
  charset?: string | null
  interchangeReference?: string | null
  messageTypeToken: string
  messageReferenceNo?: string | null
  segments: string[]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatEdifactDateYYMMDD(date = new Date()): string {
  return `${pad2(date.getUTCFullYear() % 100)}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate()
  )}`
}

export function formatEdifactTimeHHMM(date = new Date()): string {
  return `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`
}

export function buildUnaSegment(): string {
  return 'UNA:+.? '
}

export function buildUnbSegment(input: {
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  testFlag?: 0 | 1
  charset?: string | null
  interchangeReference?: string | null
  date?: Date
}): string {
  const date = input.date ?? new Date()
  const senderSub = (input.senderSubAddress ?? '').trim()
  const receiverSub = (input.receiverSubAddress ?? '').trim()
  const charset = (input.charset ?? 'UNOC').trim() || 'UNOC'
  const interchangeReference =
    input.interchangeReference ??
    buildEdielInterchangeReference({
      senderEdielId: input.senderEdielId,
      receiverEdielId: input.receiverEdielId,
    })

  const sender = `${input.senderEdielId}:ZZ${senderSub ? `:${senderSub}` : ''}`
  const receiver = `${input.receiverEdielId}:ZZ${receiverSub ? `:${receiverSub}` : ''}`
  const applicationReference = (input.applicationReference ?? '').trim()
  const testSuffix = input.testFlag === 1 ? '+1' : ''

  return [
    'UNB',
    `${charset}:3`,
    sender,
    receiver,
    `${formatEdifactDateYYMMDD(date)}:${formatEdifactTimeHHMM(date)}`,
    interchangeReference,
    '',
    applicationReference,
    '',
    testSuffix.replace(/^\+/, ''),
  ]
    .join('+')
    .replace(/\++$/, '')
}

export function buildUnhSegment(messageReferenceNo: string, messageTypeToken: string): string {
  return `UNH+${messageReferenceNo}+${messageTypeToken}`
}

export function buildUntSegment(
  segmentCountFromUnhToUnt: number,
  messageReferenceNo: string
): string {
  return `UNT+${segmentCountFromUnhToUnt}+${messageReferenceNo}`
}

export function buildUnzSegment(messageCount: number, interchangeReference: string): string {
  return `UNZ+${messageCount}+${interchangeReference}`
}

export function joinEdifactSegments(segments: string[]): string {
  return `${segments.filter(Boolean).join("'")}'`
}

export function buildEdifactEnvelope(input: EdifactEnvelopeInput): {
  raw: string
  interchangeReference: string
} {
  const interchangeReference =
    input.interchangeReference ??
    buildEdielInterchangeReference({
      senderEdielId: input.senderEdielId,
      receiverEdielId: input.receiverEdielId,
    })

  const messageReferenceNo = input.messageReferenceNo ?? '1'
  const bodySegments = input.segments.filter(Boolean)

  const unh = buildUnhSegment(messageReferenceNo, input.messageTypeToken)
  const unt = buildUntSegment(bodySegments.length + 2, messageReferenceNo)

  const allSegments = [
    buildUnaSegment(),
    buildUnbSegment({
      senderEdielId: input.senderEdielId,
      senderSubAddress: input.senderSubAddress,
      receiverEdielId: input.receiverEdielId,
      receiverSubAddress: input.receiverSubAddress,
      applicationReference: input.applicationReference,
      testFlag: input.testFlag ?? 1,
      charset: input.charset ?? 'UNOC',
      interchangeReference,
    }),
    unh,
    ...bodySegments,
    unt,
    buildUnzSegment(1, interchangeReference),
  ]

  return {
    raw: joinEdifactSegments(allSegments),
    interchangeReference,
  }
}