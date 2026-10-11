import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmLocalToUtc } from '@/lib/time/stockholm'

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

/**
 * Allowed provider-state transitions (current -> next). Replaces the former
 * total rank order, which blocked legitimate moves such as disputed -> paid
 * after a dispute is resolved or overdue -> partially_paid.
 *
 * - A repeat of the current state is always allowed (idempotent refresh and
 *   completion of a half-applied earlier attempt).
 * - Open states (registered/unpaid/partially_paid) may move to any later state.
 * - Dunning (overdue -> reminder_sent -> collection) only escalates, but a
 *   (partial) payment, credit, cancellation or dispute can arrive at any step.
 * - paid may only be credited or disputed (chargeback); it never regresses to
 *   unpaid/overdue.
 * - disputed is resolved to any outcome state.
 * - credited and cancelled are terminal.
 * - unknown (never set) accepts anything.
 * Transitions outside the table, and events whose provider timestamp is older
 * than the last applied one, are recorded as stale and ignored.
 */
const SETTLEMENT_STATES: ProviderInvoiceState[] = ['partially_paid', 'paid', 'credited', 'cancelled', 'disputed']
export const PROVIDER_STATE_TRANSITIONS: Record<ProviderInvoiceState, readonly ProviderInvoiceState[]> = {
  unknown: ['registered', 'unpaid', 'partially_paid', 'overdue', 'reminder_sent', 'collection', 'paid', 'credited', 'cancelled', 'disputed'],
  registered: ['unpaid', 'partially_paid', 'overdue', 'reminder_sent', 'collection', 'paid', 'credited', 'cancelled', 'disputed'],
  unpaid: ['partially_paid', 'overdue', 'reminder_sent', 'collection', 'paid', 'credited', 'cancelled', 'disputed'],
  partially_paid: ['overdue', 'reminder_sent', 'collection', 'paid', 'credited', 'cancelled', 'disputed'],
  overdue: ['reminder_sent', 'collection', ...SETTLEMENT_STATES],
  reminder_sent: ['collection', ...SETTLEMENT_STATES],
  collection: [...SETTLEMENT_STATES],
  paid: ['credited', 'disputed'],
  disputed: ['unpaid', 'partially_paid', 'overdue', 'reminder_sent', 'collection', 'paid', 'credited', 'cancelled'],
  credited: [],
  cancelled: [],
}

export function isAllowedProviderTransition(current: ProviderInvoiceState, next: ProviderInvoiceState): boolean {
  if (next === 'unknown') return false
  if (current === next) return true
  return (PROVIDER_STATE_TRANSITIONS[current] ?? PROVIDER_STATE_TRANSITIONS.unknown).includes(next)
}

function knownState(value: unknown): ProviderInvoiceState {
  const raw = text(value)
  return raw && raw in PROVIDER_STATE_TRANSITIONS ? raw as ProviderInvoiceState : 'unknown'
}

const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/

/**
 * Parses a provider timestamp (paid_at, event time). ISO 8601 with an explicit
 * offset (or Z) is taken as-is. A date or date-time WITHOUT offset is
 * interpreted as Europe/Stockholm local time (Swedish providers report civil
 * time). Anything else, including impossible calendar dates and local times
 * that do not exist in Stockholm (DST gap), returns null.
 */
export function parseProviderTimestamp(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  if (OFFSET_ISO.test(raw)) {
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return null
    const [y, m, d] = raw.slice(0, 10).split('-').map(Number)
    const civil = new Date(Date.UTC(y, m - 1, d))
    if (civil.getUTCFullYear() !== y || civil.getUTCMonth() + 1 !== m || civil.getUTCDate() !== d) return null
    return date.toISOString()
  }
  const match = LOCAL_ISO.exec(raw)
  if (!match) return null
  try {
    return stockholmLocalToUtc({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: match[4] ? Number(match[4]) : 0,
      minute: match[5] ? Number(match[5]) : 0,
      second: match[6] ? Number(match[6]) : 0,
    }).toISOString()
  } catch {
    return null
  }
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function providerEventOccurredAt(payload: JsonRecord): unknown {
  return payload.occurred_at ?? payload.occurredAt ?? payload.event_time ?? payload.eventTime ?? payload.created_at ?? payload.createdAt ?? payload.timestamp
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
  paidAt: string | null
}) {
  const status = portalInvoiceStatus(input.state)
  if (!status) return
  const providerGuid = text(input.item.provider_invoice_guid)
  const exportItemId = text(input.item.id)
  const customerId = text(input.item.customer_id)
  const customerContractId = text(input.item.customer_contract_id)
  if (!providerGuid || !exportItemId || !customerId || !customerContractId) {
    throw new Error('Providerfakturan saknar canonical export-, kund-, avtals- eller provideridentitet.')
  }
  const metadata = object(input.item.metadata)
  const billingMonth = text(metadata.billing_month)
  const paidAt = input.state === 'paid' ? input.paidAt : null
  const response = await supabaseService
    .from('customer_invoices')
    .upsert({
      company_id: input.companyId,
      customer_id: customerId,
      customer_contract_id: customerContractId,
      contract_id: customerContractId,
      billing_underlay_id: text(input.item.billing_underlay_id),
      partner_export_id: exportItemId,
      invoice_export_item_id: exportItemId,
      canonical_export_item_id: exportItemId,
      partner_invoice_reference: providerGuid,
      invoice_number: text(input.item.provider_invoice_number),
      period_start: text(input.item.period_start) ?? (billingMonth ? `${billingMonth}-01` : null),
      period_end: text(input.item.period_end),
      total_kwh: number(input.item.total_kwh),
      amount_ex_vat: number(input.item.amount_ex_vat),
      vat_amount: number(input.item.vat_amount),
      amount_inc_vat: number(input.item.amount_inc_vat),
      status,
      ...(paidAt ? { paid_at: paidAt } : {}),
      source_system: 'canonical_invoice_export',
      raw_payload: input.payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,invoice_export_item_id' })
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
  const payloadAmount =
    number(payload.amount_inc_vat)
    ?? number(payload.amountIncVat)
    ?? number(payload.total_amount)
  const expectedAmount = number(item.amount_inc_vat)
  const payloadCurrency = text(payload.currency)
  const expectedCurrency = text(item.currency) ?? 'SEK'
  if (
    (payloadAmount !== null &&
      expectedAmount !== null &&
      Math.abs(payloadAmount - expectedAmount) > 0.01) ||
    (payloadCurrency && payloadCurrency.toUpperCase() !== expectedCurrency.toUpperCase())
  ) {
    await markEvent({
      eventId,
      companyId,
      token,
      status: 'needs_review',
      reason: 'provider_amount_or_currency_mismatch',
    })
    return {
      eventId,
      outcome: 'needs_review',
      reason: 'provider_amount_or_currency_mismatch',
    }
  }
  const state = resolveProviderInvoiceState(text(event.event_type), payload)
  if (state === 'unknown') {
    await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'unknown_provider_state' })
    return { eventId, outcome: 'needs_review', reason: 'unknown_provider_state' }
  }

  // Validate everything that can fail BEFORE any write, so an event is never
  // half-applied (item updated, portal mirror not) by a bad payload.
  let paidAt: string | null = null
  if (state === 'paid') {
    const rawPaidAt = payload.paid_at ?? payload.paidAt
    if (present(rawPaidAt)) {
      paidAt = parseProviderTimestamp(rawPaidAt)
      if (!paidAt) {
        await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'invalid_paid_at' })
        return { eventId, outcome: 'needs_review', reason: 'invalid_paid_at' }
      }
    } else {
      // Deterministic across retries: the time the event was received.
      paidAt = parseProviderTimestamp(event.received_at) ?? new Date().toISOString()
    }
  }
  const rawOccurredAt = providerEventOccurredAt(payload)
  const occurredAt = present(rawOccurredAt) ? parseProviderTimestamp(rawOccurredAt) : null
  if (present(rawOccurredAt) && !occurredAt) {
    await markEvent({ eventId, companyId, token, status: 'needs_review', reason: 'invalid_provider_event_time' })
    return { eventId, outcome: 'needs_review', reason: 'invalid_provider_event_time' }
  }

  // Optimistic concurrency: the update only applies while provider_status is
  // still the value this decision was based on. On a lost race the row is
  // re-read and the transition re-evaluated, so a concurrent paid can never be
  // overwritten by an overdue that read the older state.
  let current = item
  let applied: { update: JsonRecord; nextStatus: string | null; currentStatus: string } | null = null
  for (let attempt = 0; attempt < 5 && !applied; attempt += 1) {
    const currentProviderState = knownState(current.provider_status)
    const statusPayload = object(current.status_payload)
    const lastOccurredAt = parseProviderTimestamp(statusPayload.last_provider_event_occurred_at)
    const staleByTime = Boolean(occurredAt && lastOccurredAt && Date.parse(occurredAt) < Date.parse(lastOccurredAt))
    if (staleByTime || !isAllowedProviderTransition(currentProviderState, state)) {
      await markEvent({ eventId, companyId, token, status: 'processed', reason: 'stale_provider_state_ignored' })
      return { eventId, outcome: 'processed', reason: 'stale_provider_state_ignored' }
    }
    const currentStatus = String(current.status ?? '')
    const nextStatus = exportItemStatus(state, currentStatus)
    const nowIso = new Date().toISOString()
    const update: JsonRecord = {
      provider_status: state,
      status_payload: {
        ...statusPayload,
        last_provider_event_id: eventId,
        last_provider_event_type: text(event.event_type),
        last_provider_state: state,
        last_provider_event_at: nowIso,
        ...(occurredAt ? { last_provider_event_occurred_at: occurredAt } : {}),
      },
      last_reconciled_at: nowIso,
      reconciliation_status: 'matched',
      updated_at: nowIso,
    }
    if (nextStatus) update.status = nextStatus
    const financeStatus = text(payload.finance_status) ?? text(payload.financeStatus)
    if (financeStatus) update.purchase_status = normalizeCapwayFinanceStatus(financeStatus)
    const providerInvoiceNumber = text(payload.invoice_number) ?? text(payload.invoiceNumber)
    if (providerInvoiceNumber) update.provider_invoice_number = providerInvoiceNumber
    const providerOcr = text(payload.ocr) ?? text(payload.payment_reference) ?? text(payload.paymentReference)
    if (providerOcr) update.provider_ocr = providerOcr

    const baseQuery = supabaseService
      .from('invoice_export_items')
      .update(update)
      .eq('company_id', companyId)
      .eq('id', itemId)
      .eq('provider_invoice_guid', invoiceGuid)
    const readProviderStatus = text(current.provider_status)
    const guardedQuery = readProviderStatus === null
      ? baseQuery.is('provider_status', null)
      : baseQuery.eq('provider_status', readProviderStatus)
    const itemUpdate = await guardedQuery.select('id').maybeSingle()
    if (itemUpdate.error) throw itemUpdate.error
    if (itemUpdate.data) {
      applied = { update, nextStatus, currentStatus }
      break
    }
    const reread = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('id', itemId)
      .eq('company_id', companyId)
      .eq('provider_invoice_guid', invoiceGuid)
      .maybeSingle()
    if (reread.error) throw reread.error
    if (!reread.data) throw new Error('Providerstatus kunde inte uppdateras tenant-säkert.')
    current = reread.data as JsonRecord
  }
  if (!applied) throw new Error('Providerstatus ändrades samtidigt för många gånger; händelsen försöks igen.')
  const { update, nextStatus, currentStatus } = applied

  // Idempotent upsert keyed on (company_id, invoice_export_item_id). If it
  // fails, the event is marked failed and a retry re-applies the same state
  // (same-state transitions are allowed) and completes the mirror.
  await upsertPortalInvoice({ companyId, item: { ...current, ...update }, state, payload, paidAt })
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
  const publicEventType = state === 'paid'
    ? 'invoice.paid'
    : state === 'disputed'
      ? 'invoice.disputed'
      : null
  if (publicEventType) {
    await emitDomainEvent({
      companyId,
      eventType: publicEventType,
      aggregateType: 'invoice_export_item',
      aggregateId: itemId,
      subjectCustomerId: text(item.customer_id),
      source: 'billing_provider_webhook',
      payload: {
        provider_invoice_guid: invoiceGuid,
        invoice_number: text(item.provider_invoice_number),
        provider_state: state,
      },
      idempotencyKey: `invoice-public-state:${companyId}:${eventId}:${publicEventType}`,
    })
  }
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
