type Row = Record<string, unknown>
type Work = {
  id: string; kind: string; companyId: string; environment: string; sourceId: string; source: Row; target: Row; payload: Row
  state: 'ready' | 'leased' | 'running' | 'uncertain' | 'done' | 'exhausted'
  attempts: number; maxAttempts: number; grace?: number; token?: string; leaseUntil?: string; receipt?: boolean
}

/** Finite controller port for legacy business tests, matching V6's public RPC
 * contract. It does not emulate cursor pagination, PostgreSQL locking or UUID
 * validation; those belong to the actual migration's finite SQL tests. Synthetic
 * fixture IDs are opaque here. Unknown RPCs and unproven finishes fail closed. */
export function createRecoveryRpcPort(tables: () => Record<string, Row[]>) {
  const work = new Map<string, Work>()
  let sequence = 0
  const calls: { name: string; args: Row }[] = []
  const rows = (table: string) => tables()[table] ?? []
  const payload = (row: Row) => (row.payload ?? {}) as Row
  const markers: Record<string, string> = { stranded: 'stranded_inbound_business_processing', technical: 'missed_technical_ack', runtime: 'unqueued_utilts_runtime_reply', held: 'held_utilts_resume' }
  const sourceKey = (w: Work) => [w.companyId, w.environment, w.sourceId].join('|')
  const technicalNote = (source: Row) => rows('ediel_message_events').some((e) => e.ediel_message_id === source.id && e.event_type === 'manual_note' && payload(e).blockedBy === 'canonical_inbound_ack_guard' && payload(e).ackFamily === 'CONTRL')
  const eligible = (w: Work, grace: number) => {
    const s = w.source; const a = w.target
    if (!rows('ediel_messages').includes(s) || s.company_id !== w.companyId || s.environment !== w.environment || s.id !== w.sourceId || s.direction !== 'inbound' || s.message_standard !== 'edifact' || s.status === 'cancelled' || !s.company_id || !s.updated_at || Date.parse(String(s.updated_at)) > Date.now() - grace * 1000) return false
    if (w.kind === 'stranded') {
      const mail = rows('inbound_email_messages').find((m) => m.id === s.inbound_email_message_id && m.company_id === s.company_id)
      return s.status === 'received' && s.processing_status === 'received' && s.tenant_resolution_status === 'tenant_resolved' && mail?.processing_status === 'processed' && mail?.match_status !== 'dsn_transport_review' && mail?.environment === s.environment
    }
    if (w.kind === 'held') return false // These three business fixtures contain no held ledger.
    if (w.kind === 'technical' && (s.message_family === 'CONTRL' || (s.status === 'received' && s.processing_status === 'received'))) return false
    const replies = rows('ediel_messages').filter((r) => r.related_message_id === s.id && r.direction === 'outbound' && r.message_family === 'CONTRL')
    if (w.kind === 'technical' && a === s) return replies.length === 0
    if (a.company_id !== s.company_id || a.environment !== s.environment || a.related_message_id !== s.id || a.direction !== 'outbound' || a.status !== 'draft' || rows('ediel_outbox').some((o) => o.ediel_message_id === a.id)) return false
    if (w.kind === 'technical') return a.message_family === 'CONTRL'
    return s.message_family === 'UTILTS' && !(s.environment === 'production' && (s.sender_ediel_id === '91100' || s.receiver_ediel_id === '91100')) && ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(String(a.message_family)) && a.message_family === w.payload.ackFamily && !(a.message_family === 'CONTRL' && technicalNote(s)) && (w.payload.provenance === 'queue_failed' || (w.payload.provenance === 'pre_f112' && s.environment === 'production'))
  }
  function dispatch(name: string, args: Row): Row {
    if (name === 'ediel_recovery_discover_v1') {
      const kind = String(args.p_kind)
      const put = (source: Row, target: Row, body: Row = {}) => {
        const key = [kind, source.company_id, source.environment, source.id, target.id].join('|')
        if (work.has(key)) return
        const attempts = rows('ediel_message_events').filter((e) => e.ediel_message_id === target.id && (e.company_id == null || e.company_id === source.company_id) && e.event_type === 'manual_note' && payload(e).resume === markers[kind] && payload(e).kind === 'attempt').length
        const w: Work = { id: key, kind, companyId: String(source.company_id), environment: String(source.environment), sourceId: String(source.id), source, target, payload: body, attempts, maxAttempts: Number(args.p_max_attempts), state: attempts >= Number(args.p_max_attempts) ? 'exhausted' : 'ready' }
        if (eligible(w, 120)) work.set(key, w)
      }
      const scoped = (source: Row) => source.environment === args.p_environment && (!args.p_company || source.company_id === args.p_company) && source.direction === 'inbound' && source.message_standard === 'edifact'
      if (kind === 'stranded') {
        for (const s of rows('ediel_messages')) if (scoped(s) && Date.parse(String(s.created_at)) >= Date.now() - Number(args.p_lookback_hours) * 3600000 && Date.parse(String(s.created_at)) <= Date.now() - Number(args.p_grace_seconds) * 1000) put(s, s)
      } else if (kind === 'technical' || kind === 'runtime') {
        for (const e of rows('ediel_message_events')) {
          if (Date.parse(String(e.created_at)) > Date.now() - Number(args.p_grace_seconds) * 1000 || Date.parse(String(e.created_at)) < Date.now() - Number(args.p_lookback_hours) * 3600000) continue
          const s = rows('ediel_messages').find((m) => m.id === e.ediel_message_id && scoped(m) && (e.company_id == null || e.company_id === m.company_id))
          if (!s) continue
          const p = payload(e)
          if (kind === 'technical') {
            if (e.event_type !== 'manual_note' || p.blockedBy !== 'canonical_inbound_ack_guard' || p.ackFamily !== 'CONTRL') continue
            const replies = rows('ediel_messages').filter((a) => a.related_message_id === s.id && a.direction === 'outbound' && a.message_family === 'CONTRL')
            if (!replies.length) put(s, s)
            else for (const a of replies.filter((r) => r.company_id === s.company_id && r.environment === s.environment).slice(0, 2)) put(s, a)
          } else {
            const family = ['CONTRL', 'APERAK', 'UTILTS_ERR'].find((f) => e.message === `${f} hanterad via canonical kernel.` && e.event_type === (f === 'CONTRL' ? 'contrl_sent' : f === 'APERAK' ? 'aperak_sent' : 'utilts_err_sent'))
            const provenance = p.replyDispatch === 'operational_outbox' && p.outboxQueued === false ? 'queue_failed' : s.environment === 'production' && p.replyDispatch == null ? 'pre_f112' : null
            const a = rows('ediel_messages').find((m) => m.id === p.ackMessageId)
            if (family && provenance && a) put(s, a, { ackFamily: family, provenance, replyDispatch: p.replyDispatch ?? null, outcome: ['positive', 'negative'].includes(String(p.outcome)) ? p.outcome : null, ackScope: p.ackScope ?? null, relatedTransactionReference: p.relatedTransactionReference ?? null })
          }
        }
      } else if (kind !== 'held') throw new Error('ediel_recovery_input_invalid')
      return { scanned: 0 }
    }
    if (name === 'ediel_recovery_lease_v1') {
      const claimed: Row[] = []; const sources = new Set<string>(); const token = `token-${++sequence}`
      for (const w of work.values()) {
        if (w.kind !== args.p_kind || w.environment !== args.p_environment || (args.p_company && w.companyId !== args.p_company) || w.state !== 'ready' || w.attempts >= w.maxAttempts || (args.p_exclude as unknown[]).includes(w.sourceId) || !eligible(w, Number(args.p_grace_seconds))) continue
        const key = sourceKey(w)
        if ([...work.values()].some((other) => sourceKey(other) === key && ['leased', 'running', 'uncertain'].includes(other.state) && other.token !== token)) continue
        if (!sources.has(key) && sources.size >= Number(args.p_source_limit)) continue
        sources.add(key); w.receipt = undefined; w.state = 'leased'; w.grace = Number(args.p_grace_seconds); w.token = token; w.leaseUntil = new Date(Date.now() + 60000).toISOString()
        const target = w.kind === 'stranded' ? { id: w.sourceId } : w.kind === 'technical' ? { kind: w.target === w.source ? 'missing' : 'unqueued', messageId: w.target.id, sourceMessageId: w.sourceId } : { ...w.payload, ackMessageId: w.target.id, sourceMessageId: w.sourceId }
        claimed.push({ ...target, companyId: w.companyId, recovery: { workId: w.id, token, leaseUntil: w.leaseUntil }, attempt: w.attempts + 1, maxAttempts: w.maxAttempts })
        if (claimed.length >= Number(args.p_target_limit)) break
      }
      return { claimed, claimedSources: sources.size, candidates: claimed.length }
    }
    const w = work.get(String(args.p_work))
    if (!w || w.token !== args.p_token) throw new Error('ediel_recovery_stale_token')
    if (name === 'ediel_recovery_record_terminal_v1') {
      if (!rows('ediel_messages').includes(w.source) || w.source.company_id !== w.companyId || w.source.environment !== w.environment || w.companyId !== args.p_company || w.state !== args.p_expected_state || !['running', 'uncertain'].includes(w.state)) throw new Error('ediel_recovery_terminal_stale')
      const proven = args.p_outcome === 'no_effect' ? !eligible(w, w.grace!) : w.kind === 'stranded' ? w.source.status !== 'received' || w.source.processing_status !== 'received' : w.kind === 'technical' && w.source === w.target ? rows('ediel_messages').some((a) => a.related_message_id === w.sourceId && a.company_id === w.companyId && a.environment === w.environment && a.direction === 'outbound' && a.message_family === 'CONTRL' && a.status !== 'cancelled') : rows('ediel_outbox').some((o) => o.ediel_message_id === w.target.id && o.company_id === w.companyId && o.environment === w.environment && o.source_message_id === w.sourceId)
      if (!['completed', 'no_effect'].includes(String(args.p_outcome)) || !proven) throw new Error('ediel_recovery_terminal_evidence_missing')
      w.receipt = true; return { receiptId: `receipt-${w.id}` }
    }
    if (name !== 'ediel_recovery_transition_v1') throw new Error(`unexpected RPC: ${name}`)
    if (args.p_operation === 'start') {
      if (w.state !== 'leased' || Date.parse(w.leaseUntil!) <= Date.now() || w.attempts >= w.maxAttempts || !eligible(w, w.grace!)) throw new Error('ediel_recovery_start_refused')
      w.state = 'running'; w.attempts++; return { attempt: w.attempts, maxAttempts: w.maxAttempts }
    }
    if (args.p_operation === 'release') {
      if (w.state !== 'leased') throw new Error('ediel_recovery_started_release_refused')
      w.state = 'ready'; w.token = undefined; return { state: w.state }
    }
    if (!['running', 'uncertain'].includes(w.state)) throw new Error('ediel_recovery_not_running')
    if (args.p_operation === 'uncertain') { w.state = 'uncertain'; return { state: w.state } }
    if (args.p_operation !== 'finish' || !w.receipt) throw new Error('ediel_recovery_terminal_receipt_required')
    const resolved = w.kind === 'stranded' ? w.source.status !== 'received' || w.source.processing_status !== 'received' : w.target === w.source ? rows('ediel_messages').some((a) => a.related_message_id === w.sourceId && a.company_id === w.companyId && a.environment === w.environment && a.direction === 'outbound' && a.message_family === 'CONTRL') : rows('ediel_outbox').some((o) => o.ediel_message_id === w.target.id) || w.target.status !== 'draft'
    w.state = resolved ? 'done' : w.attempts >= w.maxAttempts ? 'exhausted' : 'ready'; w.token = undefined; return { state: w.state }
  }
  return {
    work, calls,
    rpc: (name: string, args: Row) => ({ abortSignal: async (signal: AbortSignal) => {
      if (signal.aborted) throw signal.reason
      calls.push({ name, args: { ...args } })
      return { data: dispatch(name, args), error: null }
    } }),
  }
}
