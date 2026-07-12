/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const failures = []

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const vercel = JSON.parse(read('vercel.json'))
const cronPaths = new Set((vercel.crons ?? []).map((entry) => entry.path))
assert(cronPaths.has('/api/cron/billing/monthly?send_to_partner=true'), 'Monthly billing cron must explicitly send to the provider.')
assert(cronPaths.has('/api/cron/reconciliation/end-to-end'), 'End-to-end reconciliation cron is missing.')

const monthlyRoute = read('app/api/cron/billing/monthly/route.ts')
assert(monthlyRoute.includes("dedicatedSecretEnv: 'BILLING_AUTOMATION_CRON_SECRET'"), 'Billing cron lacks dedicated manual secret support.')
assert(monthlyRoute.includes('authorizeScheduledRequest'), 'Billing cron must accept the scheduler authorization contract.')

const manualWebhook = read('app/api/webhooks/manual-inbound/route.ts')
assert(!manualWebhook.includes('CRON_SECRET'), 'Manual inbound webhook must not accept the shared cron secret.')
for (const token of ['MANUAL_INBOUND_WEBHOOK_SECRET', 'x-manual-inbound-timestamp', 'timingSafeEqual', 'MAX_BODY_BYTES']) {
  assert(manualWebhook.includes(token), `Manual inbound webhook is missing ${token}.`)
}

const apiRoot = path.join(root, 'app', 'api', 'v1')
for (const file of walk(apiRoot).filter((file) => file.endsWith(`${path.sep}route.ts`))) {
  const source = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file)
  assert(!source.includes('request.json()'), `${rel} bypasses bounded/strict JSON parsing.`)
  assert(!source.includes("'customer_portal.read'"), `${rel} still uses the broad legacy read scope.`)
  assert(!source.includes("'customer_portal.write'"), `${rel} still uses the broad legacy write scope.`)
}

const resolver = read('lib/energy/resolver.ts')
assert(!resolver.includes('existingGridOwnerId ??'), 'Resolver still preserves stale grid-owner identity over a new verified result.')
assert(resolver.includes('automationAllowed'), 'Resolver no longer exposes an explicit automation gate.')

const facilityLookup = read('lib/customer-operations/facilityLookupAutomation.ts')
assert(!facilityLookup.includes("GRIDEX_FACILITY_LOOKUP_CHANNEL"), 'Missing-facility automation still has a selectable EDIEL channel.')
assert(facilityLookup.includes('requestMissingFacilityInformation'), 'Missing-facility automation must use the manual grid-owner workflow.')
assert(facilityLookup.includes("manual.channel ?? 'manual_email'"), 'Missing-facility automation must resolve to the manual email channel.')

const underlay = read('lib/billing/underlayEngine.ts')
for (const token of ['normalized_metering_values', 'customer_supply_periods', 'validateCoverage', 'gridex_store_billing_underlay']) {
  assert(underlay.includes(token), `Canonical underlay engine is missing ${token}.`)
}
assert(!underlay.includes('.limit(20000)'), 'Underlay engine still silently truncates at 20,000 rows.')

const exportCore = read('lib/integrations/billing/invoiceExportCore.ts')
for (const token of ['provider_invoice_guid', 'idempotencyKey', 'assertOutboundAllowed', 'acquireAutomationLock', 'releaseAutomationLock']) {
  assert(exportCore.includes(token), `Invoice export core is missing ${token}.`)
}

const capwayClient = read('lib/integrations/billing/capway/client.ts')
assert(capwayClient.includes('Idempotency-Key'), 'Capway requests do not transmit a provider idempotency key.')
assert(capwayClient.includes('AbortController'), 'Capway requests do not have a hard timeout.')

const genericExport = read('lib/billing/exportCenter.ts')
assert(!genericExport.includes('endpoints[0]'), 'Generic export can still fall back to the first provider endpoint.')
assert(genericExport.includes('assertOutboundAllowed'), 'Generic export bypasses the outbound freeze gate.')

const providerWebhook = read('lib/billing/providerWebhooks.ts')
for (const token of ['companyId', 'environment', 'timestamp', 'idempotency']) {
  assert(providerWebhook.toLowerCase().includes(token.toLowerCase()), `Provider webhook is missing ${token} binding.`)
}

const migration = read('supabase/migrations/20260712100000_gridex_end_to_end_integrity_hardening.sql')
for (const token of [
  'platform_schema_state',
  'gridex_ingest_metering_value',
  'gridex_store_billing_underlay',
  'customer_contracts_company_site_alias_fkey',
  'normalized_metering_values_company_meter_fkey',
  'customer_invoices_company_underlay_fkey',
  'gridex_claim_invoice_provider_events',
  'platform_reconciliation_findings',
  'platform_outbound_state',
]) assert(migration.includes(token), `Integrity migration is missing ${token}.`)
assert(migration.trimEnd().endsWith("on conflict(id) do update set current_version=excluded.current_version,is_ready=true,blocking_issues='[]'::jsonb,verified_at=now(),updated_at=now();"), 'Schema compatibility marker must be the final migration statement.')

if (failures.length) {
  console.error(`Gridex hardening audit failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Gridex hardening static audit passed.')
