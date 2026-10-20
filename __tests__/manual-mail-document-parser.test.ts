import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PDFDocument, PDFName } from 'pdf-lib'
import * as XLSX from 'xlsx'

const workerPort = vi.hoisted(() => ({ replacement: null as null | ((options: unknown) => unknown) }))
vi.mock('node:worker_threads', async (original) => {
  const actual = await original<typeof import('node:worker_threads')>()
  return { ...actual, Worker: vi.fn(function (filename: string, options: unknown) {
    return workerPort.replacement ? workerPort.replacement(options) : new actual.Worker(filename, options as import('node:worker_threads').WorkerOptions)
  }) }
})
import { prepareManualMailDocuments } from '@/lib/inbound-mail/manualMailDocumentParser'

function attachment(bytes: Uint8Array, filename: string, contentType: string, mimePart = 1) {
  return { filename, contentType, mimePart, sizeBytes: bytes.length, text: null, sourceRole: 'attachment',
    sha256: createHash('sha256').update(bytes).digest('hex'), contentBase64: Buffer.from(bytes).toString('base64') }
}
function spreadsheet(sheets: Array<{ name: string; rows: unknown[][]; hidden?: boolean }>, type: 'xlsx' | 'biff8' = 'xlsx') {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
  workbook.Workbook = { Sheets: sheets.map(sheet => ({ name: sheet.name, Hidden: sheet.hidden ? 1 : 0 })) }
  return { workbook, bytes: XLSX.write(workbook, { type: 'buffer', bookType: type }) as Buffer }
}
async function pdf(pages: number, encrypted = false) {
  const document = await PDFDocument.create()
  for (let i = 0; i < pages; i++) document.addPage([200, 200])
  if (encrypted) document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({ Filter: PDFName.of('Standard') }))
  return document.save({ useObjectStreams: false })
}
afterEach(() => { workerPort.replacement = null; vi.useRealTimers() })

it('returns an empty complete catalogue when no documents were attached', async () => {
  expect(await prepareManualMailDocuments([])).toMatchObject({ status: 'completed', manifest: [], units: [], visuals: [], reasons: [] })
})

it('counts real PDF pages and binds the visual input to the original bytes', async () => {
  const source = attachment(await pdf(2), 'Svar.pdf', 'application/pdf', 8)
  const result = await prepareManualMailDocuments([source])
  expect(result.status).toBe('completed')
  expect(result.visuals).toEqual([expect.objectContaining({ filename: 'Svar.pdf', pageCount: 2, kind: 'pdf', sha256: source.sha256, contentBase64: source.contentBase64 })])
  expect(result.manifest[0]).toMatchObject({ attachmentId: `part:8:${source.sha256}`, sha256: source.sha256, mimePart: 8, pageCount: 2 })
  expect(result.units).toEqual([])
})

it.each([false, true])('rejects a corrupt or encrypted PDF instead of accepting its header: encrypted=%s', async (encrypted) => {
  const bytes = encrypted ? await pdf(1, true) : Buffer.from('%PDF-1.7\nnot a complete document')
  expect((await prepareManualMailDocuments([attachment(bytes, 'Svar.pdf', 'application/pdf')])).status).toBe('needs_review')
})

it('rejects more than twelve actual PDF pages across the whole email', async () => {
  const result = await prepareManualMailDocuments([attachment(await pdf(7), 'A.pdf', 'application/pdf', 1), attachment(await pdf(6), 'B.pdf', 'application/pdf', 2)])
  expect(result.status).toBe('needs_review')
  expect(result.reasons).toContain('document_pdf_page_limit')
})

it('accepts a complete small PNG and rejects unreasonable image dimensions', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const result = await prepareManualMailDocuments([attachment(png, 'Svar.png', 'image/png')])
  expect(result.status).toBe('completed')
  expect(result.visuals[0]).toMatchObject({ kind: 'image', pageCount: 1, mimeType: 'image/png' })
  const huge = Buffer.from(png); huge.writeUInt32BE(100_000, 16); huge.writeUInt32BE(100_000, 20)
  expect((await prepareManualMailDocuments([attachment(huge, 'Svar.png', 'image/png')])).reasons).toContain('document_image_dimensions_limit')
})

it('rejects a PNG checksum mismatch before paying to transcribe damaged bytes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  png[44] ^= 1
  expect((await prepareManualMailDocuments([attachment(png, 'Svar.png', 'image/png')])).reasons).toContain('document_image_invalid')
})

it('preserves separate table rows for different customers instead of choosing one', async () => {
  const { bytes } = spreadsheet([{ name: 'Kunder', rows: [['Kundnummer', 'Anläggnings-ID', 'Tidigaste start'],
    ['K0001', '073599910000000001', '2027-04-01'], ['K0002', '073599910000000002', '2027-05-01']] }])
  const result = await prepareManualMailDocuments([attachment(bytes, 'Kunder.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed')
  expect(result.units).toContainEqual(expect.objectContaining({ origin: 'spreadsheet', locator: 'Kunder!A2:C2', text: expect.stringContaining('Kundnummer: K0001') }))
  expect(result.units).toContainEqual(expect.objectContaining({ locator: 'Kunder!A3:C3', text: expect.stringContaining('Anläggnings-ID: 073599910000000002') }))
})

it('retains a first-row condition beside recognized table headers even when later rows omit that column', async () => {
  const condition = 'Start gäller endast om uppsägningen bekräftas.'
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', 'Tidigaste start', condition], ['735999999999999991', '2027-01-01']] }])
  const result = await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed')
  expect(result.units).toContainEqual(expect.objectContaining({ locator: 'Svar!A1:C1', text: expect.stringContaining(condition) }))
})

it.each(['drawing', 'header_footer', 'vml_textbox'] as const)('reviews unsupported spreadsheet text in %s instead of dropping its condition', async (kind) => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', 'Tidigaste start'], ['735999999999999991', '2027-01-01']] }])
  if (kind === 'vml_textbox') workbook.Sheets.Svar.B2.c = [{ a: 'Support', t: 'Bevarad cellkommentar.' }]
  const archive = XLSX.CFB.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  const condition = 'Start är preliminär och gäller endast om uppsägningen bekräftas.'
  const edit = (path: string, transform: (text: string) => string) => {
    const index = archive.FullPaths.findIndex((name: string) => name.endsWith(`/${path}`))
    const entry = archive.FileIndex[index]
    if (!entry?.content) throw new Error(`missing synthetic archive entry ${path}`)
    XLSX.CFB.utils.cfb_add(archive, archive.FullPaths[index], Buffer.from(transform(Buffer.from(entry.content).toString('utf8'))))
  }
  if (kind === 'drawing') {
    XLSX.CFB.utils.cfb_add(archive, 'xl/drawings/drawing1.xml', Buffer.from(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:sp><xdr:txBody><a:p><a:r><a:t>${condition}</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:wsDr>`))
    XLSX.CFB.utils.cfb_add(archive, 'xl/worksheets/_rels/sheet1.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'))
    edit('xl/worksheets/sheet1.xml', text => text.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'))
    edit('[Content_Types].xml', text => text.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'))
  } else if (kind === 'header_footer') {
    edit('xl/worksheets/sheet1.xml', text => text.replace('</worksheet>', `<headerFooter><oddHeader>${condition}</oddHeader></headerFooter></worksheet>`))
  } else edit('xl/drawings/vmlDrawing1.vml', text => text.replace('<div style="text-align:left"></div>', `<div style="text-align:left">${condition}</div>`))
  const bytes = XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' }) as Buffer
  expect(await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).toMatchObject({
    status: 'needs_review', units: [], reasons: ['document_spreadsheet_content_unsupported'],
  })
})

it('examines a condition in row1001 and the last hidden worksheet', async () => {
  const rows: unknown[][] = [['Avtalsslut', '2027-03-31']]
  rows[1000] = ['Förbehåll', 'Datumet gäller endast om kunden säger upp avtalet.']
  const { bytes } = spreadsheet([{ name: 'Svar', rows }, { name: 'Sista', hidden: true, rows: [['Villkor', 'Uppsägning måste först bekräftas.']] }])
  const result = await prepareManualMailDocuments([attachment(bytes, 'Villkor.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed')
  expect(result.units).toContainEqual(expect.objectContaining({ locator: 'Svar!A1001:B1001', text: expect.stringContaining('gäller endast om') }))
  expect(result.units).toContainEqual(expect.objectContaining({ locator: 'Sista!A1:B1', text: expect.stringContaining('måste först') }))
})

it('rejects a full row1001 workbook on catalogue limits rather than returning its first1000 rows', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ['Rad', String(index + 1)])
  const { bytes } = spreadsheet([{ name: 'Alla', rows }])
  const result = await prepareManualMailDocuments([attachment(bytes, 'Alla.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('needs_review')
  expect(result.reasons).toContain('document_unit_limit')
})

it('retains cell comments, displayed leading zeros and deterministic Excel dates', async () => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', 1234], ['Avtalsslut', 46477], ['Brytavgift', 0]] }])
  const sheet = workbook.Sheets.Svar
  sheet.B1.z = '000000000000000000'
  sheet.B2.z = 'yyyy-mm-dd'
  sheet.B3.c = [{ a: 'Support', t: 'Avgiften gäller endast om avtalet sägs upp i tid.' }]
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const result = await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed')
  expect(result.units.map(unit => unit.text).join('\n')).toContain('Anläggnings-ID: 000000000000001234')
  expect(result.units.map(unit => unit.text).join('\n')).toContain('Avtalsslut: 2027-03-31')
  expect(result.units.map(unit => unit.text).join('\n')).toContain('Avgiften gäller endast om avtalet sägs upp i tid.')
})

it.each([
  [1000000, '0,,'], [0.1, '0%'], [1000000, '0.00E+00'], [500, '0" MWh"'],
  [123.456, '0.00'], [500, '"0"'], [1000.49, '0'], [-1000, '0;0'],
])('rejects ambiguous numeric value %s displayed with format %s', async (value, format) => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', 'Årsenergi'], ['735999999999999991', value]] }])
  workbook.Sheets.Svar.B2.z = String(format)
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const result = await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result).toMatchObject({ status: 'needs_review', units: [], reasons: ['document_numeric_display_ambiguous'] })
})

it.each([
  ['#,##0.00" kr"', '1234.5 kr'], ['"SEK "#,##0.00', '1234.5 SEK'], ['[$kr-41D] #,##0.00', '1234.5 kr'],
])('retains exact numeric currency semantics for format %s', async (format, expected) => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Brytavgift', 1234.5], ['Årsenergi', 1000000]] }])
  workbook.Sheets.Svar.B1.z = format; workbook.Sheets.Svar.B2.z = '#,##0'
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const result = await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed')
  expect(result.units.map(unit => unit.text)).toContain(`Brytavgift: ${expected}`)
  expect(result.units.map(unit => unit.text)).toContain('Årsenergi: 1000000')
})

it('honors the workbook1904 date base instead of using the server timezone or guessing a year', async () => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', 45015]] }])
  workbook.Workbook!.WBProps = { date1904: true }; workbook.Sheets.Svar.B1.z = 'yyyy-mm-dd'
  const result = await prepareManualMailDocuments([attachment(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.status).toBe('completed'); expect(result.units[0].text).toBe('Avtalsslut: 2027-03-31')
})

it('does not discard a condition embedded in a custom Excel date format', async () => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', 46477]] }])
  workbook.Sheets.Svar.B1.z = 'yyyy-mm-dd" gäller endast om kunden säger upp avtalet"'
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  expect(await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).toMatchObject({
    status: 'needs_review', units: [], reasons: ['document_numeric_display_ambiguous'],
  })
})

it('does not silently repair an Excel numeric identifier that has already lost integer precision', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', 735999100000000001]] }])
  expect((await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).reasons).toContain('document_numeric_precision')
})

it.each(['biff8', 'csv'] as const)('reads actual %s bytes without losing leading zeros or qualifiers', async (type) => {
  const source = type === 'csv'
    ? attachment(Buffer.from('Kundnummer;Anläggnings-ID;Villkor\r\nK0001;073599910000000001;Kunden måste först säga upp avtalet.'), 'Svar.csv', 'text/csv')
    : attachment(spreadsheet([{ name: 'Svar', rows: [['Anläggnings-ID', '073599910000000001'], ['Villkor', 'Kunden måste först säga upp avtalet.']] }], 'biff8').bytes, 'Svar.xls', 'application/vnd.ms-excel')
  const result = await prepareManualMailDocuments([source])
  expect(result.status).toBe('completed')
  const text = result.units.map(unit => unit.text).join('\n')
  expect(text).toContain('073599910000000001'); expect(text).toContain('måste först')
})

it('does not silently drop a legacy XLS page-header condition', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', '2027-03-31']] }], 'biff8')
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  const index = archive.FullPaths.findIndex((path: string) => /\/(?:Workbook|Book)$/.test(path))
  const workbook = Buffer.from(archive.FileIndex[index].content)
  const text = Buffer.from('Start gäller endast om kunden säger upp avtalet.', 'utf16le')
  const record = Buffer.alloc(7 + text.length)
  record.writeUInt16LE(0x14, 0); record.writeUInt16LE(text.length + 3, 2); record.writeUInt16LE(text.length / 2, 4); record[6] = 1
  text.copy(record, 7)
  const patched = Buffer.concat([workbook.subarray(0, -4), record, workbook.subarray(-4)])
  XLSX.CFB.utils.cfb_add(archive, archive.FullPaths[index], patched)
  const source = XLSX.CFB.write(archive, { type: 'buffer', fileType: 'cfb' }) as Buffer
  expect(await prepareManualMailDocuments([attachment(source, 'Svar.xls', 'application/vnd.ms-excel')])).toMatchObject({
    status: 'needs_review', units: [], reasons: ['document_spreadsheet_content_unsupported'],
  })
})

it.each(['missing_cache', 'external', 'volatile'])('never calculates or follows a spreadsheet formula: %s', async (kind) => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Brytavgift', 0]] }])
  workbook.Sheets.Svar.B1 = kind === 'missing_cache' ? { t: 'n', f: '1+1' }
    : { t: 'n', f: kind === 'external' ? 'WEBSERVICE("https://example.invalid/secret")' : 'NOW()', v: 0 }
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  expect((await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).status).toBe('needs_review')
})

it('accepts only a safe already cached constant formula without evaluating it', async () => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Brytavgift', 2]] }])
  workbook.Sheets.Svar.B1.f = '1+1'
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  expect((await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).status).toBe('completed')
})

it('rejects declared ZIP expansion before asking SheetJS to inflate it', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', '2027-03-31']] }])
  const bomb = Buffer.from(bytes), directory = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(directory).toBeGreaterThan(0); bomb.writeUInt32LE(17 * 1024 * 1024, directory + 24)
  const result = await prepareManualMailDocuments([attachment(bomb, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result.reasons).toContain('document_archive_expansion_limit')
})

it('rejects a workbook ZIP checksum mismatch even when declared lengths match', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', '2027-03-31']] }])
  const damaged = Buffer.from(bytes), directory = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  damaged.writeUInt32LE(0, directory + 16)
  expect((await prepareManualMailDocuments([attachment(damaged, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).reasons).toContain('document_archive_invalid')
})

it('shares the expanded ZIP budget across all workbook attachments', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Avtalsslut', '2027-03-31']] }])
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  XLSX.CFB.utils.cfb_add(archive, 'padding.dat', Buffer.alloc(9 * 1024 * 1024, 65))
  const padded = XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true }) as Buffer
  const result = await prepareManualMailDocuments([attachment(padded, 'A.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1),
    attachment(padded, 'B.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2)])
  expect(result.status).toBe('needs_review'); expect(result.reasons).toContain('document_archive_expansion_limit')
})

it('rejects too many sheets and excess cells or text instead of truncating them', async () => {
  const manySheets = spreadsheet(Array.from({ length: 17 }, (_, index) => ({ name: `Svar${index}`, rows: [['Villkor', 'Kundens uppsägning krävs.']] })))
  expect((await prepareManualMailDocuments([attachment(manySheets.bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).reasons).toContain('document_sheet_limit')
  const manyCells = spreadsheet([{ name: 'Svar', rows: [Array.from({ length: 10001 }, () => 'a'), Array.from({ length: 10001 }, () => 'b')] }])
  expect((await prepareManualMailDocuments([attachment(manyCells.bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).reasons).toContain('document_cell_limit')
  const text = attachment(Buffer.from('Villkor gäller. '.repeat(2000)), 'Svar.txt', 'text/plain')
  expect((await prepareManualMailDocuments([text])).reasons).toContain('document_text_limit')
})

it('preserves a condition after a unit boundary with full text coverage', async () => {
  const text = `${'Uppgifter. '.repeat(220)}\nDatumet gäller endast om uppsägning har bekräftats.`
  const result = await prepareManualMailDocuments([attachment(Buffer.from(text), 'Svar.txt', 'text/plain')])
  expect(result.status).toBe('completed')
  expect(result.units.every(unit => unit.text.length <= 2000)).toBe(true)
  expect(result.units.map(unit => unit.text).join('')).toBe(text)
})

it('keeps whitespace at the exact unit limit inside bounded complete fragments', async () => {
  const text = `${'A '.repeat(1000)} Datumet gäller endast om kunden säger upp avtalet.`
  const result = await prepareManualMailDocuments([attachment(Buffer.from(text), 'Svar.txt', 'text/plain')])
  expect(result.status).toBe('completed')
  expect(result.units.every(unit => unit.text.length <= 2000)).toBe(true)
  expect(result.units.map(unit => unit.text).join('')).toBe(text)
})

it('rejects numeric formatting that hides a nonzero fee behind a constant answer', async () => {
  const { workbook } = spreadsheet([{ name: 'Svar', rows: [['Brytavgift', 500]] }])
  workbook.Sheets.Svar.B1.z = '"Ingen"'
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const result = await prepareManualMailDocuments([attachment(bytes, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])
  expect(result).toMatchObject({ status: 'needs_review', units: [], reasons: ['document_numeric_display_ambiguous'] })
})

it('rejects a macro stream even if its filename pretends to be an ordinary workbook', async () => {
  const { bytes } = spreadsheet([{ name: 'Svar', rows: [['Brytavgift', 0]] }])
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  XLSX.CFB.utils.cfb_add(archive, 'xl/vbaProject.bin', Buffer.from('Synthetic macro stream that must never be executed.'))
  const macro = XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' }) as Buffer
  expect((await prepareManualMailDocuments([attachment(macro, 'Svar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')])).reasons).toContain('document_macros_unsupported')
})

it.each([
  ['size', { sizeBytes: 1 }], ['hash', { sha256: 'a'.repeat(64) }], ['base64', { contentBase64: '%%%not-base64%%%' }],
  ['mime', { contentType: 'image/jpeg' }], ['capture', { capturedIssue: 'attachment_not_captured' }],
])('does not turn mismatched %s metadata into a trusted document', async (_name, patch) => {
  const result = await prepareManualMailDocuments([{ ...attachment(await pdf(1), 'Svar.pdf', 'application/pdf'), ...patch }])
  expect(result.status).toBe('needs_review'); expect(result.visuals).toEqual([])
})

it('keeps forwarded source roles out of current document facts', async () => {
  const source = { ...attachment(Buffer.from('Tidigaste start: 2020-01-01'), 'old.txt', 'text/plain'), sourceRole: 'forwarded' }
  const result = await prepareManualMailDocuments([source])
  expect(result.status).toBe('completed'); expect(result.units).toEqual([]); expect(result.visuals).toEqual([])
})

it('rejects document count and total byte excess without truncating or creating a worker', async () => {
  const source = attachment(Buffer.from('Svar'), 'Svar.txt', 'text/plain')
  expect((await prepareManualMailDocuments(Array.from({ length: 6 }, (_, index) => ({ ...source, mimePart: index + 1 })))).reasons).toContain('document_count_limit')
  const a = Buffer.alloc(3 * 1024 * 1024 + 1, 65)
  expect((await prepareManualMailDocuments([attachment(a, 'A.txt', 'text/plain', 1), attachment(a, 'B.txt', 'text/plain', 2)])).reasons).toContain('document_total_bytes_limit')
})

it('handles a real4MiB canonical base64 attachment without a regex stack overflow', async () => {
  const bytes = Buffer.from('A '.repeat(2 * 1024 * 1024))
  expect(bytes.length).toBe(4 * 1024 * 1024)
  await expect(prepareManualMailDocuments([attachment(bytes, 'Large.txt', 'text/plain')])).resolves.toMatchObject({
    status: 'needs_review', units: [], visuals: [], reasons: ['document_text_limit'],
  })
})

it('terminates a stalled bounded worker and never exposes a partial catalogue', async () => {
  vi.useFakeTimers()
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 1) })
  workerPort.replacement = (options) => { expect(options).toMatchObject({ resourceLimits: { maxOldGenerationSizeMb: 96 } }); return worker }
  const pending = prepareManualMailDocuments([attachment(Buffer.from('Brytavgift: Ingen'), 'Svar.txt', 'text/plain')])
  await vi.advanceTimersByTimeAsync(8001)
  expect(await pending).toMatchObject({ status: 'needs_review', units: [], visuals: [], reasons: ['document_worker_timeout'] })
  expect(worker.terminate).toHaveBeenCalledOnce()
})
