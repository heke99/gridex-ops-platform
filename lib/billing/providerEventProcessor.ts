import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

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

async function processSingleEvent(event: JsonRecord, token: string): Promise<ProcessEventResult> {
  const eventId = text(event.id)
  const companyId = text(event.company_id)
  if (!eventId || !companyId) throw new Error('provider_event_identity_incomplete')
  const payload = object(event.payload)
  const financeStatus = text(payload.finance_status) ?? text(payload.financeStatus)
  const response = await supabaseService.rpc('gridex_apply_invoice_provider_event_v1', {
    p_company_id: companyId,
    p_event_id: eventId,
    p_processing_token: token,
    p_event_type: typeof event.event_type === 'string' ? event.event_type : null,
    p_payload: payload,
    p_state: resolveProviderInvoiceState(text(event.event_type), payload),
    p_finance_status: financeStatus ? normalizeCapwayFinanceStatus(financeStatus) : null,
    p_amount: number(payload.amount_inc_vat) ?? number(payload.amountIncVat) ?? number(payload.total_amount),
    p_currency: text(payload.currency),
  })
  if (response.error) throw response.error
  const result = object(response.data)
  if (result.eventId !== eventId || !['processed', 'needs_review', 'skipped'].includes(String(result.outcome))
    || (result.reason !== null && result.reason !== undefined && typeof result.reason !== 'string')) {
    throw new Error('provider_event_atomic_result_invalid')
  }
  return { eventId, outcome: result.outcome as ProcessEventResult['outcome'],
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}) }
}

const INTERNAL_PROVIDER_FAILURE_REASONS = new Set([
  'provider_event_identity_incomplete', 'provider_event_atomic_result_invalid',
])

function providerFailureReason(error: unknown): string {
  const details = object(error)
  const diagnostic = technicalErrorDiagnostic({ code: details.code })
  if (diagnostic.message === 'database_error' && diagnostic.code?.length === 5) {
    return `provider_event_database_${diagnostic.code}`
  }
  const message = error instanceof Error ? error.message : text(details.message)
  if (message && INTERNAL_PROVIDER_FAILURE_REASONS.has(message)) return message
  // Supabase returns plain error objects. Preserve a safe actionable failure
  // category rather than losing every such failure as unknown_error.
  return 'provider_event_persistence_failed'
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
          reason: providerFailureReason(error),
        }).catch((markError) => console.error('[invoice-provider-events] failed to mark event', {
          eventId, reason: providerFailureReason(markError),
        }))
      }
      results.push({ eventId, outcome: 'skipped', reason: providerFailureReason(error) })
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
