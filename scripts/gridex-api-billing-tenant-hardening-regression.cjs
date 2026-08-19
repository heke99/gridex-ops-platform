#!/usr/bin/env node
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { currentContractVersion } = require('./lib/current-api-contract.cjs')

const root = process.cwd()
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), 'utf8')

const tenantContext = read('lib/integrations/tenantContext.ts')
const integrationContextRoute = read(
  'app/api/v1/integration/context/route.ts',
)
const projectionStart = tenantContext.indexOf(
  'export function projectPublicExternalTenantContext',
)
const projectionEnd = tenantContext.indexOf(
  'export async function loadExternalTenantReference',
  projectionStart,
)
assert.ok(projectionStart >= 0 && projectionEnd > projectionStart)
const projection = tenantContext.slice(projectionStart, projectionEnd)
assert.match(integrationContextRoute, /projectPublicExternalTenantContext\(/)
for (const internalField of [
  'portal_identity_required',
  'portal_url',
  'webhook_delivery_ready',
  'status_delivery_modes',
  'blockers',
  'warnings',
  'checks',
  'tenant_reference',
  'complete_tenant_website_ready:',
]) {
  assert.doesNotMatch(
    projection,
    new RegExp(internalField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `public integration context leaks ${internalField}`,
  )
}
assert.match(tenantContext, /complete_tenant_website_ready:\s*boolean/)
assert.match(
  projection,
  /complete_integration_ready:\s*context\.capabilities\.complete_tenant_website_ready/,
)

const website = JSON.parse(
  read('docs/openapi/website-integration-v1.json'),
)
assert.equal(website.info.version, currentContractVersion)
const capabilitySchema =
  website.components.schemas.IntegrationContext.properties.capabilities
for (const field of [
  'website_checkout_ready',
  'customer_portal_ready',
  'complete_integration_ready',
  'required_website_scopes',
  'missing_website_scopes',
  'required_customer_portal_scopes',
  'missing_customer_portal_scopes',
  'recommended_scopes',
  'missing_recommended_scopes',
]) {
  assert.ok(capabilitySchema.properties[field], `OpenAPI missing ${field}`)
  assert.match(projection, new RegExp(`${field}\\s*:`))
}
for (const internalField of [
  'complete_tenant_website_ready',
  'portal_identity_required',
  'portal_url',
  'webhook_delivery_ready',
  'status_delivery_modes',
  'blockers',
  'warnings',
  'checks',
]) {
  assert.ok(
    !capabilitySchema.properties[internalField],
    `OpenAPI leaks internal capability ${internalField}`,
  )
}

const partnerInvoices = read('lib/customer-portal/partnerInvoices.ts')
for (const required of [
  'company_id: companyId',
  ".eq('company_id', input.companyId)",
  'vat_amount: vatAmount',
  'amount_inc_vat: amountIncVat',
  "status === 'failed'",
  "onConflict: 'company_id,partner_invoice_reference'",
]) {
  assert.ok(
    partnerInvoices.includes(required),
    `partner invoice runtime missing ${required}`,
  )
}

const migrationName =
  '20260805085617_api_contract_billing_tenant_hardening.sql'
const migration = read(`supabase/migrations/${migrationName}`)
for (const required of [
  'customer_invoice_lines alter column company_id set not null',
  'customer_invoices_company_partner_reference_key',
  'customer_invoice_lines_company_invoice_fkey',
  'billing_underlay_items_company_underlay_fkey',
  'contract_charge_ledger_company_invoice_fkey',
  'integration_api_write_idempotency_company_client_fkey',
  'website_contract_quotes_company_client_fkey',
  'customer_contracts_billing_identity_check',
  'customer_invoice_lines_amount_consistency_check',
  'from public, anon',
]) {
  assert.ok(migration.includes(required), `hardening migration missing ${required}`)
}
const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
const checksum = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'supabase/migrations', migrationName)))
  .digest('hex')
assert.equal(manifest.files?.[migrationName], checksum)

const repair = read('scripts/repair-verified-migration-history-20260805.sql')
for (const version of [
  '20260804003000',
  '20260804093500',
  '20260804121000',
  '20260804151500',
  '20260804173000',
]) {
  assert.ok(repair.includes(version), `history repair missing ${version}`)
}
assert.match(repair, /history_repair_preflight_failed/)

console.log(
  `API context and billing tenant hardening regression passed (${currentContractVersion}).`,
)
