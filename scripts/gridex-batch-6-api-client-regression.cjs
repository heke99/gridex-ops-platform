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

assertContains('app/admin/platform/api-clients/page.tsx', [
  'API-klienter för Mina sidor',
  'Gridex hemsida',
  'POST /api/v1/customer-portal/sync',
])

assertContains('app/admin/platform/api-clients/actions.ts', [
  'generateIntegrationApiToken',
  'secret_hash',
  'allowed_origins',
  'token_display',
  'api_client.created',
])

assertContains('lib/integrations/apiAuth.ts', [
  "request.headers.get('x-api-key')",
  'originAllowed',
  'client.allowed_origins',
  'rateLimitAllowed',
])

assertContains('app/api/v1/customer-portal/sync/route.ts', [
  'customer_portal.write',
  'insufficient_identity_factors',
  'E-post eller en ensam uppgift räcker inte',
  "dbStatus: 'active'",
  "matchStrength: 'manual'",
])


assertContains('lib/customer-portal/externalApi.ts', [
  ".eq('status', 'active')",
  'customerPortalJson',
  "Cache-Control', 'no-store",
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
  'app/api/v1/customer/support-case/route.ts',
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
  'Gridex Ops Platform är source of truth',
  'Email ensam ger aldrig',
  'Cache-Control: no-store',
  'route,',
  "metadata ->> 'result_count'",
])

console.log('Gridex Batch 6 API-client/customer-portal regression passed.')
