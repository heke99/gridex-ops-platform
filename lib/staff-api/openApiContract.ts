/** Staff integration is an independent protocol; Website/Portal .4 remain unchanged. */
export const STAFF_API_CONTRACT_NAME = 'staff-support-v1' as const
export const STAFF_API_CONTRACT_VERSION = '2026-10-03.1' as const
export const MINIMUM_STAFF_INTEGRATION_VERSION = STAFF_API_CONTRACT_VERSION
export const STAFF_API_PROTOCOL_CAPABILITIES = [
  'staff.sessions',
  'staff.context',
  'staff.customers.read',
  'staff.support.read',
  'staff.support.write',
  'staff.support.attachments',
] as const
export const STAFF_OPENAPI_ORIGIN = 'https://app.gridex.se' as const
export const STAFF_OPENAPI_PATH = '/api/v1/openapi/staff-support-v1.json' as const
export const STAFF_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${STAFF_API_CONTRACT_VERSION}/staff-support-v1.json` as const
export const STAFF_RELEASE_MANIFEST_PATH = '/api/v1/openapi/staff-release-manifest.json' as const
// Preparation time is deterministic. The deployment commit is supplied at runtime.
export const STAFF_OPENAPI_PREPARED_AT = '2026-10-03T21:51:31.000Z' as const
