export type BillingImportIssue = {
  code: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
}

export type BillingImportRow = {
  rowNumber: number
  raw: Record<string, string>
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  sourceRequestId: string | null
  gridOwnerId: string | null
  underlayYear: number | null
  underlayMonth: number | null
  status: 'pending' | 'received' | 'validated' | 'exported' | 'failed'
  totalKwh: number | null
  totalSekExVat: number | null
  currency: string
  sourceSystem: string
  issues: BillingImportIssue[]
}

export type BillingImportParseResult = {
  rows: BillingImportRow[]
  issues: BillingImportIssue[]
  delimiter: ';' | ',' | '\t'
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[\s-]+/g, '_')
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function detectDelimiter(firstLine: string): ';' | ',' | '\t' {
  const semicolonCount = (firstLine.match(/;/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const tabCount = (firstLine.match(/\t/g) ?? []).length

  if (tabCount > semicolonCount && tabCount > commaCount) return '\t'
  if (commaCount > semicolonCount) return ','
  return ';'
}

function pick(raw: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function intOrNull(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeStatus(value: string | null): BillingImportRow['status'] {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'validated' || normalized === 'exported' || normalized === 'failed' || normalized === 'pending') return normalized
  return 'received'
}

export function parseBillingUnderlayText(input: string): BillingImportParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const issues: BillingImportIssue[] = []
  if (lines.length < 2) {
    return {
      rows: [],
      delimiter: ';',
      issues: [{
        code: 'empty_import',
        severity: 'error',
        title: 'Importfilen saknar datarader',
        description: 'Lägg till rubrikrad och minst en rad med faktureringsunderlag.',
      }],
    }
  }

  const delimiter = detectDelimiter(lines[0])
  const headers = splitLine(lines[0], delimiter).map(normalizeHeader)
  const rows: BillingImportRow[] = []

  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitLine(lines[index], delimiter)
    const raw: Record<string, string> = {}
    headers.forEach((header, cellIndex) => {
      raw[header] = cells[cellIndex] ?? ''
    })

    const customerId = pick(raw, ['customer_id', 'kund_id', 'customerid'])
    const meteringPointId = pick(raw, ['metering_point_id', 'meter_point_id', 'mätpunkt_id', 'anlaggningsid', 'anläggningsid'])
    const underlayYear = intOrNull(pick(raw, ['underlay_year', 'year', 'år', 'period_year']))
    const underlayMonth = intOrNull(pick(raw, ['underlay_month', 'month', 'månad', 'period_month']))
    const totalKwh = numberOrNull(pick(raw, ['total_kwh', 'kwh', 'consumption_kwh', 'förbrukning_kwh']))
    const totalSekExVat = numberOrNull(pick(raw, ['total_sek_ex_vat', 'amount_ex_vat', 'belopp_ex_moms', 'sek_ex_vat']))
    const rowIssues: BillingImportIssue[] = []

    if (!customerId) {
      rowIssues.push({
        code: 'customer_id_missing',
        severity: 'error',
        title: 'Kund saknas',
        description: 'Raden måste innehålla customer_id för att kunna importeras säkert.',
      })
    }

    if (!underlayYear || !underlayMonth || underlayMonth < 1 || underlayMonth > 12) {
      rowIssues.push({
        code: 'period_missing',
        severity: 'error',
        title: 'Period saknas',
        description: 'Ange underlay_year och underlay_month eller motsvarande periodfält.',
      })
    }

    if (totalKwh === null) {
      rowIssues.push({
        code: 'kwh_missing',
        severity: 'warning',
        title: 'kWh saknas',
        description: 'Raden importeras som blockerad/flagged om förbrukning saknas.',
      })
    }

    if (totalSekExVat === null) {
      rowIssues.push({
        code: 'amount_missing',
        severity: 'warning',
        title: 'Belopp saknas',
        description: 'Raden importeras men behöver prismotor eller manuell komplettering.',
      })
    }

    rows.push({
      rowNumber: index + 1,
      raw,
      customerId,
      siteId: pick(raw, ['site_id', 'customer_site_id', 'anläggning_id']),
      meteringPointId,
      sourceRequestId: pick(raw, ['source_request_id', 'request_id']),
      gridOwnerId: pick(raw, ['grid_owner_id', 'nätägare_id', 'natagare_id']),
      underlayYear,
      underlayMonth,
      status: rowIssues.some((issue) => issue.severity === 'error') ? 'failed' : normalizeStatus(pick(raw, ['status'])),
      totalKwh,
      totalSekExVat,
      currency: pick(raw, ['currency', 'valuta']) ?? 'SEK',
      sourceSystem: pick(raw, ['source_system', 'källa', 'source']) ?? 'billing_import',
      issues: rowIssues,
    })
  }

  return { rows, issues, delimiter }
}
