import { describe, expect, it } from 'vitest'
import {
  evaluateCustomerOpsMasterReadiness,
  type CustomerLegalAcceptance,
} from '@/lib/opsMaster/readiness'

function acceptance(
  type: string,
  overrides: Partial<CustomerLegalAcceptance> = {},
): CustomerLegalAcceptance {
  return {
    id: `acceptance-${type}`,
    company_id: 'company-1',
    customer_id: 'customer-1',
    contract_id: null,
    contract_application_id: 'application-1',
    acceptance_type: type,
    legal_bundle_version_document_id: `canonical-document-${type}`,
    legal_text_version_id: null,
    accepted_at: '2026-08-23T19:00:00.000Z',
    accepted_ip: null,
    accepted_user_agent: null,
    source: 'website_api',
    snapshot: {},
    metadata: {},
    reason: null,
    ...overrides,
  }
}

describe('OPS master canonical legal readiness', () => {
  it('recognizes canonical bundle document references without legacy legal ids', () => {
    const result = evaluateCustomerOpsMasterReadiness({
      customerId: 'customer-1',
      legalAcceptances: [
        acceptance('terms'),
        acceptance('privacy_policy'),
        acceptance('withdrawal_info'),
        acceptance('price_snapshot'),
        acceptance('power_of_attorney'),
      ],
    })

    expect(result.hasTerms).toBe(true)
    expect(result.hasPrivacy).toBe(true)
    expect(result.hasWithdrawal).toBe(true)
    expect(result.hasPriceSnapshot).toBe(true)
    expect(result.hasPowerOfAttorneyAcceptance).toBe(true)
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('terms_missing')
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('privacy_missing')
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('withdrawal_missing')
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('price_snapshot_missing')
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('poa_acceptance_missing')
  })

  it('keeps legacy legal text references valid for older customers', () => {
    const result = evaluateCustomerOpsMasterReadiness({
      customerId: 'customer-1',
      legalAcceptances: [
        acceptance('terms', {
          legal_bundle_version_document_id: null,
          legal_text_version_id: 'legacy-terms-version',
        }),
      ],
    })

    expect(result.hasTerms).toBe(true)
  })

  it('fails closed when an acceptance has no immutable legal reference', () => {
    const result = evaluateCustomerOpsMasterReadiness({
      customerId: 'customer-1',
      legalAcceptances: [
        acceptance('terms', {
          legal_bundle_version_document_id: null,
          legal_text_version_id: null,
        }),
      ],
    })

    expect(result.hasTerms).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('terms_missing')
  })
})
