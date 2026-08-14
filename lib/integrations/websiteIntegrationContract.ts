/**
 * Canonical public contract for a tenant website integration.
 *
 * A production tenant must only configure one server-side secret:
 * `GRIDEX_API_KEY`. Tenant/company identity is derived from that key. The
 * production API base URL and request-field placement are part of the V1
 * contract and must never be controlled by tenant environment flags.
 */
export const WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-08-14.1' as const

export const WEBSITE_INTEGRATION_ORIGIN = 'https://app.gridex.se' as const
export const WEBSITE_INTEGRATION_BASE_PATH = '/api/v1' as const
export const WEBSITE_INTEGRATION_BASE_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_BASE_PATH}` as const

export const WEBSITE_INTEGRATION_OPENAPI_PATH = '/api/v1/openapi/website-integration-v1.json' as const
export const CUSTOMER_PORTAL_OPENAPI_PATH = '/api/v1/openapi/customer-portal-v1.json' as const
export const OPENAPI_RELEASE_MANIFEST_PATH = '/api/v1/openapi/release-manifest.json' as const
export const WEBSITE_INTEGRATION_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/website-integration-v1.json` as const
export const CUSTOMER_PORTAL_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/customer-portal-v1.json` as const
export const WEBSITE_INTEGRATION_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_OPENAPI_PATH}` as const
export const CUSTOMER_PORTAL_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${CUSTOMER_PORTAL_OPENAPI_PATH}` as const
export const OPENAPI_RELEASE_MANIFEST_URL = `${WEBSITE_INTEGRATION_ORIGIN}${OPENAPI_RELEASE_MANIFEST_PATH}` as const
export const WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_VERSIONED_OPENAPI_PATH}` as const
export const CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${CUSTOMER_PORTAL_VERSIONED_OPENAPI_PATH}` as const

export const WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES = ['GRIDEX_API_KEY'] as const
export const WEBSITE_APPLICATION_REFERENCE_LOCATION = 'top_level' as const

export const API_COMPATIBILITY_CLASSIFICATION = {
  release: 'additive-public-boundary-and-tenant-remediation',
  website: 'additive-public-boundary-and-tenant-remediation',
  customerPortal: 'additive-public-boundary-and-tenant-remediation',
} as const
export type CompatibilityClassification =
  (typeof API_COMPATIBILITY_CLASSIFICATION)[keyof typeof API_COMPATIBILITY_CLASSIFICATION]

export const WEBSITE_CHECKOUT_REQUIRED_SCOPES = [
  'integration_context.read',
  'website_contracts.read',
  'website_energy_area.resolve',
  'website_market_prices.read',
  'website_quotes.write',
  'website_quotes.validate',
  'website_legal.read',
  'website_applications.write',
  'website_switch_status.read',
] as const

export const CUSTOMER_PORTAL_REQUIRED_SCOPES = [
  'customer_profile.read',
  'customer_sites.read',
  'customer_contracts.read',
  'customer_invoices.read',
  'customer_metering.read',
  'customer_legal.read',
  'customer_events.read',
  'customer_documents.read',
  'customer_notifications.read',
  'customer_power_of_attorney.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
  'customer_sync.write',
] as const

export const TENANT_WEBSITE_RECOMMENDED_SCOPES = [
  ...WEBSITE_CHECKOUT_REQUIRED_SCOPES,
  ...CUSTOMER_PORTAL_REQUIRED_SCOPES,
  'website_events.write',
  'events.read',
  'customer_documents.read',
  'customer_documents.write',
  'customer_notifications.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
] as const
