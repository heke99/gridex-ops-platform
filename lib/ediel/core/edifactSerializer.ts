import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type SerializeEdifactInput = {
  sender: string
  receiver: string
  interchangeReference: string
  messageReference: string
  messageTypeToken: string
  applicationReference?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  testIndicator?: string | number | null
  createdAt?: Date
  businessSegments: string[]
  una?: Partial<EdifactServiceStringAdvice>
}

export function escapeEdifactValue(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\?/g, '??')
    .replace(/:/g, '?:')
    .replace(/\+/g, '?+')
    .replace(/'/g, "?'")
}

export function serializeEdifact(input: SerializeEdifactInput): string {
  return EdifactEnvelopeCodec.encode({
    sender: input.sender,
    receiver: input.receiver,
    interchangeReference: input.interchangeReference,
    applicationReference: input.applicationReference,
    senderSubAddress: input.senderSubAddress,
    receiverSubAddress: input.receiverSubAddress,
    environment: EdifactEnvelopeCodec.environmentFromLegacyTestFlag(input.testIndicator),
    createdAt: input.createdAt,
    una: input.una,
    messages: [{
      messageReference: input.messageReference,
      messageTypeToken: input.messageTypeToken,
      businessSegments: input.businessSegments,
    }],
  })
}
