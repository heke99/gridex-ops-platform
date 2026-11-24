import { supabaseService } from '@/lib/supabase/service'

function nowIso(): string {
  return new Date().toISOString()
}

async function recordOverdueTask(input: {
  companyId: string
  sourceId: string
  monitor: 'ack_overdue' | 'z04_overdue' | 'z14_overdue'
  checkedAt: string
  deadlineMinutes: number
}): Promise<boolean> {
  const { data, error } = await supabaseService.rpc('gridex_record_inbound_overdue_task_v1', {
    p_company_id: input.companyId,
    p_request_id: input.sourceId,
    p_monitor: input.monitor,
    p_checked_at: input.checkedAt,
    p_deadline_minutes: input.deadlineMinutes,
  })
  if (error) {
    console.warn('[inbound-overdue] Kunde inte spara ärende och begäransstatus', error)
    return false
  }
  return data === true
}

export async function createInboundOverdueTasks(input: {
  ackDeadlineMinutes?: number
  z04DeadlineMinutes?: number
  z14DeadlineMinutes?: number
  limit?: number
} = {}): Promise<{ ackOverdue: number; z04Overdue: number; z14Overdue: number }> {
  const ackDeadline = input.ackDeadlineMinutes ?? 30
  const z04Deadline = input.z04DeadlineMinutes ?? 24 * 60
  const z14Deadline = input.z14DeadlineMinutes ?? 24 * 60
  const limit = input.limit ?? 100
  const now = nowIso()
  const ackCutoff = new Date(Date.parse(now) - ackDeadline * 60_000).toISOString()
  const z04Cutoff = new Date(Date.parse(now) - z04Deadline * 60_000).toISOString()
  const z14Cutoff = new Date(Date.parse(now) - z14Deadline * 60_000).toISOString()

  let ackOverdue = 0
  let z04Overdue = 0
  let z14Overdue = 0

  const { data: ackRows, error: ackError } = await supabaseService
    .from('outbound_requests')
    .select('id, company_id')
    .in('status', ['sent', 'prepared', 'queued'])
    .is('acknowledged_at', null)
    .not('company_id', 'is', null)
    .lt('sent_at', ackCutoff)
    .limit(limit)

  if (!ackError) {
    for (const row of (ackRows ?? []) as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue

      const created = await recordOverdueTask({
        companyId, sourceId, monitor: 'ack_overdue', checkedAt: now, deadlineMinutes: ackDeadline,
      })
      if (created) ackOverdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa outbound ack overdue', ackError)
  }

  const { data: z04Rows, error: z04Error } = await supabaseService
    .from('outbound_requests')
    .select('id, company_id')
    .in('status', ['syntax_accepted', 'application_accepted', 'acknowledged'])
    .eq('message_code', 'Z03')
    .not('company_id', 'is', null)
    .lt('acknowledged_at', z04Cutoff)
    .limit(limit)

  if (!z04Error) {
    for (const row of (z04Rows ?? []) as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue

      const created = await recordOverdueTask({
        companyId, sourceId, monitor: 'z04_overdue', checkedAt: now, deadlineMinutes: z04Deadline,
      })
      if (created) z04Overdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa Z04 overdue', z04Error)
  }

  const { data: z14Rows, error: z14Error } = await supabaseService
    .from('outbound_requests')
    .select('id, company_id')
    .in('status', ['syntax_accepted', 'application_accepted', 'acknowledged'])
    .eq('message_code', 'Z13')
    .not('company_id', 'is', null)
    .lt('acknowledged_at', z14Cutoff)
    .limit(limit)

  if (!z14Error) {
    for (const row of (z14Rows ?? []) as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue

      const created = await recordOverdueTask({
        companyId, sourceId, monitor: 'z14_overdue', checkedAt: now, deadlineMinutes: z14Deadline,
      })
      if (created) z14Overdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa Z14 overdue', z14Error)
  }

  return { ackOverdue, z04Overdue, z14Overdue }
}
