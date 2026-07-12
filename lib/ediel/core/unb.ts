import { type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

export type ParsedUnb = {
  syntaxIdentifier: string | null
  sender: string | null
  senderSubAddress: string | null
  receiver: string | null
  receiverSubAddress: string | null
  date: string | null
  time: string | null
  interchangeReference: string | null
  applicationReference: string | null
  testIndicator: string | null
}

export function parseUnb(segment: EdifactTokenizedSegment | null | undefined, una: EdifactServiceStringAdvice): ParsedUnb | null {
  if (!segment || segment.tag !== 'UNB') return null
  const raw = `${una.raw}${segment.raw}${una.segmentTerminator}`
  const parsed = EdifactEnvelopeCodec.decode(raw)
  return {
    syntaxIdentifier: segment.elements[1] ?? null,
    sender: parsed.sender,
    senderSubAddress: parsed.senderSubAddress,
    receiver: parsed.receiver,
    receiverSubAddress: parsed.receiverSubAddress,
    date: parsed.date,
    time: parsed.time,
    interchangeReference: parsed.interchangeReference,
    applicationReference: parsed.applicationReference,
    testIndicator: parsed.testIndicator,
  }
}

/** @deprecated Use EdifactEnvelopeCodec.encode. Kept only for source compatibility. */
export function serializeUnb(input: {
  sender: string
  receiver: string
  interchangeReference: string
  date: string
  time: string
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  applicationReference?: string | null
  testIndicator?: string | number | null
}): string {
  const raw = EdifactEnvelopeCodec.encode({
    sender: input.sender,
    receiver: input.receiver,
    interchangeReference: input.interchangeReference,
    senderSubAddress: input.senderSubAddress,
    receiverSubAddress: input.receiverSubAddress,
    applicationReference: input.applicationReference,
    environment: EdifactEnvelopeCodec.environmentFromLegacyTestFlag(input.testIndicator),
    createdAt: new Date(),
    messages: [{ messageReference: '1', messageTypeToken: 'DUMMY:D:00A:UN', businessSegments: [] }],
  })
  return EdifactEnvelopeCodec.decode(raw).segments.find((item) => item.tag === 'UNB')?.raw ?? ''
}
