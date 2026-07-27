#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const migrationPath = 'supabase/migrations/20260717233000_company_legal_contract_runtime_completion.sql'
assert(fs.existsSync(path.join(root, migrationPath)), 'Forward-only runtime completion migration is missing')
const migration = read(migrationPath)
const companyActions = read('app/admin/companies/[id]/company-profile-actions.ts')
const tenantActions = read('app/admin/company-settings/actions.ts')
const internalContractActions = read('app/admin/contracts/actions.ts')
const internalContractSchema = read('lib/contracts/adminContractSchema.ts')
const publicContractActions = read('app/admin/companies/[id]/tenant-platform-actions.ts')
const contractPage = read('app/admin/contracts/page.tsx')
const profileHelper = read('lib/tenant/companyLegalProfile.ts')
const legalTypes = read('lib/legal/tenantLegalProfile.ts')
const safeErrors = read('lib/errors/safeActionErrors.ts')

for (const token of [
  'extensions.digest',
  'gridex_review_company_legal_profile',
  'direct_legal_review_not_allowed_use_gridex_review_company_legal_profile',
  'create or replace function public.gridex_update_company_and_rebuild_legal_profile',
  'gridex_company_legal_contract_runtime_health',
  'complete_unreviewed',
  'gridex_luhn_valid',
  'gridex_normalize_swedish_organization_number',
  "v_value !~ '^[0-9]{3}[ ]?[0-9]{2}$'",
  "source_company_snapshot->>'legal_name_source'",
  'gridex_render_billing_information',
  'gridex_render_dispute_resolution',
  'drop trigger if exists companies_sync_legal_profile_review',
  'create trigger gridex_companies_legal_profile_sync',
  "p.prokind = 'f'",
  'functions_missing_extensions',
  "'edit_section'",
]) {
  assert(migration.includes(token), `Runtime migration missing ${token}`)
}

for (const field of [
  'complaints_phone',
  'complaints_address_line_1',
  'complaints_description',
  'data_protection_phone',
  'data_protection_address_line_1',
  'billing_contact_phone',
  'billing_address_line_1',
  'billing_terms_summary',
  'dispute_resolution_override',
]) {
  assert(migration.includes(`j->>'${field}'`) || migration.includes(`j->'${field}'`), `Source snapshot/projection missing ${field}`)
}

const defaultsBlock = migration.match(/create or replace function public\.gridex_company_legal_profile_defaults[\s\S]*?\nend\n\$\$;/)?.[0] ?? ''
assert(!defaultsBlock.includes("'company_updated_at'"), 'Source hash still includes unrelated company_updated_at')
assert(!/jsonb::text|p_value::text/.test(migration.match(/create or replace function public\.gridex_render_(billing_information|dispute_resolution)[\s\S]*?create or replace function public\.gridex_validate_company_legal_fields_trigger/)?.[0] ?? ''), 'Legal renderers still contain raw JSON fallback')

assert(!companyActions.includes('markReviewed: true'), 'Normal platform company save still approves legal review')
assert(!tenantActions.includes('markReviewed: true'), 'Normal tenant company save still approves legal review')
assert(companyActions.includes('reviewCompanyLegalProfile'), 'Dedicated review action is not wired')
assert(profileHelper.includes("rpc('gridex_review_company_legal_profile'"), 'Dedicated review RPC helper is not wired')
assert(profileHelper.includes('p_mark_reviewed: false'), 'Canonical normal save does not explicitly avoid review approval')
assert(profileHelper.includes("| 'complete_unreviewed'"), 'TypeScript readiness status lacks complete_unreviewed')

assert(internalContractActions.includes('assertUserCanOperateCompany'), 'Internal contract action lacks explicit tenant capability check')
assert(internalContractActions.includes('getString(formData, "company_id")'), 'Internal contract action does not require explicit company_id')
assert(contractPage.includes('name="company_id"'), 'Contract forms do not submit explicit company_id')
assert(contractPage.includes('listPlatformCompanies'), 'Platform admin contract page is still limited to membership companies')
assert(contractPage.includes('Tenantval för platform admin'), 'Platform admin lacks an explicit company selector')
assert(/function nullableInteger[\s\S]*\/\^-\?\\d\+\$\//.test(internalContractSchema), 'Internal contract integer validation is not full-match strict')
assert(!/max_customers|discount_months|default_binding_months|default_notice_months/.test(publicContractActions), 'Company channel actions must not accept parallel pricing integers')
assert(!publicContractActions.includes('if (isMissingSchemaError(error)) return candidate'), 'Public offer code generation still ignores schema drift')

assert(legalTypes.includes('export type CanonicalAddress'), 'CanonicalAddress TypeScript model is missing')
assert(legalTypes.includes('address?: StructuredAddress'), 'Structured contact still models address as a string')
assert(legalTypes.includes('databaseAddressToCanonical'), 'Database/address adapter is missing')
assert(legalTypes.includes('normalizeSwedishOrganizationNumber'), 'TypeScript organisation-number validation is missing')
assert(legalTypes.includes('normalizePostalCode'), 'TypeScript postal validation is missing')

for (const code of ['42P01', '42703', '42883']) {
  assert(safeErrors.includes(`'${code}'`), `Safe error mapper does not hard-fail schema code ${code}`)
}
assert(safeErrors.includes('Referens:'), 'Safe error messages lack correlation reference')

assert(fs.existsSync(path.join(root, 'scripts/no-next-control-flow-in-try-regression.cjs')), 'Next control-flow AST regression is missing')

if (failures.length > 0) {
  console.error(`Company/legal/contract runtime regression failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Company/legal/contract runtime regression passed: canonical data, review separation, pgcrypto, rendering, tenant scope, validation and safe errors verified.')
