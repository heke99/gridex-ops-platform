import { supabaseService } from '@/lib/supabase/service'

export type EdielAutomationRow = Record<string, unknown>

export type EdielAutomationDashboard = {
  decisionTraces: EdielAutomationRow[]
  outboxItems: EdielAutomationRow[]
  slaTimers: EdielAutomationRow[]
  portalFeedback: EdielAutomationRow[]
  unresolvedItems: EdielAutomationRow[]
  metrics: {
    decisionTraces: number
    manualReviews: number
    outboxQueued: number
    outboxFailed: number
    slaCritical: number
    portalMismatches: number
    unresolvedOpen: number
  }
  warnings: string[]
}

function tableMissing(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(record.code ?? '')
  const message = String(record.message ?? record.details ?? '')
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  )
}

async function safeTableRows(params: {
  table: string
  select: string
  orderColumn?: string
  ascending?: boolean
  limit?: number
  companyId?: string | null
  statusIn?: string[] | null
  statusColumn?: string
}): Promise<{ rows: EdielAutomationRow[]; warning: string | null }> {
  let query = supabaseService
    .from(params.table)
    .select(params.select)
    .limit(params.limit ?? 50)

  if (params.companyId) query = query.eq('company_id', params.companyId)
  if (params.statusIn?.length) query = query.in(params.statusColumn ?? 'status', params.statusIn)
  if (params.orderColumn) query = query.order(params.orderColumn, { ascending: params.ascending ?? false })

  const { data, error } = await query
  if (error) {
    if (tableMissing(error)) return { rows: [], warning: `${params.table} saknas eller är inte migrerad ännu.` }
    return { rows: [], warning: `${params.table}: ${error.message}` }
  }

  const rows = Array.isArray(data) ? (data as unknown as EdielAutomationRow[]) : []
  return { rows, warning: null }
}

function statusOf(row: EdielAutomationRow): string {
  return String(row.status ?? row.lifecycle_status ?? row.decision ?? '').toLowerCase()
}

function isManualTrace(row: EdielAutomationRow): boolean {
  const status = statusOf(row)
  const decision = String(row.decision ?? '').toLowerCase()
  return status.includes('manual') || decision.includes('manual') || String(row.can_auto_send ?? '') === 'false'
}

function isCriticalSla(row: EdielAutomationRow): boolean {
  const status = statusOf(row)
  const due = typeof row.due_at === 'string' ? Date.parse(row.due_at) : NaN
  return status === 'critical' || status === 'expired' || (!Number.isNaN(due) && due <= Date.now())
}

function isPortalMismatch(row: EdielAutomationRow): boolean {
  const status = statusOf(row)
  return status === 'failed' || status === 'warning' || Boolean(row.diff)
}

export async function getEdielAutomationDashboard(params?: {
  companyId?: string | null
  limit?: number
}): Promise<EdielAutomationDashboard> {
  const limit = params?.limit ?? 50
  const [decisionTraces, outboxItems, slaTimers, portalFeedback, unresolvedItems] = await Promise.all([
    safeTableRows({
      table: 'ediel_decision_traces',
      select: 'id,company_id,source_message_id,decision,ack_family,outcome,confidence,can_auto_send,rule_profile,backend_rule_keys,reasons,warnings,created_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_outbox',
      select: 'id,company_id,ediel_message_id,source_message_id,status,priority,message_family,message_code,ack_outcome,environment,attempts,last_error,locked_at,locked_by,created_at,updated_at,sent_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_sla_timers',
      select: 'id,company_id,ediel_message_id,timer_type,status,due_at,warning_at,critical_at,triggered_at,created_at,updated_at',
      orderColumn: 'due_at',
      ascending: true,
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_portal_validation_feedback',
      select: 'id,company_id,ediel_message_id,test_run_id,test_case_code,step,expected_ack_type,expected_outcome,expected_erc,expected_ftx,actual_ack_type,actual_outcome,actual_erc,actual_ftx,diff,status,created_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
    safeTableRows({
      table: 'ediel_unresolved_items',
      select: 'id,company_id,ediel_message_id,issue_type,status,title,description,environment,created_at,updated_at',
      orderColumn: 'created_at',
      limit,
      companyId: params?.companyId ?? null,
    }),
  ])

  const warnings = [decisionTraces.warning, outboxItems.warning, slaTimers.warning, portalFeedback.warning, unresolvedItems.warning]
    .filter((item): item is string => Boolean(item))

  return {
    decisionTraces: decisionTraces.rows,
    outboxItems: outboxItems.rows,
    slaTimers: slaTimers.rows,
    portalFeedback: portalFeedback.rows,
    unresolvedItems: unresolvedItems.rows,
    warnings,
    metrics: {
      decisionTraces: decisionTraces.rows.length,
      manualReviews: decisionTraces.rows.filter(isManualTrace).length,
      outboxQueued: outboxItems.rows.filter((row) => ['prepared', 'queued', 'sending'].includes(statusOf(row))).length,
      outboxFailed: outboxItems.rows.filter((row) => statusOf(row) === 'failed' || statusOf(row) === 'blocked').length,
      slaCritical: slaTimers.rows.filter(isCriticalSla).length,
      portalMismatches: portalFeedback.rows.filter(isPortalMismatch).length,
      unresolvedOpen: unresolvedItems.rows.filter((row) => !['resolved', 'closed', 'done'].includes(statusOf(row))).length,
    },
  }
}
