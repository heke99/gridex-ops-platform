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
  missing_binding_info: 'Bindningstid saknas',
  missing_termination_info: 'Uppsägningsinfo saknas',
  ready_to_send: 'Redo att skicka',
  ready_for_switch: 'Redo för byte',
  sent_to_grid_owner: 'Skickad till nätägare',
  waiting_for_contrl: 'Väntar på CONTRL',
  waiting_for_aperak: 'Väntar på APERAK',
  waiting_for_z02: 'Väntar på svar (Z02)',
  z02_received: 'Svar mottaget (Z02)',
  negative_aperak: 'Negativ APERAK',
  route_missing: 'Route saknas',
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

// Human label for a backend status value. Unknown codes are made readable
// ("needs_more_info" -> "Needs more info") rather than shown raw.
export function formatStatusLabel(status: string | null | undefined, empty = '—'): string {
  if (!status) return empty
  const known = STATUS_LABELS[status] ?? STATUS_LABELS[status.toLowerCase()]
  if (known) return known
  const spaced = status.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : empty
}
