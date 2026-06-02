import { serializeUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { serializeUnb } from '@/lib/ediel/core/unb'
import { serializeUnh } from '@/lib/ediel/core/unh'
import { serializeUnt } from '@/lib/ediel/core/unt'
import { serializeUnz } from '@/lib/ediel/core/unz'

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

function dateParts(date: Date): { date: string; time: string } {
  const yy = String(date.getUTCFullYear()).slice(-2)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return { date: `${yy}${mm}${dd}`, time: `${hh}${min}` }
}

export function escapeEdifactValue(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\?/g, '??')
    .replace(/:/g, '?:')
    .replace(/\+/g, '?+')
    .replace(/'/g, "?'")
}

export function serializeEdifact(input: SerializeEdifactInput): string {
  const created = dateParts(input.createdAt ?? new Date())
  const body = [
    serializeUnh({ messageReference: input.messageReference, messageTypeToken: input.messageTypeToken }),
    ...input.businessSegments.map((segment) => segment.replace(/\r?\n/g, '').trim()).filter(Boolean),
  ]
  const unt = serializeUnt({ segmentCount: body.length + 1, messageReference: input.messageReference })
  const segments = [
    serializeUnb({
      sender: input.sender,
      receiver: input.receiver,
      interchangeReference: input.interchangeReference,
      applicationReference: input.applicationReference ?? null,
      senderSubAddress: input.senderSubAddress ?? null,
      receiverSubAddress: input.receiverSubAddress ?? null,
      date: created.date,
      time: created.time,
      testIndicator: input.testIndicator ?? 0,
    }),
    ...body,
    unt,
    serializeUnz({ messageCount: 1, interchangeReference: input.interchangeReference }),
  ]

  return `${serializeUna(input.una)}${segments.map((segment) => `${segment}'`).join('')}`
}
