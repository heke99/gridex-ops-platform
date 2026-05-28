// lib/ediel/rulebook/dedupe.ts

export function buildRulebookInboundDedupeKeys(params: {
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  interchangeReference?: string | null
  transactionReference?: string | null
  externalReference?: string | null
}): string[] {
  const keys: string[] = []
  if (params.mailbox && params.mailboxMessageId) keys.push(`mailbox:${params.mailbox}:${params.mailboxMessageId}`)
  if (params.senderEdielId && params.interchangeReference) keys.push(`unb:${params.senderEdielId}:${params.interchangeReference}`)
  if (params.senderEdielId && params.transactionReference) {
    keys.push(`txn:${params.senderEdielId}:${params.transactionReference}:${params.externalReference ?? 'no-external'}`)
  }
  return keys
}

export function buildRulebookOutboundDedupeKey(params: {
  sourceType?: string | null
  sourceId?: string | null
  requestType?: string | null
  receiverEdielId?: string | null
  messageFamily?: string | null
  messageCode?: string | null
  version?: string | null
  period?: string | null
}): string {
  return [
    params.sourceType ?? 'unknown-source',
    params.sourceId ?? 'unknown-id',
    params.requestType ?? 'unknown-request',
    params.receiverEdielId ?? 'unknown-receiver',
    params.messageFamily ?? 'unknown-family',
    params.messageCode ?? 'unknown-code',
    params.version ?? 'unknown-version',
    params.period ?? 'no-period',
  ].join('|')
}

export function buildRulebookAckDedupeKey(params: {
  sourceMessageId: string
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  transactionReference?: string | null
  outcome?: 'positive' | 'negative' | null
}): string {
  return [params.sourceMessageId, params.ackFamily, params.transactionReference ?? 'message', params.outcome ?? 'any'].join('|')
}
