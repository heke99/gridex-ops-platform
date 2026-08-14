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

/** Canonical granular scope set used by both portal-bundle documentation entries. */
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

/** Canonical source for the public V1 endpoint catalogue and documentation. */
const RAW_PUBLIC_API_ROUTES: PublicApiRouteDefinition[] = [
  { method: 'GET', path: '/api/v1/openapi/release-manifest.json', scopes: [], description: 'Maskinläsbart release-manifest med versioner och SHA-256 för båda publika OpenAPI-kontrakten.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/website-integration-v1.json', scopes: [], description: 'Publik versionerad OpenAPI-specifikation för tenantens websiteintegration.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-02.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-02.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-02.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-02.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-03.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-03.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-03.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-03.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-04.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-04.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-04.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-04.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.3/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-04.3.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-04.3/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-04.3.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-05.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-05.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-05.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-05.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-05.2.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-10.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-10.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-10.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-10.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-14.1/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI för release 2026-08-14.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/2026-08-14.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI för release 2026-08-14.1.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/openapi/customer-portal-v1.json', scopes: [], description: 'Publik versionerad OpenAPI-specifikation för kundportalen.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/integration/context', scopes: ['integration_context.read'], description: 'Verifiera opak tenantreferens för den autentiserade API-nyckeln.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/public-contracts', scopes: ['api_contracts.read'], description: 'Canonical feed för avtal som tenant har publicerat till API-kanalen.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/public-contracts/diagnostics', scopes: ['api_contracts.diagnostics'], description: 'Tenant-skopad diagnostik för API-kanalens publiceringsgraf.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/contracts', scopes: ['api_contracts.read'], description: 'Deprecated kompatibilitetsalias för API-kanalens public contracts-feed.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/public-contracts', scopes: ['website_contracts.read'], description: 'Hämta publicerade avtal med komplett beräkningsunderlag och separata visningsregler.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/public-contracts/diagnostics', scopes: ['website_contracts.diagnostics'], description: 'Hämta tenant-skopad diagnostik för publiceringsgrafen.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/portfolio-prices', scopes: ['website_contracts.read'], description: 'Hämta publik metod och sanerade historiska finala avräkningar för ett publicerat portföljavtal. Inga marknadsindikationer eller interna versions-ID:n exponeras.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/market-price/current', scopes: ['website_market_prices.read'], description: 'Hämta aktuellt normaliserat spotpris för elområdet i en tenantbunden OPS-resolution.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/quote', scopes: ['website_quotes.write'], description: 'Skapa en tenantbunden canonical prisquote från exakt publicerad avtalsversion och valt SE-område.', idempotencyRequired: true, rateLimitClass: 'expensive' },
  { method: 'POST', path: '/api/v1/website/quote/validate', scopes: ['website_quotes.validate'], description: 'Validera att quote_reference fortfarande matchar tenant, offer, kundtyp, SE-område, förbrukning och startdatum.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/energy-area/resolve', scopes: ['website_energy_area.resolve'], description: 'Lös SE1–SE4 med separat price-area assurance; nätområde, nätägare och EDIFACT har egna readiness-krav.', rateLimitClass: 'expensive' },
  { method: 'GET', path: '/api/v1/website/switch-status', scopes: ['website_switch_status.read'], description: 'Läs aktuell leverantörsbytesstatus via tenantens application_number.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/legal-bundle', scopes: ['website_legal.read', 'website_contracts.read'], description: 'Hämta publicerade juridikversioner och länkar. Ett av angivna scopes räcker.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/customer-applications', scopes: ['website_applications.write'], description: 'Skapa kundansökan och juridiska godkännanden.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/website/customer-applications/[applicationId]', publicPath: '/api/v1/website/customer-applications/[application_number]', scopes: ['website_switch_status.read'], description: 'Läs tenant-skopad status för en accepterad kundansökan och OPS fortsatta automation.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/customer-events', scopes: ['website_events.write'], description: 'Skicka kundhändelse från hemsida eller kundportal.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/events', scopes: ['website_events.write'], description: 'Skicka kundhändelse.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/events', scopes: ['events.read'], description: 'Läs bolagets domänhändelser.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/portal-bundle', scopes: [...CUSTOMER_PORTAL_READ_SCOPES], description: 'Hämta kundportalens samlade läsmodell med verifierad portalidentitet.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer/portal-bundle', scopes: [...CUSTOMER_PORTAL_READ_SCOPES], description: 'Hämta kundportalens samlade läsmodell med verifierad portalidentitet.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer-portal/sync', scopes: ['customer_sync.write'], description: 'Länka eller granska extern portalidentitet.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/sync', scopes: ['customer_sync.write'], description: 'Synka kundkompletteringar till OPS.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/customer/me', scopes: ['customer_profile.read'], description: 'Hämta länkad kundprofil.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/contracts', scopes: ['customer_contracts.read'], description: 'Hämta kundens avtal.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/sites', scopes: ['customer_sites.read'], description: 'Hämta kundens anläggningar.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/invoices', scopes: ['customer_invoices.read'], description: 'Hämta kundens fakturor.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/invoices/[id]', scopes: ['customer_invoices.read'], description: 'Hämta en faktura.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/metering-values', scopes: ['customer_metering.read'], description: 'Hämta kundens mätvärden.', rateLimitClass: 'expensive' },
  { method: 'GET', path: '/api/v1/customer/events', scopes: ['customer_events.read'], description: 'Hämta kundens händelser.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/documents', scopes: ['customer_documents.read'], description: 'Hämta kundens dokument utan interna lagringsvägar.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/legal-acceptances', scopes: ['customer_legal.read'], description: 'Hämta kundens juridiska godkännanden.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/powers-of-attorney', scopes: ['customer_power_of_attorney.read'], description: 'Hämta kundens fullmakter.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/notifications', scopes: ['customer_notifications.read'], description: 'Hämta kundens notiser.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer/notifications/read', scopes: ['customer_notifications.write'], description: 'Markera kundnotiser som lästa.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/profile-update', scopes: ['customer_contact.write', 'customer_facility_data.write'], description: 'Skicka profil- eller anläggningsadressändring.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/customer/move-out', scopes: ['customer_facility_data.write'], description: 'Skicka flyttanmälan.', idempotencyRequired: true, rateLimitClass: 'write' },
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
  route.scopes.join(route.scopeMode === 'any' ? ' eller ' : ' och '),
  `${route.description}${route.idempotencyRequired ? ' Idempotency-Key krävs.' : ''}`,
] as const)
