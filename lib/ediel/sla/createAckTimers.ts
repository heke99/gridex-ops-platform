import type { EdielMessageRow } from '@/lib/ediel/types'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'

export type EdielAckTimerPlan = {
  receivedAt: string
  contrlDueAt: string
  aperakDueAt: string
  warningAt: string
  criticalAt: string
  expiredAt: string
  finalApprovalDeadline: string | null
}

function addMinutes(iso: string, minutes: number): string {
  const ms = new Date(iso).getTime()
  const base = Number.isFinite(ms) ? ms : Date.now()
  return new Date(base + minutes * 60_000).toISOString()
}

export function buildAckTimerPlan(message: EdielMessageRow, params?: { testRunStartedAt?: string | null }): EdielAckTimerPlan {
  const receivedAt = message.message_received_at ?? message.created_at ?? new Date().toISOString()
  const dueAt = addMinutes(receivedAt, 30)
  return {
    receivedAt,
    contrlDueAt: dueAt,
    aperakDueAt: dueAt,
    warningAt: addMinutes(dueAt, -10),
    criticalAt: addMinutes(dueAt, -5),
    expiredAt: dueAt,
    finalApprovalDeadline: params?.testRunStartedAt ? addMinutes(params.testRunStartedAt, 24 * 60) : null,
  }
}

export async function createAckTimersForMessage(params: {
  actorUserId: string
  message: EdielMessageRow
  testRunStartedAt?: string | null
}): Promise<EdielAckTimerPlan> {
  const plan = buildAckTimerPlan(params.message, { testRunStartedAt: params.testRunStartedAt ?? null })
  const shouldCreateTimers = params.message.direction === 'inbound' && params.message.message_standard === 'edifact'

  if (!shouldCreateTimers) return plan

  const rows = [
    params.message.requires_contrl !== false
      ? {
          company_id: params.message.company_id ?? null,
          ediel_message_id: params.message.id,
          timer_type: 'contrl_due',
          due_at: plan.contrlDueAt,
          warning_at: plan.warningAt,
          critical_at: plan.criticalAt,
          status: 'open',
          payload: { receivedAt: plan.receivedAt },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    params.message.requires_aperak !== false && params.message.message_family !== 'CONTRL' && params.message.message_family !== 'APERAK' && params.message.message_family !== 'UTILTS_ERR'
      ? {
          company_id: params.message.company_id ?? null,
          ediel_message_id: params.message.id,
          timer_type: 'aperak_due',
          due_at: plan.aperakDueAt,
          warning_at: plan.warningAt,
          critical_at: plan.criticalAt,
          status: 'open',
          payload: { receivedAt: plan.receivedAt },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    plan.finalApprovalDeadline
      ? {
          company_id: params.message.company_id ?? null,
          ediel_message_id: params.message.id,
          timer_type: 'final_approval_deadline',
          due_at: plan.finalApprovalDeadline,
          warning_at: addMinutes(plan.finalApprovalDeadline, -60),
          critical_at: addMinutes(plan.finalApprovalDeadline, -15),
          status: 'open',
          payload: { receivedAt: plan.receivedAt },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row))

  if (rows.length > 0) {
    const { error } = await supabaseService
      .from('ediel_sla_timers')
      .upsert(rows, { onConflict: 'ediel_message_id,timer_type' })
    if (error) throw error
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'info',
    message: 'SLA-timers prepared for inbound Ediel automation.',
    payload: plan,
  })

  return plan
}
