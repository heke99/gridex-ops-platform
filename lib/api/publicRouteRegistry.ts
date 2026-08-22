export type PublicApiRouteContract = {
  method: 'GET' | 'POST'
  path: string
  publicPath?: string
  scopes: string[]
  description: string
  idempotencyRequired?: boolean
  rateLimitClass: 'read' | 'write' | 'expensive'
  operationId: string
  responseSchema: string
  scopeMode: 'all' | 'any'
  cachePolicy: 'no-store' | 'private-revalidate' | 'public-immutable'
  publicIdPolicy: 'none' | 'opaque-references'
}

type PublicApiRouteDefinition = Omit<
  PublicApiRouteContract,
  'operationId' | 'responseSchema' | 'scopeMode' | 'cachePolicy' | 'publicIdPolicy'
>

/** Canonical granular scope set used by both customer-portal bundle entries. */
const CUSTOMER_PORTAL_READ_SCOPES = [
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
] as const

/** Canonical source for the public V1 endpoint catalogue and developer documentation. */
const RAW_PUBLIC_API_ROUTES: PublicApiRouteDefinition[] = [
  { method: 'GET', path: '/api/v1/openapi/release-manifest.json', scopes: [], description: 'Machine-readable release manifest containing versions and SHA-256 digests for the public OpenAPI contracts.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/website-integration-v1.json', scopes: [], description: 'Current OpenAPI specification for website integrations.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-02.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-02.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-02.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-02.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-03.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-03.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-03.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-03.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-04.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-04.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-04.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-04.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.3/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-04.3.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.3/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-04.3.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-05.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-05.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-05.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-05.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-10.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-10.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-10.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-10.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-14.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-14.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-14.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-14.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-19.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-19.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-19.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-19.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-19.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-19.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-19.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-19.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-20.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-20.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-20.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-22.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-22.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-22.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-22.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/customer-portal-v1.json', scopes: [], description: 'Current OpenAPI specification for customer portal integrations.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/integration/context', scopes: ['integration_context.read'], description: 'Verify the authenticated API client and retrieve its public integration context.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/public-contracts', scopes: ['api_contracts.read'], description: 'Retrieve contracts published to the general API channel.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/public-contracts/diagnostics', scopes: ['api_contracts.diagnostics'], description: 'Retrieve publication diagnostics for the authenticated organization.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/contracts', scopes: ['api_contracts.read'], description: 'Deprecated compatibility alias for the public contracts feed.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/public-contracts', scopes: ['website_contracts.read'], description: 'Retrieve published electricity offers with complete pricing inputs and display rules.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/public-contracts/diagnostics', scopes: ['website_contracts.diagnostics'], description: 'Retrieve publication diagnostics for website offers.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/portfolio-prices', scopes: ['website_contracts.read'], description: 'Retrieve the public pricing method and sanitized historical final settlements for a published portfolio offer.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/market-price/current', scopes: ['website_market_prices.read'], description: 'Retrieve the current normalized market price for a Swedish price area.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/quote', scopes: ['website_quotes.write'], description: 'Create an authoritative checkout quote from a published offer. Fixed products lock the energy price; market, portfolio and mixed products return indicative checkout evidence for the accepted pricing model.', idempotencyRequired: true, rateLimitClass: 'expensive' },
  { method: 'POST', path: '/api/v1/website/quote/validate', scopes: ['website_quotes.validate'], description: 'Validate the immutable accepted quote and commercial identity. Elapsed wall-clock time alone does not invalidate an issued website quote.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/energy-area/resolve', scopes: ['website_energy_area.resolve'], description: 'Resolve the Swedish price area (SE1-SE4) for the supplied address or postal code.', rateLimitClass: 'expensive' },
  { method: 'GET', path: '/api/v1/website/switch-status', scopes: ['website_switch_status.read'], description: 'Retrieve the current supplier-switch status using the public application number.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/legal-bundle', scopes: ['website_legal.read', 'website_contracts.read'], description: 'Retrieve the exact published legal documents and versions required for customer acceptance.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/customer-applications', scopes: ['website_applications.write'], description: 'Submit a customer application with the exact accepted offer, quote, legal evidence and customer data.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/website/customer-applications/[applicationId]', publicPath: '/api/v1/website/customer-applications/[application_number]', scopes: ['website_switch_status.read'], description: 'Retrieve the authoritative status of an accepted customer application and its downstream processing.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/customer-events', scopes: ['website_events.write'], description: 'Submit a customer event from a website or customer portal.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/events', scopes: ['website_events.write'], description: 'Submit a customer-facing integration event.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/events', scopes: ['events.read'], description: 'Retrieve domain events available to the authenticated organization.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/portal-bundle', scopes: [...CUSTOMER_PORTAL_READ_SCOPES], description: 'Retrieve the combined customer portal read model for a verified customer identity.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer/portal-bundle', scopes: [...CUSTOMER_PORTAL_READ_SCOPES], description: 'Retrieve the combined customer portal read model for a verified customer identity.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer-portal/sync', scopes: ['customer_sync.write'], description: 'Link or verify an external customer portal identity.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/sync', scopes: ['customer_sync.write'], description: 'Submit customer data required to complete an existing customer record or process.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/customer/me', scopes: ['customer_profile.read'], description: 'Retrieve the linked customer profile.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/contracts', scopes: ['customer_contracts.read'], description: 'Retrieve the customer’s electricity contracts.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/sites', scopes: ['customer_sites.read'], description: 'Retrieve the customer’s electricity sites.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/invoices', scopes: ['customer_invoices.read'], description: 'Retrieve the customer’s invoices.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/invoices/[id]', scopes: ['customer_invoices.read'], description: 'Retrieve a single customer invoice.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/metering-values', scopes: ['customer_metering.read'], description: 'Retrieve metering values available to the customer.', rateLimitClass: 'expensive' },
  { method: 'GET', path: '/api/v1/customer/events', scopes: ['customer_events.read'], description: 'Retrieve customer-visible events.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/documents', scopes: ['customer_documents.read'], description: 'Retrieve customer documents without exposing internal storage paths.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/legal-acceptances', scopes: ['customer_legal.read'], description: 'Retrieve the customer’s recorded legal acceptances.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/powers-of-attorney', scopes: ['customer_power_of_attorney.read'], description: 'Retrieve the customer’s powers of attorney.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/notifications', scopes: ['customer_notifications.read'], description: 'Retrieve customer notifications.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer/notifications/read', scopes: ['customer_notifications.write'], description: 'Mark customer notifications as read.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/profile-update', scopes: ['customer_contact.write', 'customer_facility_data.write'], description: 'Submit a customer contact or site-address update.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/move-out', scopes: ['customer_facility_data.write'], description: 'Submit a customer move-out request.', idempotencyRequired: true, rateLimitClass: 'write' },
]

function operationIdFor(route: PublicApiRouteDefinition): string {
  const path = route.publicPath ?? route.path
  const suffix = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment
      .replace(/^\[|\]$/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(''))
    .join('')
  return `${route.method.toLowerCase()}${suffix}`
}

function scopeModeFor(route: PublicApiRouteDefinition): 'all' | 'any' {
  return [
    '/api/v1/website/legal-bundle',
    '/api/v1/customer/profile-update',
  ].includes(route.path) ? 'any' : 'all'
}

function cachePolicyFor(route: PublicApiRouteDefinition): PublicApiRouteContract['cachePolicy'] {
  if (route.path.includes('/openapi/')) return route.path.includes('/2026-') ? 'public-immutable' : 'private-revalidate'
  return 'no-store'
}

export const PUBLIC_API_ROUTES: PublicApiRouteContract[] = RAW_PUBLIC_API_ROUTES.map((route) => {
  const operationId = operationIdFor(route)
  return {
    ...route,
    operationId,
    responseSchema: `${operationId}Response`,
    scopeMode: scopeModeFor(route),
    cachePolicy: cachePolicyFor(route),
    publicIdPolicy: route.path.includes('/openapi/') ? 'none' : 'opaque-references',
  }
})

export function publicRouteContract(method: string, pathname: string): PublicApiRouteContract | null {
  const segments = pathname.split('/').filter(Boolean)
  return PUBLIC_API_ROUTES.find((route) => {
    if (route.method !== method.toUpperCase()) return false
    const template = route.path.split('/').filter(Boolean)
    return template.length === segments.length && template.every((part, index) =>
      /^\[[^\]]+\]$/.test(part) || part === segments[index])
  }) ?? null
}

export function publicRouteCost(method: string, pathname: string): number {
  const rateLimitClass = publicRouteContract(method, pathname)?.rateLimitClass ?? 'expensive'
  return { read: 1, write: 3, expensive: 10 }[rateLimitClass]
}

export const PUBLIC_API_ENDPOINT_ROWS = PUBLIC_API_ROUTES.map((route) => [
  route.method,
  route.publicPath ?? route.path,
  // scopeMode=all means every listed scope is required (AND). scopeMode=any
  // means one of the listed scopes is enough (OR). Developer docs must match.
  route.scopes.join(route.scopeMode === 'any' ? ' OR ' : ' AND '),
  `${route.description}${route.idempotencyRequired ? ' Idempotency-Key is required.' : ''}`,
] as const)
