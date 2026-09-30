import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

export async function processApprovedInvoiceRetryQueue(
  input: { companyId?: string | null; limit?: number },
  execute: (input: { companyId: string; itemId: string; actorUserId: string }) => Promise<{ status: string }>,
) {
  const limit = Math.min(Math.max(Math.floor(Number.isFinite(input.limit) ? input.limit! : 50),1),200)
  const token = randomUUID()
  const claimed = await supabaseService.rpc('gridex_claim_approved_invoice_retries_fair_v1', {
    p_company_id: input.companyId ?? null, p_limit: limit, p_claim_token: token,
  })
  if (claimed.error) throw claimed.error
  if (!Array.isArray(claimed.data)) throw new Error('approved_invoice_retry_claim_invalid')
  const rows = claimed.data as Row[]
  if (rows.length > limit || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => {
    const approval = record(record(row.metadata).approval)
    return !text(row.id) || !text(row.company_id) || row.claim_token !== token || row.status !== 'failed_retryable'
      || (input.companyId && row.company_id !== input.companyId) || approval.status !== 'approved' || !text(approval.approved_by)
  })) throw new Error('approved_invoice_retry_claim_invalid')
  let sent = 0, failed = 0
  const errors: Array<{ invoiceExportItemId: string; reason: string }> = []
  for (const row of rows) {
    const companyId = text(row.company_id)!, itemId = text(row.id)!, actor = text(record(record(row.metadata).approval).approved_by)!
    let outcome = 'not_sent', reason: string | null = null
    try {
      const result = await execute({ companyId,itemId,actorUserId: actor })
      if (result.status === 'sent') { sent++; outcome = 'sent' } else failed++
    } catch {
      failed++; outcome = 'preflight_failed'; reason = 'approved_invoice_retry_preflight_failed'
      errors.push({ invoiceExportItemId: itemId, reason })
    }
    try {
      const released = await supabaseService.rpc('gridex_release_approved_invoice_retry_v1', {
        p_company_id: companyId,p_item_id: itemId,p_claim_token: token,p_outcome: outcome,p_reason: reason,
      })
      if (released.error || released.data !== true) throw new Error('approved_invoice_retry_completion_unavailable')
    } catch { errors.push({ invoiceExportItemId: itemId,reason: 'approved_invoice_retry_completion_unavailable' }) }
  }
  return { processed: sent + failed,sent,failed,errors }
}
