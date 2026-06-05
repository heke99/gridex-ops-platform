import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'

export async function checkAckDeadlines(params: {
  actorUserId: string
  companyId?: string | null
  now?: string | null
  limit?: number
}): Promise<{ warning: number; critical: number; expired: number; updated: number }> {
  const now = params.now ?? new Date().toISOString()
  let query = supabaseService
    .from('ediel_sla_timers')
    .select('id, company_id, ediel_message_id, timer_type, warning_at, critical_at, due_at, status')
    .in('status', ['open', 'warning', 'critical'])
    .limit(params.limit ?? 200)

  if (params.companyId) query = query.eq('company_id', params.companyId)

  const { data, error } = await query
  if (error) throw error

  let warning = 0
  let critical = 0
  let expired = 0
  let updated = 0

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const dueAt = Date.parse(String(row.due_at ?? ''))
    const criticalAt = Date.parse(String(row.critical_at ?? ''))
    const warningAt = Date.parse(String(row.warning_at ?? ''))
    const nowMs = Date.parse(now)
    const status = Number.isFinite(dueAt) && dueAt <= nowMs
      ? 'expired'
      : Number.isFinite(criticalAt) && criticalAt <= nowMs
        ? 'critical'
        : Number.isFinite(warningAt) && warningAt <= nowMs
          ? 'warning'
          : String(row.status ?? 'open')

    if (status === row.status) continue

    const { error: updateError } = await supabaseService
      .from('ediel_sla_timers')
      .update({ status, updated_by: params.actorUserId, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updateError) throw updateError

    if (typeof row.ediel_message_id === 'string') {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: row.ediel_message_id,
        eventType: 'manual_note',
        eventStatus: status === 'expired' ? 'error' : 'warning',
        message: `Ediel SLA timer is now ${status}.`,
        payload: { timerId: row.id, timerType: row.timer_type, status, dueAt: row.due_at },
      }).catch(() => null)
    }

    updated += 1
    if (status === 'warning') warning += 1
    if (status === 'critical') critical += 1
    if (status === 'expired') expired += 1
  }

  return { warning, critical, expired, updated }
}
