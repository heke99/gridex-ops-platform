// ops-api-review: F26 (permanent regression from evidence/partner-poa-pdf-format.probe.ts)
import { describe, expect, it } from 'vitest'
import { inspectPdfStructure } from '@/lib/documents/pdfStructure'
import { minimalPdf, objectStreamPdf } from './helpers/minimalPdf'

describe('structural PDF validation', () => {
  it('accepts a readable one-page PDF', () => {
    expect(inspectPdfStructure(minimalPdf())).toEqual({ ok: true })
  })
  it('accepts a PDF whose catalog and page are in a compressed object stream', () => {
    expect(inspectPdfStructure(objectStreamPdf())).toEqual({ ok: true })
  })
  it.each([
    ['five-byte prefix', Buffer.from('%PDF-'), 'header'],
    ['prefix with EOF only', Buffer.from('%PDF-1.7\nSynthetic\n%%EOF\n'), 'startxref'],
    ['truncated file', minimalPdf().subarray(0, 120), 'eof'],
    ['wrong xref offset', Buffer.from(minimalPdf().toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1'), 'xref'],
    ['no page object', Buffer.from(minimalPdf().toString('latin1').replace('/Type /Page /Parent', '/Type /Pagx /Parent'), 'latin1'), 'page'],
  ])('rejects %s', (_name, bytes, reason) => {
    expect(inspectPdfStructure(bytes)).toEqual({ ok: false, reason })
  })
})
