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
}

// Human label for a backend status value; unknown values are shown as-is.
export function formatStatusLabel(status: string | null | undefined, empty = '—'): string {
  if (!status) return empty
  return STATUS_LABELS[status] ?? status
}
