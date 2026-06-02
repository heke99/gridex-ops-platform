import type { EdielMessageRow } from '@/lib/ediel/types'

export type AckCorrelationKeys = {
  sourceMessageId: string
  originalMessageId: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  companyId: string | null
}

export function buildAckCorrelationKeys(message: EdielMessageRow): AckCorrelationKeys {
  return {
    sourceMessageId: message.id,
    originalMessageId: message.original_message_id ?? message.related_message_id ?? null,
    interchangeReference: message.interchange_reference ?? null,
    transactionReference: message.transaction_reference ?? null,
    externalReference: message.external_reference ?? null,
    senderEdielId: message.sender_ediel_id ?? null,
    receiverEdielId: message.receiver_ediel_id ?? null,
    companyId: message.company_id ?? null,
  }
}
