#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) throw new Error(`Missing file: ${rel}`)
  return fs.readFileSync(full, 'utf8')
}
function assertIncludes(rel, needles) {
  const text = read(rel)
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${rel} missing expected text: ${needle}`)
  }
}

assertIncludes('supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql', [
  'company_customer_number_sequences',
  'gridex_next_customer_number',
  'website_customer_applications',
  'billing_partner_customers',
  'billing_disputes',
  'webhook_subscriptions',
  'customer_number',
])

assertIncludes('app/api/v1/website/customer-applications/route.ts', [
  "requireIntegrationApiAccess(request, ['website_applications.write'])",
  'processWebsiteCustomerApplication',
  'customerPortalJson',
])

assertIncludes('lib/website/customerApplications.ts', [
  'reserveCustomerNumber',
  'upsertPortalIdentity',
  'website_customer_applications',
  'contract.application_received',
  'contract.cooling_off_sent',
  'emitDomainEvent',
])

assertIncludes('lib/events/domainEvents.ts', [
  'enqueueWebhookDeliveriesForEvent',
])

assertIncludes('lib/integrations/webhooks.ts', [
  'x-gridex-webhook-signature',
  'customer_number',
  'external_customer_id',
])

assertIncludes('app/api/internal/webhooks/dispatch/route.ts', [
  'dispatchDueWebhookDeliveries',
  'GRIDEX_CRON_SECRET',
])

assertIncludes('lib/integrations/apiClientScopes.ts', [
  'website_applications.write',
])

assertIncludes('app/developers/customer-portal-api/page.tsx', [
  '/api/v1/website/customer-applications',
  'Webhooks',
  'customer_number',
  'Capway',
  'contract.cooling_off_sent',
])

assertIncludes('docs/external-website-api-integration-guide.md', [
  'POST /api/v1/website/customer-applications',
  'webhooks',
  'customer_number',
  'Capway',
  'debtRow amount = belopp exkl. moms',
])

console.log('Gridex Batch 7 website foundation regression OK')
