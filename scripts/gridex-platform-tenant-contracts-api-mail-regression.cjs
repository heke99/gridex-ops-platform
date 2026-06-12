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
contains('app/admin/companies/[id]/TenantPlatformControls.tsx', /saveTenantPublicContractOfferAction/, 'Avtal skapas via bolagets kort')
contains('app/admin/companies/[id]/TenantPlatformControls.tsx', /spot_weight_percent[\s\S]*portfolio_weight_percent/, 'Bolagskortets avtalsformulär har mix/procentfält')
contains('app/admin/companies/[id]/tenant-platform-actions.ts', /publicationIssues[\s\S]*Fördelningen måste bli 100%/, 'Publicering blockerar fel portföljmix')
contains('app/admin/companies/[id]/tenant-platform-actions.ts', /assertSameTenantReference/, 'Prisplan/prisversion valideras mot samma tenant')
contains('app/admin/companies/[id]/tenant-platform-actions.ts', /contract_plan\.published|contract_plan\.created/, 'Avtal audit-loggas med avtalsevents')

contains('lib/integrations/apiClientScopes.ts', /INTEGRATION_API_PERMISSION_GROUPS/, 'API-scopes är grupperade i vanliga ord')
contains('lib/integrations/apiClientScopes.ts', /website_contracts\.read[\s\S]*website_applications\.write[\s\S]*customer_portal\.read[\s\S]*customer_portal\.write[\s\S]*website_events\.write[\s\S]*events\.read/, 'Standardscopes för hemsida/Mina sidor finns')
const scopeFile = read('lib/integrations/apiClientScopes.ts')
assert(!/customer_support_cases\.(read|write)/.test(scopeFile), 'Support-scopes är exkluderade från OPS API')
contains('app/admin/platform/api-clients/CreateApiClientForm.tsx', /Behörigheter i vanliga ord/, 'API UI visar grupper i vanliga ord')
contains('app/admin/platform/api-clients/actions.ts', /permission_groups/, 'API-klienter sparar behörighetsgrupper')
contains('app/admin/platform/api-clients/actions.ts', /updateIntegrationApiClientPermissionsAction/, 'Superadmin kan ändra API-behörigheter utan kodändring')

contains('lib/website/publicContracts.ts', /public_price_text[\s\S]*mix/, 'Publik avtals-API skickar pristext och mix')
contains('lib/website/customerApplications.ts', /public_contract_offer_id[\s\S]*spot_weight_percent[\s\S]*portfolio_weight_percent/, 'Kundteckning sparar juridiskt snapshot av avtal/mix')

if (process.exitCode) process.exit(process.exitCode)
console.log('Gridex platform tenant contracts/API/mail regression passed.')
