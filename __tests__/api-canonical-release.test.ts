import { describe, expect, it } from 'vitest'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteOpenApi from '@/docs/openapi/website-integration-v1.json'
import { parseCustomerEventPayload } from '@/lib/customer-portal/customerEvents'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

describe('canonical public API release', () => {
  it('publishes one version and a release-manifest operation', () => {
    expect(WEBSITE_INTEGRATION_CONTRACT_VERSION).toBe('2026-07-30.1')
    expect(websiteOpenApi.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(customerPortalOpenApi.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(websiteOpenApi.paths['/api/v1/openapi/release-manifest.json']?.get).toBeDefined()
  })

  it('publishes document-bound legal acceptance and paired portal identity', () => {
    const application = websiteOpenApi.components.schemas.CustomerApplicationRequest
    expect(application.additionalProperties).toBe(false)
    expect(application.properties.customer_portal_user_id).toBeDefined()
    expect(application.properties.auth_user_id).toBeDefined()
    expect(application.properties.legal_bundle_version).toBeDefined()
    expect('consents' in application.properties).toBe(false)
    expect(websiteOpenApi.components.schemas.LegalAcceptances.type).toBe('array')
    expect(websiteOpenApi.components.schemas.LegalAcceptance.additionalProperties).toBe(false)
  })

  it('publishes closed quote, portfolio, event and portal sync envelopes', () => {
    const websitePaths = websiteOpenApi.paths
    const portalPaths = customerPortalOpenApi.paths
    expect(websitePaths['/api/v1/website/quote/validate'].post.responses['200'].content['application/json'].schema.additionalProperties).toBe(false)
    expect(websitePaths['/api/v1/website/portfolio-prices'].get.responses['200'].content['application/json'].schema.additionalProperties).toBe(false)
    expect(websiteOpenApi.components.schemas.WebsiteCustomerEventRequest.additionalProperties).toBe(false)
    expect(portalPaths['/api/v1/customer-portal/sync'].post.requestBody.content['application/json'].schema.additionalProperties).toBe(false)
    expect(JSON.stringify(portalPaths['/api/v1/customer-portal/sync'])).not.toContain('CustomerInvoice')
  })
})

describe('canonical customer events', () => {
  it('accepts the documented event shape and rejects the legacy free-form shape', () => {
    const canonical = parseCustomerEventPayload({
      event_type: 'customer.document_opened',
      event_reference: 'event-123',
      occurred_at: '2026-07-30T12:00:00.000Z',
      customer: {
        customer_portal_user_id: 'f8249704-7ce8-4885-93cb-fbb9922ed77d',
        auth_user_id: 'f8249704-7ce8-4885-93cb-fbb9922ed77d',
        external_customer_id: 'CUSTOMER-123',
      },
      subject: { type: 'document', reference: 'DOC-123' },
      data: { action: 'opened' },
    })
    expect(canonical.success).toBe(true)

    const legacy = parseCustomerEventPayload({
      event_type: 'customer.document_opened',
      customer_id: 'f8249704-7ce8-4885-93cb-fbb9922ed77d',
      payload: {},
    })
    expect(legacy.success).toBe(false)
  })
})
