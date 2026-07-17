/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const modulesSource = read('lib/legal/canonicalModules.ts')
const moduleBlock = modulesSource.match(/CANONICAL_LEGAL_MODULES\s*=\s*\[([\s\S]*?)\]\s*as const/)
const moduleKeys = moduleBlock
  ? [...moduleBlock[1].matchAll(/["']([a-z0-9_]+)["']/g)].map((match) => match[1])
  : []
assert(moduleKeys.length === 28, `Expected 28 canonical legal modules, found ${moduleKeys.length}`)
assert(new Set(moduleKeys).size === 28, 'Canonical legal module list contains duplicates')

const migrationPath = 'supabase/migrations/20260716223000_legal_defaults_readiness_and_profile_repair.sql'
const migration = read(migrationPath)
assert(migration.includes('create or replace view public.gridex_tenant_effective_legal_sources_v'), 'Effective legal source view is missing')
assert(migration.includes("'tenant_replacement'"), 'Tenant replacement precedence is missing')
assert(migration.includes("'platform_template_with_tenant_addendum'"), 'Tenant addendum source mode is missing')
assert(migration.includes("'platform_template'"), 'Platform template fallback is missing')
assert(migration.includes("'ops-standard-2026-07-v2'"), 'Immutable OPS master version label is missing')
assert(!migration.includes('update public.legal_template_versions\nset body='), 'Migration must not rewrite locked platform legal bodies')
assert(migration.includes('create extension if not exists pgcrypto with schema extensions'), 'pgcrypto must be installed in the Supabase extensions schema')
assert(migration.includes('set local search_path=public,extensions,pg_temp'), 'Migration session search_path must include the extensions schema')
assert(/gridex_company_legal_profile_defaults[\s\S]*set search_path=public,extensions,pg_temp/.test(migration), 'Legal profile defaults function cannot resolve pgcrypto from its locked search_path')
assert(migration.includes("digest(convert_to(v_snapshot::text,'UTF8'),'sha256'::text)"), 'Legal profile snapshot hash must use an explicit byte encoding and digest algorithm type')
assert(!migration.includes('create schema gridex_migration_20260716223000'), 'Migration must not depend on a custom staging schema')
const forbiddenSeedRelations = [
  'gridex_migration_20260716223000_legal_template_seed',
  'gridex_migration_20260716223000_preverified_legal_profiles',
  'gridex_migration_20260716223000_email_template_seed',
  'gridex_migration_20260716223000_email_rule_seed',
]
for (const relationName of forbiddenSeedRelations) {
  assert(!migration.includes(relationName), `Migration still depends on a migration-only seed relation: ${relationName}`)
}
assert(migration.includes('do $gridex_legal_seed$'), 'Legal templates are not seeded in one atomic inline block')
assert(migration.includes('from (values'), 'Legal template rows are not embedded as inline VALUES')
assert(migration.includes('do $gridex_profile_repair$'), 'Legal-profile repair is not self-contained')
assert(migration.includes('with email_template_seed(template_key,name,subject,body_html,body_text) as ('), 'Email templates are not seeded by an inline CTE')
assert((migration.match(/with canonical_email_rules\(event_key,template_key,event_label,legal_or_critical\) as \(/g) || []).length >= 2, 'Canonical email-rule repairs must use independent inline CTEs')
assert(!/create\s+(?:unlogged\s+|temporary\s+|temp\s+)?table\s+(?:public\.)?gridex_migration_/i.test(migration), 'Migration must not create migration-only seed tables')
assert(!/on\s+commit\s+drop/i.test(migration.replace(/--[^\n]*/g, '')), 'Migration must not depend on relations dropped at statement commit')

for (const moduleKey of moduleKeys) {
  const marker = `$gridex$${moduleKey}$gridex$`
  assert(migration.includes(marker), `OPS master seed is missing for ${moduleKey}`)
}

const profileSignals = [
  "j->>'address_line_1'",
  "j->>'address_line_2'",
  "j->>'postal_code'",
  "j->>'city'",
  "j->>'country_code'",
  "'data_protection_contact'",
  "'billing_information'",
  "'dispute_resolution_information'",
  'gridex_upsert_company_legal_profile_defaults',
  'gridex_postal_address_has_street',
  "j->>'billing_contact_email'",
]
for (const signal of profileSignals) {
  assert(migration.includes(signal), `Legal profile repair signal is missing: ${signal}`)
}
assert(migration.includes('after insert or update on public.companies'), 'Company-to-legal-profile synchronization trigger is missing')
assert(migration.includes('public.gridex_tenant_legal_profile_missing_fields'), 'Strict legal profile completeness function is missing')

const canonicalEvents = [
  'contract.application_received',
  'contract.confirmation_sent',
  'contract.cooling_off_sent',
  'contract.power_of_attorney_required',
  'contract.facility_id_required',
  'contract.customer_information_required',
  'contract.completion_reminder',
  'contract.rejected',
  'contract.manual_review',
  'switch.started',
  'switch.confirmed',
  'switch.action_required',
  'customer.welcome_active',
]
assert(migration.includes('create or replace view public.gridex_tenant_email_dispatch_readiness_v'), 'Canonical email readiness view is missing')
for (const eventKey of canonicalEvents) {
  assert(migration.includes(`'${eventKey}'`), `Migration is missing canonical mail event ${eventKey}`)
}

const emailEvents = read('lib/email/emailEvents.ts')
for (const eventKey of canonicalEvents) {
  assert(emailEvents.includes(`'${eventKey}'`), `TypeScript mail registry is missing ${eventKey}`)
}
assert(emailEvents.includes('CANONICAL_EMAIL_EVENT_LABELS'), 'Shared canonical mail labels are missing')
assert(emailEvents.includes('legacyDisabled'), 'Mail rule repair report is missing legacy cleanup')
assert(emailEvents.includes("reason: 'event_rule_disabled'"), 'Runtime mail dispatcher does not honor disabled canonical rules')
assert(!/seedDefaultEmailEventRules[\s\S]*ignoreDuplicates:\s*true/.test(emailEvents), 'Mail rule repair still ignores conflicting existing rows')

const emailTemplates = read('lib/email/emailTemplates.ts')
assert(emailTemplates.includes('EmailTemplateRepairReport'), 'Mail template repair report is missing')
assert(!/seedDefaultEmailTemplates[\s\S]*ignoreDuplicates:\s*true/.test(emailTemplates), 'Mail template repair still ignores inactive/broken rows')
for (const eventKey of canonicalEvents) {
  assert(emailTemplates.includes(`template_key: '${eventKey}'`), `Default mail template is missing ${eventKey}`)
}

const tenantDefaults = read('lib/tenant/legalDefaults.ts')
assert(tenantDefaults.includes("from('gridex_tenant_effective_legal_sources_v')"), 'Tenant legal status does not use the effective-source view')
assert(tenantDefaults.includes('platformPublishedCount'), 'Platform legal source count is missing')
assert(tenantDefaults.includes('tenantOverrideCount'), 'Tenant override count is missing')
assert(tenantDefaults.includes('effectiveModuleCount'), 'Effective legal module count is missing')

const companyPage = read('app/admin/companies/[id]/page.tsx')
assert(companyPage.includes('OPS-standardmallar:'), 'Company UI does not show OPS platform template count')
assert(companyPage.includes('Egna publicerade overrides:'), 'Company UI does not show tenant override count')
assert(companyPage.includes('Effektiva moduler:'), 'Company UI does not show effective legal module count')
assert(companyPage.includes('defaultStatus.missingTypes'), 'Company UI does not use canonical effective missing modules')
assert(companyPage.includes('Visa effektiva juridiska källor per modul'), 'Company UI does not expose effective source per legal module')
assert(!companyPage.includes('const publishedTypes = new Set'), 'Company UI still calculates legal readiness from tenant overrides only')

const controls = read('app/admin/companies/[id]/TenantPlatformControls.tsx')
assert(controls.includes('CANONICAL_EMAIL_EVENT_LABELS'), 'Tenant controls do not use shared canonical mail labels')

const contractActions = read('app/admin/contracts/actions.ts')
const companyProfileActions = read('app/admin/companies/[id]/company-profile-actions.ts')
const runtimeCompletionMigration = read('supabase/migrations/20260717233000_company_legal_contract_runtime_completion.sql')
assert(!companyProfileActions.includes('markReviewed: true'), 'Normal company save must not approve legal review')
assert(companyProfileActions.includes('reviewCompanyLegalProfile'), 'Dedicated legal review action is missing')
assert(runtimeCompletionMigration.includes('gridex_review_company_legal_profile'), 'Dedicated legal review RPC is missing')
assert(runtimeCompletionMigration.includes('complete_unreviewed'), 'Readiness does not distinguish complete but unreviewed profiles')
assert(!contractActions.includes('tenant_legal_profiles'), 'Contracts action still writes the generated legal profile directly')

const repairAction = read('app/admin/companies/[id]/email-automation-actions.ts')
assert(repairAction.includes('templates.created'), 'Repair action does not report template repairs')
assert(repairAction.includes('rules.legacyDisabled'), 'Repair action does not report disabled legacy rules')

assert(fs.existsSync(path.join(root, migrationPath)), 'Forward-only repair migration is missing')
assert(fs.existsSync(path.join(root, '__tests__/legal-defaults-readiness-repair.test.ts')), 'Behavioral legal defaults/readiness test is missing')
assert(!read('supabase/migrations/20260716183000_contract_canonical_finalization.sql').includes('ops-standard-2026-07-v2'), 'Previously applied canonical finalization migration was modified with the new legal version')

if (failures.length > 0) {
  console.error(`Legal defaults/readiness repair regression failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Legal defaults/readiness repair regression passed (${moduleKeys.length} legal modules; ${canonicalEvents.length} mail events; effective-source UI and profile repair verified).`)
