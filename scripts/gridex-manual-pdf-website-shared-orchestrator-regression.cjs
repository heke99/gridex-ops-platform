/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: all intake/automation entry points (website, manual admin, PDF,
// customer card "Begär uppgifter", profile-update, portal sync, cron worker)
// must converge on the shared customer intake orchestrator facility decision.
// When facility/metering identity is missing, the ONLY path is the manual
// grid-owner information request — never a queued Z01/customer_masterdata job.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const orchestrator = 'lib/customer-operations/customerIntakeOrchestrator.ts'
const automation = 'lib/customer-operations/automation.ts'
const adminCardActions = 'app/admin/customers/[id]/actions.ts'
const adminIntakeActions = 'app/admin/customers/actions.ts'
const website = 'lib/website/customerApplications.ts'

// Shared orchestrator exports.
mustInclude(orchestrator, 'export async function evaluateSiteFacilityIdentity', 'canonical shared facility-identity gate')
mustInclude(orchestrator, 'export async function processWebsiteApplicationIntake', 'website entry')
mustInclude(orchestrator, 'export async function processManualCustomerIntake', 'manual entry')
mustInclude(orchestrator, 'export async function processPdfCustomerIntake', 'PDF entry')
mustInclude(orchestrator, 'export async function resumeCustomerIntake', 'resume entry')

// Enqueue gates: customer-data and supplier-switch automation must consult the
// facility gate and redirect to the manual path before enqueueing Z01 work.
mustInclude(automation, 'evaluateSiteFacilityIdentity', 'automation must use the shared facility gate')
mustInclude(automation, 'redirectedToManualFacilityRequest: true', 'redirect result must be explicit')
mustInclude(automation, 'resumeCustomerIntake', 'redirect must run the shared orchestrator (wired resume entry)')
mustInclude(automation, 'supplier_switch.blocked_missing_facility', 'supplier switch must never start without facility identity')

// Worker gate: already-queued jobs cannot create Z01 rows without facility.
const automationSrc = read(automation)
const workerFnIdx = automationSrc.indexOf('async function processCustomerDataRequest')
const gateIdx = automationSrc.indexOf('evaluateSiteFacilityIdentity', workerFnIdx)
const createCirIdx = automationSrc.indexOf('createCustomerInfoRequest', workerFnIdx)
if (workerFnIdx === -1 || gateIdx === -1 || createCirIdx === -1 || gateIdx > createCirIdx) {
  failures.push('processCustomerDataRequest must check facility identity BEFORE creating customer_info_requests')
}

// Customer card action handles the redirect truthfully (no fake "started").
mustInclude(adminCardActions, 'job.redirectedToManualFacilityRequest', 'customer card action must surface the redirect')
mustInclude(adminCardActions, 'Anläggningsuppgifter saknas', 'truthful Swedish status for missing facility')

// Manual/PDF intake converges on the orchestrator after graph creation.
mustInclude(adminIntakeActions, 'processManualCustomerIntake', 'manual intake orchestrator handoff')
mustInclude(adminIntakeActions, 'processPdfCustomerIntake', 'PDF intake orchestrator handoff')

// Website flow keeps its facility guard and orchestrator handoff.
mustInclude(website, 'processWebsiteApplicationIntake', 'website orchestrator handoff')
// Whitespace-tolerant: the guard may be wrapped across lines by the formatter.
if (!/const gridOwnerRequestMayBeCreated =\s*readiness\.canRequestGridOwnerInformation && !facilityMissing/.test(read(website))) {
  failures.push(`Missing gridOwnerRequestMayBeCreated guard in ${website} (website Ediel request guard)`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-manual-pdf-website-shared-orchestrator-regression: all checks passed')
