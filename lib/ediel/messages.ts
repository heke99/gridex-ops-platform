import { buildEdielInterchangeReference } from '@/lib/ediel/references'
import { preflightEdielPayload, type EdielPayloadPreflightResult } from '@/lib/ediel/core/messageBuilder'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

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
  payloadPreflight: EdielPayloadPreflightResult
}

export function buildEdifactEnvelope(input: BuildEdifactEnvelopeInput): BuiltEdifactEnvelope {
  const interchangeReference = buildEdielInterchangeReference({
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
  })
  const messageReference = '1'
  const raw = EdifactEnvelopeCodec.encode({
    sender: input.senderEdielId,
    senderSubAddress: input.senderSubAddress,
    receiver: input.receiverEdielId,
    receiverSubAddress: input.receiverSubAddress,
    applicationReference: input.applicationReference,
    interchangeReference,
    environment: EdifactEnvelopeCodec.environmentFromLegacyTestFlag(input.testFlag),
    messages: [{
      messageReference,
      messageTypeToken: input.messageTypeToken,
      businessSegments: input.segments,
    }],
  })
  const preflight = preflightEdielPayload({
    rawPayload: raw,
    mimeType: 'application/EDIFACT',
    messageStandard: 'edifact',
    mode: 'send',
  })
  if (preflight.blocking) {
    throw new Error(`EDIFACT envelope stoppades av payload preflight: ${preflight.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.code}: ${issue.description}`)
      .join(' | ')}`)
  }
  return {
    raw,
    interchangeReference,
    messageReference,
    segmentCount: input.segments.length + 3,
    payloadPreflight: preflight,
  }
}
