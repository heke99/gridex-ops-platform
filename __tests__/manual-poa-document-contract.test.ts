import { describe, expect, it } from 'vitest'
import { MANUAL_EMAIL_TEMPLATES, renderManualEmailTemplate } from '@/lib/email/manualGridOwnerTemplates'
import { buildFullmaktPdfLines, renderFullmaktPdf } from '@/lib/email/fullmaktPdf'
import { inspectPdfStructure } from '@/lib/documents/pdfStructure'

const variables = {
  case_reference: 'GX-FIR-ABCDEF12', tenant_company_name: 'Synthetic El AB',
  tenant_organization_number: '559999-9984', poa_reference: 'POA-SYNTHETIC-1',
  poa_verification_number: 'synthetic-verification-1',
  customer_name: 'Synthetic Customer', customer_identity: 'SYNTHETIC-IDENTITY',
}

describe('external fullmakt request contract', () => {
  it('identifies the represented tenant and fullmakt without putting customer identity in the subject', () => {
    for (const key of Object.keys(MANUAL_EMAIL_TEMPLATES) as Array<keyof typeof MANUAL_EMAIL_TEMPLATES>) {
      const mail = renderManualEmailTemplate(key, variables)
      expect(mail.bodyText).toContain('559999-9984')
      expect(mail.bodyText).toContain('POA-SYNTHETIC-1')
      expect(mail.bodyText).toContain('Verifikatsnummer: synthetic-verification-1')
      expect(mail.subject).toContain('GX-FIR-ABCDEF12')
      expect(mail.subject).toContain('Synthetic El AB')
      expect(mail.subject).not.toContain('SYNTHETIC-IDENTITY')
    }
  })

  it('clearly separates network and supplier questions, including explicit start and notice deadlines', () => {
    const network = renderManualEmailTemplate('facility_information_request', variables)
    const supplier = renderManualEmailTemplate('current_supplier_contract_information_request', variables)
    expect(network.subject).toContain('Nätuppgifter')
    expect(supplier.subject).toContain('Handelsuppgifter')
    expect(supplier.bodyText).toMatch(/tidigast.*(?:start|byta)/i)
    expect(supplier.bodyText).toMatch(/senast.*säg/i)
  })
})

describe('external fullmakt PDF', () => {
  it('encodes accepted Swedish punctuation using actual WinAnsi bytes', () => {
    const bytes = renderFullmaktPdf({ legalText: 'Fullmakt – ”exakt” godkänd text €' })
    expect(bytes.includes(Buffer.from([0x96, 0x20, 0x94]))).toBe(true)
    expect(bytes.includes(Buffer.from([0x80]))).toBe(true)
  })
  it('refuses to silently corrupt unsupported legal text characters', () => {
    expect(() => renderFullmaktPdf({ legalText: 'Undertecknare 客戶' })).toThrow(/tecken|unicode/i)
  })
  const input = {
    reference: 'POA-SYNTHETIC-1', representativeName: 'Synthetic El AB',
    representativeOrganizationNumber: '559999-9984', method: 'website_acceptance',
    verificationReference: 'consent-synthetic-1', signerIpAddress: '192.0.2.10',
    legalText: 'EXACT ACCEPTED LEGAL TEXT', signedScopes: ['facility_information_lookup'],
  }

  it('exports actual consent evidence and exact legal text without expanding the signed scope', () => {
    const text = buildFullmaktPdfLines(input).join('\n')
    expect(text).toContain('559999-9984')
    expect(text).toContain('192.0.2.10')
    expect(text).toContain('consent-synthetic-1')
    expect(text).toContain('EXACT ACCEPTED LEGAL TEXT')
    expect(text).not.toContain('samt att genomföra leverantörsbyte')
    expect(text).toMatch(/BankID.*inte verifierad/i)
  })

  it('paginates the full accepted text and repeats the verification reference on every page', () => {
    const legalText = Array.from({ length: 230 }, (_, i) => `ACCEPTED CLAUSE ${i + 1}`).join('\n')
    const pdf = renderFullmaktPdf({ ...input, legalText })
    expect(inspectPdfStructure(pdf)).toEqual({ ok: true })
    const source = pdf.toString('latin1')
    const pages = source.match(/\/Type \/Page\b/g) ?? []
    expect(pages.length).toBeGreaterThan(1)
    expect(source).toContain('ACCEPTED CLAUSE 230')
    expect(source.match(/consent-synthetic-1/g)?.length).toBeGreaterThanOrEqual(pages.length)
  })
})
