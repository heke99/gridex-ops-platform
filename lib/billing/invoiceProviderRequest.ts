import 'server-only'
import type { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import type { CapwayFinancingMode, CapwayPutInvoice } from '@/lib/integrations/billing/capway/types'

type Row = Record<string, unknown>
const sendable = ['pending', 'failed', 'failed_retryable']
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function record(value: unknown): Row | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null }
function amount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
// JSONB may return object keys in another order. Serialize every attempt in the
// same order while preserving the original values and array order.
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  const row = record(value)
  return row ? Object.fromEntries(Object.keys(row).sort().map(key => [key, ordered(row[key])])) : value
}
function extra(fields: unknown, name: string): string | null {
  if (!Array.isArray(fields)) return null
  const matching = fields.map(record).filter(field => field?.name === name)
  return matching.length === 1 && Array.isArray(matching[0]?.value) && matching[0].value.length === 1
    ? text(matching[0].value[0]) : null
}

/** Commit a complete financial request before any external attempt. A later
 * retry reuses this request, including legal identity, dates and provider
 * channel. Separate export workers contend on the same empty-payload CAS. */
export async function captureInvoiceProviderRequest(input: {
  companyId: string; itemId: string; exportRunId: string; environment: string; financingMode: CapwayFinancingMode
  build: () => CapwayPutInvoice
}): Promise<{ payload: CapwayPutInvoice; providerKey: string; providerInvoiceGuid: string | null; response: Row; invoiceDate: string; dueDate: string }> {
  const items = tenantDb(input.companyId).from('invoice_export_items') as ReturnType<typeof supabaseService.from>
  const load = async () => {
    const result = await items.select('*').eq('id', input.itemId).eq('export_run_id', input.exportRunId).maybeSingle()
    if (result.error) throw result.error
    const item = record(result.data)
    if (!item || !sendable.includes(String(item.status)) || item.provider !== 'capway_aptic'
        || item.environment !== input.environment || item.financing_mode !== input.financingMode) {
      throw new Error('invoice_provider_request_resource_unavailable')
    }
    return item
  }
  const qualify = (item: Row) => {
    const payload = record(item.request_payload), customer = record(payload?.customer)
    const debts = Array.isArray(payload?.debts) ? payload.debts.map(record) : []
    const providerKey = text(item.provider_request_id) ?? text(item.provider_idempotency_key) ?? text(item.idempotency_key)
    const invoiceDate = text(payload?.invoiceDate), dueDate = text(debts[0]?.dueDate)
    const principal = amount(debts[0]?.originalPrincipal), vat = amount(debts[0]?.originalVat)
    const rounding = debts[0]?.rounding === undefined ? 0 : amount(debts[0]?.rounding)
    const expectedPrincipal = amount(item.amount_ex_vat), expectedVat = amount(item.vat_amount), expectedTotal = amount(item.amount_inc_vat)
    if (!payload || !customer || debts.length !== 1 || !debts[0] || !providerKey
        || extra(payload.extraFields, 'gridex_company_id') !== input.companyId
        || extra(payload.extraFields, 'gridex_pricing_run_id') !== item.pricing_run_id
        || text(payload.externalReferenceCode) !== item.pricing_run_id
        || extra(payload.extraFields, 'gridex_financing_mode') !== input.financingMode
        || extra(customer.extraFields, 'gridex_customer_id') !== item.customer_id
        || extra(debts[0].extraFields, 'gridex_billing_underlay_id') !== item.billing_underlay_id
        || !invoiceDate || !dueDate || text(debts[0].invoiceDate) !== invoiceDate
        || !Number.isFinite(Date.parse(invoiceDate)) || !Number.isFinite(Date.parse(dueDate))
        || principal === null || vat === null || rounding === null
        || expectedPrincipal === null || expectedVat === null || expectedTotal === null
        || Math.abs(principal - expectedPrincipal) > 0.01 || Math.abs(vat - expectedVat) > 0.01
        || Math.abs(principal + vat + rounding - expectedTotal) > 0.01
        || (text(item.provider_invoice_guid) && text(item.provider_invoice_id) && item.provider_invoice_guid !== item.provider_invoice_id)
        || (text(item.provider_request_id) && text(item.provider_idempotency_key)
          && item.provider_request_id !== item.provider_idempotency_key)) {
      throw new Error('invoice_provider_request_unqualified')
    }
    const response = record(record(item.response_payload)?.create_invoice) ?? {}
    return { payload: ordered(payload) as CapwayPutInvoice, providerKey,
      providerInvoiceGuid: text(item.provider_invoice_guid) ?? text(item.provider_invoice_id), response, invoiceDate, dueDate }
  }
  let item = await load()
  if (record(item.request_payload) && Object.keys(item.request_payload as Row).length > 0) return qualify(item)
  // An old ambiguous attempt without its original payload cannot be repaired
  // by inventing a new delivery decision under the old provider key.
  if (Number(item.attempt_count) > 0 || text(item.provider_invoice_guid) || text(item.provider_invoice_id)) throw new Error('invoice_provider_request_missing')
  const providerKey = text(item.provider_request_id) ?? text(item.provider_idempotency_key) ?? text(item.idempotency_key)
  if (!providerKey) throw new Error('invoice_provider_request_key_missing')
  const proposed = { ...item, request_payload: ordered(input.build()), provider_request_id: providerKey, provider_idempotency_key: providerKey }
  qualify(proposed)
  const capture = await items.update({
    request_payload: proposed.request_payload as Row, provider_request_id: providerKey, provider_idempotency_key: providerKey,
  }).eq('id', input.itemId).eq('export_run_id', input.exportRunId)
    .eq('request_payload', {}).in('status', sendable).select('*').maybeSingle()
  if (capture.error) throw capture.error
  item = record(capture.data) ?? await load()
  return qualify(item)
}
