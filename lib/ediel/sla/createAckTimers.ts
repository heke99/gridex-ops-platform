import type { EdielMessageRow } from '@/lib/ediel/types'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EdielAckTimerPlan = {
  receivedAt: string
  contrlDueAt: string
  aperakDueAt: string
  warningAt: string
  criticalAt: string
  expiredAt: string
  finalApprovalDeadline: string | null
  anchorKind: 'local_ingress_at' | 'local_record_created_at'
  anchorCertainty: 'observed' | 'uncertain'
}

function addMinutes(iso: string, minutes: number): string {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) throw new Error('ack_timer_anchor_invalid')
  return new Date(ms + minutes * 60_000).toISOString()
}

export function buildAckTimerPlan(message: EdielMessageRow, params?: { testRunStartedAt?: string | null }): EdielAckTimerPlan {
  const receivedAt = message.message_received_at ?? message.created_at
  if (!receivedAt) throw new Error('ack_timer_anchor_invalid')
  const dueAt = addMinutes(receivedAt, EDIEL_ACK_DEADLINE_MINUTES)
  return {
    receivedAt,
    anchorKind: message.message_received_at ? 'local_ingress_at' : 'local_record_created_at',
    anchorCertainty: message.message_received_at ? 'observed' : 'uncertain',
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
}): Promise<EdielAckTimerPlan | null> {
  const shouldCreateTimers = params.message.direction === 'inbound' && params.message.message_standard === 'edifact'

  if (!shouldCreateTimers) return null
  const plan = buildAckTimerPlan(params.message, { testRunStartedAt: params.testRunStartedAt ?? null })
  const requirements = canonicalAckRequirementsForFamilyCode({ family: params.message.message_family, code: params.message.message_code })
  const anchor = { receivedAt: plan.receivedAt, anchorKind: plan.anchorKind, anchorCertainty: plan.anchorCertainty }

  const rows = [
    requirements.requiresContrl
      ? {
          company_id: params.message.company_id ?? null,
          ediel_message_id: params.message.id,
          timer_type: 'contrl_due',
          due_at: plan.contrlDueAt,
          warning_at: plan.warningAt,
          critical_at: plan.criticalAt,
          status: 'open',
          payload: anchor,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
    requirements.requiresAperak || (requirements.supportsNegativeAperak && params.message.requires_aperak === true)
      ? {
          company_id: params.message.company_id ?? null,
          ediel_message_id: params.message.id,
          timer_type: 'aperak_due',
          due_at: plan.aperakDueAt,
          warning_at: plan.warningAt,
          critical_at: plan.criticalAt,
          status: 'open',
          payload: anchor,
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
          payload: anchor,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row))

  if (rows.length > 0) {
    const { error } = await supabaseService
      .from('ediel_sla_timers')
      .upsert(rows, { onConflict: 'ediel_message_id,timer_type', ignoreDuplicates: true })
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
