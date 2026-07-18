export type PublicApiRouteContract = {
  method: 'GET' | 'POST'
  path: string
  scopes: string[]
  description: string
  idempotencyRequired?: boolean
  rateLimitClass: 'read' | 'write' | 'expensive'
}

/** Canonical source for the public V1 endpoint catalogue and documentation. */
export const PUBLIC_API_ROUTES: PublicApiRouteContract[] = [
  { method: 'GET', path: '/api/v1/website/public-contracts', scopes: ['website_contracts.read'], description: 'Hämta publicerade avtal som hemsidan får visa.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/website/portfolio-prices', scopes: ['website_contracts.read'], description: 'Hämta metod, historiska finala avräkningar och uttryckligt icke-bindande indikationer för ett publicerat portföljavtal.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/quote', scopes: ['website_contracts.read'], description: 'Beräkna pris för ett publicerat erbjudande.', rateLimitClass: 'expensive' },
  { method: 'GET', path: '/api/v1/website/legal-bundle', scopes: ['website_legal.read', 'website_contracts.read'], description: 'Hämta publicerade juridikversioner och länkar. Ett av angivna scopes räcker.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/website/customer-applications', scopes: ['website_applications.write'], description: 'Skapa kundansökan och juridiska godkännanden.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/website/customer-events', scopes: ['website_events.write'], description: 'Skicka kundhändelse från hemsida eller kundportal.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'POST', path: '/api/v1/events', scopes: ['website_events.write'], description: 'Skicka kundhändelse.', idempotencyRequired: true, rateLimitClass: 'write' },
  { method: 'GET', path: '/api/v1/events', scopes: ['events.read'], description: 'Läs bolagets domänhändelser.', rateLimitClass: 'read' },
  { method: 'GET', path: '/api/v1/customer/portal-bundle', scopes: ['customer_portal.read'], description: 'Hämta kundportalens samlade läsmodell med verifierad portalidentitet.', rateLimitClass: 'read' },
  { method: 'POST', path: '/api/v1/customer/portal-bundle', scopes: ['customer_portal.read'], description: 'Hämta kundportalens samlade läsmodell med verifierad portalidentitet.', rateLimitClass: 'read' },
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

export const PUBLIC_API_ENDPOINT_ROWS = PUBLIC_API_ROUTES.map((route) => [
  route.method,
  route.path,
  route.scopes.join(' eller '),
  `${route.description}${route.idempotencyRequired ? ' Idempotency-Key krävs.' : ''}`,
] as const)
