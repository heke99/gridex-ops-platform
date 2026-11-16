function stockholmMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`
}

export function monthStart(input?: string | null): string {
  const source = input && /^\d{4}-\d{2}/.test(input) ? `${input.slice(0, 7)}-01` : stockholmMonth() + '-01'
  const date = new Date(`${source}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return stockholmMonth() + '-01'
  return date.toISOString().slice(0, 10)
}

export function addMonths(month: string, offset: number): string {
  const date = new Date(`${monthStart(month)}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 10)
}

export function monthEndExclusive(month: string): string {
  return addMonths(month, 1)
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value)
}

export function formatMwh(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return '–'
  return Math.abs(kwh) < 1000 && kwh !== 0
    ? `${new Intl.NumberFormat('sv-SE', { maximumSignificantDigits: 4 }).format(kwh)} kWh`
    : `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 3 }).format(kwh / 1000)} MWh`
}

export function percentChange(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'Jämförelse saknas'
  if (!previous) return current ? 'Ny nivå' : 'Oförändrat'
  const diff = ((current - previous) / previous) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(diff)} % jämfört med föregående månad`
}

export function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n;]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}

export function buildCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [
    headers.join(';'),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(';')),
  ].join('\n')
}

export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
