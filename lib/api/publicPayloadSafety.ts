const FORBIDDEN_PUBLIC_KEYS = new Set([
  'id',
  'company_id',
  'customer_id',
  'site_id',
  'contract_id',
  'application_id',
  'workflow_id',
  'api_client_id',
  'actor_user_id',
  'created_by',
  'updated_by',
  'storage_path',
  'object_path',
  'service_role',
])

const PUBLIC_ID_FIELD_ALLOWLIST = new Set([
  'request_id',
  'correlation_id',
  'trace_id',
  'external_customer_id',
  'facility_id',
  'metering_point_id',
  'auth_user_id',
  'customer_portal_user_id',
  'external_account_id',
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Immutable legal evidence UUIDs are a time-bounded V1 compatibility exception.
// New consumers use legal_bundle_reference/document_reference. The release
// manifest carries the removal date; no other generic `id` path is exempt.
const LEGACY_LEGAL_ID_PATH_ALLOWLIST = [
  /^\$\.(?:data|contracts)\[\d+\]\.legal\.legal_bundle_version_id$/,
  /^\$\.(?:data|contracts)\[\d+\]\.legal\.power_of_attorney_version_id$/,
  /^\$\.(?:data|contracts)\[\d+\]\.legal\.(?:module_versions|customer_documents)\[\d+\]\.(?:id|legal_bundle_version_id|primary_document_id)$/,
  /^\$\.(?:data|contracts)\[\d+\]\.legal\.customer_documents\[\d+\]\.source_document_ids\[\d+\]$/,
  /^\$\.(?:data|contracts)\[\d+\]\.legal_versions\[\d+\]\.(?:id|legal_bundle_version_id)$/,
]
const LEGACY_OFFER_ALIAS_PATH =
  /^\$\.(?:data|contracts)\[\d+\]\.(?:id|contract_offer_id)$/
const EXTERNAL_OFFER_REFERENCE = /^[a-z0-9][a-z0-9_-]{2,99}$/

function isVersionedPublicIdException(path: string, value: unknown): boolean {
  if (LEGACY_LEGAL_ID_PATH_ALLOWLIST.some((pattern) => pattern.test(path))) return true
  return LEGACY_OFFER_ALIAS_PATH.test(path) &&
    typeof value === 'string' &&
    EXTERNAL_OFFER_REFERENCE.test(value) &&
    !UUID_PATTERN.test(value)
}

export class PublicPayloadSafetyError extends Error {
  readonly code = 'public_payload_forbidden_field'
  readonly status = 500
  readonly path: string

  constructor(path: string) {
    super(`Public response contains a forbidden internal field at ${path}.`)
    this.name = 'PublicPayloadSafetyError'
    this.path = path
  }
}

export function assertPublicResponsePayload(value: unknown, path = '$', fieldName = ''): void {
  if (typeof value === 'string' && UUID_PATTERN.test(value) && !PUBLIC_ID_FIELD_ALLOWLIST.has(fieldName) && !isVersionedPublicIdException(path, value)) {
    throw new PublicPayloadSafetyError(path)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicResponsePayload(item, `${path}[${index}]`, fieldName))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    const normalizedKey = key.toLowerCase()
    const versionedException = isVersionedPublicIdException(childPath, child)
    if (
      (FORBIDDEN_PUBLIC_KEYS.has(normalizedKey) && !versionedException) ||
      ((normalizedKey === 'id' || normalizedKey.endsWith('_id')) && !PUBLIC_ID_FIELD_ALLOWLIST.has(normalizedKey) && !versionedException)
    ) {
      throw new PublicPayloadSafetyError(childPath)
    }
    assertPublicResponsePayload(child, childPath, normalizedKey)
  }
}
