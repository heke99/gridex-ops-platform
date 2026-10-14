// Shared admin display formatting. Always Swedish locale and Stockholm time so
// the same timestamp reads the same on every page.

const DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short' })
const DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'short',
  timeStyle: 'short',
})

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatAdminDate(value: string | Date | null | undefined, empty = '—'): string {
  const date = toDate(value)
  return date ? DATE.format(date) : empty
}

export function formatAdminDateTime(value: string | Date | null | undefined, empty = '—'): string {
  const date = toDate(value)
  return date ? DATE_TIME.format(date) : empty
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  queued: 'I kö',
  prepared: 'Förberett',
  sent: 'Skickat',
  received: 'Mottaget',
  parsed: 'Tolkat',
  validated: 'Validerat',
  acknowledged: 'Kvitterat',
  awaiting_contrl: 'Väntar på CONTRL',
  awaiting_aperak: 'Väntar på APERAK',
  pending: 'Väntar',
  running: 'Pågår',
  in_progress: 'Pågår',
  not_started: 'Ej startad',
  passed: 'Godkänd',
  approved: 'Godkänd',
  completed: 'Klar',
  failed: 'Misslyckad',
  rejected: 'Avvisad',
  blocked: 'Blockerad',
  cancelled: 'Avbruten',
  archived: 'Arkiverad',
  active: 'Aktiv',
  inactive: 'Inaktiv',
  open: 'Öppen',
  new: 'Ny',
  resolved: 'Löst',
  closed: 'Stängd',
  ignored: 'Ignorerad',
  processing: 'Bearbetas',
  skipped: 'Överhoppad',
  dead_letter: 'Gav upp efter flera försök',
  blocked_tenant_state: 'Stoppad (bolaget ej aktivt)',
  delivery_uncertain: 'Leverans osäker',
  pending_review: 'Väntar på granskning',
  pending_signature: 'Väntar på signering',
  action_required: 'Åtgärd krävs',
  manual_review_required: 'Manuell granskning krävs',
  missing_authorization: 'Fullmakt saknas',
  needs_review: 'Behöver granskning',
  missing_binding_info: 'Bindningstid saknas',
  missing_termination_info: 'Uppsägningsinfo saknas',
  ready_to_send: 'Redo att skicka',
  ready_for_switch: 'Redo för leverantörsbyte',
  sent_to_grid_owner: 'Skickad till nätägare',
  waiting_for_contrl: 'Väntar på CONTRL',
  waiting_for_aperak: 'Väntar på APERAK',
  waiting_for_z02: 'Väntar på svar (Z02)',
  z02_received: 'Svar mottaget (Z02)',
  negative_aperak: 'Mottagaren avvisade begäran',
  process_waiting: 'Väntar enligt processbeslut',
  process_decision_missing: 'Nästa steg behöver kontrolleras',
  process_response_received: 'Svar mottaget',
  route_missing: 'Utskicksväg saknas',
  waiting_response: 'Väntar på svar',
  response_received: 'Svar mottaget',
  ready: 'Redo',
  incomplete: 'Ofullständig',
  complete: 'Komplett',
  ready_for_pricing: 'Redo för prisberäkning',
  price_preview_ready: 'Prisförhandsgranskning klar',
  reprice_required: 'Ny prisberäkning krävs',
  pricing_failed: 'Prisberäkning misslyckades',
  requires_correction: 'Behöver rättas',
  awaiting_external_response: 'Väntar på externt svar',
  billing_blocked: 'Fakturering blockerad',
  manual_follow_up: 'Manuell uppföljning',
  urgent: 'Brådskande',
  ready_to_send_manual_email: 'Redo att skickas',
  manual_email_queued: 'E-post köad',
  manual_email_sent: 'E-post skickad',
  waiting_manual_response: 'Väntar på svar',
  manual_response_received: 'Svar mottaget',
  manual_response_parsed: 'Svar tolkat',
  blocked_missing_poa: 'Fullmakt saknas',
  blocked_missing_grid_owner_contact: 'Kontaktväg saknas',
  blocked_missing_manual_mailbox: 'Avsändaradress saknas',
  waiting_customer: 'Väntar på kund',
  waiting_internal: 'Väntar internt',
  published: 'Publicerad',
  paused: 'Pausad',
  unpublished: 'Ej publicerad',
  signed: 'Signerad',
  expired: 'Utgången',
  revoked: 'Återkallad',
  verified: 'Verifierad',
  verifying: 'Verifieras',
  pending_dns: 'Väntar på DNS',
  disabled: 'Avstängd',
  locked: 'Låst',
  success: 'Klar',
  succeeded: 'Klar',
  error: 'Fel',
  ended: 'Avslutad',
  terminated: 'Uppsagd',
  suspended: 'Pausad',
  critical: 'Kritisk',
  high: 'Hög',
  normal: 'Normal',
  medium: 'Medel',
  low: 'Låg',
  warning: 'Varning',
  info: 'Info',
}

// Shared label for backend status values. Operator views pass a Swedish unknown
// label to hold new states for review; technical views may keep humanization.
export function formatStatusLabel(status: string | null | undefined, empty = '—', unknown?: string): string {
  if (!status) return empty
  const known = STATUS_LABELS[status] ?? STATUS_LABELS[status.toLowerCase()]
  if (typeof known === 'string') return known
  if (unknown !== undefined) return unknown
  const spaced = status.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : empty
}
