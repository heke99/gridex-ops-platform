import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'
import type { EdielMessageRow } from '@/lib/ediel/types'

export async function checkAckDeadlines(params: {
  actorUserId: string
  companyId?: string | null
  now?: string | null
  limit?: number
}): Promise<{ warning: number; critical: number; expired: number; updated: number }> {
  const now = params.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new Error('ack_deadline_now_invalid')
  let query = supabaseService
    .from('ediel_sla_timers')
    .select('id, company_id, ediel_message_id, timer_type, warning_at, critical_at, due_at, status')
    .in('status', ['open', 'warning', 'critical', 'expired'])
    .order('due_at', { ascending: true })
    .limit(Math.min(Math.max(Math.floor(params.limit ?? 200), 1), 500))

  if (params.companyId) query = query.eq('company_id', params.companyId)

  const { data, error } = await query
  if (error) throw error

  let warning = 0
  let critical = 0
  let expired = 0
  let updated = 0

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    // Null-tenant raw receipts remain unassigned; a global sweep must never
    // convert them into another tenant's operational record.
    if (typeof row.company_id !== 'string' || typeof row.ediel_message_id !== 'string') continue
    const { data: source, error: sourceError } = await supabaseService.from('ediel_messages')
      .select('id,company_id,environment,message_family,raw_payload')
      .eq('company_id', row.company_id).eq('id', row.ediel_message_id).maybeSingle()
    if (sourceError) throw sourceError
    if (!source) continue
    const { data: acknowledgements, error: ackError } = await supabaseService.from('ediel_messages')
      .select('id,company_id,environment,related_message_id,direction,status,message_sent_at,message_family,ack_outcome,validation_report')
      .eq('company_id', row.company_id).eq('related_message_id', row.ediel_message_id)
      .eq('direction', 'outbound').in('message_family', ['CONTRL', 'APERAK', 'UTILTS_ERR']).limit(2000)
    if (ackError) throw ackError
    let transactionResults: Array<Record<string, unknown>> = []
    if (source.message_family === 'UTILTS' && row.timer_type === 'aperak_due') {
      const results = await supabaseService.from('ediel_ack_transaction_results')
        .select('company_id,environment,source_message_id,source_transaction_id,finalized_at,response_message_id')
        .eq('company_id', row.company_id).eq('source_message_id', row.ediel_message_id).limit(1000)
      if (results.error) throw results.error
      transactionResults = results.data ?? []
    }
    const completion = inboundAckTimerCompletion({
      source: source as EdielMessageRow, timerType: String(row.timer_type),
      acknowledgements: acknowledgements ?? [], transactionResults,
    })
    const dueAt = Date.parse(String(row.due_at ?? ''))
    const criticalAt = Date.parse(String(row.critical_at ?? ''))
    const warningAt = Date.parse(String(row.warning_at ?? ''))
    const status = completion ?? (Number.isFinite(dueAt) && dueAt <= nowMs
      ? 'expired'
      : Number.isFinite(criticalAt) && criticalAt <= nowMs
        ? 'critical'
        : Number.isFinite(warningAt) && warningAt <= nowMs
          ? 'warning'
          : String(row.status ?? 'open'))

    if (status === row.status) continue

    const { data: changed, error: updateError } = await supabaseService
      .from('ediel_sla_timers')
      .update({ status, updated_by: params.actorUserId, updated_at: now })
      .eq('id', row.id)
      .eq('company_id', row.company_id)
      .eq('status', row.status)
      .select('id')
    if (updateError) throw updateError
    if (!changed?.length) continue

    if (typeof row.ediel_message_id === 'string') {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: row.ediel_message_id,
        eventType: 'manual_note',
        eventStatus: status === 'expired' ? 'error' : completion ? 'success' : 'warning',
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
