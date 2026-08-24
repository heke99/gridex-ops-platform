import { describe, expect, it } from 'vitest'
import {
  buildAgreementPdfAttachment,
  buildAgreementPdfBuffer,
  customerContractTypeLabel,
} from '@/lib/customer-contracts/agreementPdf'

const input = {
  companyName: 'Exempel Energi AB',
  brandName: 'Exempel Energi',
  organizationNumber: '559999-9999',
  companyAddress: 'Exempelvägen 1, Exempelvägen 1, 111 11 Stockholm',
  companySupportEmail: 'kundservice@exempel.se',
  companyPhone: '+46 8 123 45 67',
  companyWebsite: 'https://exempel.se',
  customerName: 'Anna Andersson',
  customerEmail: 'anna@example.se',
  customerNumber: 'DX-100025',
  contractNumber: 'AVT-DX-100025-001',
  contractName: 'Rörligt elpris',
  contractDescription: 'Inköpspris med avtalat påslag.',
  contractType: 'variable_monthly',
  signedAt: '2026-07-13T18:00:00.000Z',
  startsAt: '2026-08-01',
  withdrawalDeadline: '2026-07-27T18:00:00.000Z',
  offerReference: 'offer_signed_reference',
  contractPublicationVersionId: '33333333-3333-4333-8333-333333333333',
  pricePlanVersionId: '44444444-4444-4444-8444-444444444444',
  legalBundleVersionId: '55555555-5555-4555-8555-555555555555',
  tenantSnapshotSha256: 'b'.repeat(64),
  evidenceId: 'evidence-001',
  monthlyFeeSek: 68,
  spotMarkupOrePerKwh: 4,
  bindingMonths: 0,
  noticeMonths: 1,
  legalVersions: [
    { id: '11111111-1111-4111-8111-111111111111', type: 'terms', title: 'Allmänna villkor', version: '2026-07', body: '<p>Detta är de accepterade villkoren.</p>' },
    { id: '22222222-2222-4222-8222-222222222222', type: 'privacy_policy', title: 'Integritetspolicy', version: '2026-07', body: 'Personuppgifter behandlas enligt policyn.' },
  ],
  signatureSnapshotSha256: 'a'.repeat(64),
}

describe('agreement PDF', () => {
  it('renders a compact customer-facing confirmation without internal evidence dumps', () => {
    const pdf = buildAgreementPdfBuffer(input)
    const latin1 = pdf.toString('latin1')

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    expect(latin1).toContain('AVTALSBEKR')
    expect(latin1).toContain('AVT-DX-100025-001')
    expect(latin1).toContain('559999-9999')
    expect(latin1).toContain('DITT AVTAL')
    expect(latin1).toContain('ACCEPTERADE VILLKOR OCH DOKUMENT')
    expect(latin1).toContain('Allm\\344nna villkor')
    expect(latin1).toContain('Exempelv\\344gen 1, 111 11 Stockholm')
    expect(latin1).toContain('Avtalstyp: M\\345nadsr\\366rligt')

    expect(latin1).not.toContain('variable_monthly')
    expect(latin1).not.toContain('Detta \\344r de accepterade villkoren')
    expect(latin1).not.toContain('offer_signed_reference')
    expect(latin1).not.toContain('33333333-3333-4333-8333-333333333333')
    expect(latin1).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(latin1).not.toContain('Signatursnapshot SHA-256')
    expect(latin1).not.toContain('BEVISUPPGIFTER')
    expect(latin1).not.toContain('Gridex OPS')
    expect(latin1.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it.each([
    ['fixed', 'Fast pris'],
    ['variable_monthly', 'Månadsrörligt'],
    ['variable_hourly', 'Timpris'],
    ['variable_quarterly', 'Kvartspris'],
    ['portfolio', 'Portföljförvaltat'],
    ['mixed', 'Mixavtal'],
  ])('maps %s to a customer-facing Swedish label', (contractType, expected) => {
    expect(customerContractTypeLabel(contractType)).toBe(expected)
  })

  it('does not expose unknown internal contract type enums', () => {
    expect(customerContractTypeLabel('internal_future_enum')).toBeNull()
  })

  it('returns a durable base64 email attachment', () => {
    const attachment = buildAgreementPdfAttachment(input)
    expect(attachment.filename).toBe('avtalsbekraftelse-AVT-DX-100025-001.pdf')
    expect(attachment.contentType).toBe('application/pdf')
    expect(Buffer.from(attachment.content, 'base64').subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  })
})
