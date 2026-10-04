import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { canonicalizeEdifact } from '@/lib/ediel/core/canonicalizeEdifact'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { recordEdielExchangeLog } from '@/lib/ediel/operations/exchangeLog'
import { createEdielDeadLetterItem } from '@/lib/ediel/transport/deadLetter'
import { formatErrorMessage } from '@/lib/errors'
import { classifyEdielFailure } from '@/lib/ediel/core/failureDisposition'

export async function processInboundEdifactMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  let syntaxOk: boolean | null = null
  try {
  const canonicalPayload = canonicalizeEdifact(params.message.raw_payload)
  const syntax = validateEdifactEnvelope(canonicalPayload)
  syntaxOk = syntax.syntaxOk

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

    return await processInboundEdielMessage({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
    })
  } catch (error) {
    const disposition = classifyEdielFailure(error)
    try {
    await createEdielDeadLetterItem({
      companyId: params.message.company_id ?? null,
      environmentType: params.message.environment === 'production' ? 'production' : 'agt_test',
      source: 'inbound_mail',
      edielMessageId: params.message.id,
      errorCode: disposition.kind === 'protocol_rejection' ? disposition.sourceRule : disposition.code,
      errorMessage: formatErrorMessage(error, 'Inbound processing misslyckades.'),
      retryable: disposition.kind === 'internal_failure',
      replayRequiresApproval: params.message.environment === 'production' || disposition.kind !== 'internal_failure',
      metadata: {
        syntaxOk,
        failureDisposition: disposition,
      },
      actorUserId: params.actorUserId,
    })
    } catch (persistenceError) {
      throw new AggregateError([error, persistenceError], 'ediel_processing_failure_journal_unavailable')
    }
    throw error
  }
}
