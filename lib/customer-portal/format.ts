/** Established customer-visible invoice statuses shared by web and API readers. */
export const PORTAL_PUBLISHED_INVOICE_STATUSES = [
  'issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited',
] as const

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

/**
 * The invoice's covered period as printed on the invoice: the exact period (dates and times, end exclusive) stored
 * with the invoice (metadata.billing_period, FINDINGS F108), e.g. "September 2026 · 2026-09-01 01:00 – 2026-10-01
 * 01:00 (svensk tid)"; older invoices without it keep their dates.
 */
export function formatInvoicePeriod(invoice: { period_start?: string | null; period_end?: string | null; metadata?: unknown }): string {
  const metadata = invoice.metadata && typeof invoice.metadata === 'object' && !Array.isArray(invoice.metadata)
    ? invoice.metadata as Record<string, unknown>
    : {}
  const period = metadata.billing_period && typeof metadata.billing_period === 'object' && !Array.isArray(metadata.billing_period)
    ? metadata.billing_period as Record<string, unknown>
    : null
  const text = typeof period?.text === 'string' && period.text.trim() ? period.text.trim() : null
  if (!text) return formatPeriod(invoice.period_start, invoice.period_end)
  const label = typeof period?.label === 'string' && period.label.trim() ? period.label.trim() : null
  return label ? `${label} · ${text}` : text
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
