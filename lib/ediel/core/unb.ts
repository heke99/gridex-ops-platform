import { firstCompositeComponent, splitComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

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

function subAddress(composite: string | null | undefined, una: EdifactServiceStringAdvice): string | null {
  const parts = splitComposite(composite, una)
  return parts[2]?.trim() || null
}

export function parseUnb(segment: EdifactTokenizedSegment | null | undefined, una: EdifactServiceStringAdvice): ParsedUnb | null {
  if (!segment || segment.tag !== 'UNB') return null
  const datetime = splitComposite(segment.elements[4], una)

  return {
    syntaxIdentifier: segment.elements[1] ?? null,
    sender: firstCompositeComponent(segment.elements[2], una),
    senderSubAddress: subAddress(segment.elements[2], una),
    receiver: firstCompositeComponent(segment.elements[3], una),
    receiverSubAddress: subAddress(segment.elements[3], una),
    date: datetime[0] ?? null,
    time: datetime[1] ?? null,
    interchangeReference: segment.elements[5] || null,
    applicationReference: segment.elements[7] || null,
    testIndicator: segment.elements[9] || null,
  }
}

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
  const sender = input.senderSubAddress ? `${input.sender}:ZZ:${input.senderSubAddress}` : `${input.sender}:ZZ`
  const receiver = input.receiverSubAddress ? `${input.receiver}:ZZ:${input.receiverSubAddress}` : `${input.receiver}:ZZ`
  return [
    'UNB',
    'UNOC:3',
    sender,
    receiver,
    `${input.date}:${input.time}`,
    input.interchangeReference,
    '',
    input.applicationReference ?? '',
    '',
    input.testIndicator ?? '0',
  ].join('+')
}
