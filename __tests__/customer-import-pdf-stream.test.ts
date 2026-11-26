import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parsePdfCustomerRows } from '@/lib/customers/importParser'

const header = 'first_name;last_name;email;facility_id'
const row = 'Syntetisk;Kund;kunden@example.invalid;735999260744000002'
const text = `BT\n(${header}) Tj\n(${row}) Tj\nET`

function pdfWithStream(body: Buffer, filter = '') {
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length} ${filter} >>\nstream\n`),
    body,
    Buffer.from('\nendstream\nendobj\n%%EOF\n'),
  ])
}

function expectedCustomer() {
  return expect.objectContaining({ first_name: 'Syntetisk', last_name: 'Kund', email: 'kunden@example.invalid', facility_id: '735999260744000002' })
}

describe('PDF customer import stream extraction', () => {
  it('reads a compressed table row exactly once with either equivalent Flate declaration', () => {
    for (const filter of ['/Filter /FlateDecode', '/Filter [/FlateDecode]', '/Title (upstream invoice) /Filter /FlateDecode']) {
      const document = pdfWithStream(deflateSync(Buffer.from(text)), filter)
      expect(parsePdfCustomerRows(document).rows).toEqual([expectedCustomer()])
    }
  })

  it('uses a plain decoded text stream once and retains the legacy unstructured text fallback', () => {
    expect(parsePdfCustomerRows(pdfWithStream(Buffer.from(text))).rows).toEqual([expectedCustomer()])
    const legacy = Buffer.from(`%PDF-1.4\n${header}\n${row}\n%%EOF`)
    expect(parsePdfCustomerRows(legacy).rows).toEqual([expectedCustomer()])
  })

  it('keeps unreadable or unsupported encoded bodies out of customer table results', () => {
    for (const filter of ['/Filter /FlateDecode', '/Filter /ASCII85Decode']) {
      const document = pdfWithStream(Buffer.from(text), filter)
      const parsed = parsePdfCustomerRows(document)
      expect(parsed.rows).toEqual([])
      expect(parsed.ocrStatus).toBe('needs_ocr')
    }
  })
})
