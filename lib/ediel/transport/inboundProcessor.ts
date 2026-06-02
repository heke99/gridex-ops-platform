import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { canonicalizeEdifact } from '@/lib/ediel/core/canonicalizeEdifact'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { recordEdielExchangeLog } from '@/lib/ediel/operations/exchangeLog'
import { createEdielDeadLetterItem } from '@/lib/ediel/transport/deadLetter'
import { formatErrorMessage } from '@/lib/errors'

export async function processInboundEdifactMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const canonicalPayload = canonicalizeEdifact(params.message.raw_payload)
  const syntax = validateEdifactEnvelope(canonicalPayload)

  await recordEdielExchangeLog({
    companyId: params.message.company_id ?? null,
    environmentType: params.message.environment === 'production' ? 'production' : 'agt_test',
    edielMessageId: params.message.id,
    direction: 'inbound',
    exchangeKind: 'inbound_process',
    rawPayload: canonicalPayload,
    senderEdielId: params.message.sender_ediel_id ?? null,
    receiverEdielId: params.message.receiver_ediel_id ?? null,
    interchangeReference: params.message.interchange_reference ?? null,
    messageReference: params.message.message_reference ?? null,
    messageType: params.message.message_family ?? null,
    businessCode: params.message.message_code ?? null,
    metadata: {
      syntaxOk: syntax.syntaxOk,
      syntaxIssues: syntax.issues,
    },
    actorUserId: params.actorUserId,
  }).catch(() => null)

  try {
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
  } catch (error) {
    await createEdielDeadLetterItem({
      companyId: params.message.company_id ?? null,
      environmentType: params.message.environment === 'production' ? 'production' : 'agt_test',
      source: 'inbound_mail',
      edielMessageId: params.message.id,
      errorCode: 'inbound_processing_failed',
      errorMessage: formatErrorMessage(error, 'Inbound processing misslyckades.'),
      retryable: true,
      replayRequiresApproval: params.message.environment === 'production',
      metadata: {
        syntaxOk: syntax.syntaxOk,
      },
      actorUserId: params.actorUserId,
    }).catch(() => null)
    throw error
  }
}
