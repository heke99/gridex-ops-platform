import { describe, expect, it } from 'vitest'
import { legalProfileMissingFieldDetail, normalizeCompanyLegalProfileSyncResult } from '@/lib/tenant/companyLegalProfile'

describe('company legal profile sync result', () => {
  it('maps database field codes to Swedish guidance and the single editor', () => {
    expect(legalProfileMissingFieldDetail('company-1', 'postal_address')).toEqual({
      code: 'postal_address',
      label: 'Postadress',
      message: 'Fyll i gatuadress, postnummer, ort och land under Postadress.',
      edit_section: 'company_address',
      edit_path: '/admin/companies/company-1#company-address',
    })
  })

  it('normalizes an RPC result and fills missing structured details', () => {
    expect(normalizeCompanyLegalProfileSyncResult({
      company_id: 'company-1', company_name: 'Gridex El AB', completeness_status: 'incomplete',
      missing_fields: ['postal_address'], review_required: false, updated_at: '2026-07-17T12:00:00.000Z',
    }, 'company-1')).toMatchObject({
      company_id: 'company-1', completeness_status: 'incomplete', missing_fields: ['postal_address'],
      missing_field_details: [expect.objectContaining({ code: 'postal_address', label: 'Postadress' })],
    })
  })
})
