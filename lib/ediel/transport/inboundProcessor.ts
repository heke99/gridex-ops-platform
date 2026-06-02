import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { canonicalizeEdifact } from '@/lib/ediel/core/canonicalizeEdifact'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'

export async function processInboundEdifactMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const canonicalPayload = canonicalizeEdifact(params.message.raw_payload)
  const syntax = validateEdifactEnvelope(canonicalPayload)
  if (!syntax.syntaxOk) {
    return processInboundEdielMessage({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
    })
  }

  return processInboundEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
  })
}
