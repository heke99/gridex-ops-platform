import { describe, expect, it } from 'vitest'
import { contractDatabaseErrorMessage, contractLifecycleMessage } from '@/lib/contracts/lifecycleErrors'

describe('contract lifecycle errors', () => {
  it('prioritizes domain reason codes', () => {
    expect(contractLifecycleMessage({ reason_codes: ['PUBLICATION_VERSION_LINK_MISMATCH'] }, 'fallback')).toContain('framåt- och bakåtlänk')
  })

  it('maps the production FK failure to a safe repair message', () => {
    expect(contractDatabaseErrorMessage({
      code: '23503',
      message: 'update or delete violates foreign key',
      details: 'contract_publication_versions_legacy_offer_fk',
    })).toContain('publiceringshistorik')
  })

  it('maps explicit database reason before generic SQLSTATE', () => {
    expect(contractDatabaseErrorMessage({ code: '23514', message: 'contract_public_offer_still_referenced' })).toContain('publiceringshistorik fortfarande refererar')
  })
})
