import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'

type Row = Record<string, unknown>
export async function resolveManualReplyReview(input: {
  companyId: string; requestId: string; powerOfAttorneyId: string; actorUserId: string; note: string
}) {
  if (input.note.trim().length < 8) throw new Error('Beskriv vad som har åtgärdats.')
  const { data, error } = await supabaseService.from('grid_owner_information_requests').select('*')
    .eq('company_id', input.companyId).eq('id', input.requestId).eq('poa_id', input.powerOfAttorneyId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Fullmaktsärendet hittades inte.')
  const metadata = (data.metadata ?? {}) as Row, reply = (metadata.counterparty_reply ?? {}) as Row
  const completedCommercial = data.status === 'completed' && data.request_type === 'current_supplier_contract_information_request'
  if (reply.requires_review !== true || (data.status !== 'needs_review' && !completedCommercial)) return
  let nextStatus = 'ready_to_send_manual_email'
  if (completedCommercial) {
    // Retained completed conversations can hold a site while another inquiry
    // is active. Review that source without reopening a competing inquiry.
    const sibling = await supabaseService.from('grid_owner_information_requests').select('id')
      .eq('company_id', input.companyId).eq('customer_id', data.customer_id).eq('customer_site_id', data.customer_site_id)
      .eq('request_type', data.request_type).neq('id', input.requestId)
      .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'received', 'needs_review',
        'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',
        'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response',
        'manual_response_received', 'manual_response_parsed']).limit(1).maybeSingle()
    if (sibling.error) throw sibling.error
    if (sibling.data) nextStatus = 'completed'
  }
  const now = new Date().toISOString()
  let update = supabaseService.from('grid_owner_information_requests').update({
    status: nextStatus, last_error_code: null, last_error_message: null, next_follow_up_at: null,
    metadata: { ...metadata, counterparty_reply: { ...reply, requires_review: false, reviewed_at: now,
      reviewed_by: input.actorUserId, resolution_note: input.note.trim() } }, updated_at: now,
  }).eq('company_id', input.companyId).eq('id', input.requestId).eq('poa_id', input.powerOfAttorneyId).eq('status', data.status)
  update = data.updated_at ? update.eq('updated_at', data.updated_at) : update.is('updated_at', null)
  update = reply.inbound_id ? update.eq('metadata->counterparty_reply->>inbound_id', String(reply.inbound_id)) : update.is('metadata->counterparty_reply->>inbound_id', null)
  const saved = await update.select('id').maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) throw new Error('Ärendet ändrades samtidigt. Läs om ärendet.')
  if (data.customer_id) await emitCustomerOperationEvent({
    companyId: input.companyId, customerId: String(data.customer_id), customerSiteId: data.customer_site_id,
    actorUserId: input.actorUserId, eventType: 'power_of_attorney_reply_reviewed', title: 'Motpartens kompletteringsbegäran har granskats',
    message: input.note.trim(), status: 'completed', severity: 'info', actionRequired: false,
    source: 'poa_register', payload: { request_id: input.requestId, poa_id: input.powerOfAttorneyId, inbound_id: reply.inbound_id ?? null },
    idempotencyKey: `poa-reply-reviewed:${input.requestId}:${String(reply.inbound_id ?? 'legacy')}`,
  })
}
