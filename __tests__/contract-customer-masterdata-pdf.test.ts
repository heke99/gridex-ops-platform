// masterplan: none (FINDINGS F51, owner decisions 2026-10-22)
// The signed agreement PDF shows exactly the identity number and registered address that the
// Ediel masterdata declaration sends to the grid owner; a contract without the section keeps
// its PDF byte-identical.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAgreementPdfBuffer,
  contractCustomerMasterdataSection,
  customerMasterdataPdfLines,
  type ContractCustomerMasterdataSection,
} from '@/lib/customer-contracts/agreementPdf'

const base = {
  companyName: 'Exempel Energi AB', brandName: 'Exempel Energi', organizationNumber: '559999-9999',
  companyAddress: 'Exempelvägen 1, 111 11 Stockholm', companySupportEmail: 'kundservice@exempel.se', companyPhone: '+46 8 123 45 67',
  companyWebsite: 'https://exempel.se', customerName: 'Anna Andersson', customerEmail: 'anna@example.se', customerNumber: 'DX-100025',
  contractNumber: 'AVT-DX-100025-001', contractName: 'Rörligt elpris', contractDescription: 'Inköpspris med avtalat påslag.',
  contractType: 'variable_monthly', signedAt: '2026-07-13T18:00:00.000Z', startsAt: '2026-08-01', withdrawalDeadline: '2026-07-27T18:00:00.000Z',
  offerReference: 'offer_signed_reference', monthlyFeeSek: 68, spotMarkupOrePerKwh: 4, bindingMonths: 0, noticeMonths: 1,
  legalVersions: [{ id: '11111111-1111-4111-8111-111111111111', type: 'terms', title: 'Allmänna villkor', version: '2026-07' }],
  signatureSnapshotSha256: 'a'.repeat(64),
}
// sha256 of buildAgreementPdfBuffer(base) before F51 (computed on the unchanged renderer).
const PRE_F51_PDF_SHA256 = 'c238fddb297df5f53654040aa00957fc8026f8371bca73a0530512f56a73ce63'

const section = (overrides: Partial<ContractCustomerMasterdataSection> = {}): ContractCustomerMasterdataSection => ({
  schema: 'gridex_contract_customer_masterdata_v1', customerId: '00000000-0000-4000-8000-000000000001',
  registeredAddressId: '00000000-0000-4000-8000-000000000002', source: 'website_declaration', declaredAt: '2026-07-13T17:59:00.000Z',
  customerIdentity: { id: '199001011234', qualifier: 'SE2', agency: '260' },
  endUserMasterdata: { nameParts: ['Anna Andersson'], streetParts: ['Storgatan 1', 'lgh 1102'], postalCode: '441 30', city: 'Alingsås', country: 'SE' },
  ...overrides,
})
const latin1 = (pdf: Buffer) => pdf.toString('latin1')

describe('agreement PDF customer details (F51)', () => {
  it('renders a contract without the section byte-identically to the pre-F51 renderer', () => {
    expect(createHash('sha256').update(buildAgreementPdfBuffer(base)).digest('hex')).toBe(PRE_F51_PDF_SHA256)
    expect(createHash('sha256').update(buildAgreementPdfBuffer({ ...base, customerMasterdata: null })).digest('hex')).toBe(PRE_F51_PDF_SHA256)
  })

  it('shows the full personnummer and the registered address, each as one whole line', () => {
    const text = latin1(buildAgreementPdfBuffer({ ...base, customerMasterdata: section() }))
    expect(text).toContain('KUNDUPPGIFTER')
    for (const line of [
      'Td\n(Namn: Anna Andersson) Tj\n',
      'Td\n(Personnummer: 199001011234) Tj\n',
      'Td\n(Folkbokf\\366ringsadress: Storgatan 1) Tj\n',
      'Td\n(Adressrad 2: lgh 1102) Tj\n',
      'Td\n(Postnummer och ort: 441 30 Alings\\345s) Tj\n',
      'Td\n(Land: SE) Tj\n',
    ]) expect(text).toContain(line)
  })

  it('uses the organisation number and registered address labels for an SE1 customer', () => {
    const company = section({ customerIdentity: { id: '5560000001', qualifier: 'SE1', agency: '260' },
      endUserMasterdata: { nameParts: ['Exempel Fastigheter Aktiebolag i Vä', 'stra Götaland'], streetParts: ['Box 12'], postalCode: '411 01', city: 'Göteborg', country: 'SE' } })
    expect(customerMasterdataPdfLines(company)).toEqual([
      'Namn: Exempel Fastigheter Aktiebolag i Västra Götaland',
      'Organisationsnummer: 5560000001',
      'Registrerad adress: Box 12',
      'Postnummer och ort: 411 01 Göteborg',
      'Land: SE',
    ])
    const text = latin1(buildAgreementPdfBuffer({ ...base, customerMasterdata: company }))
    expect(text).toContain('(Organisationsnummer: 5560000001) Tj')
    expect(text).not.toContain('Personnummer')
  })

  it('renders only a section with exactly the masterdata rule shape', () => {
    const bad: unknown[] = [
      { ...section(), schema: 'other' },
      { ...section(), customerIdentity: { id: '199001011234', qualifier: 'SE3', agency: '260' } },
      { ...section(), customerIdentity: { id: ' 199001011234', qualifier: 'SE2', agency: '260' } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, nameParts: [] } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, streetParts: ['.'] } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, postalCode: '1234567890' } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, city: 'x'.repeat(36) } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, country: 'se' } },
      { ...section(), endUserMasterdata: { ...section().endUserMasterdata, invoiceAddress: 'Fakturavägen 1' } },
      { ...section(), source: 'facility_copy' },
      'not a section', null,
    ]
    for (const value of bad) {
      expect(contractCustomerMasterdataSection(value)).toBeNull()
      expect(createHash('sha256').update(buildAgreementPdfBuffer({ ...base, customerMasterdata: value })).digest('hex')).toBe(PRE_F51_PDF_SHA256)
    }
    expect(contractCustomerMasterdataSection(section())).toEqual(section())
  })
})
