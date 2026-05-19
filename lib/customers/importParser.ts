import { Buffer } from 'node:buffer'

export const CUSTOMER_IMPORT_HEADERS = [
  'customer_type',
  'intake_flow_type',
  'first_name',
  'last_name',
  'contact_title',
  'company_name',
  'email',
  'phone',
  'personal_number',
  'org_number',
  'apartment_number',
  'site_name',
  'facility_id',
  'meter_point_id',
  'grid_owner_id',
  'price_area_code',
  'move_in_date',
  'annual_consumption_kwh',
  'street',
  'postal_code',
  'city',
  'care_of',
  'country',
  'current_supplier_name',
  'current_supplier_org_number',
  'moved_from_street',
  'moved_from_postal_code',
  'moved_from_city',
  'moved_from_supplier_name',
  'contract_offer_id',
  'contract_start_date',
  'contract_status',
  'contract_type_override',
  'fixed_price_ore_per_kwh',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'monthly_fee_sek',
  'green_fee_mode',
  'green_fee_value',
  'binding_months',
  'notice_months',
  'optional_fee_lines',
] as const

export type CustomerImportHeader = (typeof CUSTOMER_IMPORT_HEADERS)[number]

export type CustomerImportRow = Record<CustomerImportHeader, string>

export type CustomerImportIssueSeverity = 'error' | 'warning' | 'info'

export type CustomerImportIssue = {
  rowNumber: number
  field?: string
  severity: CustomerImportIssueSeverity
  message: string
}

export type CustomerImportPreview = {
  rows: CustomerImportRow[]
  normalizedCsv: string
  issues: CustomerImportIssue[]
  duplicateKeys: string[]
  sourceKind: 'text' | 'csv' | 'excel' | 'pdf'
  message: string
}

const HEADER_ALIASES: Record<string, CustomerImportHeader> = {
  kundtyp: 'customer_type',
  customer_type: 'customer_type',
  typ: 'customer_type',
  flode: 'intake_flow_type',
  flöde: 'intake_flow_type',
  intake_flow_type: 'intake_flow_type',
  fornamn: 'first_name',
  förnamn: 'first_name',
  first_name: 'first_name',
  efternamn: 'last_name',
  last_name: 'last_name',
  kontaktperson_titel: 'contact_title',
  contact_title: 'contact_title',
  foretagsnamn: 'company_name',
  företagsnamn: 'company_name',
  bolagsnamn: 'company_name',
  company_name: 'company_name',
  epost: 'email',
  'e-post': 'email',
  mail: 'email',
  email: 'email',
  telefon: 'phone',
  mobil: 'phone',
  phone: 'phone',
  personnummer: 'personal_number',
  personal_number: 'personal_number',
  orgnummer: 'org_number',
  organisationsnummer: 'org_number',
  org_number: 'org_number',
  lagenhetsnummer: 'apartment_number',
  lägenhetsnummer: 'apartment_number',
  apartment_number: 'apartment_number',
  anlaggningsnamn: 'site_name',
  anläggningsnamn: 'site_name',
  site_name: 'site_name',
  anlaggningsid: 'facility_id',
  anläggningsid: 'facility_id',
  facility_id: 'facility_id',
  facilityid: 'facility_id',
  matpunktsid: 'meter_point_id',
  mätpunktsid: 'meter_point_id',
  meter_point_id: 'meter_point_id',
  metering_point_id: 'meter_point_id',
  natagare: 'grid_owner_id',
  nätägare: 'grid_owner_id',
  grid_owner_id: 'grid_owner_id',
  elomrade: 'price_area_code',
  elområde: 'price_area_code',
  price_area_code: 'price_area_code',
  startdatum: 'move_in_date',
  inflyttningsdatum: 'move_in_date',
  move_in_date: 'move_in_date',
  arsförbrukning: 'annual_consumption_kwh',
  arsförbrukning_kwh: 'annual_consumption_kwh',
  årsförbrukning: 'annual_consumption_kwh',
  annual_consumption_kwh: 'annual_consumption_kwh',
  adress: 'street',
  gatuadress: 'street',
  street: 'street',
  postnummer: 'postal_code',
  postal_code: 'postal_code',
  stad: 'city',
  ort: 'city',
  city: 'city',
  co: 'care_of',
  'c/o': 'care_of',
  care_of: 'care_of',
  land: 'country',
  country: 'country',
  nuvarande_leverantor: 'current_supplier_name',
  nuvarande_leverantör: 'current_supplier_name',
  current_supplier_name: 'current_supplier_name',
  current_supplier_org_number: 'current_supplier_org_number',
  tidigare_adress: 'moved_from_street',
  moved_from_street: 'moved_from_street',
  tidigare_postnummer: 'moved_from_postal_code',
  moved_from_postal_code: 'moved_from_postal_code',
  tidigare_stad: 'moved_from_city',
  moved_from_city: 'moved_from_city',
  tidigare_leverantor: 'moved_from_supplier_name',
  tidigare_leverantör: 'moved_from_supplier_name',
  moved_from_supplier_name: 'moved_from_supplier_name',
  avtal: 'contract_offer_id',
  avtalsmall: 'contract_offer_id',
  contract_offer_id: 'contract_offer_id',
  avtalsstart: 'contract_start_date',
  contract_start_date: 'contract_start_date',
  avtalsstatus: 'contract_status',
  contract_status: 'contract_status',
  contract_type_override: 'contract_type_override',
  fixed_price_ore_per_kwh: 'fixed_price_ore_per_kwh',
  spot_markup_ore_per_kwh: 'spot_markup_ore_per_kwh',
  variable_fee_ore_per_kwh: 'variable_fee_ore_per_kwh',
  monthly_fee_sek: 'monthly_fee_sek',
  green_fee_mode: 'green_fee_mode',
  green_fee_value: 'green_fee_value',
  binding_months: 'binding_months',
  notice_months: 'notice_months',
  optional_fee_lines: 'optional_fee_lines',
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, '')
    .replace(/[\s/-]+/g, '_')
}

function csvEscape(value: string): string {
  if (!/[;"\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function rowsToNormalizedCsv(rows: CustomerImportRow[]): string {
  return [
    CUSTOMER_IMPORT_HEADERS.join(';'),
    ...rows.map((row) => CUSTOMER_IMPORT_HEADERS.map((header) => csvEscape(row[header] ?? '')).join(';')),
  ].join('\n')
}

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes('\t')) return '\t'
  const semicolonCount = (headerLine.match(/;/g) ?? []).length
  const commaCount = (headerLine.match(/,/g) ?? []).length
  return semicolonCount >= commaCount ? ';' : ','
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function emptyImportRow(): CustomerImportRow {
  return CUSTOMER_IMPORT_HEADERS.reduce((acc, header) => {
    acc[header] = ''
    return acc
  }, {} as CustomerImportRow)
}

function parseDelimitedRows(text: string): CustomerImportRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const delimiter = detectDelimiter(lines[0])
  const rawHeaders = splitDelimitedLine(lines[0], delimiter)
  const headers = rawHeaders.map((header) => {
    const normalized = normalizeHeader(header)
    const mapped = HEADER_ALIASES[normalized]
    if (mapped) return mapped
    if ((CUSTOMER_IMPORT_HEADERS as readonly string[]).includes(normalized)) {
      return normalized as CustomerImportHeader
    }
    return null
  })

  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter)
    const row = emptyImportRow()

    headers.forEach((header, index) => {
      if (header) row[header] = String(values[index] ?? '').trim()
    })

    if (!row.customer_type) row.customer_type = row.org_number || row.company_name ? 'business' : 'private'
    if (!row.intake_flow_type) row.intake_flow_type = 'switch'
    if (!row.country) row.country = 'SE'
    if (!row.contract_status && row.contract_offer_id) row.contract_status = 'pending_signature'

    return row
  })
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
}

function decodePdfHex(value: string): string {
  const clean = value.replace(/\s+/g, '')
  if (clean.length < 2 || clean.length % 2 !== 0) return ''
  const bytes: number[] = []

  for (let index = 0; index < clean.length; index += 2) {
    const parsed = Number.parseInt(clean.slice(index, index + 2), 16)
    if (Number.isFinite(parsed)) bytes.push(parsed)
  }

  return Buffer.from(bytes).toString('utf8').replace(/\u0000/g, '')
}

export function extractTextFromPdfBytes(bytes: Buffer): string {
  const raw = bytes.toString('latin1')
  const chunks: string[] = []
  const literalRegex = /\((?:\\.|[^\\)]){2,}\)/g
  const hexRegex = /<([0-9a-fA-F\s]{8,})>/g

  for (const match of raw.matchAll(literalRegex)) {
    const value = match[0].slice(1, -1)
    const decoded = decodePdfLiteral(value).trim()
    if (decoded && /[a-zA-ZåäöÅÄÖ0-9]/.test(decoded)) chunks.push(decoded)
  }

  for (const match of raw.matchAll(hexRegex)) {
    const decoded = decodePdfHex(match[1]).trim()
    if (decoded && /[a-zA-ZåäöÅÄÖ0-9]/.test(decoded)) chunks.push(decoded)
  }

  return chunks.join('\n')
}

function inferRowsFromLooseText(text: string): CustomerImportRow[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')

  if (normalized.includes(';') || normalized.includes('\t')) {
    const parsed = parseDelimitedRows(normalized)
    if (parsed.length > 0) return parsed
  }

  const blocks = normalized
    .split(/\n{2,}|(?=\b(?:kund|namn|bolag|företag|fornamn|förnamn)\b[: ]?)/i)
    .map((block) => block.trim())
    .filter((block) => block.length > 10)

  return blocks.map((block) => {
    const row = emptyImportRow()
    const email = block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ''
    const phone = block.match(/(?:\+46|0)\s?7[0-9][0-9\s-]{6,}/)?.[0]?.replace(/\s+/g, '') ?? ''
    const org = block.match(/\b\d{6}[- ]?\d{4}\b/)?.[0] ?? ''
    const facility = block.match(/\b7359\d{14,}\b/)?.[0] ?? ''
    const priceArea = block.match(/\bSE[1-4]\b/i)?.[0]?.toUpperCase() ?? ''
    const postal = block.match(/\b\d{3}\s?\d{2}\b/)?.[0] ?? ''
    const date = block.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? ''

    row.email = email
    row.phone = phone
    row.facility_id = facility
    row.meter_point_id = facility
    row.price_area_code = priceArea
    row.postal_code = postal
    row.move_in_date = date
    row.customer_type = org ? 'business' : 'private'
    row.intake_flow_type = 'switch'
    row.country = 'SE'

    if (org) row.org_number = org

    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const likelyName = lines.find((line) =>
      !line.includes('@') &&
      !/7359\d+/.test(line) &&
      !/\bSE[1-4]\b/i.test(line) &&
      !/\b\d{3}\s?\d{2}\b/.test(line) &&
      /[a-zA-ZåäöÅÄÖ]/.test(line)
    )

    if (likelyName) {
      const cleaned = likelyName.replace(/^(kund|namn|bolag|företag|foretag)[: ]+/i, '').trim()
      if (org) {
        row.company_name = cleaned
      } else {
        const parts = cleaned.split(/\s+/)
        row.first_name = parts[0] ?? ''
        row.last_name = parts.slice(1).join(' ')
      }
      row.site_name = cleaned
    }

    return row
  }).filter((row) => row.email || row.org_number || row.personal_number || row.facility_id || row.company_name || row.first_name)
}

export async function parseCustomerImportSource(input: {
  text?: string | null
  file?: File | null
}): Promise<{
  rows: CustomerImportRow[]
  sourceKind: CustomerImportPreview['sourceKind']
  message: string
}> {
  const file = input.file
  const pastedText = input.text?.trim() ?? ''

  if (file && file.size > 0) {
    const fileName = file.name.toLowerCase()
    const bytes = Buffer.from(await file.arrayBuffer())

    if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
      const text = extractTextFromPdfBytes(bytes)
      return {
        rows: inferRowsFromLooseText(text),
        sourceKind: 'pdf',
        message: 'PDF-underlaget har tolkats. Granska förhandsgranskningen innan importen sparas.',
      }
    }

    const text = bytes.toString('utf8')
    return {
      rows: parseDelimitedRows(text),
      sourceKind: fileName.endsWith('.xlsx') || fileName.endsWith('.xls') ? 'excel' : 'csv',
      message:
        fileName.endsWith('.xlsx') || fileName.endsWith('.xls')
          ? 'Excel-filen behandlas som tabelltext. Exportera gärna till CSV om kolumner saknas.'
          : 'Importfilen har lästs in. Granska förhandsgranskningen innan importen sparas.',
    }
  }

  return {
    rows: parseDelimitedRows(pastedText),
    sourceKind: 'text',
    message: 'Importerad text har tolkats. Granska förhandsgranskningen innan importen sparas.',
  }
}

export function validateCustomerImportRows(rows: CustomerImportRow[]): CustomerImportIssue[] {
  const issues: CustomerImportIssue[] = []
  const seenKeys = new Map<string, number>()

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const key = row.org_number || row.personal_number || row.facility_id || row.meter_point_id || row.email

    if (!row.customer_type) {
      issues.push({ rowNumber, field: 'customer_type', severity: 'warning', message: 'Kundtyp saknas och sätts till privatkund vid import.' })
    }

    if (row.customer_type === 'private') {
      if (!row.first_name) issues.push({ rowNumber, field: 'first_name', severity: 'error', message: 'Förnamn saknas för privatkund.' })
      if (!row.last_name) issues.push({ rowNumber, field: 'last_name', severity: 'error', message: 'Efternamn saknas för privatkund.' })
    } else {
      if (!row.company_name) issues.push({ rowNumber, field: 'company_name', severity: 'error', message: 'Företags- eller föreningsnamn saknas.' })
      if (!row.org_number) issues.push({ rowNumber, field: 'org_number', severity: 'error', message: 'Organisationsnummer saknas.' })
    }

    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      issues.push({ rowNumber, field: 'email', severity: 'error', message: 'E-postadressen har ogiltigt format.' })
    }

    if (row.move_in_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.move_in_date)) {
      issues.push({ rowNumber, field: 'move_in_date', severity: 'error', message: 'Datum ska anges som YYYY-MM-DD.' })
    }

    if (key) {
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '')
      const previous = seenKeys.get(normalizedKey)
      if (previous) {
        issues.push({ rowNumber, severity: 'warning', message: `Möjlig dubblett i filen. Samma nyckel finns även på rad ${previous}.` })
      } else {
        seenKeys.set(normalizedKey, rowNumber)
      }
    } else {
      issues.push({ rowNumber, severity: 'warning', message: 'Raden saknar tydlig matchningsnyckel såsom orgnummer, personnummer, anläggnings-id, mätpunkts-id eller e-post.' })
    }
  })

  return issues
}

export function buildCustomerImportPreview(input: {
  rows: CustomerImportRow[]
  sourceKind: CustomerImportPreview['sourceKind']
  message: string
  extraIssues?: CustomerImportIssue[]
}): CustomerImportPreview {
  const rows = input.rows
  const issues = [...validateCustomerImportRows(rows), ...(input.extraIssues ?? [])]
  const duplicateKeys = issues
    .filter((issue) => issue.message.toLowerCase().includes('dubblett'))
    .map((issue) => `Rad ${issue.rowNumber}`)

  return {
    rows,
    normalizedCsv: rowsToNormalizedCsv(rows),
    issues,
    duplicateKeys,
    sourceKind: input.sourceKind,
    message: rows.length > 0 ? input.message : 'Inga importerbara rader hittades i underlaget.',
  }
}
