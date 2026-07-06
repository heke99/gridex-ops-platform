#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }

const unit = read('lib/pricing/unitConversion.ts')
const calculator = read('lib/pricing/priceComponentCalculator.ts')
const billingWebhook = read('lib/billing/providerWebhooks.ts')
// externalSync.ts was removed (dead legacy path); the live portal identity
// linking is customerResolver.ts.
const portalSync = read('lib/customer-portal/customerResolver.ts')
const edielDecision = read('lib/ediel/inboundBusinessDecision.ts')
const cleanupActions = read('app/admin/ediel/actions.ts')
const migration = read('supabase/migrations/20260608170000_batch_1_9_operations_integration_foundation.sql')
const docs = read('docs/gridex-batch-1-to-9-implementation.md')

assert(unit.includes('ore_per_kwh') && unit.includes('component.amount / 100'), 'Batch 1 unit conversion must support öre/kWh')
assert(calculator.includes('sekPerKwhFromComponent(component)'), 'Batch 1 calculator must use unit helper')
assert(migration.includes('billing_provider_webhook_events'), 'Batch 5 provider webhook table missing')
assert(billingWebhook.includes('receiveBillingProviderWebhook'), 'Batch 5 provider webhook receiver missing')
assert(migration.includes('tenant_customer_sync_requests'), 'Batch 6 portal sync request table missing')
assert(portalSync.includes('customer_portal_identities'), 'Batch 6 customer portal identity linking missing')
assert(migration.includes('company_dashboard_snapshots'), 'Batch 7 dashboard snapshot table missing')
assert(edielDecision.includes('recordInboundBusinessDecision'), 'Batch 4 inbound business decision logging missing')
assert(cleanupActions.includes('RADERA TESTDATA'), 'Batch 9 cleanup confirmation missing')
assert(docs.includes('Batch 1') && docs.includes('Batch 9'), 'Batch 1-9 documentation missing')

console.log('gridex-batch-1-9-regression: OK')
