import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { parseProdatMessage, type ParsedProdatMessage } from '@/lib/ediel/prodat/parser'

export type ParsedProdat = ParsedProdatMessage & {
  bgmCode: string | null
  bgmReference: string | null
  unbSender: string | null
  unbReceiver: string | null
  unhMessageTypeToken: string | null
}

export function parseProdat(rawPayload: string): ParsedProdat {
  const envelope = parseEdifact(rawPayload)
  const parsed = parseProdatMessage(rawPayload)

  return {
    ...parsed,
    messageCode: envelope.businessCode ?? parsed.messageCode,
    bgmCode: envelope.businessCode,
    bgmReference: envelope.bgm?.elements[2] || null,
    unbSender: envelope.unb?.sender ?? null,
    unbReceiver: envelope.unb?.receiver ?? null,
    unhMessageTypeToken: envelope.unh?.messageTypeToken ?? null,
  }
}
