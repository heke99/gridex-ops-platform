export type XlsxCellValue = unknown

export type XlsxRow = Record<string, XlsxCellValue>

const encoder = new TextEncoder()

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normalizeCellValue(value: XlsxCellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

function columnName(index: number): string {
  let dividend = index + 1
  let column = ''
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26
    column = String.fromCharCode(65 + modulo) + column
    dividend = Math.floor((dividend - modulo) / 26)
  }
  return column
}

function worksheetXml(headers: string[], rows: XlsxRow[]): string {
  const headerCells = headers
    .map((header, index) => `<c r="${columnName(index)}1" t="inlineStr"><is><t>${xmlEscape(header)}</t></is></c>`)
    .join('')

  const dataRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 2
      const cells = headers
        .map((header, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowNumber}`
          const value = normalizeCellValue(row[header])
          if (value === null) return `<c r="${reference}"/>`
          if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`
          if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`
          return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowNumber}">${cells}</row>`
    })
    .join('')

  const maxColumn = columnName(Math.max(headers.length - 1, 0))
  const maxRow = Math.max(rows.length + 1, 1)

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${maxColumn}${maxRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData>
</worksheet>`
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Faktureringsunderlag" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
}

function workbookRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
}

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let j = 0; j < 8; j += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  crcTable[i] = c >>> 0
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pushUInt16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff)
}

function pushUInt32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function pushBytes(bytes: number[], data: Uint8Array) {
  for (const byte of data) bytes.push(byte)
}

function encode(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value
}

function zip(entries: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const local: number[] = []
  const central: number[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = encode(entry.data)
    const checksum = crc32(data)
    const size = data.length
    const localOffset = offset

    pushUInt32(local, 0x04034b50)
    pushUInt16(local, 20)
    pushUInt16(local, 0x0800)
    pushUInt16(local, 0)
    pushUInt16(local, 0)
    pushUInt16(local, 0)
    pushUInt32(local, checksum)
    pushUInt32(local, size)
    pushUInt32(local, size)
    pushUInt16(local, name.length)
    pushUInt16(local, 0)
    pushBytes(local, name)
    pushBytes(local, data)

    offset += 30 + name.length + size

    pushUInt32(central, 0x02014b50)
    pushUInt16(central, 20)
    pushUInt16(central, 20)
    pushUInt16(central, 0x0800)
    pushUInt16(central, 0)
    pushUInt16(central, 0)
    pushUInt16(central, 0)
    pushUInt32(central, checksum)
    pushUInt32(central, size)
    pushUInt32(central, size)
    pushUInt16(central, name.length)
    pushUInt16(central, 0)
    pushUInt16(central, 0)
    pushUInt16(central, 0)
    pushUInt16(central, 0)
    pushUInt32(central, 0)
    pushUInt32(central, localOffset)
    pushBytes(central, name)
  }

  const centralOffset = local.length
  const centralSize = central.length
  const output = [...local, ...central]

  pushUInt32(output, 0x06054b50)
  pushUInt16(output, 0)
  pushUInt16(output, 0)
  pushUInt16(output, entries.length)
  pushUInt16(output, entries.length)
  pushUInt32(output, centralSize)
  pushUInt32(output, centralOffset)
  pushUInt16(output, 0)

  return Uint8Array.from(output)
}

export function buildXlsxWorkbook(headers: string[], rows: XlsxRow[]): Uint8Array {
  const safeHeaders = headers.length > 0 ? headers : ['empty']

  return zip([
    { name: '[Content_Types].xml', data: contentTypesXml() },
    { name: '_rels/.rels', data: rootRelsXml() },
    { name: 'xl/workbook.xml', data: workbookXml() },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml() },
    { name: 'xl/styles.xml', data: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml(safeHeaders, rows) },
  ])
}
