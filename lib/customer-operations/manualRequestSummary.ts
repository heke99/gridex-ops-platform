// lib/customer-operations/manualRequestSummary.ts
//
// Lightweight, tenant-safe summary of manual grid-owner information requests
// (grid_owner_information_requests) for the customer card. This intentionally
// reads ONLY summary columns — never raw e-mail bodies, parsed payloads,
// provider message ids, EDIFACT, route/certificate internals or attachments —
// so it is cheap and safe to render in tenant list/card views.

import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

export type ManualRequestChannelLabel = 'E-post' | 'Ediel' | 'Manuell granskning'

export type ManualRequestRecipientResolution = {
  mode: string | null
  selectedToEmail: string | null
  actualGridOwnerContactEmail: string | null
  environment: string | null
  contactVerified: boolean
  productionSafeOverrideWarning: boolean
}

export type ManualRequestSummary = {
  id: string
  customerSiteId: string | null
  requestType: string | null
  status: string | null
  statusLabel: string
  channel: string | null
  channelLabel: ManualRequestChannelLabel
  caseReference: string | null
  poaStatus: 'finns' | 'saknas' | 'utgången'
  deliveryFailed: boolean
  sentAt: string | null
  updatedAt: string | null
  // Superadmin diagnostics only (never populated for tenant views): who the
  // e-mail was actually addressed to and why.
  recipientResolution?: ManualRequestRecipientResolution | null
}

// Columns that are safe for tenant card/list views (no provider/Ediel internals).
const SUMMARY_COLUMNS =
  'id,customer_site_id,request_type,status,channel,case_reference,requires_poa,poa_id,last_error_code,sent_at,due_at,created_at,updated_at'

// Active (non-terminal) manual statuses worth surfacing on the card.
const ACTIVE_STATUSES = [
  'draft',
  'ready_to_send',
  'ready_to_send_manual_email',
  'manual_email_queued',
  'manual_email_sent',
  'waiting_manual_response',
  'manual_response_received',
  'manual_response_parsed',
  'waiting_response',
  'received',
  'needs_review',
  'blocked_missing_poa',
  'blocked_missing_grid_owner_contact',
  'blocked_missing_manual_mailbox',
  'completed',
]

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

// Tenant-safe message shown when delivery to the grid owner failed/bounced.
export const MANUAL_REQUEST_DELIVERY_FAILED_LABEL =
  'E-post till nätägaren kunde inte levereras. Kontrollera kontaktväg.'

// Tenant-safe, non-technical Swedish status labels for manual requests.
// When `lastErrorCode` indicates a delivery failure, the tenant sees a single
// clear contact-path message instead of the raw status.
export function manualRequestStatusLabel(
  status: string | null | undefined,
  lastErrorCode?: string | null,
): string {
  if (clean(lastErrorCode) === 'delivery_failed') {
    return MANUAL_REQUEST_DELIVERY_FAILED_LABEL
  }
  switch (clean(status)) {
    case 'draft':
    case 'ready_to_send':
    case 'ready_to_send_manual_email':
      return 'Uppgiftsbegäran skapad'
    case 'manual_email_queued':
      return 'E-post köad'
    case 'manual_email_sent':
    case 'sent':
      return 'E-post skickad'
    case 'waiting_manual_response':
    case 'waiting_response':
      return 'Väntar på svar från nätägaren'
    case 'manual_response_received':
    case 'manual_response_parsed':
    case 'received':
      return 'Svar mottaget'
    case 'needs_review':
      return 'Behöver granskning'
    case 'completed':
      return 'Uppgifter kompletterade'
    case 'blocked_missing_poa':
      return 'Fullmakt saknas'
    case 'blocked_missing_grid_owner_contact':
      return 'Kontaktväg till nätägaren saknas'
    case 'blocked_missing_manual_mailbox':
      return 'Manuell e-postbrevlåda saknas'
    case 'cancelled':
      return 'Avbruten'
    case 'failed':
      return 'Begäran misslyckades'
    default:
      return 'Begäran pågår'
  }
}

// Tenant-safe channel label (no provider internals).
export function manualRequestChannelLabel(channel: string | null | undefined): ManualRequestChannelLabel {
  switch (clean(channel)) {
    case 'ediel':
    case 'ediel_prodat':
      return 'Ediel'
    case 'manual':
    case 'manual_upload':
      return 'Manuell granskning'
    default:
      return 'E-post'
  }
}

function poaStatusFor(row: JsonRecord): ManualRequestSummary['poaStatus'] {
  const requiresPoa = row.requires_poa === true
  const hasPoa = Boolean(clean(row.poa_id))
  if (clean(row.status) === 'blocked_missing_poa') return 'saknas'
  if (hasPoa) return 'finns'
  return requiresPoa ? 'saknas' : 'finns'
}

function toSummary(row: JsonRecord): ManualRequestSummary {
  const lastErrorCode = clean(row.last_error_code)
  return {
    id: String(row.id),
    customerSiteId: clean(row.customer_site_id),
    requestType: clean(row.request_type),
    status: clean(row.status),
    statusLabel: manualRequestStatusLabel(clean(row.status), lastErrorCode),
    channel: clean(row.channel),
    channelLabel: manualRequestChannelLabel(clean(row.channel)),
    caseReference: clean(row.case_reference),
    poaStatus: poaStatusFor(row),
    deliveryFailed: lastErrorCode === 'delivery_failed',
    sentAt: clean(row.sent_at),
    updatedAt: clean(row.updated_at),
  }
}

function recipientResolutionFromMetadata(metadata: unknown): ManualRequestRecipientResolution | null {
  const record = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as JsonRecord) : null
  const resolution = record?.recipient_resolution && typeof record.recipient_resolution === 'object'
    ? (record.recipient_resolution as JsonRecord)
    : null
  if (!resolution) return null
  return {
    mode: clean(resolution.resolution_mode),
    selectedToEmail: clean(resolution.selected_to_email),
    actualGridOwnerContactEmail: clean(resolution.actual_grid_owner_contact_email),
    environment: clean(resolution.environment),
    contactVerified: resolution.contact_verified === true,
    productionSafeOverrideWarning: resolution.production_safe_override_warning === true,
  }
}

// Loads tenant-safe manual request summaries for a customer (company-scoped).
// `includeRecipientResolution` is superadmin diagnostics only: it additionally
// reads metadata.recipient_resolution so operators can see WHICH address was
// used and WHY (real grid-owner contact vs safe override).
export async function listManualGridOwnerRequestSummaries(input: {
  companyId: string
  customerId: string
  includeRecipientResolution?: boolean
}): Promise<ManualRequestSummary[]> {
  const runQuery = async (columns: string): Promise<{ data: JsonRecord[] | null; error: unknown }> => {
    const result = await supabaseService
      .from('grid_owner_information_requests')
      .select(columns)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .in('status', ACTIVE_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(50)
    return { data: (result.data as unknown as JsonRecord[] | null) ?? null, error: result.error }
  }

  let result = await runQuery(input.includeRecipientResolution ? `${SUMMARY_COLUMNS},metadata` : SUMMARY_COLUMNS)
  if (result.error && input.includeRecipientResolution && missingSchema(result.error)) {
    result = await runQuery(SUMMARY_COLUMNS)
  }
  if (result.error) {
    if (missingSchema(result.error)) return []
    throw result.error
  }
  return (result.data ?? []).map((row) => ({
    ...toSummary(row),
    ...(input.includeRecipientResolution
      ? { recipientResolution: recipientResolutionFromMetadata(row.metadata) }
      : {}),
  }))
}
