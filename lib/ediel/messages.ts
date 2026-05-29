// lib/ediel/messages.ts

import { buildEdielInterchangeReference } from '@/lib/ediel/references'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder'

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

function swedishDateTimeParts(date = new Date()): Record<string, string> {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function edielLocalDateYYMMDD(date = new Date()) {
  const parts = swedishDateTimeParts(date)
  return `${String(parts.year ?? '').slice(-2)}${parts.month}${parts.day}`
}

function edielLocalTimeHHMM(date = new Date()) {
  const parts = swedishDateTimeParts(date)
  return `${parts.hour}${parts.minute}`
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
    `${edielLocalDateYYMMDD()}:${edielLocalTimeHHMM()}`,
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

  const interchangeSegments = [
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

  // UNA is a fixed nine-character service string. The sixth service character is
  // the reserved blank before the segment terminator. Do not add an extra
  // terminator after UNA; it already ends with the terminator character.
  const raw = `${buildUnaSegment()}${interchangeSegments.map((segment) => `${sanitizeSegment(segment)}'`).join('')}`
  const preflight = preflightEdielPayload({
    rawPayload: raw,
    mimeType: 'application/EDIFACT',
    messageStandard: 'edifact',
    mode: 'send',
  })

  if (preflight.blocking) {
    throw new Error(
      `EDIFACT envelope stoppades av payload preflight: ${preflight.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${issue.code}: ${issue.description}`)
        .join(' | ')}`
    )
  }

  return {
    raw,
    interchangeReference,
    messageReference,
    segmentCount: normalizedBody.length + 2,
  }
}