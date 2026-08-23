import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import websiteOpenApi from '@/docs/openapi/website-integration-v1.json'

describe('website legal bundle public reference contract', () => {
  it('publishes an opaque legal bundle reference while retaining the immutable internal version for read evidence', () => {
    const publicContracts = readFileSync(
      'lib/website/publicContracts.part-1.ts',
      'utf8',
    )

    expect(publicContracts).toMatch(
      /legal_bundle_reference:\s*legalBundleVersionId\s*\?\s*publicReference\("legal_bundle",\s*input\.companyId,\s*legalBundleVersionId\)\s*:\s*null/,
    )
    expect(publicContracts).toContain(
      'legal_bundle_version_id: legalBundleVersionId',
    )
  })

  it('requires customer-application writes to bind the opaque reference to the exact offer bundle', () => {
    const legalRuntime = readFileSync(
      'lib/website/customerApplicationLegal.ts',
      'utf8',
    )

    expect(legalRuntime).toContain(
      'publicReference("legal_bundle", input.companyId, bundleId)',
    )
    expect(legalRuntime).toContain('legal_bundle_version_mismatch')
    expect(legalRuntime).toContain('acceptanceMatchesCustomerDocument')
    expect(legalRuntime).toContain('customer_legal_acceptances')
  })

  it('keeps the public application contract document-bound and closed', () => {
    const application = websiteOpenApi.components.schemas.CustomerApplicationRequest
    expect(application.additionalProperties).toBe(false)
    expect(application.required).toContain('legal_bundle_version')
    expect(application.required).toContain('legal_acceptances')
    expect(application.properties.legal_bundle_version).toBeDefined()

    const acceptance = websiteOpenApi.components.schemas.LegalAcceptance
    expect(acceptance.additionalProperties).toBe(false)
    expect(acceptance.required).toEqual(
      expect.arrayContaining([
        'requirement_code',
        'document_reference',
        'document_version',
        'document_hash',
        'accepted',
        'accepted_at',
      ]),
    )
  })

  it('keeps structured POA evidence connected to the operational authorization chain', () => {
    const legalRuntime = readFileSync(
      'lib/website/customerApplicationLegal.ts',
      'utf8',
    )
    const authorizationChain = readFileSync(
      'lib/legal/authorizationChain.ts',
      'utf8',
    )

    expect(legalRuntime).toContain('structuredPoaIsExternallySendable')
    expect(legalRuntime).toContain('power_of_attorney_scopes')
    expect(legalRuntime).toContain('ensureWebsiteAuthorizationChainFromPowerOfAttorney')
    expect(authorizationChain).toContain('customer_authorization_documents')
    expect(authorizationChain).toContain('authorization_scopes')
    expect(authorizationChain).toContain('grid_owner_data_requests')
    expect(authorizationChain).toContain('outbound_requests.authorization_document_id')
    expect(authorizationChain).toContain('ediel_message_intents.payload.authorization_document_id')
  })
})
