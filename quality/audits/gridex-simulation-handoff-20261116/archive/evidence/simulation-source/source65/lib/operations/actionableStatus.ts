import { formatStatusLabel } from '@/lib/ui/format'

// Shared by queue selection and display. An event's action_required is the
// producer's decision and must not be overturned by a later status allowlist.
export const OPERATION_ACTION_STATUSES = [
  'open', 'new', 'pending_review', 'action_required', 'needs_review',
  'missing_authorization', 'blocked', 'route_missing', 'manual_review_required', 'failed',
  'draft', 'ready_to_send', 'negative_aperak', 'missing_binding_info', 'missing_termination_info',
  'ready_for_switch', 'process_decision_missing', 'process_response_received',
  'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',
  'delivery_uncertain',
] as const

export const OPERATION_TERMINAL_STATUSES = [
  'completed', 'resolved', 'closed', 'cancelled', 'skipped', 'archived', 'rejected',
] as const

// Use the same terminal definition before classification. An open-status
// allowlist would discard a new or null state before the classifier can hold it.
export const OPERATION_NON_TERMINAL_STATUS_FILTER = `status.is.null,status.not.in.(${OPERATION_TERMINAL_STATUSES.join(',')})`

const actionStatuses = new Set<string>(OPERATION_ACTION_STATUSES)
const automaticOrTerminalStatuses = new Set([
  'pending', 'ready', 'queued', 'prepared', 'submitted', 'accepted', 'sent', 'sent_to_grid_owner',
  'running', 'in_progress', 'waiting_response', 'waiting_grid_owner_response',
  'waiting_for_contrl', 'waiting_for_aperak', 'waiting_for_z02', 'z02_received', 'process_waiting',
  'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response',
  'manual_response_received', 'manual_response_parsed', 'response_received',
  'active', ...OPERATION_TERMINAL_STATUSES,
])

export type OperationActionState = { status: string | null | undefined; actionRequired?: boolean | null }

export function isOperationActionRequired(input: OperationActionState): boolean {
  if (typeof input.actionRequired === 'boolean') return input.actionRequired
  const status = String(input.status ?? '').trim().toLowerCase()
  if (actionStatuses.has(status)) return true
  if (automaticOrTerminalStatuses.has(status)) return false
  // A new or unreadable state has not established that an operator can safely
  // ignore it. Keep it visible for review instead of silently losing the work.
  return true
}

export function operationActionStatusLabel(status: string | null | undefined): string {
  return formatStatusLabel(status, 'Behöver granskning', 'Kräver åtgärd')
}

export function operationTypeLabel(value: unknown, fallback = 'Åtgärd'): string {
  const labels: Record<string, string> = {
    missing_power_of_attorney: 'Saknar fullmakt',
    missing_metering_point_id: 'Saknar mätpunkt',
    missing_facility_id: 'Saknar anläggnings-ID',
    missing_grid_owner: 'Saknar nätägare',
    possible_duplicate: 'Möjlig dubblett',
    customer_data_request: 'Uppgiftsbegäran',
    grid_owner_request: 'Begäran till nätägare',
    supplier_switch: 'Leverantörsbyte',
    customer_application_continuation: 'Fortsätt behandla ansökan',
    dispatch_lifecycle_notification: 'Skicka kundmeddelande',
    request_customer_data: 'Begär kunduppgifter',
    start_supplier_switch: 'Starta leverantörsbyte',
    apply_inbound_grid_owner_response: 'Registrera nätägarens svar',
    recheck_switch_readiness: 'Kontrollera leverantörsbytet',
    facility_lookup: 'Begär anläggningsuppgifter',
    facility_identifier_lookup: 'Begär anläggnings-ID',
    z01_customer_masterdata: 'Kontroll av kund- och anläggningsuppgifter',
    current_supplier_contract_check: 'Kontroll av nuvarande elavtal',
    current_supplier_contract: 'Kontroll av nuvarande elavtal',
    manual_customer_document_check: 'Kontroll av dokument',
  }
  const label = labels[String(value ?? '').trim()]
  return typeof label === 'string' ? label : fallback
}

export function operationChannelLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    email: 'E-post', manual_email: 'E-post', phone: 'Telefon', manual_phone: 'Telefon',
    portal: 'Portal', manual_upload: 'Manuell uppladdning', manual: 'Manuell hantering',
    ediel: 'Ediel', ediel_prodat: 'Ediel', ai_list: 'Uppgiftslista',
  }
  if (!value) return '—'
  const label = labels[value]
  return typeof label === 'string' ? label : 'Behöver granskning'
}
