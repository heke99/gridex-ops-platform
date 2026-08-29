const fs = require('fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertContains(path, needles) {
  const content = read(path)
  for (const needle of needles) {
    if (!content.includes(needle)) {
      throw new Error(`${path} saknar: ${needle}`)
    }
  }
}

function assertNotContains(path, needles) {
  const content = read(path)
  for (const needle of needles) {
    if (content.includes(needle)) {
      throw new Error(`${path} innehåller utfasat kontrakt: ${needle}`)
    }
  }
}

assertContains('app/admin/platform/api-clients/page.tsx', [
  'API-klienter för Mina sidor',
  'Gridex hemsida',
  'POST /api/v1/customer-portal/sync',
  '/developers/customer-portal-api',
  'Radera gammal nyckel',
])

assertContains('app/admin/platform/api-clients/actions.ts', [
  'generateIntegrationApiToken',
  'secret_hash',
  'allowed_origins',
  'token_display',
  'api_client.created',
  'deleteIntegrationApiClientAction',
  'api_client.deleted',
])

assertContains('lib/integrations/apiAuth.ts', [
  "request.headers.get('x-api-key')",
  'originAllowed',
  'client.allowed_origins',
  'integration_api_rate_limit_check',
])

assertContains('app/api/v1/customer-portal/sync/route.ts', [
  "requireIntegrationApiAccess(request, ['customer_sync.write'])",
  'insufficient_identity_factors',
  'E-post eller en ensam uppgift räcker inte',
])

assertContains('lib/customer-portal/externalApi.ts', [
  'resolvePortalCustomer',
  'customerPortalJson',
  "Cache-Control', 'no-store",
])
assertContains('lib/customer-portal/customerResolver.ts', [
  ".eq('status', 'active')",
])

for (const path of [
  'app/api/v1/customer/contracts/route.ts',
  'app/api/v1/customer/invoices/route.ts',
  'app/api/v1/customer/invoices/[id]/route.ts',
  'app/api/v1/customer/sites/route.ts',
  'app/api/v1/customer/metering-values/route.ts',
  'app/api/v1/customer/documents/route.ts',
  'app/api/v1/customer/profile-update/route.ts',
  'app/api/v1/customer/move-out/route.ts',
]) {
  assertContains(path, ['requireCustomerPortalApiContext', 'customerPortalJson'])
}

assertContains('app/api/v1/customer/metering-values/route.ts', [
  "from('normalized_metering_values')",
  ".eq('company_id', context.client.company_id)",
  ".eq('customer_id', context.identity.customer_id)",
  "optionalParam(request, 'from')",
  "optionalParam(request, 'to')",
  "optionalParam(request, 'facility_id')",
  "source_table: 'normalized_metering_values'",
  'quantity_kwh',
  'quality_status',
  'source_type',
])

assertContains('supabase/migrations/20260609143000_batch_6_api_clients_customer_portal.sql', [
  'customer_portal_identities',
  'customer_portal_api_access_logs',
  'customer_portal_identities_external_uidx',
])

assertContains('docs/gridex-customer-portal-api.md', [
  'OPS är master för kund',
  'aldrig skicka ett fritt `company_id`',
  'Kundresolvern måste länka portalidentiteten till rätt `company_id`',
  '/developers/customer-portal-api',
])

assertContains('docs/external-website-api-integration-guide.md', [
  '/developers/customer-portal-api',
  'Frontend får aldrig anropa OPS direkt med API-nyckel',
  'aldrig skicka ett fritt `company_id`',
  'external_customer_id',
])

// Phase 5 supersedes the old support_out_of_scope policy. Support/case events
// stay on the already-published customer-event APIs and project into canonical
// customer_cases with tenant identity and idempotency preserved.
for (const path of [
  'app/api/v1/events/route.ts',
  'app/api/v1/website/customer-events/route.ts',
]) {
  assertContains(path, [
    'isSupportEvent',
    'createSupportCaseFromCustomerEvent',
    'recordWebsiteCustomerEvent',
  ])
  assertNotContains(path, ['support_out_of_scope'])
}
assertContains('lib/customer-portal/customerEvents.ts', [
  "^customer\\.(support|case)(?:_|$)",
])
assertContains('lib/customer-cases/support.ts', [
  "from('customer_cases')",
  "support_idempotency_key",
  "createCustomerCase({",
])

assertContains('app/developers/customer-portal-api/page.tsx', [
  'Website API, Mina sidor-koppling',
  'WEBSITE_INTEGRATION_BASE_URL',
  'Authorization: Bearer',
])
assertContains('lib/integrations/websiteIntegrationContract.ts', [
  "WEBSITE_INTEGRATION_ORIGIN = 'https://app.gridex.se'",
  "WEBSITE_INTEGRATION_BASE_PATH = '/api/v1'",
])

assertContains('scripts/customer-portal-live-test.sh', [
  'OPS_API_BASE_URL',
  'EXTERNAL_CUSTOMER_ID',
  '/developers/customer-portal-api',
  '/api/v1/customer/metering-values',
])

console.log('Gridex Batch 6 API-client/customer-portal regression passed.')
