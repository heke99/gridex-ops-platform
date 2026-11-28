const MANUAL_SENT_FACILITY_STATUSES = [
  'draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review',
  'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent',
  'waiting_manual_response', 'blocked_missing_poa', 'blocked_missing_grid_owner_contact',
]

// Mirrors the open-request states of public.gridex_complete_facility_response.
const REGISTER_RESPONSE_FACILITY_STATUSES = [
  'draft', 'ready_to_send', 'sent', 'waiting_response', 'received', 'needs_review',
  'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'manual_response_parsed',
]

export const ACTIVE_FACILITY_LOOKUP_STATUSES = [
  ...new Set([...MANUAL_SENT_FACILITY_STATUSES, ...REGISTER_RESPONSE_FACILITY_STATUSES]),
]

export function canRegisterFacilityLookupResponse(status: string | null | undefined): boolean {
  return typeof status === 'string' && REGISTER_RESPONSE_FACILITY_STATUSES.includes(status)
}

export function canMarkFacilityLookupSentManually(status: string | null | undefined): status is string {
  return typeof status === 'string' && MANUAL_SENT_FACILITY_STATUSES.includes(status)
}
