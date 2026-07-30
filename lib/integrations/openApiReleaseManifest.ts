import { createHash } from 'node:crypto'
import customerPortalOpenApi from '@/docs/openapi/customer-portal-v1.json'
import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'
import {
  CUSTOMER_PORTAL_OPENAPI_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
} from '@/lib/integrations/websiteIntegrationContract'

export const OPENAPI_RELEASED_AT = '2026-07-30T00:00:00.000Z' as const

function canonicalDocument(document: unknown): string {
  return `${JSON.stringify(document)}\n`
}

function sha256(document: unknown): string {
  return createHash('sha256').update(canonicalDocument(document)).digest('hex')
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
        url: WEBSITE_INTEGRATION_OPENAPI_URL,
        sha256: sha256(websiteIntegrationOpenApi),
      },
      customer_portal: {
        url: CUSTOMER_PORTAL_OPENAPI_URL,
        sha256: sha256(customerPortalOpenApi),
      },
    },
  } as const
}
