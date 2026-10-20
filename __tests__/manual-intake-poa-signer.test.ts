// FINDINGS F66: an uploaded signed power of attorney from the manual intake carried no signer and no method, so it
// was never externally sendable and the facility request to the grid owner stopped at review.
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { intakePoaSigner } from '@/app/admin/customers/actions.part-2'
import { buildCreateCustomerParams, validateCreateCustomerParams } from '@/app/admin/customers/actions.part-1'
import { hasExternallySendablePoa } from '@/lib/customers/poaReadiness'

const file = () => new File([Buffer.from('%PDF-1.4 fullmakt')], 'fullmakt.pdf', { type: 'application/pdf' })
const base = { firstName: 'Eva', lastName: 'Exempel', personalNumber: '199001011239', poaSignerName: null, poaSignerIdentityNumber: null, signedPowerOfAttorneyFile: file() }

// The POA row the intake stores once the signed file is uploaded (status signed, scopes, stored document).
const storedPoa = (signer: ReturnType<typeof intakePoaSigner>) => ({
  status: 'signed', signed_at: '2026-10-20T10:00:00Z', document_path: 'customer/site/power_of_attorney/fullmakt.pdf', source: null, ...signer,
})

describe('manual intake power-of-attorney signer', () => {
  it('a private customer signs for themself when the fields are left empty, and the fullmakt becomes sendable', () => {
    const signer = intakePoaSigner({ ...base, customerType: 'private' })
    expect(signer).toEqual({ signer_name: 'Eva Exempel', signer_identity_number: '199001011239', method: 'pdf_upload' })
    expect(hasExternallySendablePoa(storedPoa(signer))).toBe(true)
  })

  it('an explicit signer always wins', () => {
    expect(intakePoaSigner({ ...base, customerType: 'private', poaSignerName: 'Olle Ombud', poaSignerIdentityNumber: '198001011231' }))
      .toEqual({ signer_name: 'Olle Ombud', signer_identity_number: '198001011231', method: 'pdf_upload' })
  })

  it('a company signer is never assumed, so the fullmakt is saved but not sent', () => {
    const signer = intakePoaSigner({ ...base, customerType: 'business', firstName: 'Kontakt', lastName: 'Person' })
    expect(signer).toEqual({ signer_name: null, signer_identity_number: null, method: 'pdf_upload' })
    expect(hasExternallySendablePoa(storedPoa(signer))).toBe(false)
  })

  it('no uploaded file means no upload method', () => {
    expect(intakePoaSigner({ ...base, customerType: 'private', signedPowerOfAttorneyFile: null }).method).toBeNull()
  })

  it('reads the signer from the form and rejects an invalid signer identity number', () => {
    const form = new FormData()
    form.set('customerType', 'business'); form.set('companyName', 'E2E Bolag AB'); form.set('poaSignerName', 'Firma Tecknare'); form.set('poaSignerIdentityNumber', '123')
    const params = buildCreateCustomerParams(form, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a')
    expect(params.poaSignerName).toBe('Firma Tecknare')
    expect(validateCreateCustomerParams(params).poaSignerIdentityNumber).toContain('person- eller organisationsnummer')
    form.set('poaSignerIdentityNumber', '5560000001')
    expect(validateCreateCustomerParams(buildCreateCustomerParams(form, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a')).poaSignerIdentityNumber).toBeUndefined()
  })
})
