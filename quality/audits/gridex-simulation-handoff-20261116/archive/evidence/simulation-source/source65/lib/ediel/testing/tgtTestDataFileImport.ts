// lib/ediel/tgtTestDataFileImport.ts

import { inflateRawSync } from 'node:zlib'

export type EdielTgtImportedFileText = {
  text: string
  fileName: string | null
  source: 'text' | 'spreadsheet'
}

function normalizeFileName(value?: string | null): string {
  return String(value ?? '').trim().toLowerCase()
}

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\u0000')) return utf8
  return buffer.toString('latin1')
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripXmlTags(value: string): string {
  return xmlUnescape(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function columnNameToIndex(cellRef: string): number {
  const letters = (cellRef.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase()
  let index = 0
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const signature = 0x06054b50
  const minOffset = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset
  }
  throw new Error('Kunde inte läsa Excel-filen: ZIP-katalogen saknas.')
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8')

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset })
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Kunde inte läsa Excel-filen: lokal header saknas för ${entry.name}.`)
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + fileNameLength + extraLength
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.compressionMethod === 0) return compressed
  if (entry.compressionMethod === 8) return inflateRawSync(compressed)

  throw new Error(`Kunde inte läsa Excel-filen: komprimeringsmetod ${entry.compressionMethod} stöds inte.`)
}

function getZipText(files: Map<string, Buffer>, name: string): string | null {
  const value = files.get(name)
  return value ? value.toString('utf8') : null
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const values: string[] = []
  const siRegex = /<si\b[\s\S]*?<\/si>/g
  for (const siMatch of xml.matchAll(siRegex)) {
    const si = siMatch[0]
    const parts: string[] = []
    for (const tMatch of si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      parts.push(xmlUnescape(tMatch[1] ?? ''))
    }
    values.push(parts.join('').trim())
  }
  return values
}

function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []
  const rowRegex = /<row\b[^>]*>[\s\S]*?<\/row>/g

  for (const rowMatch of xml.matchAll(rowRegex)) {
    const rowXml = rowMatch[0]
    const row: string[] = []
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g

    for (const cellMatch of rowXml.matchAll(cellRegex)) {
      const attrs = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? ''
      const type = attrs.match(/\bt="([^"]+)"/i)?.[1] ?? ''
      const index = ref ? columnNameToIndex(ref) : row.length
      let value = ''

      if (type === 's') {
        const rawIndex = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
        value = Number.isFinite(rawIndex) ? sharedStrings[rawIndex] ?? '' : ''
      } else if (type === 'inlineStr') {
        value = stripXmlTags(body)
      } else {
        value = xmlUnescape(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? stripXmlTags(body))
      }

      row[index] = value.replace(/\s+/g, ' ').trim()
    }

    while (row.length > 0 && !row[row.length - 1]) row.pop()
    if (row.some((cell) => String(cell ?? '').trim().length > 0)) rows.push(row)
  }

  return rows
}

function xlsxToText(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const files = new Map<string, Buffer>()
  for (const entry of entries) {
    if (entry.name.startsWith('xl/sharedStrings.xml') || entry.name.startsWith('xl/worksheets/sheet')) {
      files.set(entry.name, readZipEntry(buffer, entry))
    }
  }

  const sharedStrings = parseSharedStrings(getZipText(files, 'xl/sharedStrings.xml'))
  const sheetNames = Array.from(files.keys())
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'sv-SE', { numeric: true }))

  const lines: string[] = []
  for (const sheetName of sheetNames) {
    const xml = getZipText(files, sheetName)
    if (!xml) continue
    const rows = parseSheetRows(xml, sharedStrings)
    if (rows.length > 0) {
      lines.push(`# ${sheetName}`)
      for (const row of rows) {
        lines.push(row.join('\t'))
      }
    }
  }

  const text = lines.join('\n').trim()
  if (!text) throw new Error('Excel-filen kunde läsas men innehöll ingen testdata.')
  return text
}

export function parseEdielTgtUploadedTestDataFile(input: {
  bytes: ArrayBuffer
  fileName?: string | null
}): EdielTgtImportedFileText {
  const fileName = input.fileName ?? null
  const normalizedName = normalizeFileName(fileName)
  const buffer = Buffer.from(input.bytes)

  if (normalizedName.endsWith('.xlsx')) {
    return {
      text: xlsxToText(buffer),
      fileName,
      source: 'spreadsheet',
    }
  }

  if (normalizedName.endsWith('.xls')) {
    throw new Error('Gamla .xls-filer stöds inte. Exportera från Edielportalen som .xlsx, .csv eller .tsv.')
  }

  return {
    text: decodeText(buffer),
    fileName,
    source: 'text',
  }
}
