// lib/ediel/utilts/utiltsResumability.ts
//
// FINDINGS F80: one server-side rule decides whether an inbound UTILTS source
// may be (re)run through the canonical processor. The admin detail page, the
// message list and processEdielOperationalMessageAction all read this rule; the
// action re-checks it server-side and never trusts the UI.
//
// Authority:
// - ediel_ack_transaction_results is the per-transaction reservation/final
//   reply ledger (unique per company/environment/source/transaction;
//   internal_review <=> planned_response_type 'none'; a final reply is written
//   once). A held transaction is `internal_review` without a final reply.
// - Outbound replies are ediel_messages rows related to the source. Protocol
//   replies (CONTRL) never block. Application replies (APERAK / UTILTS-ERR)
//   bound to OTHER transactions never block a held transaction. A whole-message
//   application reply, or any final reply when nothing is held, keeps the
//   source closed to avoid duplicate/contradicting application replies.
// - Cancelled/failed reply drafts are ignored entirely.
import { supabaseService } from '@/lib/supabase/service'

export type UtiltsSourceResumabilityReason =
  /** Resumable: >=1 own transaction is held for internal review without a final reply. */
  | 'held_transactions'
  /** Resumable: no transaction has a final reply and no application reply exists yet. */
  | 'not_yet_answered'
  /** Not resumable: the source is missing, foreign to the tenant or in another environment. */
  | 'source_unavailable'
  /** Not resumable: only inbound UTILTS sources are handled by this rule. */
  | 'not_inbound_utilts'
  /** Not resumable: nothing is held and an application reply/final transaction reply exists. */
  | 'already_answered'
  /** Not resumable: a whole-message APERAK/UTILTS-ERR exists; resuming could contradict it. */
  | 'message_level_application_reply_exists'

export type UtiltsHeldTransaction = {
  transactionId: string
  issueCodes: string[]
}

export type UtiltsSourceResumability = {
  resumable: boolean
  reason: UtiltsSourceResumabilityReason
  heldTransactionIds: string[]
  heldTransactions: UtiltsHeldTransaction[]
  /** Transactions finally rejected (guide/processability/syntax). Ediel requires a new file from the sender. */
  rejectedTransactionIds: string[]
  /** Transactions with a final application reply already written. */
  finalizedTransactionIds: string[]
  /** Active (not cancelled/failed) application replies: APERAK and UTILTS-ERR. */
  activeApplicationReplyIds: string[]
  /** Active protocol replies (CONTRL). Informational; they never block resumption. */
  activeProtocolReplyIds: string[]
  /** Held rows that nevertheless have an active reply scoped to them (inconsistent; not resumed). */
  heldWithReplyTransactionIds: string[]
}

export type UtiltsResumabilitySource = {
  id: string
  company_id?: string | null
  environment?: string | null
  direction?: string | null
  message_family?: string | null
}

export type UtiltsResumabilityTransactionRow = {
  source_transaction_id: string
  disposition: string | null
  planned_response_type: string | null
  final_response_type: string | null
  response_message_id: string | null
  finalized_at: string | null
  issue_codes: string[] | null
}

export type UtiltsResumabilityReplyRow = {
  id: string
  message_family: string | null
  message_code: string | null
  status: string | null
  transaction_reference: string | null
}

const INACTIVE_REPLY_STATUSES = new Set(['cancelled', 'failed', 'error', 'rejected'])
const REJECTED_DISPOSITIONS = new Set(['guide_rejected', 'processability_rejected', 'syntax_rejected'])

function isActiveReply(reply: UtiltsResumabilityReplyRow): boolean {
  return !INACTIVE_REPLY_STATUSES.has(String(reply.status ?? '').toLowerCase())
}

function isApplicationReply(reply: UtiltsResumabilityReplyRow): boolean {
  const family = String(reply.message_family ?? '')
  return family === 'APERAK' || family === 'UTILTS_ERR' ||
    (family === 'UTILTS' && String(reply.message_code ?? '').toUpperCase() === 'ERR')
}

function isProtocolReply(reply: UtiltsResumabilityReplyRow): boolean {
  return String(reply.message_family ?? '') === 'CONTRL'
}

function closed(reason: UtiltsSourceResumabilityReason): UtiltsSourceResumability {
  return {
    resumable: false, reason, heldTransactionIds: [], heldTransactions: [], rejectedTransactionIds: [],
    finalizedTransactionIds: [], activeApplicationReplyIds: [], activeProtocolReplyIds: [], heldWithReplyTransactionIds: [],
  }
}

/**
 * Pure decision. `source` must already be the server-read row; `companyId` and
 * `environment` are the caller's verified scope (never form input).
 */
export function decideUtiltsSourceResumability(input: {
  companyId: string | null | undefined
  environment?: string | null
  source: UtiltsResumabilitySource | null
  transactions: readonly UtiltsResumabilityTransactionRow[]
  replies: readonly UtiltsResumabilityReplyRow[]
}): UtiltsSourceResumability {
  const { source } = input
  if (!input.companyId || !source || source.company_id !== input.companyId ||
    (input.environment && source.environment !== input.environment)) return closed('source_unavailable')
  if (source.direction !== 'inbound' || source.message_family !== 'UTILTS') return closed('not_inbound_utilts')

  const activeReplies = input.replies.filter(isActiveReply)
  const applicationReplies = activeReplies.filter(isApplicationReply)
  const protocolReplies = activeReplies.filter(isProtocolReply)
  const rowsById = new Map(input.transactions.map((row) => [row.source_transaction_id, row]))
  const boundReplyIds = new Set(input.transactions.map((row) => row.response_message_id).filter((id): id is string => Boolean(id)))

  const heldCandidates = input.transactions.filter((row) =>
    row.disposition === 'internal_review' && !row.final_response_type && !row.finalized_at && !row.response_message_id)
  const heldIds = new Set(heldCandidates.map((row) => row.source_transaction_id))
  const heldWithReply = new Set<string>()
  const messageLevelReplyIds: string[] = []

  for (const reply of applicationReplies) {
    if (boundReplyIds.has(reply.id)) continue
    const reference = reply.transaction_reference?.trim() || null
    if (reference && heldIds.has(reference)) { heldWithReply.add(reference); continue }
    // A transaction-scoped reply whose own finalization has not been written
    // yet (e.g. crash between draft and finalization) belongs to its sibling.
    if (reference && rowsById.has(reference)) continue
    messageLevelReplyIds.push(reply.id)
  }

  const held = heldCandidates.filter((row) => !heldWithReply.has(row.source_transaction_id))
  const decision: UtiltsSourceResumability = {
    resumable: false,
    reason: 'already_answered',
    heldTransactionIds: held.map((row) => row.source_transaction_id),
    heldTransactions: held.map((row) => ({ transactionId: row.source_transaction_id, issueCodes: [...(row.issue_codes ?? [])] })),
    rejectedTransactionIds: input.transactions
      .filter((row) => REJECTED_DISPOSITIONS.has(String(row.disposition ?? '')))
      .map((row) => row.source_transaction_id),
    finalizedTransactionIds: input.transactions
      .filter((row) => Boolean(row.final_response_type && row.finalized_at))
      .map((row) => row.source_transaction_id),
    activeApplicationReplyIds: applicationReplies.map((reply) => reply.id),
    activeProtocolReplyIds: protocolReplies.map((reply) => reply.id),
    heldWithReplyTransactionIds: [...heldWithReply],
  }

  if (messageLevelReplyIds.length > 0) return { ...decision, reason: 'message_level_application_reply_exists' }
  if (held.length > 0) return { ...decision, resumable: true, reason: 'held_transactions' }
  if (decision.finalizedTransactionIds.length > 0 || applicationReplies.length > 0 || heldWithReply.size > 0) {
    return { ...decision, reason: 'already_answered' }
  }
  return { ...decision, resumable: true, reason: 'not_yet_answered' }
}

const SOURCE_COLUMNS = 'id,company_id,environment,direction,message_family'
const TRANSACTION_COLUMNS = 'source_message_id,source_transaction_id,disposition,planned_response_type,final_response_type,response_message_id,finalized_at,issue_codes'
const REPLY_COLUMNS = 'id,related_message_id,message_family,message_code,status,transaction_reference'
const REPLY_FAMILIES = ['CONTRL', 'APERAK', 'UTILTS_ERR', 'UTILTS']

async function readRows<T>(query: PromiseLike<{ data: unknown; error: unknown }>, label: string): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(`utilts_resumability_read_failed:${label}`, { cause: error })
  return Array.isArray(data) ? (data as T[]) : []
}

/** Single-source reader (detail page and server action). Company-scoped service reads only. */
export async function readUtiltsSourceResumability(input: {
  companyId: string | null | undefined
  sourceMessageId: string
  environment?: string | null
}): Promise<UtiltsSourceResumability> {
  if (!input.companyId || !input.sourceMessageId) return closed('source_unavailable')
  const sources = await readRows<UtiltsResumabilitySource>(
    supabaseService.from('ediel_messages').select(SOURCE_COLUMNS)
      .eq('id', input.sourceMessageId).eq('company_id', input.companyId).limit(1),
    'source',
  )
  const source = sources[0] ?? null
  if (!source) return closed('source_unavailable')
  const environment = input.environment ?? source.environment
  if (!environment || source.environment !== environment) return closed('source_unavailable')
  if (source.direction !== 'inbound' || source.message_family !== 'UTILTS') return closed('not_inbound_utilts')

  const [transactions, replies] = await Promise.all([
    readRows<UtiltsResumabilityTransactionRow>(
      supabaseService.from('ediel_ack_transaction_results').select(TRANSACTION_COLUMNS)
        .eq('company_id', input.companyId).eq('environment', environment).eq('source_message_id', source.id),
      'transactions',
    ),
    readRows<UtiltsResumabilityReplyRow>(
      supabaseService.from('ediel_messages').select(REPLY_COLUMNS)
        .eq('company_id', input.companyId).eq('environment', environment).eq('related_message_id', source.id)
        .eq('direction', 'outbound').in('message_family', REPLY_FAMILIES),
      'replies',
    ),
  ])
  return decideUtiltsSourceResumability({ companyId: input.companyId, environment, source, transactions, replies })
}

/**
 * Batch reader for the message list. Each source is evaluated with its own
 * server-read company/environment; reads are scoped per company group.
 */
export async function readUtiltsSourceResumabilityForSources(sources: readonly UtiltsResumabilitySource[]): Promise<Map<string, UtiltsSourceResumability>> {
  const result = new Map<string, UtiltsSourceResumability>()
  const groups = new Map<string, UtiltsResumabilitySource[]>()
  for (const source of sources) {
    if (!source.company_id || !source.environment) { result.set(source.id, closed('source_unavailable')); continue }
    if (source.direction !== 'inbound' || source.message_family !== 'UTILTS') { result.set(source.id, closed('not_inbound_utilts')); continue }
    const key = `${source.company_id}|${source.environment}`
    groups.set(key, [...(groups.get(key) ?? []), source])
  }
  for (const group of groups.values()) {
    const companyId = group[0].company_id as string
    const environment = group[0].environment as string
    const ids = group.map((source) => source.id)
    const [transactions, replies] = await Promise.all([
      readRows<UtiltsResumabilityTransactionRow & { source_message_id: string }>(
        supabaseService.from('ediel_ack_transaction_results').select(TRANSACTION_COLUMNS)
          .eq('company_id', companyId).eq('environment', environment).in('source_message_id', ids),
        'transactions',
      ),
      readRows<UtiltsResumabilityReplyRow & { related_message_id: string }>(
        supabaseService.from('ediel_messages').select(REPLY_COLUMNS)
          .eq('company_id', companyId).eq('environment', environment).in('related_message_id', ids)
          .eq('direction', 'outbound').in('message_family', REPLY_FAMILIES),
        'replies',
      ),
    ])
    for (const source of group) {
      result.set(source.id, decideUtiltsSourceResumability({
        companyId, environment, source,
        transactions: transactions.filter((row) => row.source_message_id === source.id),
        replies: replies.filter((row) => row.related_message_id === source.id),
      }))
    }
  }
  return result
}

const ISSUE_EXPLANATIONS: Record<string, string> = {
  UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE:
    'Avsändarens (nätägarens) identitetsunderlag är inte godkänt ännu: juridisk avsändare, transportmandat, historiktäckning och retention måste styrkas.',
}

/** Operator-facing explanation of why a transaction is held. */
export function explainUtiltsHeldIssueCode(code: string): string {
  return ISSUE_EXPLANATIONS[code] ?? `Internt granskningsunderlag saknas (${code}).`
}

/** Operator-facing summary of the rule outcome (Swedish UI copy). */
export function describeUtiltsSourceResumability(decision: UtiltsSourceResumability): string {
  switch (decision.reason) {
    case 'held_transactions':
      return `${decision.heldTransactionIds.length} transaktion(er) hålls för intern granskning utan applikationssvar. Återupptagning kör om hela kontrollen från det bevarade originalet (inklusive avsändarens identitetsunderlag). Redan slutliga svar ändras inte; nya svar skapas bara för transaktioner som lämnar granskningen.`
    case 'not_yet_answered':
      return 'Inget applikationssvar finns ännu. Engine kör kontrollen från det bevarade originalet; redan skickad CONTRL återanvänds och skickas inte igen.'
    case 'already_answered':
      return decision.rejectedTransactionIds.length > 0
        ? 'Alla transaktioner har redan slutligt svar och inget hålls för granskning. Avvisade transaktioner kan inte återupptas här: enligt Ediel-processen måste avsändaren (nätägaren) skicka en ny, rättad fil.'
        : 'Alla transaktioner har redan slutligt svar och inget hålls för granskning. Engine körs inte igen för att undvika dubbla applikationssvar.'
    case 'message_level_application_reply_exists':
      return 'Ett applikationssvar för hela meddelandet (APERAK/UTILTS-ERR) finns redan. Engine körs inte igen, eftersom ett nytt svar skulle kunna dubblera eller motsäga det. Var svaret negativt måste avsändaren skicka en ny fil.'
    case 'not_inbound_utilts':
      return 'Endast inbound UTILTS kan återupptas.'
    case 'source_unavailable':
    default:
      return 'Källmeddelandet kunde inte läsas för aktuell tenant och miljö.'
  }
}

/** Append-only audit of earlier runtime results. Pure; returns the new history array. */
export type UtiltsRuntimeHistoryEntry = {
  supersededAt: string
  supersededByActorUserId: string
  runtime: unknown
}

export function appendUtiltsRuntimeHistory(input: {
  validationReport: Record<string, unknown> | null | undefined
  actorUserId: string
  at: string
}): UtiltsRuntimeHistoryEntry[] {
  const report = input.validationReport ?? {}
  const existing = Array.isArray(report.utiltsRuntimeHistory) ? (report.utiltsRuntimeHistory as UtiltsRuntimeHistoryEntry[]) : []
  const previous = report.utiltsRuntime
  if (previous === undefined || previous === null) return [...existing]
  return [...existing, { supersededAt: input.at, supersededByActorUserId: input.actorUserId, runtime: previous }]
}
