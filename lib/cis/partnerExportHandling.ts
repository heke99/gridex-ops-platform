import type { PartnerExportRow } from '@/lib/cis/types'

export function canChangePartnerExportHandling(row: PartnerExportRow): boolean {
  return Boolean(row.company_id && row.customer_id)
    && ['queued', 'failed', 'cancelled'].includes(row.status)
    && !row.sent_at && !row.acknowledged_at && !row.last_partner_response_at
    && !row.partner_response_log?.length && !row.payload?.exportRunId && !row.payload?.exportRunItemId
    && !row.idempotency_key?.startsWith('billing-export-run-item:')
}
