#!/usr/bin/env bash
set -euo pipefail

# Read-only positive probes: prove the reviewed source still contains the cited
# broken path before relying on the guarded desired-behavior regressions below.
node <<'NODE'
const fs = require('node:fs')
const assert = require('node:assert/strict')
const read = (path) => fs.readFileSync(path, 'utf8')

const apiData = read('lib/customer-portal/apiData.ts')
assert.match(apiData, /return \[\]/, 'line 192 should expose the false-empty branch for BUG-003')
assert.match(apiData, /\.limit\(100\)/, 'line 203 should expose the pre-pagination cap for BUG-001')

const invoiceRoute = read('app/api/v1/customer/invoices/[id]/route.ts')
assert.match(invoiceRoute, /listPortalInvoices/, 'invoice route lines 27-48 should expose BUG-002')

const tenantContext = read('lib/integrations/tenantContext.ts')
assert.match(tenantContext, /client\.id\.replaceAll\('-', ''\)/, 'tenantContext should expose BUG-004')

const idempotency = read('lib/integrations/writeIdempotency.ts')
assert.match(idempotency, /best effort/i, 'idempotency completion lines 173-225 should expose BUG-005')

const portalSpec = JSON.parse(read('docs/openapi/customer-portal-v1.json'))
assert.equal(portalSpec.paths['/api/v1/customer/invoices/{id}'].get.operationId, 'getApiV1CustomerInvoicesId}', 'OpenAPI line 1479 should expose BUG-006')

const facade = read('lib/website/customerApplications.ts')
const process = read('lib/website/customerApplicationProcess.ts')
assert.ok(!facade.includes('price_option_reference_required') && process.includes('price_option_reference_required'), 'facade line 1 versus process line 95 proves BUG-007')

assert.ok(!fs.existsSync('supabase/migrations/20260809182215_authenticate_integration_request_v1.sql'), 'missing official ledger file proves BUG-008')

const webhooks = read('lib/integrations/webhooks.ts')
assert.match(webhooks, /sanitizeWebhookData/, 'webhook blacklist lines 92-114 should expose BUG-009')
assert.match(webhooks, /WEBHOOK_SIGNING_SECRET_FALLBACK/, 'secret fallback line 61 should expose BUG-009')

const auth = read('lib/integrations/apiAuth.ts')
assert.ok(!auth.includes("rpc('authenticate_integration_request_v1'"), 'apiAuth lines 355-460 should expose BUG-010')

const externalApi = read('lib/customer-portal/externalApi.ts')
assert.ok(!externalApi.includes('assertSafePublicPayload'), 'externalApi lines 31-108 should expose BUG-011')

const contracts = read('lib/website/publicContracts.ts')
assert.match(contracts, /\.select\(['"]\*['"]\)/, 'publicContracts lines 2325-2605 should expose BUG-012')

const resolver = read('lib/customer-portal/customerResolver.ts')
assert.ok(!resolver.includes("rpc('resolve_portal_customer_identity_v1'"), 'customerResolver lines 118-348 should expose BUG-013')

const profile = read('supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql')
assert.match(profile, /'customer_portal\.read'/, 'profile line 52 should expose BUG-014')
console.log('PASS: 14 cited broken paths extracted from current source')
NODE

npx vitest run --config quality/vitest.config.ts quality/test_regression.test.ts --reporter=dot
node quality/mechanical/verify_compensation.mjs
