// GOR-04 (reality scenario I): what follows when the grid owner rejects our request.
//
// processInboundAckMessage moves the switch / grid-owner data request to failed. The people around it must also
// learn it, exactly once and only for a real rejection of a request that was still waiting:
//   negative APERAK (the grid owner's business rejection) -> the inbound business state machine's
//     business_rejection: operator case, website application -> switch_rejected, 'supplier_switch.rejected'
//     customer notice (template switch.action_required). Its workflow/notification keys are idempotent per ACK.
//   negative CONTRL (our own syntax error) -> an operator case only. The customer is not told: the fault is ours,
//     not the customer's (owner decision 2026-10-22).
// Never for a late negative ACK after the Z04 (P-11): processInboundAckMessage then reports no rejection.
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type AckRejectionFollowUpInput = {
  actorUserId: string
  /** The received ACK as stored after processing (linked to customer/site/metering point of our original). */
  ackMessage: EdielMessageRow
  switchRequestId: string | null
  gridOwnerDataRequestId: string | null
  failureReason: string | null
}
export type AckRejectionFollowUpResult =
  | { status: 'business_rejection'; outcome: string; updated: string[] }
  | { status: 'technical_rejection_case'; caseId: string; existing: boolean }
  | { status: 'skipped'; reason: 'no_customer_link' | 'not_a_rejection_family' }

async function existingCase(companyId: string, ackMessageId: string, caseType: 'business_rejection' | 'technical_rejection'): Promise<string | null> {
  const { data, error } = await supabaseService.from('customer_cases').select('id')
    .eq('company_id', companyId).eq('case_type', caseType).eq('metadata->>source_ediel_message_id', ackMessageId).limit(1)
  if (error) throw error
  return (data?.[0] as { id?: string } | undefined)?.id ?? null
}

export async function followUpAckRejection(input: AckRejectionFollowUpInput): Promise<AckRejectionFollowUpResult> {
  const ack = input.ackMessage, companyId = ack.company_id
  if (!companyId || !ack.customer_id) {
    await createEdielMessageEvent({ actorUserId: input.actorUserId, edielMessageId: ack.id, eventType: 'manual_note', eventStatus: 'warning',
      message: 'Nätägarens avvisning saknar kundkoppling; operatörsärende och kundbesked kunde inte skapas. Granska meddelandet manuellt.',
      payload: { ackRejectionFollowUp: 'no_customer_link', switchRequestId: input.switchRequestId, gridOwnerDataRequestId: input.gridOwnerDataRequestId } })
    return { status: 'skipped', reason: 'no_customer_link' }
  }
  if (ack.message_family === 'APERAK') {
    // Exactly once per received ACK: a re-run of the follow-up after a crash finds the case it already opened
    // (the state machine's workflow and notification keys are idempotent per ACK, its case insert is not).
    const prior = await existingCase(companyId, ack.id, 'business_rejection')
    if (prior) return { status: 'business_rejection', outcome: 'business_rejection', updated: [] }
    const result = await applyInboundBusinessStateMachine({ actorUserId: input.actorUserId, message: ack,
      matchedSwitchRequestId: input.switchRequestId, source: 'inbound_ack_rejection' })
    return { status: 'business_rejection', outcome: result.outcome, updated: result.updated }
  }
  if (ack.message_family !== 'CONTRL') return { status: 'skipped', reason: 'not_a_rejection_family' }
  // Our own interchange failed the counterparty's syntax check: an operator corrects and re-sends (TR-05).
  const prior = await existingCase(companyId, ack.id, 'technical_rejection')
  if (prior) return { status: 'technical_rejection_case', caseId: prior, existing: true }
  const { data, error } = await supabaseService.from('customer_cases').insert({
    company_id: companyId, customer_id: ack.customer_id, site_id: ack.site_id ?? null, metering_point_id: ack.metering_point_id ?? null,
    supplier_switch_request_id: input.switchRequestId, case_type: 'technical_rejection', status: 'open', priority: 'high',
    title: 'Nätägaren avvisade vår fil tekniskt (negativ CONTRL)',
    description: `Vårt Ediel-meddelande underkändes i nätägarens syntaxkontroll${input.failureReason ? ` (${input.failureReason})` : ''}. Felet ligger hos oss; kunden informeras inte.`,
    reason_category: 'ediel_inbound_review',
    next_action: 'Granska originalet och rätta det. Ett nytt meddelande kräver en separat rättelse; ingen automatisk omsändning.',
    source: 'ediel_inbound_state_machine',
    metadata: { source_ediel_message_id: ack.id, message_family: ack.message_family, message_code: ack.message_code,
      grid_owner_data_request_id: input.gridOwnerDataRequestId, failure_reason: input.failureReason, customer_notified: false },
  }).select('id').single()
  if (error) throw error
  const caseId = (data as { id?: string } | null)?.id
  if (!caseId) throw new Error('ack_rejection_case_missing_id')
  return { status: 'technical_rejection_case', caseId, existing: false }
}
