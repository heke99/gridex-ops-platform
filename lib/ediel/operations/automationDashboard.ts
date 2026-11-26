import { supabaseService } from '@/lib/supabase/service'

export type EdielAutomationRow = Record<string, unknown>

const OUTBOX_FIELDS = 'id,company_id,ediel_message_id,source_message_id,status,priority,message_family,message_code,ack_outcome,environment,attempts,last_error,locked_at,locked_by,created_at,updated_at,sent_at'
export const OUTBOX_READY_STATUSES: readonly string[] = ['prepared', 'queued']
export const OUTBOX_PROBLEM_STATUSES: readonly string[] = ['failed', 'blocked', 'blocked_tenant_state']
type OutboxEnvironment = 'production' | 'test'
type OutboxWork = { rows: EdielAutomationRow[]; warning: string | null; count: number | null }

export type ClosedSlaBreach = {
  timer_id: string
  ediel_message_id: string
  timer_type: string
  status: 'resolved' | 'cancelled'
  due_at: string
  evidence: 'late_contrl' | 'expiry_recorded' | 'breach_recorded'
}

const CLOSED_SLA_HISTORY_LIMIT = 12
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function isClosedSlaBreach(value: unknown): value is ClosedSlaBreach {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.timer_id === 'string' && UUID.test(row.timer_id)
    && typeof row.ediel_message_id === 'string' && UUID.test(row.ediel_message_id)
    && typeof row.timer_type === 'string'
    && (row.status === 'resolved' || row.status === 'cancelled')
    && typeof row.due_at === 'string' && Number.isFinite(Date.parse(row.due_at))
    && (row.evidence === 'late_contrl' || row.evidence === 'expiry_recorded' || row.evidence === 'breach_recorded')
}

async function readClosedSlaHistory(companyId: string | null, evaluatedAt: string): Promise<ClosedSlaBreach[] | null> {
  try {
    const { data, error } = await supabaseService.rpc('gridex_list_closed_ack_deadline_history_v1', {
      p_evaluated_at: evaluatedAt,
      ...(companyId ? { p_company_id: companyId } : {}),
      p_limit: CLOSED_SLA_HISTORY_LIMIT,
    }, { get: true })
    return !error && Array.isArray(data) && data.length <= CLOSED_SLA_HISTORY_LIMIT && data.every(isClosedSlaBreach)
      ? data : null
  } catch {
    return null
  }
}

export type EdielAutomationDashboard = {
  decisionTraces: EdielAutomationRow[]
  outboxItems: EdielAutomationRow[]
  slaTimers: EdielAutomationRow[]
  closedSlaHistory: ClosedSlaBreach[] | null
  portalFeedback: EdielAutomationRow[]
  unresolvedItems: EdielAutomationRow[]
  metrics: {
    decisionTraces: number
    manualReviews: number
    outboxQueued: number
    outboxFailed: number
    slaCritical: number | null
    portalMismatches: number
    unresolvedOpen: number | null
  }
  warnings: string[]
}

async function safeTableRows(params: {
  table: string
  select: string
  unavailableMessage: string
  orderColumn?: string
  orderTieBreaker?: string
  ascending?: boolean
  limit?: number
  companyId?: string | null
  environment?: OutboxEnvironment
  statusIn?: readonly string[] | null
  statusColumn?: string
}): Promise<{ rows: EdielAutomationRow[]; warning: string | null }> {
  const unavailable = { rows: [], warning: params.unavailableMessage }
  try {
    let query = supabaseService
      .from(params.table)
      .select(params.select)
      .limit(params.limit ?? 50)

    if (params.companyId) query = query.eq('company_id', params.companyId)
    if (params.environment) query = query.eq('environment', params.environment)
    if (params.statusIn?.length) query = query.in(params.statusColumn ?? 'status', params.statusIn)
    if (params.orderColumn) query = query.order(params.orderColumn, { ascending: params.ascending ?? false })
    if (params.orderTieBreaker) query = query.order(params.orderTieBreaker, { ascending: params.ascending ?? false })

    const { data, error } = await query
    if (error || !Array.isArray(data)) return unavailable
    return { rows: data as unknown as EdielAutomationRow[], warning: null }
  } catch {
    return unavailable
  }
}

async function readOutboxWorkCount(companyId: string | null, environment: OutboxEnvironment, statuses: readonly string[]): Promise<number | null> {
  try {
    let query = supabaseService.from('ediel_outbox').select('id', { count: 'exact', head: true })
      .eq('environment', environment).in('status', statuses)
    if (companyId) query = query.eq('company_id', companyId)
    const { count, error } = await query
    return !error && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

export async function getEdielOutboxWorkload(companyId: string | null) {
  async function readWork(environment: OutboxEnvironment, statuses: readonly string[], unavailableMessage: string): Promise<OutboxWork> {
    const [list, count] = await Promise.all([
      safeTableRows({
        table: 'ediel_outbox', select: OUTBOX_FIELDS, companyId, environment, statusIn: statuses,
        orderColumn: 'created_at', orderTieBreaker: 'id', limit: 100, unavailableMessage,
      }),
      readOutboxWorkCount(companyId, environment, statuses),
    ])
    return { ...list, count }
  }

  async function readEnvironment(environment: OutboxEnvironment) {
    const [ready, problems] = await Promise.all([
      readWork(environment, OUTBOX_READY_STATUSES, 'Listan över sändkön kunde inte läsas.'),
      readWork(environment, OUTBOX_PROBLEM_STATUSES, 'Listan över fel och spärrar kunde inte läsas.'),
    ])
    return { ready, problems }
  }

  const [production, test] = await Promise.all([readEnvironment('production'), readEnvironment('test')])
  return { production, test }
}

function statusOf(row: EdielAutomationRow): string {
  return String(row.status ?? row.lifecycle_status ?? row.decision ?? '').toLowerCase()
}

function isManualTrace(row: EdielAutomationRow): boolean {
  const status = statusOf(row)
  const decision = String(row.decision ?? '').toLowerCase()
  return status.includes('manual') || decision.includes('manual') || String(row.can_auto_send ?? '') === 'false'
}

async function readCriticalSlaCount(companyId: string | null, evaluatedAt: string): Promise<number | null> {
  try {
    let query = supabaseService.from('ediel_sla_timers').select('id', { count: 'exact', head: true })
    if (companyId) query = query.eq('company_id', companyId)
    // Expired timers remain actionable until the worker resolves or cancels them.
    const { count, error } = await query
      .in('status', ['open', 'warning', 'critical', 'expired'])
      .or(`status.in.(critical,expired),due_at.lte.${evaluatedAt}`)
    return !error && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

function isPortalMismatch(row: EdielAutomationRow): boolean {
  const status = statusOf(row)
  return status === 'failed' || status === 'warning' || Boolean(row.diff)
}

export async function getEdielAutomationDashboard(params?: {
  companyId?: string | null
  limit?: number
  includeClosedSlaHistory?: boolean
}): Promise<EdielAutomationDashboard> {
  const limit = params?.limit ?? 50
  const evaluatedAt = new Date().toISOString()
  const [decisionTraces, outboxItems, slaTimers, portalFeedback, unresolvedItems, slaCritical, closedSlaHistory] = await Promise.all([
    safeTableRows({
      table: 'ediel_decision_traces',
      unavailableMessage: 'Beslutshistoriken kunde inte läsas.',
      select: 'id,company_id,source_message_id,decision,ack_family,outcome,confidence,can_auto_send,rule_profile,backend_rule_keys,reasons,warnings,created_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_outbox',
      unavailableMessage: 'Utkorgen kunde inte läsas.',
      select: OUTBOX_FIELDS,
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_sla_timers',
      unavailableMessage: 'Fristbevakningen kunde inte läsas.',
      select: 'id,company_id,ediel_message_id,timer_type,status,due_at,warning_at,critical_at,triggered_at,created_at,updated_at',
      orderColumn: 'due_at',
      ascending: true,
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_portal_validation_feedback',
      unavailableMessage: 'Portalfeedback kunde inte läsas.',
      select: 'id,company_id,ediel_message_id,test_run_id,test_case_code,step,expected_ack_type,expected_outcome,expected_erc,expected_ftx,actual_ack_type,actual_outcome,actual_erc,actual_ftx,diff,status,created_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_unresolved_items',
      unavailableMessage: 'Osäkra matchningar kunde inte läsas.',
      select: 'id,company_id,source_message_id,ediel_message_id,issue_type,status,environment,created_at',
      orderColumn: 'created_at',
      orderTieBreaker: 'id',
      statusIn: ['open', 'manual_review'],
      limit,
      companyId: params?.companyId ?? null,
    }),
    readCriticalSlaCount(params?.companyId ?? null, evaluatedAt),
    params?.includeClosedSlaHistory ? readClosedSlaHistory(params?.companyId ?? null, evaluatedAt) : Promise.resolve(null),
  ])

  const warnings = [decisionTraces.warning, outboxItems.warning, slaTimers.warning, portalFeedback.warning, unresolvedItems.warning,
    slaCritical === null ? 'Kritiska kvittensfrister kunde inte räknas.' : null]
    .filter((item): item is string => Boolean(item))

  return {
    decisionTraces: decisionTraces.rows,
    outboxItems: outboxItems.rows,
    slaTimers: slaTimers.rows,
    closedSlaHistory,
    portalFeedback: portalFeedback.rows,
    unresolvedItems: unresolvedItems.rows,
    warnings,
    metrics: {
      decisionTraces: decisionTraces.rows.length,
      manualReviews: decisionTraces.rows.filter(isManualTrace).length,
      outboxQueued: outboxItems.rows.filter((row) => ['prepared', 'queued', 'sending'].includes(statusOf(row))).length,
      outboxFailed: outboxItems.rows.filter((row) => statusOf(row) === 'failed' || statusOf(row) === 'blocked').length,
      slaCritical,
      portalMismatches: portalFeedback.rows.filter(isPortalMismatch).length,
      unresolvedOpen: unresolvedItems.warning ? null : unresolvedItems.rows.length,
    },
  }
}
