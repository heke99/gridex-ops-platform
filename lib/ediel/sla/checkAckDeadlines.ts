import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'
import type { EdielMessageRow } from '@/lib/ediel/types'

function compareAckTime(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right)
  if (milliseconds !== 0) return milliseconds
  // PostgREST can return finer precision than the JavaScript clock.
  const subMilliseconds = (value: string) => Number(
    (value.match(/:\d{2}\.(\d+)/)?.[1] ?? '').slice(3, 6).padEnd(3, '0'),
  )
  return subMilliseconds(left) - subMilliseconds(right)
}

export async function checkAckDeadlines(params: {
  actorUserId: string
  companyId?: string | null
  now?: string | null
  limit?: number
}): Promise<{ warning: number; critical: number; expired: number; updated: number }> {
  const now = params.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new Error('ack_deadline_now_invalid')
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 200), 1), 500)
  const readTimers = async (statuses: string[], order: string) => {
    let query = supabaseService.from('ediel_sla_timers')
      .select('id, company_id, ediel_message_id, timer_type, warning_at, critical_at, due_at, status, payload')
      .in('status', statuses).order(order, { ascending: true }).limit(limit)
    if (params.companyId) query = query.eq('company_id', params.companyId)
    const result = await query
    if (result.error) throw result.error
    return result.data ?? []
  }
  // An expired backlog must not consume the active timer budget. Expired rows
  // rotate by last visit so late ACK reconciliation also makes bounded progress.
  const active = await readTimers(['open', 'warning', 'critical'], 'due_at')
  const expiredRows = await readTimers(['expired'], 'updated_at')
  const data = [...active, ...expiredRows]

  let warning = 0
  let critical = 0
  let expired = 0
  let updated = 0

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    // Null-tenant raw receipts remain unassigned; a global sweep must never
    // convert them into another tenant's operational record.
    if (typeof row.company_id !== 'string' || typeof row.ediel_message_id !== 'string') continue
    const { data: source, error: sourceError } = await supabaseService.from('ediel_messages')
      .select('id,company_id,environment,direction,message_family,raw_payload')
      .eq('company_id', row.company_id).eq('id', row.ediel_message_id).maybeSingle()
    if (sourceError) throw sourceError
    if (!source) continue
    const technicalContrl = row.timer_type === 'contrl_due'
    // Only PRODAT application completion reads the sent ACK bytes.
    const physicalProdatAperak = source.message_family === 'PRODAT' && row.timer_type === 'aperak_due'
    const columns = 'id,company_id,environment,related_message_id,direction,status,message_sent_at,message_family,ack_outcome,validation_report'
    const messages = () => supabaseService.from('ediel_messages')
    const ackQuery = messages().select(columns)
      .eq('company_id', row.company_id).eq('related_message_id', row.ediel_message_id)
      .eq('direction', 'outbound')
    const { data: acknowledgements, error: ackError } = physicalProdatAperak
      ? await messages().select(`${columns},raw_payload,source_operation_id`)
        .eq('company_id', row.company_id).eq('related_message_id', row.ediel_message_id)
        .eq('direction', 'outbound').in('message_family', ['CONTRL', 'APERAK', 'UTILTS_ERR']).limit(2000)
      : technicalContrl
        ? await ackQuery.eq('environment', source.environment).eq('message_family', 'CONTRL').eq('status', 'sent')
          .order('message_sent_at', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).limit(1)
        : await ackQuery.in('message_family', ['CONTRL', 'APERAK', 'UTILTS_ERR']).limit(2000)
    if (ackError) throw ackError
    let transactionResults: Array<Record<string, unknown>> = []
    if (source.message_family === 'UTILTS' && row.timer_type === 'aperak_due') {
      const results = await supabaseService.from('ediel_ack_transaction_results')
        .select('company_id,environment,source_message_id,source_transaction_id,finalized_at,response_message_id')
        .eq('company_id', row.company_id).eq('source_message_id', row.ediel_message_id).limit(1000)
      if (results.error) throw results.error
      transactionResults = results.data ?? []
    }
    const observedAcks = (acknowledgements ?? []).filter(ack => typeof ack.message_sent_at === 'string'
      && (technicalContrl ? compareAckTime(ack.message_sent_at, now) <= 0 : Date.parse(ack.message_sent_at) <= nowMs))
    const completion = inboundAckTimerCompletion({
      source: source as EdielMessageRow, timerType: String(row.timer_type),
      acknowledgements: observedAcks,
      transactionResults,
    })
    const deadline = typeof row.due_at === 'string' ? row.due_at : ''
    const firstContrl = technicalContrl && completion === 'resolved' ? observedAcks[0] : undefined
    const lateContrl = typeof firstContrl?.message_sent_at === 'string'
      && compareAckTime(firstContrl.message_sent_at, deadline) > 0
      ? { dueAt: deadline, sentAt: firstContrl.message_sent_at, acknowledgementId: firstContrl.id }
      : null
    const deadlineReached = technicalContrl ? compareAckTime(deadline, now) <= 0 : Date.parse(deadline) <= nowMs
    const criticalAt = Date.parse(String(row.critical_at ?? ''))
    const warningAt = Date.parse(String(row.warning_at ?? ''))
    const status = completion ?? (deadlineReached
      ? 'expired'
      : Number.isFinite(criticalAt) && criticalAt <= nowMs
        ? 'critical'
        : Number.isFinite(warningAt) && warningAt <= nowMs
          ? 'warning'
          : String(row.status ?? 'open'))

    if (status === row.status) {
      if (status === 'expired') {
        const visited = await supabaseService.from('ediel_sla_timers')
          .update({ updated_at: now }).eq('id', row.id).eq('company_id', row.company_id).eq('status', 'expired')
        if (visited.error) throw visited.error
      }
      continue
    }

    // Keep the delivery outcome and deadline evidence together if the history write later fails.
    const timerPayload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {}
    const { data: changed, error: updateError } = await supabaseService
      .from('ediel_sla_timers')
      .update({
        status,
        updated_by: params.actorUserId,
        updated_at: now,
        ...(lateContrl ? { payload: { ...timerPayload, lateContrl } } : {}),
      })
      .eq('id', row.id)
      .eq('company_id', row.company_id)
      .eq('status', row.status)
      .select('id')
    if (updateError) throw updateError
    if (!changed?.length) continue

    const newlyExpired = status === 'expired' || (lateContrl !== null && row.status !== 'expired')
    if (typeof row.ediel_message_id === 'string') {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: row.ediel_message_id,
        eventType: 'manual_note',
        eventStatus: newlyExpired ? 'error' : completion ? 'success' : 'warning',
        message: `Ediel SLA timer is now ${status}.${lateContrl ? ' CONTRL was sent after its deadline.' : ''}`,
        payload: { timerId: row.id, timerType: row.timer_type, status, dueAt: row.due_at, ...(lateContrl ? { lateContrl } : {}) },
      }).catch(() => null)
    }

    updated += 1
    if (status === 'warning') warning += 1
    if (status === 'critical') critical += 1
    if (newlyExpired) expired += 1
  }

  return { warning, critical, expired, updated }
}
