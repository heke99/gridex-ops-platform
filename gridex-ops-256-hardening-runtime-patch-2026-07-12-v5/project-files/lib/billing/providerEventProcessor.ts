import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'

type JsonRecord = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

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

const STATE_RANK: Record<ProviderInvoiceState, number> = {
  unknown: -1,
  registered: 0,
  unpaid: 1,
  partially_paid: 2,
  overdue: 3,
  reminder_sent: 4,
  collection: 5,
  paid: 10,
  disputed: 11,
  cancelled: 12,
  credited: 13,
}

export function resolveProviderInvoiceState(eventType: string | null, payload: JsonRecord): ProviderInvoiceState {
  const typeKey = (eventType ?? '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '_')
  if (typeKey && EVENT_TYPE_STATE_MAP[typeKey]) return EVENT_TYPE_STATE_MAP[typeKey]
  const statusValue = payload.invoice_status ?? payload.invoiceStatus ?? payload.status
  const statusText = text(statusValue)
  if (statusText) {
    const statusKey = statusText.toLowerCase().replace(/[^a-z0-9_.]/g, '_')
    if (EVENT_TYPE_STATE_MAP[statusKey]) return EVENT_TYPE_STATE_MAP[statusKey]
  }
  const numericStatus = number(statusValue)
  if (numericStatus !== null) {
    const normalized = normalizeCapwayInvoiceStatus(numericStatus)
    if (EVENT_TYPE_STATE_MAP[normalized]) return EVENT_TYPE_STATE_MAP[normalized]
  }
  return 'unknown'
}

function portalInvoiceStatus(state: ProviderInvoiceState): string | null {
  if (state === 'paid') return 'paid'
  if (state === 'credited') return 'credited'
  if (state === 'cancelled') return 'cancelled'
  if (['overdue', 'reminder_sent', 'collection'].includes(state)) return 'overdue'
  if (['registered', 'unpaid', 'partially_paid'].includes(state)) return 'sent'
  return null
}

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

async function markEvent(input: {
  eventId: string
  companyId: string
  token: string
  status: 'processed' | 'needs_review' | 'failed'
  reason?: string | null
}) {
  const response = await supabaseService
    .from('invoice_provider_events')
    .update({
      status: input.status,
      processed_at: new Date().toISOString(),
      processing_token: null,
      processing_started_at: null,
      failure_reason: input.reason ?? null,
    })
    .eq('id', input.eventId)
    .eq('company_id', input.companyId)
    .eq('processing_token', input.token)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle()
  if (response.error) throw response.error
  if (!response.data) throw new Error('Providerhändelsen kunde inte slutföras med rätt claim.')
}

async function upsertPortalInvoice(input: {
  companyId: string
  item: JsonRecord
  state: ProviderInvoiceState
  payload: JsonRecord
}) {
  const status = portalInvoiceStatus(input.state)
  if (!status) return
  const providerGuid = text(input.item.provider_invoice_guid)
  const customerId = text(input.item.customer_id)
  if (!providerGuid || !customerId) throw new Error('Providerfakturan saknar kund- eller provideridentitet.')
  const metadata = object(input.item.metadata)
  const billingMonth = text(metadata.billing_month)
  const paidAt = input.state === 'paid'
    ? text(input.payload.paid_at) ?? text(input.payload.paidAt) ?? new Date().toISOString()
    : null
  const response = await supabaseService
    .from('customer_invoices')
    .upsert({
      company_id: input.companyId,
      customer_id: customerId,
      billing_underlay_id: text(input.item.billing_underlay_id),
      partner_invoice_reference: providerGuid,
      invoice_number: text(input.item.provider_invoice_number),
      period_start: billingMonth ? `${billingMonth}-01` : null,
      amount_ex_vat: number(input.item.amount_ex_vat),
      vat_amount: number(input.item.vat_amount),
      amount_inc_vat: number(input.item.amount_inc_vat),
      status,
      ...(paidAt ? { paid_at: paidAt } : {}),
      source_system: 'billing_provider_webhook',
      raw_payload: input.payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,partner_invoice_reference' })
    .select('id')
    .maybeSingle()
  if (response.error) throw response.error
  if (!response.data) throw new Error('Kundportalens fakturaspegel kunde inte uppdateras.')
}

async function processSingleEvent(event: JsonRecord, token: string): Promise<ProcessEventResult> {
  const eventId = text(event.id)
  const companyId = text(event.company_id)
  const itemId = text(event.matched_invoice_export_item_id)
  const provider = text(event.provider)
  const environment = text(event.environment)
  const invoiceGuid = text(event.provider_invoice_guid)
  if (!eventId || !companyId || !itemId || !provider || !environment || !invoiceGuid) {
    if (eventId && companyId) await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'provider_event_identity_incomplete' })
    return { eventId: eventId ?? 'unknown', outcome: 'needs_review', reason: 'provider_event_identity_incomplete' }
  }

  const itemResult = await supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('id', itemId)
    .eq('company_id', companyId)
    .eq('provider', provider)
    .eq('environment', environment)
    .eq('provider_invoice_guid', invoiceGuid)
    .maybeSingle()
  if (itemResult.error) throw itemResult.error
  const item = (itemResult.data as JsonRecord | null) ?? null
  if (!item) {
    await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'no_matching_export_item' })
    return { eventId, outcome: 'needs_review', reason: 'no_matching_export_item' }
  }

  const payload = object(event.payload)
  const state = resolveProviderInvoiceState(text(event.event_type), payload)
  if (state === 'unknown') {
    await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'unknown_provider_state' })
    return { eventId, outcome: 'needs_review', reason: 'unknown_provider_state' }
  }
  const currentProviderState = (text(item.provider_status) as ProviderInvoiceState | null) ?? 'unknown'
  if (STATE_RANK[state] < STATE_RANK[currentProviderState]) {
    await markEvent({ eventId, companyId, token, status: 'processed', reason: 'stale_provider_state_ignored' })
    return { eventId, outcome: 'processed', reason: 'stale_provider_state_ignored' }
  }

  const currentStatus = String(item.status ?? '')
  const nextStatus = exportItemStatus(state, currentStatus)
  const statusPayload = object(item.status_payload)
  const update: JsonRecord = {
    provider_status: state,
    status_payload: {
      ...statusPayload,
      last_provider_event_id: eventId,
      last_provider_event_type: text(event.event_type),
      last_provider_state: state,
      last_provider_event_at: new Date().toISOString(),
    },
    last_reconciled_at: new Date().toISOString(),
    reconciliation_status: 'matched',
    updated_at: new Date().toISOString(),
  }
  if (nextStatus) update.status = nextStatus
  const financeStatus = text(payload.finance_status) ?? text(payload.financeStatus)
  if (financeStatus) update.purchase_status = normalizeCapwayFinanceStatus(financeStatus)
  const providerInvoiceNumber = text(payload.invoice_number) ?? text(payload.invoiceNumber)
  if (providerInvoiceNumber) update.provider_invoice_number = providerInvoiceNumber
  const providerOcr = text(payload.ocr) ?? text(payload.payment_reference) ?? text(payload.paymentReference)
  if (providerOcr) update.provider_ocr = providerOcr

  const itemUpdate = await supabaseService
    .from('invoice_export_items')
    .update(update)
    .eq('company_id', companyId)
    .eq('id', itemId)
    .eq('provider_invoice_guid', invoiceGuid)
    .select('id')
    .maybeSingle()
  if (itemUpdate.error) throw itemUpdate.error
  if (!itemUpdate.data) throw new Error('Providerstatus kunde inte uppdateras tenant-säkert.')

  await upsertPortalInvoice({ companyId, item: { ...item, ...update }, state, payload })
  await markEvent({ eventId, companyId, token, status: 'processed' })
  await emitDomainEvent({
    companyId,
    eventType: `invoice.provider.${state}`,
    aggregateType: 'invoice_export_item',
    aggregateId: itemId,
    subjectCustomerId: text(item.customer_id),
    source: 'billing_provider_webhook',
    payload: { provider, environment, provider_invoice_guid: invoiceGuid, provider_state: state, export_item_status: nextStatus ?? currentStatus },
    idempotencyKey: `invoice-provider-state:${companyId}:${eventId}`,
  })
  return { eventId, outcome: 'processed' }
}

async function claimEvents(input: {
  companyId?: string | null
  statuses: Array<'received' | 'needs_review' | 'failed'>
  limit: number
  maxAgeDays?: number
}) {
  const token = randomUUID()
  const response = await supabaseService.rpc('gridex_claim_invoice_provider_events', {
    p_company_id: input.companyId ?? null,
    p_statuses: input.statuses,
    p_limit: input.limit,
    p_processing_token: token,
    p_max_age_days: input.maxAgeDays ?? 365,
  })
  if (response.error) throw response.error
  return { token, events: (response.data ?? []) as JsonRecord[] }
}

async function processClaimed(token: string, events: JsonRecord[]) {
  const results: ProcessEventResult[] = []
  for (const event of events) {
    try {
      results.push(await processSingleEvent(event, token))
    } catch (error) {
      const eventId = text(event.id) ?? 'unknown'
      const companyId = text(event.company_id)
      if (companyId && eventId !== 'unknown') {
        await markEvent({
          eventId,
          companyId,
          token,
          status: 'failed',
          reason: error instanceof Error ? error.message : 'unknown_error',
        }).catch((markError) => console.error('[invoice-provider-events] failed to mark event', { eventId, error: markError }))
      }
      results.push({ eventId, outcome: 'skipped', reason: error instanceof Error ? error.message : 'unknown_error' })
    }
  }
  return results
}

export async function processPendingInvoiceProviderEvents(input: { companyId?: string | null; limit?: number } = {}) {
  await assertPlatformSchemaReady()
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const claim = await claimEvents({ companyId: input.companyId, statuses: ['received'], limit })
  const results = await processClaimed(claim.token, claim.events)
  return {
    processed: results.filter((row) => row.outcome === 'processed').length,
    needsReview: results.filter((row) => row.outcome === 'needs_review').length,
    failed: results.filter((row) => row.outcome === 'skipped').length,
    results,
  }
}

export async function retryReviewableInvoiceProviderEvents(input: {
  companyId?: string | null
  limit?: number
  maxAgeDays?: number
} = {}) {
  await assertPlatformSchemaReady()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const maxAgeDays = Math.min(Math.max(input.maxAgeDays ?? 30, 1), 365)
  const claim = await claimEvents({ companyId: input.companyId, statuses: ['needs_review', 'failed'], limit, maxAgeDays })
  const results = await processClaimed(claim.token, claim.events)
  return {
    processed: results.filter((row) => row.outcome === 'processed').length,
    stillNeedsReview: results.filter((row) => row.outcome === 'needs_review').length,
    failed: results.filter((row) => row.outcome === 'skipped').length,
    results,
  }
}
