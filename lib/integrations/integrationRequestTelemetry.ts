import { PUBLIC_API_ERROR_REGISTRY } from '@/lib/integrations/publicApiErrorRegistry'
import { PUBLIC_CONTRACT_ERROR_CODES } from '@/lib/external-contracts/publicContractModel'
import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

const COUNT_KEYS = [
  'result_count', 'historical_count', 'publication_revision', 'rejected_contracts',
  'contracts', 'sites', 'invoices', 'metering_points', 'metering_values', 'documents',
  'legal_acceptances', 'powers_of_attorney', 'notifications', 'events', 'data_quality_issues',
] as const
const BOOLEAN_KEYS = [
  'idempotency_replay', 'idempotency_replayed', 'found', 'complete', 'partial_bundle',
  'summary_mode', 'diagnostics', 'deprecated_customer_type_alias', 'resolution_cache_hit',
] as const
const UUID_KEYS = [
  'trace_id', 'idempotency_record_id', 'identity_id', 'resolution_id', 'customer_id', 'application_id',
] as const
const ENUM_VALUES: Record<string, ReadonlySet<string>> = {
  channel: new Set(['api', 'website', 'internal']),
  decision: new Set(['allowed', 'denied']),
  api_surface: new Set(['partner_v1', 'partner_v1_simple', 'partner_v1_business', 'partner_v1_canonical']),
  customer_type: new Set(['private', 'business', 'both']),
  price_area: new Set(['SE1', 'SE2', 'SE3', 'SE4']),
  action: new Set(['tenant_customer_sync']),
  access_mode: new Set(['headers_or_query', 'json_payload']),
  operation: new Set([
    '/api/partner/v1/contract', '/api/partner/v1/contracts', '/api/partner/v1/customer', '/api/partner/v1/customers',
    '/api/partner/v1/customer/{customer_id}/site', '/api/partner/v1/customer/{customer_id}/site/{site_id}/powerofattorney',
    '/api/partner/v1/powers-of-attorney', '/api/partner/v1/sites', '/api/partner/v1/webhook/subscription', '/api/partner/v1/webhooks/subscriptions',
    'contract.create', 'contract.state', 'contract.status', 'contract.get', 'customer.create', 'customer.get', 'invoice.get', 'invoice.list',
    'invoice.list_by_site', 'invoice.pdf', 'location.resolve', 'measurement.list', 'power_of_attorney.create',
    'power_of_attorney.get', 'power_of_attorney.get_by_site', 'price.current', 'price.quote', 'site.create',
    'site.get', 'webhook.create', 'webhook.create.preflight', 'webhook.delete', 'webhook.list',
  ]),
  error_stage: new Set(['validation', 'authorization', 'intake', 'integration_readiness', 'tenant_readiness', 'internal_error']),
  field: new Set([
    'customer_type', 'quote_reference', 'offer_reference', 'resolution_id', 'price_area',
    'grid_area_code', 'postal_code', 'annual_consumption_kwh', 'start_date',
    'price_option_reference', 'invoice_delivery_method', 'selected_component_references',
    'site_count', 'idempotency_key', 'pricing_snapshot_schema_version',
  ]),
}
const KNOWN_ERROR_CODES = new Set([
  ...Object.keys(PUBLIC_API_ERROR_REGISTRY), ...Object.values(PUBLIC_CONTRACT_ERROR_CODES),
  'customer_type_invalid', 'validation_error', 'website_application_error', 'website_application_failed',
  'website_quote_failed', 'website_quote_validation_failed', 'quote_expired',
  'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE', 'PUBLIC_CONTRACT_SCHEMA_OUTDATED',
  'PUBLIC_CONTRACT_FEED_INCONSISTENT', 'PUBLICATION_GRAPH_INCOMPLETE',
])

function uuid(value: unknown): string | null {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null
}

// UUID syntax is only an opaque identifier namespace. It proves no origin,
// tenant ownership or authority. Only a reviewed server caller may supply
// serverRequestId; neither inbound headers nor arbitrary metadata can do so.
export function integrationRequestTelemetryProjection(input: {
  serverRequestId?: string | null
  metadata?: Record<string, unknown>
}): { requestId: string | null; metadata: Record<string, unknown> } {
  const source = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata : {}
  const metadata: Record<string, unknown> = {}
  for (const key of COUNT_KEYS) {
    const value = source[key]
    if (value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) metadata[key] = value
  }
  for (const key of BOOLEAN_KEYS) if (typeof source[key] === 'boolean') metadata[key] = source[key]
  for (const key of UUID_KEYS) {
    const value = uuid(source[key])
    if (value) metadata[key] = value
  }
  for (const [key, values] of Object.entries(ENUM_VALUES)) {
    const value = source[key]
    if (typeof value === 'string' && values.has(value)) metadata[key] = value
  }
  const databaseCode = technicalErrorDiagnostic({ code: source.database_code }).code
  if (source.database_code === null || databaseCode) metadata.database_code = databaseCode
  if (typeof source.error_code === 'string' && KNOWN_ERROR_CODES.has(source.error_code)) metadata.error_code = source.error_code

  const requestId = uuid(input.serverRequestId)
  const reportedId = uuid(source.request_id)
  if (requestId) {
    metadata.request_id = requestId
    metadata.request_id_source = 'server_explicit'
  } else if (reportedId) {
    metadata.request_id = reportedId
    metadata.request_id_source = 'unverified_metadata'
  } else {
    metadata.request_id_source = 'unavailable'
  }
  return { requestId, metadata }
}
