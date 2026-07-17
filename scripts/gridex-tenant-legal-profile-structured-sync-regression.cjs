const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const migrationPath = 'supabase/migrations/20260717190000_company_legal_profile_single_editor.sql'
const migration = read(migrationPath)
const companyPage = read('app/admin/companies/[id]/page.tsx')
const companyAction = read('app/admin/companies/[id]/company-profile-actions.ts')
const tenantPage = read('app/admin/company-settings/page.tsx')
const tenantAction = read('app/admin/company-settings/actions.ts')
const contractAction = read('app/admin/contracts/actions.ts')
const contractPage = read('app/admin/contracts/page.tsx')
const helper = read('lib/tenant/companyLegalProfile.ts')
const governance = read('lib/tenant/governance.ts')

for (const token of [
  'gridex_rebuild_company_legal_profile',
  'gridex_update_company_and_rebuild_legal_profile',
  'gridex_companies_legal_profile_sync',
  'gridex_company_legal_profile_e2e',
  'address_line_1',
  'postal_code',
  'formatted',
  'missing_field_details',
  'customer_service_contact',
  'complaints_contact',
  'data_protection_contact',
  'billing_information',
  'dispute_resolution_information',
]) assert(migration.includes(token), `Single-source migration missing ${token}`)

assert(!exists('components/admin/legal/TenantLegalProfileForm.tsx'), 'Parallel legal-profile editor still exists')
assert(!contractAction.includes('tenant_legal_profiles'), 'Contracts action still writes tenant_legal_profiles directly')
assert(!contractPage.includes('TenantLegalProfileForm'), 'Contracts page still renders a separate legal editor')
assert(contractPage.includes('Juridikprofil · read-only'), 'Contracts page does not expose read-only legal status')
assert(contractPage.includes('Redigera bolagsuppgifter'), 'Contracts page does not route users to company settings')

for (const source of [companyAction, tenantAction]) {
  assert(source.includes('updateCompanyAndRebuildLegalProfile'), 'A company write path does not use the atomic RPC helper')
}
assert(!companyAction.includes('markReviewed: true'), 'Normal superadmin save must not approve legal review')
assert(companyAction.includes('reviewCompanyLegalProfile'), 'Superadmin page lacks a dedicated legal review operation')
assert(!tenantAction.includes('markReviewed: true'), 'Tenant edits must never approve legal review')
assert(helper.includes("rpc('gridex_update_company_and_rebuild_legal_profile'"), 'Shared helper does not call the canonical RPC')
assert(helper.includes('p_mark_reviewed: false'), 'Normal company writes do not force fresh review state')
assert(helper.includes("rpc('gridex_review_company_legal_profile'"), 'Dedicated review RPC helper is missing')

const fields = [
  'legal_name', 'org_number', 'vat_number', 'address_line_1', 'address_line_2', 'postal_code', 'city', 'country_code',
  'primary_contact_email', 'support_email', 'phone', 'customer_service_hours',
  'complaints_contact_name', 'complaints_email', 'complaints_phone', 'complaints_address_line_1', 'complaints_postal_code', 'complaints_city', 'complaints_country_code',
  'data_protection_contact_name', 'data_protection_email', 'data_protection_phone', 'data_protection_address_line_1', 'data_protection_postal_code', 'data_protection_city', 'data_protection_country_code',
  'billing_contact_email', 'billing_contact_phone', 'billing_address_line_1', 'billing_postal_code', 'billing_city', 'billing_country_code', 'billing_terms_summary',
]
for (const field of fields) {
  assert(companyPage.includes(`name="${field}"`), `Superadmin company editor missing ${field}`)
  assert(companyAction.includes(`${field}:`), `Superadmin company action missing ${field}`)
  assert(tenantPage.includes(`name="${field}"`), `Tenant company editor missing ${field}`)
  assert(tenantAction.includes(`${field}:`), `Tenant company action missing ${field}`)
  assert(governance.includes(field), `Governance company model/select missing ${field}`)
}

assert(companyPage.includes('Juridisk status · read-only'), 'Company card lacks read-only legal status')
assert(tenantPage.includes('Juridisk status · read-only'), 'Tenant settings lacks read-only legal status')
assert(companyPage.includes('Postadress') || helper.includes('Postadress'), 'Swedish postal-address guidance is missing')
assert(helper.includes('Fyll i gatuadress, postnummer, ort och land'), 'Technical postal_address code is not translated')

for (const forbidden of ['update public.legal_bundle_versions', 'update public.contract_publication_versions', 'update public.customer_contracts']) {
  assert(!migration.toLowerCase().includes(forbidden), `Migration mutates immutable history: ${forbidden}`)
}

console.log(`Tenant legal profile single-source regression passed (${fields.length} canonical company fields checked)`)
