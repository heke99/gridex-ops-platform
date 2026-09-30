import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function sent(row: Row): boolean {
  return row.direction === 'outbound' && row.status === 'sent' && typeof row.message_sent_at === 'string'
    && Number.isFinite(Date.parse(row.message_sent_at))
}

/** Completion is a read projection of existing durable outcomes, never a new
 * protocol decision. One sent sibling cannot satisfy other physical IDEs. */
export function inboundAckTimerCompletion(input: {
  source: Pick<EdielMessageRow, 'id' | 'company_id' | 'environment' | 'message_family' | 'raw_payload'>
  timerType: string
  acknowledgements: readonly Row[]
  transactionResults?: readonly Row[]
}): 'resolved' | 'cancelled' | null {
  const rows = input.acknowledgements.filter(row => row.company_id === input.source.company_id
    && row.environment === input.source.environment && row.related_message_id === input.source.id)
  const sentRows = rows.filter(sent)
  const technical = sentRows.filter(row => row.message_family === 'CONTRL')
  if (input.timerType === 'contrl_due') return technical.length ? 'resolved' : null
  if (input.timerType !== 'aperak_due') return null
  if (technical.some(row => row.ack_outcome === 'negative')) return 'cancelled'
  const application = sentRows.filter(row => ['APERAK', 'UTILTS_ERR'].includes(String(row.message_family)))
  if (input.source.message_family !== 'UTILTS') return application.length ? 'resolved' : null
  // A source-qualified whole-message/header response owns the complete scope.
  if (application.some(row => {
    const report = record(row.validation_report)
    return report.sourceMessageId === input.source.id && report.ackScope === 'message'
      && !report.relatedTransactionReference && row.message_family === 'APERAK' && row.ack_outcome === 'negative'
  })) return 'resolved'
  const ast = parseCanonicalEdifactAst(input.source.raw_payload)
  const transactions = ast.messages.flatMap(message => message.utiltsTransactions ?? [])
  const ids = transactions.map(transaction => transaction.transactionId)
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) return null
  const results = input.transactionResults ?? []
  return ids.every(id => {
    const own = results.filter(row => row.company_id === input.source.company_id
      && row.environment === input.source.environment && row.source_message_id === input.source.id && row.source_transaction_id === id)
    if (own.length !== 1 || !own[0].finalized_at || !own[0].response_message_id) return false
    return application.some(row => row.id === own[0].response_message_id
      && record(row.validation_report).relatedTransactionReference === id)
  }) ? 'resolved' : null
}
