const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const failures = []
const requireText = (file, token) => {
  if (!read(file).includes(token)) failures.push(`${file}: missing ${token}`)
}
const forbidText = (file, token) => {
  if (read(file).includes(token)) failures.push(`${file}: forbidden ${token}`)
}

const migration = 'supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql'
for (const token of [
  'gridex_onboard_customer_graph',
  'gridex_resolve_customer_match_review_case',
  'customer_match_review_case.resolved',
  'pg_advisory_xact_lock',
  'ambiguous_customer_match',
  'customer_number_assignment_failed',
  'gridex_next_contract_number',
  "'contract_number', v_contract_number",
  'signed_scope_snapshot',
  'customer-onboarding-orchestrator',
  "when others then",
]) requireText(migration, token)

const intakeFiles = [
  'app/admin/customers/actions.ts',
  'lib/website/customerApplications.ts',
  'lib/external-contracts/intake.ts',
  'lib/ediel/inboundCases.ts',
]
for (const file of intakeFiles) {
  requireText(file, 'onboardCustomerGraph')
  forbidText(file, '.catch(() => null)')
  const source = read(file)
  const directCoreWrite = /\.from\(["'](?:customers|customer_sites|metering_points|customer_contracts)["']\)[\s\S]{0,100}?\.(?:insert|upsert)\(/m
  if (directCoreWrite.test(source)) failures.push(`${file}: direct customer-graph insert/upsert remains`)
}

forbidText('app/admin/customers/actions.ts', 'cleanupCreatedGraph')
forbidText('app/admin/customers/actions.ts', 'CreationContext')
forbidText('lib/website/customerApplications.ts', 'async function createOrUpdateCustomer(')
forbidText('lib/website/customerApplications.ts', 'async function upsertSite(')
forbidText('lib/website/customerApplications.ts', 'async function upsertMeteringPoint(')
forbidText('lib/website/customerApplications.ts', 'async function createContract(')
forbidText('lib/website/customerApplications.ts', 'reserveCustomerNumber')
forbidText('lib/website/customerApplications.ts', 'reserveContractNumber')
forbidText('lib/website/customerApplications.ts', 'candidate_customer_ids: result.candidate_customer_ids')

requireText('lib/billing/invoiceReadiness.ts', 'evaluateBillingReadinessCore')
forbidText('lib/billing/invoiceReadiness.ts', 'evaluateContractBillingAccountReadiness')
requireText('lib/billing/billingReadiness.ts', "new Set(['active'])")
requireText('lib/billing/billingReadiness.ts', 'periodsOverlap')
requireText('lib/billing/billingReadiness.ts', 'delivery_not_started')

requireText('lib/ediel/decisionEngine.ts', 'findCertificationCase')
forbidText('lib/ediel/decisionEngine.ts', "from '@/lib/ediel/testing")

if (failures.length) {
  console.error('Canonical onboarding regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Canonical onboarding regression passed.')
