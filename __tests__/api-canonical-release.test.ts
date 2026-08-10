import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteOpenApi from '@/docs/openapi/website-integration-v1.json'
import { parseCustomerEventPayload } from '@/lib/customer-portal/customerEvents'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { publicPortalContract } from '@/lib/customer-portal/publicDto'
import { CURRENT_API_CONTRACT } from '@/lib/integrations/apiContract'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'
import { buildPublicWebhookPayload } from '@/lib/integrations/webhooks'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

describe('canonical public API release', () => {
  it('publishes one version and a release-manifest operation', () => {
    const manifest = buildOpenApiReleaseManifest()
    expect(websiteOpenApi.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(customerPortalOpenApi.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(manifest.release_version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(manifest.compatibility_classification).toBe(
      CURRENT_API_CONTRACT.compatibilityClassification,
    )
    expect(manifest.specifications.website.compatibility).toBe(
      'additive-response-field-and-readiness-correction',
    )
    expect(websiteOpenApi.paths['/api/v1/openapi/release-manifest.json']?.get).toBeDefined()
  })

  it('hashes the exact pretty-printed bytes served by the OpenAPI routes', () => {
    const manifest = buildOpenApiReleaseManifest()
    const sha256 = (document: unknown) =>
      createHash('sha256')
        .update(serializeOpenApiDocument(document))
        .digest('hex')

    expect(manifest.specifications.website.sha256).toBe(sha256(websiteOpenApi))
    expect(manifest.specifications.customer_portal.sha256).toBe(
      sha256(customerPortalOpenApi),
    )
  })

  it('aligns guide, OpenAPI, runtime and database on mandatory pre-authentication', () => {
    const guide = readFileSync(
      'app/developers/customer-portal-api/page.tsx',
      'utf8',
    )
    const runtime = [
      readFileSync('lib/website/customerApplicationProcess.ts', 'utf8'),
      readFileSync('lib/website/customerApplicationPersistence.ts', 'utf8'),
    ].join('\n')
    const migration = readFileSync(
      'supabase/migrations/20260804151500_website_application_pre_auth_contract_alignment.sql',
      'utf8',
    )
    const application = websiteOpenApi.components.schemas.CustomerApplicationRequest

    expect(application.required).toEqual(
      expect.arrayContaining(['auth_user_id', 'customer_portal_user_id']),
    )
    expect(guide).toContain('Kunden måste autentiseras i tenantens egen')
    expect(guide).toContain('<strong>innan</strong> kundansökan skickas till OPS')
    expect(guide).not.toContain('När kunden redan är inloggad skickas')
    expect(runtime).toContain('portal_auth_identity_required')
    expect((runtime.match(/portal_identity_required: true/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(migration).toContain('alter column portal_identity_required set default true')
    expect(migration).toContain("tg_op = 'INSERT'")
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

  it('keeps the portal contract signature evidence aligned with OpenAPI', () => {
    const signatureHash = 'a'.repeat(64)
    const contract = publicPortalContract('tenant-1', {
      customer_contract_reference: 'contract-1',
      status: 'signed',
      signature_snapshot_sha256: signatureHash,
    })

    expect(contract.signature_snapshot_sha256).toBe(signatureHash)
    expect(
      customerPortalOpenApi.components.schemas.CustomerContract.properties
        .signature_snapshot_sha256,
    ).toMatchObject({ type: ['string', 'null'] })
  })

  it('normalizes legacy route failures into one canonical error envelope', async () => {
    const response = customerPortalJson(
      {
        error: {
          code: 'quote_expired',
          message: 'Quoten har gått ut.',
          request_id: 'request-123',
          correlation_id: 'correlation-123',
          retryable: false,
        },
        error_code: 'quote_expired',
        message: 'Quoten har gått ut.',
      },
      { status: 409 },
    )
    const body = await response.json()

    expect(body).toEqual({
      error: {
        code: 'quote_expired',
        message: 'Quoten har gått ut.',
        retryable: false,
        field: null,
        blockers: [],
      },
      request_id: 'request-123',
      correlation_id: 'correlation-123',
      contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
    })
    expect(response.headers.get('x-request-id')).toBe('request-123')
  })


  it('keeps website application lookup public and tenant-bound', () => {
    const path = websiteOpenApi.paths['/api/v1/website/customer-applications/{application_number}']
    expect(path?.get).toBeDefined()
    expect(
      '/api/v1/website/customer-applications/{application_id}' in
        websiteOpenApi.paths,
    ).toBe(false)
    const data = websiteOpenApi.components.schemas.WebsiteCustomerApplicationData
    const properties = data.properties as Record<string, unknown>
    expect(properties.application_number).toBeDefined()
    for (const internalField of [
      'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
      'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
    ]) {
      expect(properties[internalField]).toBeUndefined()
    }
  })

  it('publishes operation-specific closed write contracts', () => {
    const portalPaths = customerPortalOpenApi.paths
    expect(portalPaths['/api/v1/customer/profile-update'].post.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/CustomerProfileUpdateRequest' })
    expect(portalPaths['/api/v1/customer/notifications/read'].post.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/CustomerNotificationReadRequest' })
    expect(portalPaths['/api/v1/events'].post.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/CustomerEventRequest' })
    expect(customerPortalOpenApi.components.schemas.CustomerNotificationReadRequest.required)
      .toContain('notification_ids')
  })

  it('uses one closed canonical error contract and preserves explicit cache policy', async () => {
    expect(websiteOpenApi.components.schemas.ErrorEnvelope)
      .toEqual(websiteOpenApi.components.schemas.ApiError)
    expect(customerPortalOpenApi.components.schemas.ErrorResponse)
      .toEqual(customerPortalOpenApi.components.schemas.ApiError)
    const response = customerPortalJson(
      { data: { ok: true }, request_id: 'request-cache' },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(response.headers.get('x-request-id')).toBe('request-cache')
  })

  it('projects webhook events without raw tenant or database identifiers', () => {
    const payload = buildPublicWebhookPayload(
      {
        id: '8f71039c-1111-4222-8333-6a8ee4ad9c3e',
        company_id: '0f140c8b-1111-4222-8333-f088008e2d6f',
        event_type: 'contract.application_received',
        aggregate_type: 'customer_contract',
        aggregate_id: '7e005a2c-1111-4222-8333-89a90ff5a78d',
        subject_customer_id: '5ef6d6c4-1111-4222-8333-30f160647e4f',
        actor_user_id: '9c62138d-1111-4222-8333-57a9b57779ac',
        source: 'application',
        event_version: 1,
        idempotency_key: null,
        payload: {
          application_number: 'APP-123',
          status: 'application_received',
          company_id: '0f140c8b-1111-4222-8333-f088008e2d6f',
          customer_id: '5ef6d6c4-1111-4222-8333-30f160647e4f',
          nested: {
            contract_id: '7e005a2c-1111-4222-8333-89a90ff5a78d',
          },
        },
        occurred_at: '2026-07-30T10:00:00.000Z',
        created_at: '2026-07-30T10:00:00.000Z',
      },
      'tenant_public-123',
    )
    const serialized = JSON.stringify(payload)

    expect(payload.event_id).toMatch(/^event_[a-f0-9]{32}$/)
    expect(payload.aggregate).toEqual({
      type: 'customer_contract',
      reference: 'APP-123',
    })
    expect(payload.customer?.customer_reference).toMatch(
      /^customer_[a-f0-9]{32}$/,
    )
    expect(serialized).not.toContain('company_id')
    expect(serialized).not.toContain('customer_id')
    expect(serialized).not.toContain('contract_id')
    expect(serialized).not.toContain('0f140c8b-1111-4222-8333-f088008e2d6f')
    expect(serialized).not.toContain('5ef6d6c4-1111-4222-8333-30f160647e4f')
    expect(serialized).not.toContain('7e005a2c-1111-4222-8333-89a90ff5a78d')
    expect(payload.contract_schema_version).toBe(
      WEBSITE_INTEGRATION_CONTRACT_VERSION,
    )
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
