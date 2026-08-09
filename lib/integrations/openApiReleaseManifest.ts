import { createHash } from 'node:crypto'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import { CURRENT_API_CONTRACT } from '@/lib/integrations/apiContract'
import {
  CUSTOMER_PORTAL_OPENAPI_URL,
  CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
  WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL,
} from '@/lib/integrations/websiteIntegrationContract'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'

export const OPENAPI_RELEASED_AT = CURRENT_API_CONTRACT.releasedAt

function sha256(document: unknown): string {
  return createHash('sha256')
    .update(serializeOpenApiDocument(document))
    .digest('hex')
}

export function buildOpenApiReleaseManifest() {
  const version = WEBSITE_INTEGRATION_CONTRACT_VERSION
  const compatibility = CURRENT_API_CONTRACT.compatibilityClassification
  return {
    release_version: version,
    website_openapi_version: websiteIntegrationOpenApi.info.version,
    customer_portal_openapi_version: customerPortalOpenApi.info.version,
    runtime_contract_version: version,
    guide_version: version,
    released_at: OPENAPI_RELEASED_AT,
    generated_at: OPENAPI_RELEASED_AT,
    build_commit:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA ??
      'unknown',
    compatibility_classification: compatibility,
    deprecated_features: [
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
      {
        feature: 'customer_portal.read / customer_portal.write scope aliases',
        replacement: 'granular customer_* scopes from /api/v1/integration/context',
        sunset_at: '2026-10-31T23:59:59.000Z',
      },
    ],
    minimum_tenant_integration_version: version,
    specifications: {
      website: {
        contract_name: 'website-integration-v1',
        contract_version: version,
        url: WEBSITE_INTEGRATION_OPENAPI_URL,
        immutable_url: WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL,
        sha256: sha256(websiteIntegrationOpenApi),
        compatibility,
      },
      customer_portal: {
        contract_name: 'customer-portal-v1',
        contract_version: version,
        url: CUSTOMER_PORTAL_OPENAPI_URL,
        immutable_url: CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL,
        sha256: sha256(customerPortalOpenApi),
        compatibility,
      },
    },
  } as const
}
