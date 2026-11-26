import type { CustomerConsumptionReviewReason } from '@/lib/customer-portal/types'

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

export function formatInvoiceMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (currency == null || currency === 'SEK') return formatSek(value)
  if (typeof value !== 'number' || !Number.isFinite(value) || !/^[A-Z]{3}$/.test(currency)) return '—'
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(value)
}

export const PORTAL_CONSUMPTION_BOUNDARY_NOTICE =
  'Ett mätvärde sträcker sig över ett månadsskifte eller en leveransgräns. Finare mätvärden behövs för att beräkna summan.'

export const PORTAL_CONSUMPTION_REVIEW_NOTICES: Record<CustomerConsumptionReviewReason, string> = {
  coverage_gap: 'Mätvärden saknas för delar av månaden.',
  reading_overlap: 'Mätvärden överlappar. Förbrukningssumman behöver kontrolleras.',
  supply_unconfirmed: 'Alla leveransperioder kunde inte verifieras. Endast mätvärden från verifierade leveranser visas.',
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

export function isCancelledOrCreditedInvoice(status: string): boolean {
  return status === 'cancelled' || status === 'credited'
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
  if (isCancelledOrCreditedInvoice(status)) {
    return 'border-slate-200 bg-slate-50 text-slate-600'
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}
