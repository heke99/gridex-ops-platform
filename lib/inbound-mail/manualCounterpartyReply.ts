import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import type { ManualReplyAssessment } from './manualReplyAssessment'

type Row = Record<string, unknown>

export async function recordManualCounterpartyReply(input: {
  companyId: string; request: Row; inboundId: string; assessment: ManualReplyAssessment
}): Promise<void> {
  const { request, assessment } = input
  if (request.company_id !== input.companyId) throw new Error('Motpartssvaret saknar verifierad tenantkoppling.')
  const now = new Date().toISOString()
  const metadata = request.metadata && typeof request.metadata === 'object' ? request.metadata as Row : {}
  const updated = await supabaseService.from('grid_owner_information_requests').update({
    status: 'needs_review', last_error_code: assessment.reason_codes[0], last_error_message: assessment.message,
    next_follow_up_at: null, received_at: now,
    metadata: { ...metadata, counterparty_reply: {
      ...assessment, requires_review: true, inbound_id: input.inboundId, poa_id: request.poa_id ?? null, received_at: now,
    } }, updated_at: now,
  }).eq('company_id', input.companyId).eq('id', String(request.id))
    .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review', 'ready_to_send_manual_email'])
    .select('id').maybeSingle()
  if (updated.error) throw updated.error
  // A completed/cancelled request must not be reopened by an older reply.
  if (!updated.data) return
  if (typeof request.customer_id === 'string') {
    await emitCustomerOperationEvent({
      companyId: input.companyId, customerId: request.customer_id,
      customerSiteId: typeof request.customer_site_id === 'string' ? request.customer_site_id : null,
      eventType: assessment.intent, title: assessment.outcome === 'rejected' ? 'Motparten har nekat fullmakten' : 'Fullmaktsärendet behöver kompletteras',
      message: assessment.message, status: 'needs_review', severity: 'warning', actionRequired: true,
      source: 'manual_inbound_ingestion', payload: { request_id: request.id, inbound_id: input.inboundId, reason_codes: assessment.reason_codes },
      idempotencyKey: `manual-counterparty-reply:${input.inboundId}`,
    })
  }
}
