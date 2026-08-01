import { createHash } from 'node:crypto'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import {
  CUSTOMER_PORTAL_OPENAPI_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
} from '@/lib/integrations/websiteIntegrationContract'
import { serializeOpenApiDocument } from '@/lib/integrations/openApiResponse'

export const OPENAPI_RELEASED_AT = '2026-07-31T22:31:00.000Z' as const

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
    runtime_contract_version: version,
    guide_version: version,
    released_at: OPENAPI_RELEASED_AT,
    specifications: {
      website: {
        contract_name: 'website-integration-v1',
        contract_version: version,
        url: WEBSITE_INTEGRATION_OPENAPI_URL,
        sha256: sha256(websiteIntegrationOpenApi),
        compatibility: 'additive',
      },
      customer_portal: {
        contract_name: 'customer-portal-v1',
        contract_version: version,
        url: CUSTOMER_PORTAL_OPENAPI_URL,
        sha256: sha256(customerPortalOpenApi),
        compatibility: 'additive',
      },
    },
  } as const
}
