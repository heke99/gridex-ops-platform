import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { readPhysicalAckSourceCorrelation, type AckCorrelationMessage } from '@/lib/ediel/ack/sourceCorrelation'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
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
  source: Pick<EdielMessageRow, 'id' | 'company_id' | 'environment' | 'message_family' | 'raw_payload'> & Partial<Pick<EdielMessageRow, 'direction'>>
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
  if (input.source.message_family === 'PRODAT') {
    if (input.source.direction !== 'inbound') return null
    const replies = application.filter(row => row.message_family === 'APERAK' && typeof row.raw_payload === 'string')
      .map(row => ({ row, message: { id: String(row.id ?? ''), company_id: input.source.company_id,
        environment: input.source.environment, direction: 'outbound', message_family: 'APERAK',
        raw_payload: row.raw_payload as string } satisfies AckCorrelationMessage }))
    // A header rejection can cover an unparseable source. Its stored source
    // binding and actual whole-message negative wire must agree; editable scope
    // metadata cannot promote a partial object response to whole completion.
    for (const { row, message } of replies) {
      const report = record(row.validation_report)
      if (report.sourceMessageId !== input.source.id || report.ackScope !== 'message' || row.ack_outcome !== 'negative') continue
      try {
        const physical = readPhysicalAckSourceCorrelation(message)
        if (physical.scope === 'message' && physical.wholeSourceOutcome === 'negative') return 'resolved'
      } catch { /* Invalid response bytes grant no completion. */ }
    }
    let required: Array<{ index: number; objectId: string | null; agency: string | null; li: string | null }>
    try {
      const wire = tokenizeEdifact(input.source.raw_payload)
      required = prodatRegisterGroups(wire.segments, wire.una).groups.filter(group => group.registerPosition === 1).map(group => {
        const refs = group.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, wire.una)[0] === 'LI')
          .map(segment => segmentComposite(segment, 1, wire.una)[1]).filter(Boolean)
        return { index: group.segments[0].index, objectId: group.itemId, agency: group.identityAgency, li: refs.length === 1 ? refs[0] : null }
      })
    } catch { return null }
    if (!required.length) return null
    const answered = new Set<number>()
    const source = { ...input.source, direction: input.source.direction } satisfies AckCorrelationMessage
    for (const { message } of replies) {
      try {
        const physical = readPhysicalAckSourceCorrelation(message, source)
        for (const own of physical.prodatObjectOutcomes ?? []) {
          const original = required.find(item => item.index === own.firstLineIndex && item.objectId === own.objectId
            && item.agency === own.identityAgency && item.li === own.lineItemReference)
          if (original) answered.add(original.index)
        }
      } catch { /* Foreign, ambiguous or malformed scopes answer no sibling. */ }
    }
    return required.every(own => answered.has(own.index)) ? 'resolved' : null
  }
  if (input.source.message_family !== 'UTILTS') return application.length ? 'resolved' : null
  // A source-qualified whole-message/header response owns the complete scope.
  if (application.some(row => {
    const report = record(row.validation_report)
    return report.sourceMessageId === input.source.id && report.ackScope === 'message'
      && !report.relatedTransactionReference && row.message_family === 'APERAK' && row.ack_outcome === 'negative'
  })) return 'resolved'
  let ast: ReturnType<typeof parseCanonicalEdifactAst>
  try { ast = parseCanonicalEdifactAst(input.source.raw_payload) } catch { return null }
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
