import { supabaseService } from '@/lib/supabase/service'
import { tenantUpdate } from '@/lib/supabase/tenantQuery'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import type { ManualReplyAssessment } from './manualReplyAssessment'

type Row = Record<string, unknown>

export async function recordManualCounterpartyReply(input: {
  companyId: string; request: Row; inboundId: string; assessment: ManualReplyAssessment
}): Promise<void> {
  const { request, assessment } = input
  if (request.company_id !== input.companyId) throw new Error('Motpartssvaret saknar verifierad tenantkoppling.')
  const commercial = request.request_type === 'current_supplier_contract_information_request'
  if (commercial) {
    const { data, error } = await supabaseService.rpc('gridex_hold_manual_counterparty_reply_v1', {
      p_company_id: input.companyId, p_request_id: String(request.id), p_inbound_id: input.inboundId, p_assessment: assessment,
    })
    if (error) throw error
    const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Row : {}
    if (result.ok === false && result.held === false) return
    if (result.ok !== true || result.held !== true) {
      throw new Error('manual_counterparty_hold_invalid_result')
    }
    if (result.customerId !== request.customer_id || result.customerSiteId !== request.customer_site_id) {
      throw new Error('manual_counterparty_hold_scope_mismatch')
    }
    // All commercial holds use durable source ordering under the site lock.
    // The command owns the hold and its idempotent audit together.
    return
  }
  const now = new Date().toISOString()
  const metadata = request.metadata && typeof request.metadata === 'object' ? request.metadata as Row : {}
  const updated = await tenantUpdate(input.companyId, 'grid_owner_information_requests', {
    status: 'needs_review', last_error_code: assessment.reason_codes[0], last_error_message: assessment.message,
    next_follow_up_at: null, received_at: now,
    metadata: { ...metadata, counterparty_reply: {
      ...assessment, requires_review: true, inbound_id: input.inboundId, poa_id: request.poa_id ?? null, received_at: now,
    } }, updated_at: now,
  }).eq('id', String(request.id))
    .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review', 'ready_to_send_manual_email'])
    .select('id').maybeSingle()
  if (updated.error) throw updated.error
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
