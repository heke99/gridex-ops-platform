/* eslint-disable @typescript-eslint/no-require-imports */
// Static Node worker. Document contents never select modules, paths, code or URLs.
const { parentPort, workerData } = require('node:worker_threads')
const { inflateRawSync } = require('node:zlib')
const { PDFDocument } = require('pdf-lib')
const XLSX = require('xlsx')

class DocumentError extends Error {}
const refuse = (code) => { throw new DocumentError(code) }
const { documents, manifest, limits } = workerData
const units = [], visuals = []
let characters = 0, cells = 0, sheets = 0, visualPages = 0, archiveBytes = 0
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes) {
  let value = 0xffff_ffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8
  return (value ^ 0xffff_ffff) >>> 0
}

function addText(entry, origin, locator, text) {
  if (!text.trim()) return
  let remaining = text.replace(/\r\n?/g, '\n'), part = 0
  while (remaining.length) {
    let end = Math.min(remaining.length, limits.unitCharacters)
    if (end < remaining.length) {
      const boundary = Math.max(remaining.lastIndexOf('\n', end - 1), remaining.lastIndexOf(' ', end - 1))
      if (boundary <= 0) refuse('document_unit_text_limit')
      end = boundary + 1
    }
    const fragment = remaining.slice(0, end)
    remaining = remaining.slice(end)
    characters += fragment.length
    if (characters > limits.characters) refuse('document_text_limit')
    if (units.length >= limits.units) refuse('document_unit_limit')
    units.push({ attachmentId: entry.attachmentId, sha256: entry.sha256, origin,
      locator: part || remaining ? `${locator}#text:${++part}` : locator, text: fragment })
  }
}

function checkSpreadsheetPart(name, bytes) {
  if (/^(?:xl\/(?:media|charts|diagrams|embeddings|ctrlProps|activeX|threadedComments)\/|customXml\/)/i.test(name)
    || /^xl\/drawings\//i.test(name) && !/\.vml$/i.test(name)) refuse('document_spreadsheet_content_unsupported')
  if (!/\.(?:xml|rels|vml)$/i.test(name)) return
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { refuse('document_spreadsheet_content_unsupported') }
  if (text.includes('\0') || /<!DOCTYPE|<!ENTITY/i.test(text)
    || /<(?:[\w.-]+:)?(?:drawing|legacyDrawingHF|headerFooter|picture|oleObjects|controls|rPh)\b/i.test(text)
    || /^xl\/(?:worksheets\/|comments|sharedStrings)/i.test(name) && /<(?:[\w.-]+:)?extLst\b/i.test(text)
    || /\bType\s*=\s*["'][^"']*\/(?:drawing|image|chart|oleObject|control)["']/i.test(text)) refuse('document_spreadsheet_content_unsupported')
  if (!/\.vml$/i.test(name)) return
  // Cell notes have a legacy VML shape whose actual text is in comments.xml,
  // which SheetJS exposes as cell comments. Other shapes or nonempty VML
  // textboxes can contain visible conditions that the cell parser cannot read.
  const shapes = [...text.matchAll(/<v:shape\b[^>]*>([\s\S]*?)<\/v:shape>/g)]
  if (!shapes.length || shapes.length !== (text.match(/<v:shape\b/g) ?? []).length
    || /<(?:v:group|v:image|v:imagedata)\b|\b(?:alt|title|o:title)\s*=\s*["'][^"']+/i.test(text)) refuse('document_spreadsheet_content_unsupported')
  for (const shape of shapes) {
    const textboxes = [...shape[1].matchAll(/<v:textbox\b[^>]*>([\s\S]*?)<\/v:textbox>/g)]
    if (!/<x:ClientData\b[^>]*\bObjectType="Note"/.test(shape[1])
      || textboxes.length !== 1 || textboxes[0][1].replace(/<[^>]*>/g, '').trim()) refuse('document_spreadsheet_content_unsupported')
  }
}

// Check both directory declarations AND actual bounded inflation. A malicious
// archive cannot lie about its expansion and bypass the pre-read budget.
function zipPreflight(bytes) {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) refuse('document_archive_invalid')
  const count = bytes.readUInt16LE(eocd + 10), directorySize = bytes.readUInt32LE(eocd + 12), offset = bytes.readUInt32LE(eocd + 16)
  if (!count || count > 512 || count !== bytes.readUInt16LE(eocd + 8) || offset + directorySize !== eocd) refuse('document_archive_invalid')
  let cursor = offset
  const names = new Set(), ranges = []
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) refuse('document_archive_invalid')
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10)
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32)
    const local = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extra + comment
    if (next > eocd || !nameLength || flags & 1 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34)) refuse('document_archive_invalid')
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (names.has(name) || /[\0\\\ufffd]/.test(name) || name.startsWith('/') || name.split('/').includes('..')) refuse('document_archive_invalid')
    names.add(name)
    if (/vbaProject|macrosheet|\.bin$/i.test(name)) refuse('document_macros_unsupported')
    if (/externalLinks\//i.test(name)) refuse('document_external_formula')
    if (size > limits.archiveBytes - archiveBytes) refuse('document_archive_expansion_limit')
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method
      || bytes.readUInt16LE(local + 6) !== flags) refuse('document_archive_invalid')
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28)
    const start = local + 30 + localNameLength + localExtra, end = start + compressed
    if (start > offset || end > offset || bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) refuse('document_archive_invalid')
    ranges.push([local, end])
    let inflated
    try { inflated = method === 0 ? bytes.subarray(start, end) : inflateRawSync(bytes.subarray(start, end), { maxOutputLength: limits.archiveBytes - archiveBytes + 1 }) }
    catch { refuse('document_archive_expansion_limit') }
    if (inflated.length !== size) refuse('document_archive_invalid')
    if (crc32(inflated) !== bytes.readUInt32LE(cursor + 16)) refuse('document_archive_invalid')
    archiveBytes += inflated.length
    if (archiveBytes > limits.archiveBytes) refuse('document_archive_expansion_limit')
    checkSpreadsheetPart(name, inflated)
    if (/\.rels$/i.test(name) && /TargetMode\s*=\s*["']External["']/i.test(inflated.toString('utf8'))) refuse('document_external_link')
    cursor = next
  }
  ranges.sort((a, b) => a[0] - b[0])
  if (cursor !== eocd || ranges.some((range, index) => index && range[0] < ranges[index - 1][1])) refuse('document_archive_invalid')
  if (!names.has('xl/workbook.xml') || !names.has('[Content_Types].xml')) refuse('document_spreadsheet_invalid')
}

function checkImage(bytes, type) {
  let width = 0, height = 0
  if (type === 'image/png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) refuse('document_image_invalid')
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
    if (width > limits.imageDimension || height > limits.imageDimension || width * height > limits.imagePixels) refuse('document_image_dimensions_limit')
    let cursor = 8, data = false, ended = false
    while (cursor + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(cursor), name = bytes.toString('ascii', cursor + 4, cursor + 8)
      if (size > bytes.length - cursor - 12) refuse('document_image_invalid')
      if (crc32(bytes.subarray(cursor + 4, cursor + 8 + size)) !== bytes.readUInt32BE(cursor + 8 + size)) refuse('document_image_invalid')
      if (name === 'acTL') refuse('document_animated_image_unsupported')
      if (name === 'IDAT') data = true
      cursor += size + 12
      if (name === 'IEND') { ended = size === 0 && cursor === bytes.length; break }
    }
    if (!data || !ended) refuse('document_image_invalid')
  } else if (type === 'image/jpeg') {
    if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) refuse('document_image_invalid')
    let cursor = 2
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor++] !== 0xff) refuse('document_image_invalid')
      while (bytes[cursor] === 0xff) cursor++
      const marker = bytes[cursor++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      const size = bytes.readUInt16BE(cursor)
      if (size < 2 || cursor + size > bytes.length) refuse('document_image_invalid')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) refuse('document_image_invalid')
        height = bytes.readUInt16BE(cursor + 3); width = bytes.readUInt16BE(cursor + 5)
      }
      cursor += size
    }
  } else {
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) refuse('document_image_invalid')
    let cursor = 12, image = false
    while (cursor + 8 <= bytes.length) {
      const name = bytes.toString('ascii', cursor, cursor + 4), size = bytes.readUInt32LE(cursor + 4), start = cursor + 8
      if (start + size > bytes.length) refuse('document_image_invalid')
      if (name === 'ANIM' || name === 'ANMF') refuse('document_animated_image_unsupported')
      if (name === 'VP8X') {
        if (size < 10 || bytes[start] & 2) refuse('document_animated_image_unsupported')
        width = bytes.readUIntLE(start + 4, 3) + 1; height = bytes.readUIntLE(start + 7, 3) + 1
      } else if (name === 'VP8L') {
        if (size < 5 || bytes[start] !== 0x2f) refuse('document_image_invalid')
        const bits = bytes.readUInt32LE(start + 1)
        width ||= (bits & 0x3fff) + 1; height ||= (bits >>> 14 & 0x3fff) + 1; image = true
      } else if (name === 'VP8 ') {
        if (size < 10 || bytes.toString('hex', start + 3, start + 6) !== '9d012a') refuse('document_image_invalid')
        width ||= bytes.readUInt16LE(start + 6) & 0x3fff; height ||= bytes.readUInt16LE(start + 8) & 0x3fff; image = true
      }
      cursor = start + size + (size & 1)
    }
    if (!image || cursor !== bytes.length) refuse('document_image_invalid')
  }
  if (!width || !height) refuse('document_image_invalid')
  if (width > limits.imageDimension || height > limits.imageDimension || width * height > limits.imagePixels) refuse('document_image_dimensions_limit')
}

const currencyPattern = '(?:"\\s*(?:kr|SEK|EUR|USD|GBP|€|\\$|£)\\s*"|\\[\\$(?:kr|SEK|EUR|USD|GBP|€|\\$|£)(?:-[0-9a-f]{3,4})?\\]|[€$£])'
const exactNumericFormat = new RegExp(`^(?:(${currencyPattern})\\s*)?((?:0+|#,##0)(?:\\.[0#]+)?)(?:\\s*(${currencyPattern}))?$`, 'i')
function numericText(cell) {
  const format = typeof cell.z === 'string' ? cell.z.trim() : 'General'
  const matched = format === 'General' ? null : exactNumericFormat.exec(format)
  if (format !== 'General' && !matched || matched?.[1] && matched[3]) refuse('document_numeric_display_ambiguous')
  const token = matched?.[1] ?? matched?.[3]
  const currency = token ? token.startsWith('[$') ? token.slice(2, -1).replace(/-[0-9a-f]{3,4}$/i, '') : token.replace(/^"|"$/g, '').trim() : null
  let displayed = typeof cell.w === 'string' ? cell.w.trim() : String(cell.v)
  if (currency) {
    if (matched[1] && displayed.startsWith(currency)) displayed = displayed.slice(currency.length).trim()
    else if (matched[3] && displayed.endsWith(currency)) displayed = displayed.slice(0, -currency.length).trim()
    else refuse('document_numeric_display_ambiguous')
  }
  // Only ordinary decimal/grouping formats are allowed. This check rejects
  // rounding, percentages, scientific notation, scaling commas, hidden signs
  // and arbitrary unit labels instead of silently changing the stored value.
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(displayed)
    || Number(displayed.replace(/,/g, '')) !== cell.v || /e/i.test(String(cell.v))) refuse('document_numeric_display_ambiguous')
  if (!currency && matched && /^0+$/.test(matched[2])) return displayed
  return `${String(cell.v)}${currency ? ` ${currency}` : ''}`
}

function legacyWorkbookPreflight(bytes) {
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  const indexes = archive.FullPaths.map((name, index) => /\/(?:Workbook|Book)$/i.test(name) ? index : -1).filter(index => index >= 0)
  if (indexes.length !== 1) refuse('document_spreadsheet_invalid')
  const stream = Buffer.from(archive.FileIndex[indexes[0]].content)
  let cursor = 0
  while (cursor + 4 <= stream.length) {
    const type = stream.readUInt16LE(cursor), size = stream.readUInt16LE(cursor + 2)
    if (cursor + 4 + size > stream.length) refuse('document_spreadsheet_invalid')
    // These BIFF records contain rendered page or object text outside cells.
    // The local cell reader cannot prove complete coverage, so review them.
    if ([0x0014, 0x0015].includes(type) && size > 0 || [0x005d, 0x007f, 0x01b6].includes(type)) refuse('document_spreadsheet_content_unsupported')
    cursor += 4 + size
  }
  if (cursor !== stream.length) refuse('document_spreadsheet_invalid')
}

function cellText(cell, date1904) {
  if (cell.f != null) {
    if (typeof cell.f !== 'string' || /\[|\]|\||https?:|\b(?:NOW|TODAY|RAND|RANDBETWEEN|INDIRECT|OFFSET|WEBSERVICE|HYPERLINK|RTD|INFO|CELL)\s*\(/i.test(cell.f)) refuse('document_external_formula')
    if (cell.v == null || !['n', 's', 'str', 'b'].includes(cell.t)) refuse('document_formula_cache_missing')
  }
  if (cell.l && typeof cell.l.Target === 'string' && !cell.l.Target.startsWith('#')) refuse('document_external_link')
  if (cell.t === 'e') refuse('document_cell_error')
  if (cell.v == null) return ''
  if (typeof cell.v === 'number') {
    if (!Number.isFinite(cell.v) || Number.isInteger(cell.v) && !Number.isSafeInteger(cell.v)) refuse('document_numeric_precision')
    if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
      const dateFormat = cell.z.replace(/\\([-/:. ])/g, '$1').replace(/AM\/PM/gi, '')
      if (!/^[dmyhs0:/ .,\-]+$/i.test(dateFormat) || !/[dy]/i.test(dateFormat)) refuse('document_numeric_display_ambiguous')
      const date = XLSX.SSF.parse_date_code(cell.v, { date1904 })
      if (!date || date.y < 1900 || date.y > 9999 || date.y === 1900 && date.m === 2 && date.d === 29) refuse('document_date_invalid')
      const result = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
      return date.H || date.M || date.S ? `${result} ${String(date.H).padStart(2, '0')}:${String(date.M).padStart(2, '0')}:${String(date.S).padStart(2, '0')}` : result
    }
    return numericText(cell)
  }
  if (!['string', 'number', 'boolean'].includes(typeof cell.v)) refuse('document_cell_unsupported')
  return typeof cell.w === 'string' ? cell.w : String(cell.v)
}

const headerLabel = /^(?:kund(?:nummer|namn)?|anläggnings[- ]?(?:id|nummer)|mätpunkts?[- ]?(?:id|nummer)|avtalsslut|tidigaste start|brytavgift|uppsägningstid|bindningstid|villkor|förbehåll|kommentar|årsenergi|nätområde|elområde|nuvarande elhandelsföretag)\s*:?$/i
function spreadsheet(bytes, entry, csv) {
  if (!csv && bytes.readUInt32LE(0) === 0x04034b50) zipPreflight(bytes)
  else if (!csv) legacyWorkbookPreflight(bytes)
  let input = bytes
  if (csv) {
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { refuse('document_text_encoding') }
    if (input.includes('\0')) refuse('document_text_encoding')
  }
  const workbook = XLSX.read(input, { type: csv ? 'string' : 'buffer', raw: true, cellNF: true, cellText: true, cellStyles: true,
    cellFormula: true, bookVBA: true, sheetStubs: true, WTF: true })
  if (workbook.vbaraw || workbook.Workbook?.Names?.some(name => /auto_open|auto_close/i.test(name.Name))) refuse('document_macros_unsupported')
  if (!workbook.SheetNames.length) refuse('document_spreadsheet_invalid')
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true
  for (const name of workbook.SheetNames) {
    if (++sheets > limits.sheets) refuse('document_sheet_limit')
    const sheet = workbook.Sheets[name]
    if (!sheet || sheet['!type'] === 'macro') refuse('document_macros_unsupported')
    const rows = new Map()
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue
      if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address) || ++cells > limits.cells) refuse('document_cell_limit')
      const point = XLSX.utils.decode_cell(address)
      if (point.r >= 1_048_576 || point.c >= 16_384) refuse('document_cell_limit')
      const cell = sheet[address], text = cellText(cell, date1904), comments = []
      for (const comment of cell.c ?? []) {
        if (typeof comment.t !== 'string') refuse('document_comment_unsupported')
        if (comment.t.trim()) comments.push(`Kommentar ${address}: ${comment.t}`)
      }
      if (!text && !comments.length) continue
      const row = rows.get(point.r) ?? []
      row.push({ c: point.c, text, comments }); rows.set(point.r, row)
    }
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0])
    for (const [, row] of ordered) row.sort((a, b) => a.c - b.c)
    const first = ordered[0]?.[1] ?? []
    const headers = first.length >= 2 && first.every(cell => cell.text && cell.text.length <= 100) && first.filter(cell => headerLabel.test(cell.text)).length >= 2
      ? new Map(first.map(cell => [cell.c, cell.text.replace(/:\s*$/, '')])) : null
    for (let index = 0; index < ordered.length; index++) {
      const [rowIndex, row] = ordered[index]
      // The real header labels are repeated beside each row's own values;
      // no row is assigned to the customer of another row or worksheet.
      let text
      if (headers && index > 0) text = row.filter(cell => cell.text).map(cell => `${headers.get(cell.c) ?? XLSX.utils.encode_col(cell.c)}: ${cell.text}`).join('\n')
      else if (!headers && row.length === 2 && row[0].text && row[1].text) text = `${row[0].text.replace(/:\s*$/, '')}: ${row[1].text}`
      else text = row.map(cell => cell.text).join('\t')
      const comments = row.flatMap(cell => cell.comments)
      if (comments.length) text += `${text ? '\n' : ''}${comments.join('\n')}`
      const range = `${XLSX.utils.encode_cell({ r: rowIndex, c: row[0].c })}:${XLSX.utils.encode_cell({ r: rowIndex, c: row[row.length - 1].c })}`
      addText(entry, 'spreadsheet', `${name}!${range}`, text)
    }
    for (const key of ['Comments', 'Subject']) {
      const text = workbook.Props?.[key]
      if (typeof text === 'string' && text.trim()) addText(entry, 'spreadsheet', `${name}!metadata:${key}`, text)
    }
  }
}

async function parse(document) {
  const { entry } = document, bytes = Buffer.from(document.bytes)
  const zip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50
  const ole = bytes.length >= 8 && bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'
  const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-'
  const image = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
    : bytes.length >= 2 && bytes.readUInt16BE(0) === 0xffd8 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
  const declared = entry.mimeType, generic = declared === 'application/octet-stream'
  if (/\.(?:xlsm|xlsb|xlam|xltm)$/i.test(entry.filename) || /macroenabled/i.test(declared)) refuse('document_macros_unsupported')
  const expected = pdf ? 'application/pdf' : image ?? (zip ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : ole ? 'application/vnd.ms-excel' : null)
  if (expected && !generic && declared !== expected) refuse('document_mime_mismatch')
  if (expected) entry.mimeType = expected
  if (pdf || image) {
    let pageCount = 1
    if (pdf) {
      const loaded = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
      if (loaded.isEncrypted) refuse('document_pdf_encrypted')
      pageCount = loaded.getPageCount()
      if (!pageCount || pageCount > limits.pdfPages) refuse('document_pdf_page_limit')
    } else checkImage(bytes, image)
    visualPages += pageCount
    if (visualPages > limits.pdfPages) refuse('document_pdf_page_limit')
    entry.pageCount = pageCount
    visuals.push({ attachmentId: entry.attachmentId, sha256: entry.sha256, mimeType: entry.mimeType, filename: entry.filename,
      contentBase64: bytes.toString('base64'), pageCount, kind: pdf ? 'pdf' : 'image' })
    return
  }
  if (zip || ole) { spreadsheet(bytes, entry, false); return }
  const csv = declared === 'text/csv' || /\.csv$/i.test(entry.filename)
  if (csv) { spreadsheet(bytes, entry, true); return }
  if (declared === 'text/plain') {
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { refuse('document_text_encoding') }
    if (text.includes('\0')) refuse('document_text_encoding')
    addText(entry, 'text', 'text:1', text)
    return
  }
  refuse('document_type_unsupported')
}

;(async () => {
  try {
    for (const document of documents) await parse(document)
    parentPort.postMessage({ status: 'completed', manifest, units, visuals, reasons: [] })
  } catch (error) {
    parentPort.postMessage({ status: 'needs_review', manifest, units: [], visuals: [], reasons: [error instanceof DocumentError ? error.message : 'document_parse_failed'] })
  }
})()
