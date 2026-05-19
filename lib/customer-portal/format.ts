export function formatSek(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatKwh(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value)} kWh`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE').format(date)
}

export function formatPeriod(start?: string | null, end?: string | null): string {
  if (!start && !end) return '—'
  return `${formatDate(start)} – ${formatDate(end)}`
}

export function invoiceStatusLabel(status: string): string {
  if (status === 'draft') return 'Utkast'
  if (status === 'issued') return 'Utfärdad'
  if (status === 'sent') return 'Skickad'
  if (status === 'paid') return 'Betald'
  if (status === 'overdue') return 'Förfallen'
  if (status === 'cancelled') return 'Makulerad'
  if (status === 'credited') return 'Krediterad'
  return status
}

export function invoiceStatusTone(status: string): string {
  if (status === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'overdue') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'cancelled' || status === 'credited') {
    return 'border-slate-200 bg-slate-50 text-slate-600'
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}
