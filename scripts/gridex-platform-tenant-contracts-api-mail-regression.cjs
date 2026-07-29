#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✅ ${message}`)
  }
}
function contains(file, pattern, message) {
  const content = read(file)
  assert(pattern.test(content), message)
}

const migration = 'supabase/migrations/20260612193000_platform_tenant_contracts_api_mail.sql'
contains(migration, /public_contract_offers[\s\S]*spot_weight_percent[\s\S]*portfolio_weight_percent/, 'Tenant-avtal stödjer procentfördelning rörligt/portfölj')
contains(migration, /gridex_public_contract_offer_admin_v/, 'Adminvy för avtals-readiness finns')
contains(migration, /integration_api_permission_groups/, 'API-behörighetsgrupper finns i DB/config')
contains(migration, /gridex_tenant_email_dispatch_readiness_v/, 'Automatmail-readiness finns per tenant')
contains(migration, /contract_price_snapshots[\s\S]*public_contract_offer_id/, 'Snapshot sparar publicerat avtal')

contains('app/admin/companies/[id]/page.tsx', /TenantPlatformControls/, 'Bolagskortet visar avtal/API/mail-kontroller')
contains('app/admin/companies/[id]/TenantPlatformControls.tsx', /href=\{`\/admin\/contracts\?company_id=\$\{companyId\}`\}[\s\S]*Hantera interna avtal/, 'Bolagskortet delegerar skapande till canonical avtalsadmin')
contains('app/admin/companies/[id]/TenantPlatformControls.tsx', /spot_weight_percent[\s\S]*portfolio_weight_percent/, 'Bolagskortets avtalsformulär har mix/procentfält')
contains('supabase/migrations/20260727030000_contract_operation_readiness_completion.sql', /gridex_validate_contract_readiness_v2[\s\S]*v_spot_weight\+v_portfolio_weight\+v_fixed_weight<>100/, 'Canonical readiness blockerar fel portföljmix')
contains('app/admin/contracts/actions.ts', /requireContractPermissionAction[\s\S]*assertUserCanOperateCompany[\s\S]*publishContractChannel\(\{[\s\S]*actorUserId:\s*actor\.userId/, 'Tenant och verklig actor valideras före canonical publiceringstjänst')
contains('supabase/migrations/20260727030000_contract_operation_readiness_completion.sql', /insert into public\.audit_logs[\s\S]*contract\.channel\.published/, 'Canonical kanalpublicering audit-loggas med avtalsevent')

contains('lib/integrations/apiClientScopes.ts', /INTEGRATION_API_PERMISSION_GROUPS/, 'API-scopes är grupperade i vanliga ord')
contains('lib/integrations/apiClientScopes.ts', /website_contracts\.read[\s\S]*website_applications\.write[\s\S]*customer_portal\.read[\s\S]*customer_portal\.write[\s\S]*website_events\.write[\s\S]*events\.read/, 'Standardscopes för hemsida/Mina sidor finns')
const scopeFile = read('lib/integrations/apiClientScopes.ts')
assert(!/customer_support_cases\.(read|write)/.test(scopeFile), 'Support-scopes är exkluderade från OPS API')
contains('app/admin/platform/api-clients/CreateApiClientForm.tsx', /Behörigheter i vanliga ord/, 'API UI visar grupper i vanliga ord')
contains('app/admin/platform/api-clients/actions.ts', /permission_groups/, 'API-klienter sparar behörighetsgrupper')
contains('app/admin/platform/api-clients/actions.ts', /updateIntegrationApiClientPermissionsAction/, 'Superadmin kan ändra API-behörigheter utan kodändring')

contains('lib/website/publicContracts.ts', /public_price_text[\s\S]*mix/, 'Publik avtals-API skickar pristext och mix')
const publicContracts = read('lib/website/publicContracts.ts')
assert(/offer_reference:\s*offerReference/.test(publicContracts), 'Publik avtals-API exponerar opak offer_reference')
assert(/contract_offer_id:\s*offerReference/.test(publicContracts), 'Legacy contract_offer_id i publik avtals-API är opak referens')
assert(!/price_plan_id:\s*offer\.price_plan_id/.test(publicContracts), 'Publik avtals-API exponerar inte intern price_plan_id')
assert(!/price_plan_version_id:\s*offer\.price_plan_version_id/.test(publicContracts), 'Publik avtals-API exponerar inte intern price_plan_version_id')
contains('lib/website/customerApplications.ts', /public_contract_offer_id[\s\S]*spot_weight_percent[\s\S]*portfolio_weight_percent/, 'Kundteckning sparar juridiskt snapshot av avtal/mix')
contains('lib/website/customerApplications.ts', /offerReference:[\s\S]*selectedOfferReference/, 'Kundteckning kan lösa publicerat avtal via offer_reference')
const companyEmailSettings = read('lib/email/companyEmailSettings.ts')
assert(!/noreply@gridex\.se|support@gridex\.se/.test(companyEmailSettings), 'Fallback-avsändare är miljöstyrd och inte hårdkodad till Gridex')
assert(/legalOrCritical[\s\S]*verification_status !== 'verified'/.test(companyEmailSettings), 'Juridiska/kritiska kundmail blockeras utan verifierad bolagsdomän')

if (process.exitCode) process.exit(process.exitCode)
console.log('Gridex platform tenant contracts/API/mail regression passed.')
