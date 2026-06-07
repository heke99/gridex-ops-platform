// lib/ediel/prodat/render/dates.ts

export function normalizeProdatDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return trimmed
  return trimmed
}

export function prodatDate102(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length >= 8) return digits.slice(0, 8)

  const normalized = normalizeProdatDate(value)
  if (!normalized) return null
  const ymd = normalized.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.replace(/-/g, '') : null
}


export function prodatDate203(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length >= 12) return digits.slice(0, 12)
  if (digits.length >= 8) return `${digits.slice(0, 8)}0000`
  return prodatDate203AtStartOfDay(value)
}

export function prodatDate203AtStartOfDay(value?: string | null): string | null {
  const ymd = prodatDate102(value)
  return ymd ? `${ymd}0000` : null
}

function swedishDateTimeParts(date = new Date()): Record<string, string> {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

export function prodatNowDate203(date = new Date()): string {
  const parts = swedishDateTimeParts(date)
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
}
