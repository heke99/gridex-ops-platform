import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ApplicationSchema } from '@/lib/website/customerApplicationSchemas'
import { contractLegalMailEvidenceReady } from '@/lib/website/customerApplicationLegal'
import { buildAgreementPdfAttachment } from '@/lib/customer-contracts/agreementPdf'
import { DEFAULT_EMAIL_TEMPLATES, type CompanyEmailTemplate } from '@/lib/email/emailTemplates'
import {
  EMAIL_EVENT_VARIABLE_CONTRACTS,
  sampleEmailVariablesForEvent,
} from '@/lib/email/eventVariableContracts'
import { renderEmailTemplate } from '@/lib/email/templateRenderer'
import { buildZ03Segments } from '@/lib/ediel/prodat/z03'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'

function canonicalTemplate(templateKey: string): CompanyEmailTemplate {
  const row = DEFAULT_EMAIL_TEMPLATES.find((item) => item.template_key === templateKey)
  if (!row) throw new Error(`synthetic_missing_template:${templateKey}`)
  return {
    id: `synthetic:${templateKey}`,
    company_id: '00000000-0000-4000-8000-000000000001',
    template_key: row.template_key,
    name: row.name,
    subject: row.subject,
    body_html: row.body_html,
    body_text: row.body_text,
    language: 'sv',
    is_active: true,
    created_at: '2026-08-19T10:00:00.000Z',
    updated_at: '2026-08-19T10:00:00.000Z',
  }
}

describe('synthetic customer journey stops immediately before external SMTP', () => {
  it('walks application -> legal evidence -> PDF -> all customer mail -> switch Z03 -> recipient certificate gate', () => {
    const acceptedAt = '2026-08-19T10:00:00.000Z'
    const termsId = '00000000-0000-4000-8000-000000000101'
    const poaId = '00000000-0000-4000-8000-000000000102'
    const termsHash = 'a'.repeat(64)
    const poaHash = 'b'.repeat(64)

    const application = ApplicationSchema.parse({
      offer_reference: 'synthetic-offer-v1',
      customer: {
        customer_type: 'private',
        first_name: 'Anna',
        last_name: 'Andersson',
        full_name: 'Anna Andersson',
        personal_number: '199001011234',
        email: 'anna.synthetic@example.invalid',
        phone: '+46700000000',
      },
      site: {
        facility_id: '735999999999999999',
        street: 'Testgatan 1',
        postal_code: '11122',
        city: 'Stockholm',
        price_area_code: 'SE3',
        grid_area_code: 'STH',
        move_in_date: '2026-09-01',
      },
      metering_point: {
        metering_point_id: '735999999999999999',
        price_area_code: 'SE3',
        grid_area_code: 'STH',
      },
      contract: {
        contract_name: 'Rörligt elavtal',
        contract_type: 'spot_hourly',
        requested_start_date: '2026-09-01',
        monthly_fee_sek: 49,
        spot_markup_ore_per_kwh: 11,
      },
      consents: {
        terms: true,
        privacy_policy: true,
        withdrawal: true,
        power_of_attorney: true,
        price_terms: true,
      },
      legalAcceptances: [
        {
          requirement_code: 'terms',
          document_reference: `legal_bundle_document:${termsId}`,
          document_version: '1',
          document_hash: termsHash,
          accepted: true,
          accepted_at: acceptedAt,
        },
        {
          requirement_code: 'power_of_attorney',
          document_reference: `legal_bundle_document:${poaId}`,
          document_version: '1',
          document_hash: poaHash,
          accepted: true,
          accepted_at: acceptedAt,
        },
      ],
      powerOfAttorney: {
        accepted: true,
        signerName: 'Anna Andersson',
        signerIdentityNumber: '199001011234',
        method: 'website_acceptance',
        scope: ['supplier_switch', 'facility_information_lookup'],
        acceptedAt,
        textVersionId: poaId,
      },
    })

    expect(application.customer.first_name).toBe('Anna')
    expect(application.powerOfAttorney?.scope).toContain('supplier_switch')

    const legalVersions = [
      { id: termsId, type: 'terms', title: 'Allmänna villkor', version: '1', body: 'Villkor', published_at: acceptedAt },
      { id: poaId, type: 'power_of_attorney', title: 'Fullmakt', version: '1', body: 'Fullmakt för leverantörsbyte', published_at: acceptedAt },
    ]
    expect(contractLegalMailEvidenceReady({
      legalVersions,
      acceptanceIds: { [termsId]: 'acceptance-terms', [poaId]: 'acceptance-poa' },
    })).toBe(true)

    const pdf = buildAgreementPdfAttachment({
      companyName: 'Gridex El AB',
      brandName: 'Gridex',
      organizationNumber: '559000-0000',
      companyAddress: 'Sverige',
      companySupportEmail: 'support@gridex.se',
      companyWebsite: 'https://gridex.se',
      customerName: 'Anna Andersson',
      customerEmail: 'anna.synthetic@example.invalid',
      customerNumber: 'DX-900001',
      contractNumber: 'AV-900001',
      contractName: 'Rörligt elavtal',
      contractType: 'spot_hourly',
      signedAt: acceptedAt,
      startsAt: '2026-09-01',
      withdrawalDeadline: '2026-09-02T10:00:00.000Z',
      offerReference: 'synthetic-offer-v1',
      monthlyFeeSek: 49,
      spotMarkupOrePerKwh: 11,
      legalVersions: legalVersions.map((item) => ({
        type: item.type,
        title: item.title,
        version: item.version,
        id: item.id,
        body: item.body,
      })),
      signatureSnapshotSha256: 'c'.repeat(64),
    })
    expect(pdf.contentType).toBe('application/pdf')
    expect(pdf.filename).toContain('AV-900001')
    expect(Buffer.from(String(pdf.content), 'base64').subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')

    for (const contract of Object.values(EMAIL_EVENT_VARIABLE_CONTRACTS)) {
      const rendered = renderEmailTemplate(
        canonicalTemplate(contract.templateKey),
        sampleEmailVariablesForEvent(contract.eventKey),
        { eventKey: contract.eventKey },
      )
      expect(rendered.subject.trim().length, contract.eventKey).toBeGreaterThan(0)
      expect(rendered.html, contract.eventKey).not.toContain('{{')
      expect(rendered.text, contract.eventKey).not.toContain('{{')
    }

    const z03 = buildZ03Segments({
      mode: 'production',
      generatedAt: new Date(acceptedAt),
      context: {
        code: 'Z03',
        bgmReference: 'SYNTH-Z03-900001',
        transactionReference: 'SWITCH-900001',
        senderEdielId: '21660',
        receiverEdielId: '99999',
        customerName: 'Anna Andersson',
        customerId: '199001011234',
        customerIdCodeListQualifier: 'Z01',
        meterPointId: '735999999999999999',
        gridAreaId: 'STH',
        startDate: '2026-09-01',
        customerAddress: 'Testgatan 1',
        customerCity: 'Stockholm',
        customerPostalCode: '11122',
        customerCountry: 'SE',
        powerOfAttorneyReference: 'POA-SYNTH-900001',
      },
    })
    expect(z03.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(z03.segments.some((segment) => segment.startsWith('BGM+Z03+'))).toBe(true)
    expect(z03.segments.some((segment) => segment.includes('735999999999999999'))).toBe(true)
    expect(z03.segments.some((segment) => segment.startsWith('RFF+ANJ:POA-SYNTH-900001'))).toBe(true)

    const certificate = evaluateCertificateStatus({
      usage: 'outbound_recipient',
      purpose: 'encryption',
      status: 'active',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_to: '2030-01-01T00:00:00.000Z',
    }, new Date(acceptedAt))
    expect(certificate.isUsableForSmime).toBe(true)

    // This certificate intentionally stops before any SMTP/provider call.
    // The production transport must resolve/validate the recipient certificate
    // before the send function appears in the execution source.
    const transportSource = readFileSync('lib/ediel/transport/index.ts', 'utf8')
    const resolverUse = transportSource.indexOf('await resolveOutboundRecipientCertificate')
    const smtpUse = transportSource.indexOf('sendEdielEmail(', resolverUse)
    expect(resolverUse).toBeGreaterThan(-1)
    expect(smtpUse).toBeGreaterThan(resolverUse)
  })
})
