export function inboundRulebookDedupeKeys(input: {
  mailboxId?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  interchangeReference?: string | null
  transactionReference?: string | null
  messageCode?: string | null
}): string[] {
  const keys: string[] = []
  if (input.mailboxId && input.mailboxMessageId) keys.push(`mailbox:${input.mailboxId}:${input.mailboxMessageId}`)
  if (input.senderEdielId && input.interchangeReference) keys.push(`unb:${input.senderEdielId}:${input.interchangeReference}`)
  if (input.senderEdielId && input.transactionReference && input.messageCode) keys.push(`tx:${input.senderEdielId}:${input.transactionReference}:${input.messageCode}`)
  return keys
}

export function outboundRulebookDedupeKey(input: {
  sourceType?: string | null
  sourceId?: string | null
  requestType?: string | null
  receiverEdielId?: string | null
  family?: string | null
  code?: string | null
  version?: string | null
  period?: string | null
}): string {
  return [input.sourceType, input.sourceId, input.requestType, input.receiverEdielId, input.family, input.code, input.version, input.period]
    .map((value) => String(value ?? '').trim() || '_')
    .join(':')
}

export function ackRulebookDedupeKey(input: {
  sourceMessageId: string
  ackFamily: string
  transactionReference?: string | null
  outcome?: string | null
}): string {
  return [input.sourceMessageId, input.ackFamily, input.transactionReference ?? '_', input.outcome ?? '_'].join(':')
}
