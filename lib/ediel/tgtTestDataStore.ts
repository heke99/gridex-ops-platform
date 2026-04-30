// lib/ediel/tgtTestDataStore.ts

import { inflateRawSync } from 'node:zlib'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import type {
  EdielTgtCaseTestData,
  EdielTgtExcelBlock,
  EdielTgtExcelColumn,
  EdielTgtExcelField,
} from '@/lib/ediel/tgtTestData'

export type EdielTgtDynamicTestDataRow = {
  id: string
  test_suite: EdielTestSuite
  role_code: EdielTestRoleCode
  test_case_code: string
  title: string | null
  source_note: string | null
  raw_text: string
  parsed_payload: EdielTgtCaseTestData | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type EdielTgtDynamicTestDataSummary = {
  id: string
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title: string
  sourceNote: string
  rawText: string
  parsedPayload: EdielTgtCaseTestData | null
  updatedAt: string
  updatedBy: string | null
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function normalizeFieldValue(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}


const KNOWN_PORTAL_FIELD_NAMES: Record<string, string> = {
  '209': 'Anläggningsid',
  '210': 'Avtal, startdatum',
  '213': 'Uppskattad årsenergi',
  '214': 'Konstant för mätare',
  '217': 'Mätmetod',
  '218': 'Antal siffror, mätare',
  '222': 'Rapporteringsfrekvens',
  '223': 'Transaktionstyp',
  '224': 'Mätarnummer',
  '227': 'Kund-id',
  '228': 'Namn-elanvändare',
  '229': 'Adress-elanvändare',
  '231': 'Postnr-elanvändare',
  '232': 'Postort-elanvändare',
  '233': 'Anläggningsid',
  '234': 'Address-anläggning',
  '235': 'Postnr-anläggning',
  '236': 'Postort-anläggning',
  '237': 'Land-anläggning',
  '242': 'Produktkod',
  '249': 'Födelsedatum',
  '250': 'Fakturamottagare-id',
  '251': 'Namn-fakturamottagare',
  '252': 'Address-fakturamottagare',
  '253': 'Postnr-fakturamottagare',
  '254': 'Avräkningsmetod',
  '259': 'Mätare, tidsintervall',
  '260': 'Nätområdesid',
  '261': 'Referens till avtal/fullmakt',
  '262': 'Balansansvarig',
  '306': 'Installationsstatus',
  '316': 'Land-elanvändare',
  '317': 'Postort-fakturamottagare',
  '318': 'Land-fakturamottagare',
  '508B': 'Upplösning',
}


const KNOWN_PORTAL_FIELD_ALIASES: Record<string, string[]> = {
  '234': ['Address-anläggning', 'Adress-anläggning', 'Address-anlaggning', 'Adress-anlaggning'],
  '252': ['Address-fakturamottagare', 'Adress-fakturamottagare'],
  '261': ['Referens till avtal/fullmakt', 'Referens til avtal/fullmakt'],
}


function normalizeLabel(value: string | null | undefined): string {
  return normalizeFieldValue(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function splitPortalCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  const separators = ['\t', ';', ',']
  for (const separator of separators) {
    const cells = trimmed
      .split(separator)
      .map((cell) => normalizeFieldValue(cell.replace(/^"|"$/g, '')))
      .filter(Boolean)
    if (cells.length >= 2) return cells
  }

  return [trimmed]
}

const PORTAL_FIELD_CODE_BY_LABEL = new Map<string, string>(
  Object.entries(KNOWN_PORTAL_FIELD_NAMES).flatMap(([code, name]) => {
    const aliases = KNOWN_PORTAL_FIELD_ALIASES[code] ?? []
    return [name, ...aliases].map((label) => [normalizeLabel(label), code] as const)
  })
)

function codeForPortalLabel(value: string | null | undefined): string | null {
  const normalized = normalizeLabel(value)
  if (!normalized) return null

  const direct = PORTAL_FIELD_CODE_BY_LABEL.get(normalized)
  if (direct) return direct

  for (const [label, code] of PORTAL_FIELD_CODE_BY_LABEL.entries()) {
    if (normalized === label || normalized.includes(label) || label.includes(normalized)) {
      return code
    }
  }

  if (/reference to metering point/i.test(String(value ?? ''))) return 'REF_MP'
  if (/enhet.*arsenergi|enhet.*årsenergi/i.test(String(value ?? ''))) return 'UNIT_213'

  return null
}

function portalValuesFromCells(cells: string[], startValueIndex: number): Record<string, string> {
  const values: Record<string, string> = {}
  const valueCells = cells.slice(startValueIndex).map(normalizeFieldValue).filter(Boolean)

  if (valueCells.length <= 1) {
    const value = valueCells[0] ?? ''
    if (value) values.Portaltestdata = value
    return values
  }

  valueCells.forEach((value, index) => {
    values[`Portaltestdata ${index + 1}`] = value
  })

  return values
}

function hasPortalValues(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => normalizeFieldValue(value).length > 0)
}

function parsePortalCellsLine(line: string): EdielTgtExcelField | null {
  const cells = splitPortalCells(line)
  if (cells.length < 2) return null

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] ?? ''
    const directCode = cell.match(/^(\d{3}[A-Za-z]?)(?:\s+(.+))?$/)
    const leadingCode = cell.match(/^(\d{3}[A-Za-z]?)\s+(.+)$/)
    const code = normalizeCode((directCode?.[1] ?? leadingCode?.[1] ?? ''))

    if (code && KNOWN_PORTAL_FIELD_NAMES[code]) {
      const nameFromSameCell = normalizeFieldValue(directCode?.[2] ?? leadingCode?.[2] ?? '')
      const fieldName = nameFromSameCell || cells[index + 1] || KNOWN_PORTAL_FIELD_NAMES[code]
      const startValueIndex = nameFromSameCell ? index + 1 : index + 2
      const values = portalValuesFromCells(cells, startValueIndex)
      if (hasPortalValues(values)) {
        return {
          fieldCode: code,
          fieldName: KNOWN_PORTAL_FIELD_NAMES[code] ?? fieldName,
          values,
        }
      }
    }
  }

  const labelCode = codeForPortalLabel(cells[0])
  if (labelCode) {
    const values = portalValuesFromCells(cells, 1)
    if (hasPortalValues(values)) {
      return {
        fieldCode: labelCode,
        fieldName: KNOWN_PORTAL_FIELD_NAMES[labelCode] ?? cells[0] ?? labelCode,
        values,
      }
    }
  }

  if (cells.length >= 3) {
    const codeFromLabel = codeForPortalLabel(cells[1])
    if (codeFromLabel) {
      const values = portalValuesFromCells(cells, 2)
      if (hasPortalValues(values)) {
        return {
          fieldCode: codeFromLabel,
          fieldName: KNOWN_PORTAL_FIELD_NAMES[codeFromLabel] ?? cells[1] ?? codeFromLabel,
          values,
        }
      }
    }
  }

  return null
}

function parseKnownPortalFieldLine(cleaned: string): EdielTgtExcelField | null {
  const codeMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+(.+)$/)
  if (!codeMatch) return null

  const fieldCode = normalizeCode(codeMatch[1] ?? '')
  const rest = normalizeFieldValue(codeMatch[2] ?? '')
  const knownName = KNOWN_PORTAL_FIELD_NAMES[fieldCode]
  if (!knownName) return null

  const normalizedKnown = knownName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const normalizedRest = rest.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (normalizedRest.startsWith(normalizedKnown)) {
    const value = normalizeFieldValue(rest.slice(knownName.length))
    if (value) {
      return {
        fieldCode,
        fieldName: knownName,
        values: { Portaltestdata: value },
      }
    }
  }

  return null
}

function parsePortalFieldLine(line: string): EdielTgtExcelField | null {
  const cleaned = line.replace(/^[-•*]\s*/, '').trim()
  if (!cleaned) return null

  const cellField = parsePortalCellsLine(cleaned)
  if (cellField) return cellField

  const knownField = parseKnownPortalFieldLine(cleaned)
  if (knownField) return knownField

  const tabParts = cleaned.split('\t').map((part) => part.trim()).filter(Boolean)
  if (tabParts.length >= 3 && /^\d{3}[A-Za-z]?$/.test(tabParts[0] ?? '')) {
    return {
      fieldCode: normalizeCode(tabParts[0]),
      fieldName: tabParts[1] ?? '',
      values: { Portaltestdata: normalizeFieldValue(tabParts.slice(2).join(' ')) },
    }
  }

  const fieldMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+(.+?)\s{2,}(.+)$/)
  if (fieldMatch) {
    return {
      fieldCode: normalizeCode(fieldMatch[1] ?? ''),
      fieldName: normalizeFieldValue(fieldMatch[2] ?? ''),
      values: { Portaltestdata: normalizeFieldValue(fieldMatch[3] ?? '') },
    }
  }

  const looseMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+([^\d].*?)\s+(\S.*)$/)
  if (looseMatch) {
    const fieldCode = normalizeCode(looseMatch[1] ?? '')
    const fieldName = normalizeFieldValue(looseMatch[2] ?? '')
    const value = normalizeFieldValue(looseMatch[3] ?? '')

    if (fieldCode && fieldName && value) {
      return {
        fieldCode,
        fieldName,
        values: { Portaltestdata: value },
      }
    }
  }

  const namedMatch = cleaned.match(/^(Reference to metering point)\s+(.+)$/i)
  if (namedMatch) {
    return {
      fieldCode: 'REF_MP',
      fieldName: 'Reference to metering point',
      values: { Portaltestdata: normalizeFieldValue(namedMatch[2] ?? '') },
    }
  }

  const unitMatch = cleaned.match(/^(Enhet för uppskattad årsenergi)\s+(.+)$/i)
  if (unitMatch) {
    return {
      fieldCode: 'UNIT_213',
      fieldName: 'Enhet för uppskattad årsenergi',
      values: { Portaltestdata: normalizeFieldValue(unitMatch[2] ?? '') },
    }
  }

  return null
}

function mergeDuplicateFields(fields: EdielTgtExcelField[]): EdielTgtExcelField[] {
  const byKey = new Map<string, EdielTgtExcelField>()

  for (const field of fields) {
    const key = `${field.fieldCode}|${field.fieldName}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, field)
      continue
    }

    const existingValue = existing.values.Portaltestdata ?? ''
    const incomingValue = field.values.Portaltestdata ?? ''
    if (!existingValue && incomingValue) {
      existing.values.Portaltestdata = incomingValue
    }
  }

  return Array.from(byKey.values())
}

export function parseEdielPortalTestDataText(input: {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title?: string | null
  rawText: string
}): EdielTgtCaseTestData {
  const rawText = normalizeText(input.rawText)
  const fields = mergeDuplicateFields(
    rawText
      .split('\n')
      .map(parsePortalFieldLine)
      .filter((field): field is EdielTgtExcelField => Boolean(field))
  )

  const columnNames = Array.from(
    fields.reduce((set, field) => {
      Object.keys(field.values).forEach((key) => set.add(key))
      return set
    }, new Set<string>())
  )

  const columns: EdielTgtExcelColumn[] = (columnNames.length > 0 ? columnNames : ['Portaltestdata']).map(
    (name, index) => ({
      index: index + 1,
      name,
      testCase: input.testCaseCode,
    })
  )

  const block: EdielTgtExcelBlock = {
    kind: input.suite === 'PRODAT' ? 'PRODAT' : 'UTILTS',
    sourceWorkbook: 'Edielportalen testdata – importerad',
    sourceSheet: `TGT ${input.testCaseCode}`,
    entityLabel: input.title?.trim() || `TGT ${input.testCaseCode}`,
    entityNumbers: [input.testCaseCode],
    columns,
    fields,
  }

  return {
    suite: input.suite,
    roleCode: input.roleCode,
    testCaseCode: input.testCaseCode,
    title: input.title?.trim() || `TGT ${input.testCaseCode} · importerad testdata`,
    sourceNote:
      columns.length > 1
        ? `Importerad från Edielportalens testdata med ${columns.length} testkunder/rader. Generatorn bygger ett LIN-block per importerad testkund där testfallet kräver det.`
        : 'Importerad från Edielportalens testdatafält. Generatorn läser denna data före statiska bilagor.',
    groups: [
      {
        block,
        columns,
        fields,
      },
    ],
  }
}


function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripXmlTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, ''))
}

function parseDelimitedRows(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(current.trim())
      current = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(current.trim())
      current = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
      if (char === '\r' && next === '\n') index += 1
      continue
    }

    current += char
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim())
    if (row.some(Boolean)) rows.push(row)
  }

  return rows
}

function delimiterScore(text: string, delimiter: ',' | ';' | '\t'): number {
  return text
    .split(/\r?\n/)
    .slice(0, 25)
    .reduce((sum, line) => sum + line.split(delimiter).length - 1, 0)
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t']
  return candidates.sort((a, b) => delimiterScore(text, b) - delimiterScore(text, a))[0] ?? ';'
}

function rowsToPortalText(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => normalizeFieldValue(cell)).filter(Boolean))
    .filter((row) => row.length > 0)
    .map((row) => {
      const first = row[0] ?? ''
      const second = row[1] ?? ''
      const third = row[2] ?? ''

      if (/^\d{3}[A-Za-z]?$/.test(first) && second && third) {
        return [first, second, ...row.slice(2)].join('\t')
      }

      if (/^\d{3}[A-Za-z]?\s+/.test(first) && second) {
        return [first, ...row.slice(1)].join('\t')
      }

      return row.join('\t')
    })
    .join('\n')
}

function parseDelimitedPortalText(text: string): string {
  const normalized = normalizeText(text)
  if (!normalized) return ''

  const delimiter = detectDelimiter(normalized)
  const rows = parseDelimitedRows(normalized, delimiter)
  if (rows.length === 0) return normalized

  const converted = rowsToPortalText(rows)
  return converted || normalized
}

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset)
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const signature = 0x06054b50
  const minOffset = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) return offset
  }
  throw new Error('Kunde inte läsa Excel-filen: ZIP-slut saknas.')
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const centralDirectorySize = readUInt32(buffer, eocdOffset + 12)
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  const end = centralDirectoryOffset + centralDirectorySize

  while (offset < end) {
    if (readUInt32(buffer, offset) !== 0x02014b50) break

    const compressionMethod = readUInt16(buffer, offset + 10)
    const compressedSize = readUInt32(buffer, offset + 20)
    const uncompressedSize = readUInt32(buffer, offset + 24)
    const fileNameLength = readUInt16(buffer, offset + 28)
    const extraFieldLength = readUInt16(buffer, offset + 30)
    const fileCommentLength = readUInt16(buffer, offset + 32)
    const localHeaderOffset = readUInt32(buffer, offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8')

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset })
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
  }

  return entries
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset
  if (readUInt32(buffer, offset) !== 0x04034b50) {
    throw new Error(`Kunde inte läsa Excel-filen: lokal ZIP-header saknas för ${entry.name}.`)
  }

  const fileNameLength = readUInt16(buffer, offset + 26)
  const extraFieldLength = readUInt16(buffer, offset + 28)
  const dataOffset = offset + 30 + fileNameLength + extraFieldLength
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)

  if (entry.compressionMethod === 0) return compressed
  if (entry.compressionMethod === 8) return inflateRawSync(compressed, { finishFlush: 2 })

  throw new Error(`Excel-filen använder ZIP-komprimering som inte stöds (${entry.compressionMethod}).`)
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const siMatches = xml.match(/<si[\s\S]*?<\/si>/g) ?? []

  for (const si of siMatches) {
    const textParts = Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) =>
      decodeXmlEntities(match[1] ?? '')
    )
    strings.push(textParts.join(''))
  }

  return strings
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = (cellRef.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase()
  let index = 0
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

function getCellValue(cellXml: string, sharedStrings: string[]): string {
  const type = cellXml.match(/\st="([^"]+)"/)?.[1] ?? ''

  if (type === 'inlineStr') {
    return stripXmlTags(cellXml.match(/<is[\s\S]*?<\/is>/)?.[0] ?? '')
  }

  const rawValue = decodeXmlEntities(cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '')
  if (!rawValue) return ''

  if (type === 's') {
    const sharedIndex = Number.parseInt(rawValue, 10)
    return Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? '' : ''
  }

  return rawValue
}

function worksheetXmlToRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []
  const rowMatches = xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []

  for (const rowXml of rowMatches) {
    const cells: string[] = []
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? []

    for (const cellXml of cellMatches) {
      const cellRef = cellXml.match(/\br="([^"]+)"/)?.[1] ?? ''
      const columnIndex = cellRef ? columnIndexFromCellRef(cellRef) : cells.length
      cells[columnIndex] = normalizeFieldValue(getCellValue(cellXml, sharedStrings))
    }

    if (cells.some(Boolean)) rows.push(cells)
  }

  return rows
}

function parseXlsxPortalText(buffer: Buffer): string {
  const entries = listZipEntries(buffer)
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]))
  const sharedStringsEntry = entryByName.get('xl/sharedStrings.xml')
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(readZipEntry(buffer, sharedStringsEntry).toString('utf8'))
    : []

  const worksheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv-SE', { numeric: true }))

  if (worksheetEntries.length === 0) {
    throw new Error('Excel-filen saknar läsbara kalkylblad.')
  }

  const allRows = worksheetEntries.flatMap((entry) => {
    const rows = worksheetXmlToRows(readZipEntry(buffer, entry).toString('utf8'), sharedStrings)
    return rows.length > 0 ? [['Kalkylblad', entry.name], ...rows] : []
  })

  return rowsToPortalText(allRows)
}

export async function extractEdielPortalTestDataUploadText(file: File | null): Promise<string | null> {
  if (!file || file.size === 0) return null

  const fileName = file.name.toLowerCase()
  const bytes = Buffer.from(await file.arrayBuffer())

  if (fileName.endsWith('.xlsx')) {
    return parseXlsxPortalText(bytes)
  }

  if (fileName.endsWith('.xls')) {
    throw new Error('Äldre .xls stöds inte. Exportera från Edielportalen som .xlsx eller .csv.')
  }

  const text = bytes.toString('utf8')
  if (fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt')) {
    return parseDelimitedPortalText(text)
  }

  throw new Error('Filtypen stöds inte. Ladda upp .xlsx, .csv, .tsv eller .txt från Edielportalen.')
}

function isMissingTableError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '42P01')
}

function mapRow(row: EdielTgtDynamicTestDataRow): EdielTgtDynamicTestDataSummary {
  return {
    id: row.id,
    testSuite: row.test_suite,
    roleCode: row.role_code,
    testCaseCode: row.test_case_code,
    title: row.title ?? row.parsed_payload?.title ?? `TGT ${row.test_case_code}`,
    sourceNote: row.source_note ?? row.parsed_payload?.sourceNote ?? 'Importerad från Edielportalen.',
    rawText: row.raw_text,
    parsedPayload: row.parsed_payload,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function listEdielTgtDynamicTestData(): Promise<EdielTgtDynamicTestDataSummary[]> {
  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .select('*')
    .order('test_suite', { ascending: true })
    .order('role_code', { ascending: true })
    .order('test_case_code', { ascending: true })

  if (error) {
    if (isMissingTableError(error)) return []
    throw error
  }
  return ((data ?? []) as EdielTgtDynamicTestDataRow[]).map(mapRow)
}

export async function getEdielTgtDynamicTestDataForCase(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): Promise<EdielTgtCaseTestData | null> {
  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .select('parsed_payload')
    .eq('test_suite', suite)
    .eq('role_code', roleCode)
    .eq('test_case_code', testCaseCode)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  return (data?.parsed_payload as EdielTgtCaseTestData | null | undefined) ?? null
}

export async function upsertEdielTgtDynamicTestData(input: {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title?: string | null
  rawText: string
  actorUserId?: string | null
}): Promise<EdielTgtDynamicTestDataSummary> {
  const parsedPayload = parseEdielPortalTestDataText({
    suite: input.suite,
    roleCode: input.roleCode,
    testCaseCode: input.testCaseCode,
    title: input.title,
    rawText: input.rawText,
  })

  if (parsedPayload.groups[0]?.fields.length === 0) {
    throw new Error('Ingen testdata kunde läsas. Klistra in rader från Edielportalen, t.ex. "209 Anläggningsid 735...".')
  }

  const payload = {
    test_suite: input.suite,
    role_code: input.roleCode,
    test_case_code: input.testCaseCode,
    title: input.title?.trim() || parsedPayload.title,
    source_note: parsedPayload.sourceNote,
    raw_text: normalizeText(input.rawText),
    parsed_payload: parsedPayload,
    updated_by: input.actorUserId ?? null,
    created_by: input.actorUserId ?? null,
  }

  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .upsert(payload, { onConflict: 'test_suite,role_code,test_case_code' })
    .select('*')
    .single()

  if (error) throw error
  return mapRow(data as EdielTgtDynamicTestDataRow)
}
