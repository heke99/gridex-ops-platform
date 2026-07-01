#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const adminOps = read('lib/admin/websiteIntegrationOps.ts')
const intake = read('lib/external-contracts/intake.ts')
const page = read('app/admin/website-applications/page.tsx')
const detailPage = read('app/admin/website-applications/[id]/page.tsx')
const actions = read('app/admin/website-applications/actions.ts')
const migration = read('supabase/migrations/20260701090000_website_application_ops_chain_hardening.sql')

expect(
  /const \[website, external\] = await Promise\.all\(\[\s*listLegacyWebsiteApplications\(input\),\s*listExternalContractIntakes\(input\),\s*\]\)/s.test(adminOps),
  'website_customer_applications loads before external_contract_intakes'
)
expect(
  /mergeExternalMirrorIntoWebsiteRow\(existing, row\)/.test(adminOps),
  'external intake mirror is merged into canonical website row instead of replacing it'
)
expect(
  /source_table:\s*"website_customer_applications"/.test(adminOps) && /source_table:\s*"external_contract_intakes"/.test(adminOps),
  'admin rows carry explicit source_table for safe UI/action handling'
)
expect(
  /export async function getWebsiteApplicationAdminRow/.test(adminOps),
  'single application admin loader exists for detail page'
)
expect(
  /async function ensureCustomerForIntake/.test(intake),
  'external intake uses ensureCustomerForIntake instead of blind customer insert'
)
expect(
  /findExistingCustomerForIntake/.test(intake) && /normalized_email/.test(intake) && /normalized_personal_number/.test(intake) && /normalized_org_number/.test(intake),
  'external intake deduplicates by normalized email, personnummer, and orgnummer'
)
expect(
  !/status:\s*["']pending_signature["'][\s\S]{0,500}from\(["']customers["']\)/.test(intake),
  'external intake does not write pending_signature into customers.status'
)
expect(
  /status:\s*["']draft["']/.test(intake),
  'external intake writes a valid draft customer status'
)
expect(
  /shouldReplayExisting/.test(intake) && /status:\s*"processing"/.test(intake),
  'external intake replays failed/needs_review idempotent rows instead of returning a dead duplicate'
)
expect(
  /!isCanonicalWebsiteApplication\(item\)/.test(page),
  'list UI blocks website actions for external-only fallback rows'
)
expect(
  /href=\{`\/admin\/website-applications\/\$\{item\.id\}\?source=/.test(page),
  'list UI exposes a detail route for every intake row'
)
expect(
  /getWebsiteApplicationAdminRow/.test(detailPage) && /loadOperationalChain/.test(detailPage),
  'detail page renders full operational chain from application to customer/site/contract/requests'
)
expect(
  /safeReturnPath/.test(actions) && /revalidateWebsiteApplicationPaths/.test(actions),
  'server actions safely return to and revalidate the application detail view'
)
expect(
  /where status = 'pending_signature'/.test(migration) && /external_contract_intakes_company_idempotency_chain_idx/.test(migration),
  'migration repairs legacy customer status and adds chain indexes'
)

if (failures > 0) {
  console.error(`\n${failures} regression check(s) failed.`)
  process.exit(1)
}

console.log('\nWebsite application ops chain regression passed.')
