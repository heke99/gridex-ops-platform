import { inflateRawSync } from 'node:zlib'

export type ParsedCustomerImport = {
  rows: Array<Record<string, string>>
  warnings: string[]
  sourceKind: 'text' | 'csv' | 'excel' | 'pdf'
}

const HEADER_ALIASES: Record<string, string> = {
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
  foretag: 'company_name',
  företag: 'company_name',
  bolag: 'company_name',
  company_name: 'company_name',
  epost: 'email',
  'e-post': 'email',
  email: 'email',
  mail: 'email',
  telefon: 'phone',
  phone: 'phone',
  mobil: 'phone',
  personnummer: 'personal_number',
  personal_number: 'personal_number',
  orgnummer: 'org_number',
  organisationsnummer: 'org_number',
  org_number: 'org_number',
  anlaggningsid: 'facility_id',
  'anläggnings-id': 'facility_id',
  anläggningsid: 'facility_id',
  facility_id: 'facility_id',
  matpunktsid: 'meter_point_id',
  mätpunktsid: 'meter_point_id',
  'mätpunkts-id': 'meter_point_id',
  meter_point_id: 'meter_point_id',
  natagare: 'grid_owner_name',
  nätägare: 'grid_owner_name',
  grid_owner: 'grid_owner_name',
  elomrade: 'price_area_code',
  elområde: 'price_area_code',
  price_area_code: 'price_area_code',
  startdatum: 'move_in_date',
  avtalsstart: 'contract_start_date',
  move_in_date: 'move_in_date',
  arsförbrukning: 'annual_consumption_kwh',
  årsförbrukning: 'annual_consumption_kwh',
  annual_consumption_kwh: 'annual_consumption_kwh',
  adress: 'street',
  gata: 'street',
  street: 'street',
  postnummer: 'postal_code',
  postal_code: 'postal_code',
  ort: 'city',
  stad: 'city',
  city: 'city',
  avtal: 'contract_offer_name',
  kampanj: 'campaign_name',
}

function normalizeHeader(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, '_')
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9_-]/g, '')

  return HEADER_ALIASES[normalized] ?? HEADER_ALIASES[value.trim().toLowerCase()] ?? normalized
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  result.push(current.trim())
  return result
}

function detectDelimiter(headerLine: string): string {
  const candidates = [';', '\t', ',']
  return candidates
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ';'
}

export function parseDelimitedCustomerRows(raw: string): ParsedCustomerImport {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return { rows: [], warnings: ['Underlaget behöver en rubrikrad och minst en kundrad.'], sourceKind: 'text' }
  }

  const delimiter = detectDelimiter(lines[0])
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader)
  const warnings: string[] = []
  const rows = lines.slice(1).map((line) => {
    const cols = splitDelimitedLine(line, delimiter)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      if (!header) return
      row[header] = String(cols[index] ?? '').trim()
    })

    return row
  })

  if (!headers.includes('email') && !headers.includes('personal_number') && !headers.includes('org_number')) {
    warnings.push('Underlaget saknar tydlig unik kundnyckel. Dubblettkontrollen blir svagare.')
  }

  return { rows, warnings, sourceKind: delimiter === ',' ? 'csv' : 'text' }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

type ZipEntry = { name: string; data: Buffer }

function readUInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

function readUInt16LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset)
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdSignature = 0x06054b50
  let eocdOffset = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (readUInt32LE(buffer, offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset < 0) return []

  const totalEntries = readUInt16LE(buffer, eocdOffset + 10)
  const centralDirectoryOffset = readUInt32LE(buffer, eocdOffset + 16)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let i = 0; i < totalEntries; i += 1) {
    if (readUInt32LE(buffer, offset) !== 0x02014b50) break

    const compressionMethod = readUInt16LE(buffer, offset + 10)
    const compressedSize = readUInt32LE(buffer, offset + 20)
    const fileNameLength = readUInt16LE(buffer, offset + 28)
    const extraLength = readUInt16LE(buffer, offset + 30)
    const commentLength = readUInt16LE(buffer, offset + 32)
    const localHeaderOffset = readUInt32LE(buffer, offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8')

    const localNameLength = readUInt16LE(buffer, localHeaderOffset + 26)
    const localExtraLength = readUInt16LE(buffer, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

    let data: Buffer | null = null
    if (compressionMethod === 0) data = Buffer.from(compressed)
    if (compressionMethod === 8) data = inflateRawSync(compressed)

    if (data) entries.push({ name, data })
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(/<si[\s\S]*?<\/si>/g)).map((match) => {
    const textParts = Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXmlEntities(part[1] ?? ''))
    return textParts.join('')
  })
}

function cellColumn(ref: string): number {
  const letters = (ref.match(/[A-Z]+/i)?.[0] ?? '').toUpperCase()
  let value = 0
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64)
  }
  return Math.max(0, value - 1)
}

function parseSheetXml(xml: string, sharedStrings: string[]): string[][] {
  return Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const row: string[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? ''
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? ''
      const column = ref ? cellColumn(ref) : row.length
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ''
      const value = type === 's' ? sharedStrings[Number(rawValue)] ?? '' : decodeXmlEntities(rawValue)
      row[column] = value.trim()
    }
    return row
  }).filter((row) => row.some(Boolean))
}

export function parseXlsxCustomerRows(buffer: Buffer): ParsedCustomerImport {
  const entries = readZipEntries(buffer)
  const sharedStringsXml = entries.find((entry) => entry.name === 'xl/sharedStrings.xml')?.data.toString('utf8') ?? ''
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : []
  const firstSheet = entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))

  if (!firstSheet) {
    return { rows: [], warnings: ['Kunde inte hitta första bladet i Excel-filen.'], sourceKind: 'excel' }
  }

  const table = parseSheetXml(firstSheet.data.toString('utf8'), sharedStrings)
  if (table.length < 2) {
    return { rows: [], warnings: ['Excel-filen behöver en rubrikrad och minst en kundrad.'], sourceKind: 'excel' }
  }

  const headers = table[0].map(normalizeHeader)
  const rows = table.slice(1).map((cols) => {
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (!header) return
      row[header] = String(cols[index] ?? '').trim()
    })
    return row
  })

  return { rows, warnings: [], sourceKind: 'excel' }
}

function bestEffortPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1')
  const textParts = Array.from(raw.matchAll(/\(([^()]|\\.){2,}\)/g))
    .map((match) => match[0].slice(1, -1).replace(/\\([()\\])/g, '$1'))
    .join('\n')
  return textParts || raw.replace(/[^\x09\x0A\x0D\x20-\x7EÅÄÖåäö]/g, ' ')
}

export function parsePdfCustomerRows(buffer: Buffer): ParsedCustomerImport {
  const text = bestEffortPdfText(buffer)
  const delimited = parseDelimitedCustomerRows(text)
  if (delimited.rows.length > 0) {
    return {
      ...delimited,
      sourceKind: 'pdf',
      warnings: [
        'PDF-underlag tolkas som förhandsgranskning. Kontrollera raderna innan import.',
        ...delimited.warnings,
      ],
    }
  }

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ''
  const orgNumber = text.match(/\b\d{6}[- ]?\d{4}\b/)?.[0] ?? ''
  const facilityId = text.match(/\b735\d{15}\b/)?.[0] ?? ''
  const priceArea = text.match(/\bSE[1-4]\b/i)?.[0]?.toUpperCase() ?? ''
  const phone = text.match(/\b(?:\+46|0)\d[\d\s-]{6,}\b/)?.[0] ?? ''

  const row: Record<string, string> = {
    customer_type: orgNumber ? 'business' : 'private',
    email,
    phone,
    org_number: orgNumber,
    facility_id: facilityId,
    price_area_code: priceArea,
  }

  return {
    rows: Object.values(row).some(Boolean) ? [row] : [],
    warnings: [
      'PDF-underlag kunde inte läsas som tabell. En försiktig förhandsgranskning skapades från hittade nyckelvärden.',
    ],
    sourceKind: 'pdf',
  }
}

export async function parseCustomerImportFormData(formData: FormData): Promise<ParsedCustomerImport> {
  const file = formData.get('bulkFile')
  const upload = file && typeof file === 'object' && 'arrayBuffer' in file && 'size' in file
    ? (file as File)
    : null

  if (upload && upload.size > 0) {
    const buffer = Buffer.from(await upload.arrayBuffer())
    const name = upload.name.toLowerCase()
    if (name.endsWith('.xlsx')) return parseXlsxCustomerRows(buffer)
    if (name.endsWith('.xls')) {
      return {
        rows: [],
        warnings: ['Äldre .xls-format stöds inte fullt ut. Exportera till .xlsx eller CSV innan import.'],
        sourceKind: 'excel',
      }
    }
    if (name.endsWith('.pdf')) return parsePdfCustomerRows(buffer)
    return parseDelimitedCustomerRows(buffer.toString('utf8'))
  }

  const raw = String(formData.get('bulkPayload') ?? '').trim()
  return parseDelimitedCustomerRows(raw)
}
