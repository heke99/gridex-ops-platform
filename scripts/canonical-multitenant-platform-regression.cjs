const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
let failures = 0
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function ok(condition, message) {
  if (condition) console.log(`PASS ${message}`)
  else { failures += 1; console.error(`FAIL ${message}`) }
}

const context = read('lib/tenant/context.ts')
const apiAuth = read('lib/integrations/apiAuth.ts')
const onboarding = read('lib/customers/canonicalOnboarding.ts')
const webhook = read('lib/billing/providerWebhooks.ts')
const smtp = read('lib/auth/smtpTransactionalEmail.ts')
const mailbox = read('lib/email/manualOperationsMailbox.ts')
const customerNumbers = read('lib/customer-numbers/customerNumbers.ts')
const legalDefaults = read('lib/tenant/legalDefaults.ts')
const migration = read('supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql')
const websiteRoute = read('app/api/v1/website/customer-applications/route.ts')

ok(context.includes('type TenantContext') && context.includes('assertTenantContextCompany'), 'explicit server-side TenantContext exists')
ok(context.includes('TENANT_CONTEXT_MISMATCH') && context.includes('bindPayloadToTenant'), 'client tenant mismatch fails closed')
ok(apiAuth.includes('context: TenantContext') && apiAuth.includes('tenantContextForIntegration'), 'API authentication returns verified tenant context')
for (const file of fs.readdirSync(path.join(root, 'app/api/v1'), { recursive: true }).filter((name) => String(name).endsWith('.ts'))) {
  const full = path.join('app/api/v1', String(file))
  const source = read(full)
  if (source.includes('requireIntegrationApiAccess')) ok(!source.includes('auth.client.company_id'), `${full} does not bypass authenticated context`)
}
ok(websiteRoute.includes('bindPayloadToTenant') && websiteRoute.includes('auth.context.companyId'), 'public website intake binds payload to authenticated tenant')
ok(onboarding.includes("rpc('canonical_onboard_customer_graph'") && onboarding.includes('assertTenantContextCompany'), 'canonical onboarding requires context and neutral RPC')
for (const file of ['app/admin/customers/actions.ts','lib/website/customerApplicationOnboarding.ts','lib/external-contracts/intake.ts','lib/ediel/inboundCases.ts']) {
  const source = read(file)
  ok(source.includes('createTenantContext') && source.includes('tenantContext)'), `${file} passes explicit tenant context to onboarding`)
}
ok(!webhook.includes('companyHint') && !webhook.includes("x-gridex-company-id") && !webhook.includes('text(payload.company_id)'), 'billing webhook ignores client-selected tenant hints')
ok(webhook.includes(".eq('provider_invoice_guid', input.invoiceGuid)") && webhook.includes('items.length !== 1'), 'billing webhook resolves one persisted tenant target')
ok(!smtp.includes('no-reply@gridex.se') && !smtp.includes('AUTH_EMAIL_FROM'), 'transactional auth mail has no tenant-specific fallback sender')
ok(customerNumbers.includes('canonical_next_customer_number') && customerNumbers.includes('canonical_next_contract_number') && customerNumbers.includes('canonical_next_application_number'), 'number generation uses tenant-neutral database aliases')
ok(!customerNumbers.includes('Date.now().toString().slice') && !customerNumbers.includes('return `AVT-') && !customerNumbers.includes('return `APP-'), 'number generation has no runtime fallback format')
ok(legalDefaults.includes(".from('canonical_tenant_effective_legal_sources_v')"), 'legal readiness uses the tenant-neutral projection alias')
ok(mailbox.includes(".from('ediel_mailboxes')") && !mailbox.includes("'ediel@gridex.se'"), 'reserved Ediel sender comes from secure configuration')
ok(migration.includes('create table if not exists public.company_capabilities'), 'tenant capability model is migrated')
ok(migration.includes('foreign key (company_id, %I)') && migration.includes('not valid'), 'new parent-child writes receive tenant-qualified database guards')
ok(migration.includes('check (company_id is not null) not valid'), 'new tenant-owned writes cannot omit company_id')
ok(migration.includes('canonical_onboard_customer_graph') && migration.includes('grant execute') && migration.includes('service_role'), 'neutral onboarding RPC is service-only')

for (const file of [
  'scripts/canonical-multitenant-preflight.sql',
  'scripts/canonical-multitenant-backfill-dry-run.sql',
  'scripts/canonical-multitenant-backfill-apply.sql',
  'scripts/canonical-multitenant-post-verification.sql',
  'docs/canonical-multitenant-architecture.md',
  'docs/canonical-multitenant-runbook.md',
]) ok(fs.existsSync(path.join(root, file)), `${file} exists`)

if (failures) {
  console.error(`\n${failures} canonical multi-tenant regression check(s) failed.`)
  process.exit(1)
}
console.log('\nCanonical multi-tenant static regression passed.')
