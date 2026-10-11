import { createHash } from 'node:crypto'
import staffOpenApi from '@/docs/openapi/staff-v1.json'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import {
  STAFF_OPENAPI_URL,
  STAFF_VERSIONED_OPENAPI_URL,
  CUSTOMER_PORTAL_OPENAPI_URL,
  CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL,
  API_COMPATIBILITY_CLASSIFICATION,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
  WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL,
  MINIMUM_TENANT_INTEGRATION_VERSION,
} from '@/lib/integrations/websiteIntegrationContract'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'

// Deterministic release preparation instant; publication is verified separately after deployment.
export const OPENAPI_RELEASED_AT = '2026-10-09T12:00:00.000Z' as const

function sha256(document: unknown): string {
  return createHash('sha256')
    .update(serializeOpenApiDocument(document))
    .digest('hex')
}

export function buildOpenApiReleaseManifest() {
  const version = WEBSITE_INTEGRATION_CONTRACT_VERSION
  return {
    release_version: version,
    website_openapi_version: websiteIntegrationOpenApi.info.version,
    customer_portal_openapi_version: customerPortalOpenApi.info.version,
    staff_openapi_version: staffOpenApi.info.version,
    runtime_contract_version: version,
    guide_version: version,
    released_at: OPENAPI_RELEASED_AT,
    generated_at: OPENAPI_RELEASED_AT,
    build_commit:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA ??
      'unknown',
    compatibility_classification: API_COMPATIBILITY_CLASSIFICATION.release,
    deprecated_features: [
      {
        feature: 'public contract id and contract_offer_id compatibility aliases',
        replacement: 'offer_reference',
        sunset_at: '2026-10-31T23:59:59.000Z',
      },
      {
        feature: 'legal evidence UUID compatibility fields',
        replacement: 'legal_bundle_reference and document_reference',
        sunset_at: '2026-10-31T23:59:59.000Z',
      },
      {
        feature: 'diagnostics=true on public-contracts',
        replacement: '/api/v1/website/public-contracts/diagnostics',
        sunset_at: '2026-10-31T23:59:59.000Z',
      },
      {
        feature: 'x-api-key request header',
        replacement: 'Authorization: Bearer <GRIDEX_API_KEY>',
        sunset_at: '2026-10-31T23:59:59.000Z',
      },
    ],
    minimum_tenant_integration_version: MINIMUM_TENANT_INTEGRATION_VERSION,
    specifications: {
      staff: {
        contract_name: 'staff-v1',
        contract_version: staffOpenApi.info.version,
        url: STAFF_OPENAPI_URL,
        immutable_url: STAFF_VERSIONED_OPENAPI_URL,
        sha256: sha256(staffOpenApi),
        compatibility: API_COMPATIBILITY_CLASSIFICATION.release,
      },
      website: {
        contract_name: 'website-integration-v1',
        contract_version: version,
        url: WEBSITE_INTEGRATION_OPENAPI_URL,
        immutable_url: WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL,
        sha256: sha256(websiteIntegrationOpenApi),
        compatibility: API_COMPATIBILITY_CLASSIFICATION.website,
      },
      customer_portal: {
        contract_name: 'customer-portal-v1',
        contract_version: version,
        url: CUSTOMER_PORTAL_OPENAPI_URL,
        immutable_url: CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL,
        sha256: sha256(customerPortalOpenApi),
        compatibility: API_COMPATIBILITY_CLASSIFICATION.customerPortal,
      },
    },
  } as const
}
