// ops-api-review: F26 (permanent regression from evidence/partner-poa-pdf-format.probe.ts)
import { describe, expect, it } from 'vitest'
import { inspectPdfStructure } from '@/lib/documents/pdfStructure'
import { minimalPdf, objectStreamPdf } from './helpers/minimalPdf'

/** Appends an incremental-update revision with its own xref and %%EOF. */
function incrementallyUpdatedPdf(): Buffer {
  const base = minimalPdf()
  const prevXref = Number(/startxref\n(\d+)/.exec(base.toString('latin1'))![1])
  const objOffset = base.length
  const obj = '5 0 obj\n<< /Producer (incremental) >>\nendobj\n'
  const xrefOffset = objOffset + Buffer.byteLength(obj, 'latin1')
  const update =
    obj +
    `xref\n5 1\n${String(objOffset).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size 6 /Root 1 0 R /Prev ${prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.concat([base, Buffer.from(update, 'latin1')])
}

describe('structural PDF validation', () => {
  it('accepts a readable one-page PDF', () => {
    expect(inspectPdfStructure(minimalPdf())).toEqual({ ok: true })
  })
  it('accepts a PDF whose catalog and page are in a compressed object stream', () => {
    expect(inspectPdfStructure(objectStreamPdf())).toEqual({ ok: true })
  })
  it('accepts leading bytes (up to 1024) before the %PDF- header', () => {
    const lead = Buffer.alloc(1000, 0x20)
    expect(inspectPdfStructure(Buffer.concat([lead, minimalPdf()]))).toEqual({ ok: true })
  })
  it('accepts trailing whitespace and garbage (up to 1024 bytes) after %%EOF', () => {
    expect(inspectPdfStructure(Buffer.concat([minimalPdf(), Buffer.from('\r\n\n  \n')]))).toEqual({ ok: true })
    expect(inspectPdfStructure(Buffer.concat([minimalPdf(), Buffer.alloc(1000, 0x00)]))).toEqual({ ok: true })
  })
  it('accepts incremental updates and uses the last startxref', () => {
    expect(inspectPdfStructure(incrementallyUpdatedPdf())).toEqual({ ok: true })
  })
  it.each([
    ['header after more than 1024 leading bytes', Buffer.concat([Buffer.alloc(1100, 0x20), minimalPdf()]), 'header'],
    ['more than 1024 bytes after %%EOF', Buffer.concat([minimalPdf(), Buffer.alloc(1100, 0x41)]), 'eof'],
    ['incremental update with a broken last startxref', Buffer.from(incrementallyUpdatedPdf().toString('latin1').replace(/startxref\n(\d+)\n%%EOF\n$/, 'startxref\n12\n%%EOF\n'), 'latin1'), 'xref'],
    ['structureless body', Buffer.from('%PDF-1.7\nhello\nstartxref\n9\n%%EOF\n'), 'xref'],
    ['five-byte prefix', Buffer.from('%PDF-'), 'header'],
    ['prefix with EOF only', Buffer.from('%PDF-1.7\nSynthetic\n%%EOF\n'), 'startxref'],
    ['truncated file', minimalPdf().subarray(0, 120), 'eof'],
    ['wrong xref offset', Buffer.from(minimalPdf().toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1'), 'xref'],
    ['no page object', Buffer.from(minimalPdf().toString('latin1').replace('/Type /Page /Parent', '/Type /Pagx /Parent'), 'latin1'), 'page'],
  ])('rejects %s', (_name, bytes, reason) => {
    expect(inspectPdfStructure(bytes)).toEqual({ ok: false, reason })
  })
})
