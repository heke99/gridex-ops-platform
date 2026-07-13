import { describe, expect, it } from 'vitest'
import { buildAgreementPdfAttachment, buildAgreementPdfBuffer } from '@/lib/customer-contracts/agreementPdf'

const input = {
  companyName: 'Exempel Energi AB',
  customerName: 'Anna Andersson',
  customerEmail: 'anna@example.se',
  customerNumber: 'DX-100025',
  contractNumber: 'AVT-DX-100025-001',
  contractName: 'Rörligt elpris',
  contractDescription: 'Ett avtal med komplett fryst bevisinformation.',
  contractType: 'variable_spot',
  signedAt: '2026-07-13T18:00:00.000Z',
  startsAt: '2026-08-01',
  withdrawalDeadline: '2026-07-27T18:00:00.000Z',
  offerReference: 'offer_signed_reference',
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
  it('creates a valid deterministic PDF envelope with the frozen agreement content', () => {
    const pdf = buildAgreementPdfBuffer(input)
    const latin1 = pdf.toString('latin1')

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    expect(latin1).toContain('AVTALSBEKR')
    expect(latin1).toContain('AVT-DX-100025-001')
    expect(latin1).toContain('offer_signed_reference')
    expect(latin1).toContain('Detta \\344r de accepterade villkoren')
    expect(latin1.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('returns a durable base64 email attachment', () => {
    const attachment = buildAgreementPdfAttachment(input)
    expect(attachment.filename).toBe('avtalsbekraftelse-AVT-DX-100025-001.pdf')
    expect(attachment.contentType).toBe('application/pdf')
    expect(Buffer.from(attachment.content, 'base64').subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  })
})
