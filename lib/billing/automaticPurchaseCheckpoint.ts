const CHECKPOINT = 'automatic_purchase_reconciliation'

export const automaticPurchaseCheckpointGuid = `response_payload->${CHECKPOINT}->>invoice_guid`
export const automaticPurchaseHeldStatuses = ['needs_review', 'pending', 'failed', 'failed_retryable']

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonemptyText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function hasAutomaticPurchaseCheckpoint(item: Record<string, unknown>, invoiceGuid: string) {
  const payload = object(item.response_payload)
  const checkpoint = object(payload[CHECKPOINT])
  const createInvoice = object(payload.create_invoice)
  const guids = Array.isArray(createInvoice.invoiceGuids)
    ? createInvoice.invoiceGuids.filter((guid: unknown) => nonemptyText(guid) !== null)
    : []
  const providerKey = nonemptyText(item.provider_idempotency_key) ?? nonemptyText(item.idempotency_key)
    ?? `invoice:${item.company_id}:${item.id}`
  return item.provider === 'capway_aptic'
    && (item.environment === 'production' || item.environment === 'test')
    && item.provider_invoice_guid === null && item.provider_invoice_id === null
    && !Object.hasOwn(payload, 'manual_purchase_reconciliation') && payload.purchase == null
    && automaticPurchaseHeldStatuses.includes(String(item.status))
    && nonemptyText(item.id) !== null && nonemptyText(item.company_id) !== null && nonemptyText(item.export_run_id) !== null
    && checkpoint.invoice_export_item_id === item.id && checkpoint.company_id === item.company_id
    && checkpoint.export_run_id === item.export_run_id && checkpoint.provider === item.provider
    && checkpoint.environment === item.environment && checkpoint.provider_idempotency_key === providerKey
    && typeof checkpoint.attempt_no === 'number' && Number.isSafeInteger(checkpoint.attempt_no) && checkpoint.attempt_no > 0
    && checkpoint.attempt_no === item.attempt_count
    && (checkpoint.financing_mode === 'factoring_with_recourse' || checkpoint.financing_mode === 'factoring_without_recourse')
    && checkpoint.invoice_guid === invoiceGuid && guids.length === 1 && guids[0] === invoiceGuid
}
