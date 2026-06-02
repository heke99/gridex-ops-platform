import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveRecommendedAckForInboundMessage } from '@/lib/ediel/ackDecision'
import type { EdielAckDecision } from '@/lib/ediel/ackDecision'

export function decideAcknowledgement(params: {
  message: EdielMessageRow
  relatedAcks?: EdielMessageRow[]
}): EdielAckDecision {
  return resolveRecommendedAckForInboundMessage({
    message: params.message,
    relatedAcks: params.relatedAcks ?? [],
  })
}
