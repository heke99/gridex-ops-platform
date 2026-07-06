import { supabaseService } from '@/lib/supabase/service'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'
import { emitDomainEvent } from '@/lib/events/domainEvents'

// Closes the billing webhook loop: provider events stored by
// receiveBillingProviderWebhook are matched to invoice_export_items, the item's
// provider status is updated, and the customer-portal invoice mirror
// (customer_invoices) is upserted so customers see paid/credited state.

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function missingRelation(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(maybe && (maybe.code === '42P01' || maybe.code === '42703' || maybe.code === 'PGRST204' || maybe.code === 'PGRST205' || /does not exist|schema cache/i.test(maybe.message ?? '')))
}

// Normalized provider invoice states we understand. Anything else -> needs_review.
export type ProviderInvoiceState =
  | 'registered'
  | 'unpaid'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'reminder_sent'
  | 'collection'
  | 'credited'
  | 'cancelled'
  | 'disputed'
  | 'unknown'

const EVENT_TYPE_STATE_MAP: Record<string, ProviderInvoiceState> = {
  'invoice.registered': 'registered',
  'invoice.created': 'registered',
  'invoice.paid': 'paid',
  'invoice.payment': 'paid',
  'invoice.partially_paid': 'partially_paid',
  'invoice.unpaid': 'unpaid',
  'invoice.overdue': 'overdue',
  'invoice.reminder': 'reminder_sent',
  'invoice.reminder_sent': 'reminder_sent',
  'invoice.collection': 'collection',
  'invoice.credited': 'credited',
  'invoice.credit': 'credited',
  'invoice.cancelled': 'cancelled',
  'invoice.disputed': 'disputed',
  paid: 'paid',
  partially_paid: 'partially_paid',
  unpaid: 'unpaid',
  overdue: 'overdue',
  reminder_sent: 'reminder_sent',
  collection: 'collection',
  credited: 'credited',
  cancelled: 'cancelled',
  disputed: 'disputed',
  registered: 'registered',
}

export function resolveProviderInvoiceState(eventType: string | null, payload: Record<string, unknown>): ProviderInvoiceState {
  const typeKey = (eventType ?? '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '_')
  if (typeKey && EVENT_TYPE_STATE_MAP[typeKey]) return EVENT_TYPE_STATE_MAP[typeKey]

  const statusText = stringValue(payload.invoice_status) ?? stringValue(payload.invoiceStatus) ?? stringValue(payload.status)
  if (statusText) {
    const statusKey = statusText.toLowerCase().replace(/[^a-z0-9_.]/g, '_')
    if (EVENT_TYPE_STATE_MAP[statusKey]) return EVENT_TYPE_STATE_MAP[statusKey]
    // Capway bit-flag statuses arrive numerically.
    const numeric = numberValue(statusText)
    if (numeric !== null) {
      const normalized = normalizeCapwayInvoiceStatus(numeric)
      if (EVENT_TYPE_STATE_MAP[normalized]) return EVENT_TYPE_STATE_MAP[normalized]
    }
  }
  const numericStatus = numberValue(payload.invoice_status ?? payload.invoiceStatus ?? payload.status)
  if (numericStatus !== null) {
    const normalized = normalizeCapwayInvoiceStatus(numericStatus)
    if (EVENT_TYPE_STATE_MAP[normalized]) return EVENT_TYPE_STATE_MAP[normalized]
  }
  return 'unknown'
}

// Portal invoice status vocabulary (customer_invoices.status).
function portalInvoiceStatus(state: ProviderInvoiceState): string | null {
  switch (state) {
    case 'paid':
      return 'paid'
    case 'credited':
      return 'credited'
    case 'cancelled':
      return 'cancelled'
    case 'overdue':
    case 'reminder_sent':
    case 'collection':
      return 'overdue'
    case 'registered':
    case 'unpaid':
    case 'partially_paid':
      return 'sent'
    default:
      return null
  }
}

// Export item status transitions driven by provider events. Only forward,
// well-understood transitions are applied; everything else keeps the current
// status and only updates provider_status.
function exportItemStatus(state: ProviderInvoiceState, currentStatus: string): string | null {
  if (state === 'credited') return 'credited'
  if (state === 'disputed') return 'disputed'
  if (state === 'cancelled' && currentStatus !== 'sent') return 'cancelled'
  return null
}

type ProcessEventResult = {
  eventId: string
  outcome: 'processed' | 'needs_review' | 'skipped'
  reason?: string
}

async function upsertPortalInvoiceFromItem(input: {
  companyId: string
  item: Record<string, unknown>
  state: ProviderInvoiceState
  payload: Record<string, unknown>
}) {
  const status = portalInvoiceStatus(input.state)
  if (!status) return

  const providerGuid = stringValue(input.item.provider_invoice_guid)
  if (!providerGuid) return

  const metadata = isObject(input.item.metadata) ? input.item.metadata : {}
  const billingMonth = stringValue(metadata.billing_month)
  const periodStart = billingMonth ? `${billingMonth}-01` : null
  const paidAt = input.state === 'paid'
    ? stringValue(input.payload.paid_at) ?? stringValue(input.payload.paidAt) ?? new Date().toISOString()
    : null

  const row: Record<string, unknown> = {
    company_id: input.companyId,
    customer_id: stringValue(input.item.customer_id),
    billing_underlay_id: stringValue(input.item.billing_underlay_id),
    partner_invoice_reference: providerGuid,
    invoice_number: stringValue(input.item.provider_invoice_number),
    period_start: periodStart,
    amount_ex_vat: numberValue(input.item.amount_ex_vat),
    vat_amount: numberValue(input.item.vat_amount),
    amount_inc_vat: numberValue(input.item.amount_inc_vat),
    status,
    ...(paidAt ? { paid_at: paidAt } : {}),
    source_system: 'billing_provider_webhook',
    raw_payload: input.payload,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabaseService
    .from('customer_invoices')
    .upsert(row, { onConflict: 'company_id,partner_invoice_reference' })
  if (error) {
    if (missingRelation(error)) return
    // The unique index ships in the webhook-loop migration; fall back to
    // insert-or-update by lookup when it is not there yet.
    if (error.code === '42P10' || /no unique or exclusion constraint/i.test(error.message ?? '')) {
      const existing = await supabaseService
        .from('customer_invoices')
        .select('id')
        .eq('company_id', input.companyId)
        .eq('partner_invoice_reference', providerGuid)
        .limit(1)
        .maybeSingle()
      if (existing.data?.id) {
        await supabaseService.from('customer_invoices').update(row).eq('company_id', input.companyId).eq('id', existing.data.id)
      } else {
        await supabaseService.from('customer_invoices').insert(row)
      }
      return
    }
    throw error
  }
}

async function markEvent(eventId: string, status: 'processed' | 'needs_review' | 'failed') {
  await supabaseService
    .from('invoice_provider_events')
    .update({ status, processed_at: new Date().toISOString() })
    .eq('id', eventId)
}

async function processSingleEvent(event: Record<string, unknown>): Promise<ProcessEventResult> {
  const eventId = String(event.id)
  const provider = stringValue(event.provider) ?? 'unknown'
  const payload = isObject(event.payload) ? event.payload : {}
  const eventType = stringValue(event.event_type)
  const invoiceGuid = stringValue(event.provider_invoice_guid)

  // Match the export item (either previously matched, or match now by guid).
  let itemId = stringValue(event.matched_invoice_export_item_id)
  let companyId = stringValue(event.company_id)
  let item: Record<string, unknown> | null = null

  if (!itemId && invoiceGuid) {
    let query = supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('provider', provider)
      .eq('provider_invoice_guid', invoiceGuid)
      .limit(2)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    if (rows.length === 1) {
      item = rows[0]
      itemId = stringValue(item.id)
      companyId = companyId ?? stringValue(item.company_id)
    } else if (rows.length > 1) {
      await markEvent(eventId, 'needs_review')
      return { eventId, outcome: 'needs_review', reason: 'multiple_items_for_invoice_guid' }
    }
  } else if (itemId) {
    const { data, error } = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle()
    if (error) throw error
    item = (data as Record<string, unknown> | null) ?? null
    companyId = companyId ?? stringValue(item?.company_id)
  }

  if (!item || !itemId || !companyId) {
    await markEvent(eventId, 'needs_review')
    return { eventId, outcome: 'needs_review', reason: 'no_matching_export_item' }
  }

  const state = resolveProviderInvoiceState(eventType, payload)
  if (state === 'unknown') {
    await markEvent(eventId, 'needs_review')
    return { eventId, outcome: 'needs_review', reason: 'unknown_provider_state' }
  }

  const financeStatus = stringValue(payload.finance_status) ?? stringValue(payload.financeStatus)
  const currentStatus = String(item.status ?? '')
  const nextStatus = exportItemStatus(state, currentStatus)
  const statusPayload = isObject(item.status_payload) ? item.status_payload : {}

  const update: Record<string, unknown> = {
    provider_status: state,
    status_payload: {
      ...statusPayload,
      last_provider_event_id: eventId,
      last_provider_event_type: eventType,
      last_provider_state: state,
      last_provider_event_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }
  if (nextStatus) update.status = nextStatus
  if (financeStatus) update.purchase_status = normalizeCapwayFinanceStatus(financeStatus)
  const providerInvoiceNumber = stringValue(payload.invoice_number) ?? stringValue(payload.invoiceNumber)
  if (providerInvoiceNumber) update.provider_invoice_number = providerInvoiceNumber
  const providerOcr = stringValue(payload.ocr) ?? stringValue(payload.payment_reference) ?? stringValue(payload.paymentReference)
  if (providerOcr) update.provider_ocr = providerOcr

  const { error: updateError } = await supabaseService
    .from('invoice_export_items')
    .update(update)
    .eq('company_id', companyId)
    .eq('id', itemId)
  if (updateError) throw updateError

  await upsertPortalInvoiceFromItem({ companyId, item: { ...item, ...update }, state, payload })

  // Also link the event to the item if it was matched during processing.
  await supabaseService
    .from('invoice_provider_events')
    .update({ matched_invoice_export_item_id: itemId, company_id: companyId })
    .eq('id', eventId)

  await markEvent(eventId, 'processed')

  await emitDomainEvent({
    companyId,
    eventType: `invoice.provider.${state}`,
    aggregateType: 'invoice_export_item',
    aggregateId: itemId,
    subjectCustomerId: stringValue(item.customer_id),
    source: 'billing_provider_webhook',
    payload: {
      provider,
      provider_invoice_guid: invoiceGuid,
      provider_state: state,
      export_item_status: nextStatus ?? currentStatus,
    },
    idempotencyKey: `invoice-provider-state:${eventId}`,
  }).catch(() => null)

  return { eventId, outcome: 'processed' }
}

export async function processPendingInvoiceProviderEvents(input: {
  companyId?: string | null
  limit?: number
} = {}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  let query = supabaseService
    .from('invoice_provider_events')
    .select('*')
    .eq('status', 'received')
    .order('received_at', { ascending: true })
    .limit(limit)
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (missingRelation(error)) return { processed: 0, needsReview: 0, failed: 0, results: [] as ProcessEventResult[] }
    throw error
  }

  const events = (data ?? []) as Record<string, unknown>[]
  const results: ProcessEventResult[] = []
  for (const event of events) {
    try {
      results.push(await processSingleEvent(event))
    } catch (processError) {
      const eventId = String(event.id)
      console.error('[invoice-provider-events] processing failed', { eventId, error: processError })
      await markEvent(eventId, 'failed').catch(() => null)
      results.push({ eventId, outcome: 'skipped', reason: processError instanceof Error ? processError.message : 'unknown_error' })
    }
  }

  return {
    processed: results.filter((row) => row.outcome === 'processed').length,
    needsReview: results.filter((row) => row.outcome === 'needs_review').length,
    failed: results.filter((row) => row.outcome === 'skipped').length,
    results,
  }
}

/**
 * Re-sweeps needs_review provider events that may have become resolvable —
 * e.g. the invoice_export_item now exists or its GUID was linked after the
 * webhook arrived. Previously needs_review was a permanent dead letter: no
 * cron and no UI ever touched those rows again.
 *
 * Idempotent: unresolvable events simply stay needs_review.
 */
export async function retryReviewableInvoiceProviderEvents(input: {
  companyId?: string | null
  limit?: number
  maxAgeDays?: number
} = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const maxAgeDays = Math.min(Math.max(input.maxAgeDays ?? 30, 1), 365)
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  let query = supabaseService
    .from('invoice_provider_events')
    .select('*')
    .eq('status', 'needs_review')
    .not('provider_invoice_guid', 'is', null)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(limit)
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (missingRelation(error)) return { processed: 0, stillNeedsReview: 0, failed: 0, results: [] as ProcessEventResult[] }
    throw error
  }

  const events = (data ?? []) as Record<string, unknown>[]
  const results: ProcessEventResult[] = []
  for (const event of events) {
    try {
      results.push(await processSingleEvent(event))
    } catch (processError) {
      const eventId = String(event.id)
      console.error('[invoice-provider-events] review retry failed', { eventId, error: processError })
      results.push({ eventId, outcome: 'skipped', reason: processError instanceof Error ? processError.message : 'unknown_error' })
    }
  }

  return {
    processed: results.filter((row) => row.outcome === 'processed').length,
    stillNeedsReview: results.filter((row) => row.outcome === 'needs_review').length,
    failed: results.filter((row) => row.outcome === 'skipped').length,
    results,
  }
}
