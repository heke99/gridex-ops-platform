export type AiBiListType = 'AI' | 'BI'

export type AiBiParsedRow = {
  rowNumber: number
  rawColumns: Record<string, string>
  meteringPointExternalId: string | null
  customerIdentity: string | null
  customerName: string | null
  gridAreaCode: string | null
  gridOwnerEdielId: string | null
}

export type AiBiParseResult = {
  listType: AiBiListType
  delimiter: ',' | ';'
  headers: string[]
  rows: AiBiParsedRow[]
}

const METERING_POINT_HEADERS = [
  'anlaggningsid',
  'anläggningsid',
  'meteringpointid',
  'metering_point_id',
  'meterpointid',
  'installationid',
  'installation_id',
  'facilityid',
]

const CUSTOMER_IDENTITY_HEADERS = [
  'kundid',
  'customerid',
  'customer_id',
  'personnummer',
  'organisationsnummer',
  'identitynumber',
]

const CUSTOMER_NAME_HEADERS = ['kundnamn', 'namn', 'customername', 'customer_name', 'name']
const GRID_AREA_HEADERS = ['natomrade', 'nätområde', 'gridarea', 'grid_area', 'grid_area_code']
const GRID_OWNER_HEADERS = ['natagareedielid', 'nätägareedielid', 'gridowneredielid', 'grid_owner_ediel_id']

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '')
}

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normaliseAiBiGridAreaCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, '').toUpperCase()
    : null
}

function pick(rawColumns: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = clean(rawColumns[normalizeHeader(key)])
    if (value) return value
  }
  return null
}

function detectDelimiter(firstLine: string): ',' | ';' {
  return (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
}

function parseLine(line: string, delimiter: ',' | ';'): string[] {
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

export function parseAiBiListCsv(input: {
  raw: string
  listType: AiBiListType
}): AiBiParseResult {
  const lines = input.raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return { listType: input.listType, delimiter: ';', headers: [], rows: [] }
  }

  const delimiter = detectDelimiter(lines[0])
  const headers = parseLine(lines[0], delimiter).map(normalizeHeader)
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseLine(line, delimiter)
    const rawColumns = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? '']))

    return {
      rowNumber: index + 2,
      rawColumns,
      meteringPointExternalId: pick(rawColumns, METERING_POINT_HEADERS),
      customerIdentity: pick(rawColumns, CUSTOMER_IDENTITY_HEADERS),
      customerName: pick(rawColumns, CUSTOMER_NAME_HEADERS),
      gridAreaCode: pick(rawColumns, GRID_AREA_HEADERS),
      gridOwnerEdielId: pick(rawColumns, GRID_OWNER_HEADERS),
    }
  })

  return { listType: input.listType, delimiter, headers, rows }
}

export function discrepancyReasonsForAiBiRow(input: {
  row: AiBiParsedRow
  matchedMeteringPoint: Record<string, unknown> | null
}): string[] {
  const reasons: string[] = []

  if (!input.row.meteringPointExternalId) {
    reasons.push('missing_metering_point_id')
  }

  if (!input.matchedMeteringPoint && input.row.meteringPointExternalId) {
    reasons.push('metering_point_not_found')
  }

  const matchedGridAreaCode = normaliseAiBiGridAreaCode(
    input.matchedMeteringPoint?.grid_area_code,
  )
  const rowGridAreaCode = normaliseAiBiGridAreaCode(input.row.gridAreaCode)
  if (
    input.matchedMeteringPoint &&
    rowGridAreaCode &&
    matchedGridAreaCode &&
    matchedGridAreaCode !== rowGridAreaCode
  ) {
    reasons.push('grid_area_mismatch')
  }

  if (
    input.matchedMeteringPoint &&
    input.row.gridOwnerEdielId &&
    typeof input.matchedMeteringPoint.grid_owner_ediel_id === 'string' &&
    input.matchedMeteringPoint.grid_owner_ediel_id.trim() !== '' &&
    input.matchedMeteringPoint.grid_owner_ediel_id !== input.row.gridOwnerEdielId
  ) {
    reasons.push('grid_owner_mismatch')
  }

  return reasons
}
