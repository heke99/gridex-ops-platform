/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: PRODAT Z01 / customer_masterdata must be hard-blocked at EVERY
// layer when both facility_id and metering point identity are missing:
//   L1 customer_info_request -> grid_owner_data_request creation
//   L2 createOutboundRequest (never status=queued)
//   L3 ediel_message_intents validation (blocked, never draft/validated)
//   L5 resumeStuckEdielIntents (no revival; draft sweep blocks)
// Plus: safe repair script exists for historical bad rows (dry-run default,
// never touches rendered/sent messages, never deletes).
const fs = require('fs')
const path = require('path')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const infoRequests = 'lib/onboarding/infoRequests.ts'
const dbOutbound = 'lib/cis/db-outbound.ts'
const intentEngine = 'lib/ediel/intent/intentEngine.ts'
const resume = 'lib/ediel/intent/resumeStuckIntents.ts'
const repair = 'scripts/gridex/repairMissingFacilityZ01Rows.ts'

// L1: dispatch gate before GODR creation.
mustInclude(infoRequests, 'evaluateSiteFacilityIdentity', 'customer info dispatch must check live facility identity')
mustInclude(infoRequests, 'blocked_missing_facility_identity', 'CIR must persist the facility blocker event')
const infoSrc = read(infoRequests)
const gateIdx = infoSrc.indexOf('HARD FACILITY GUARD')
const godrIdx = infoSrc.indexOf('const gridOwnerDataRequest = await createGridOwnerDataRequest')
if (gateIdx === -1 || godrIdx === -1 || gateIdx > godrIdx) {
  failures.push('infoRequests: facility guard must run BEFORE createGridOwnerDataRequest')
}

// L2: outbound creation can never queue a facility-less customer_masterdata row.
mustInclude(dbOutbound, 'facilityIdentityMissing', 'createOutboundRequest facility guard')
mustInclude(dbOutbound, "facilityIdentityMissing || routeDecision.decisionStatus === 'blocked' ? 'failed'", 'facility-less masterdata outbound must be failed, never queued')
mustInclude(dbOutbound, "'request_facility_information'", 'required_admin_actions must include request_facility_information')
mustInclude(dbOutbound, "eventType: row.status === 'failed' ? 'failed' : 'queued'", 'dispatch event must mirror actual status, never claim koad for failed rows')

// L3: intent validation blocks customer_masterdata/supplier_switch without identity.
mustInclude(intentEngine, 'facility_identity_present', 'intent validation facility check')
mustInclude(intentEngine, "businessProcess === 'customer_masterdata' || businessProcess === 'supplier_switch'", 'guard scope')
mustInclude(intentEngine, "code: 'facility_or_metering_point_missing'", 'canonical blocker code on intents')

// L5: resume worker cannot revive facility-less intents; draft sweep exists.
mustInclude(resume, "!text(row.facility_id) &&", 'resume facility guard')
mustInclude(resume, 'sweepDraftIntents', 'stale draft intents must be re-validated or blocked')
mustInclude(resume, "source: 'resume_draft_sweep'", 'draft sweep provenance')

// Repair script safety contract.
if (!fs.existsSync(path.join(process.cwd(), repair))) {
  failures.push(`Missing repair script ${repair}`)
} else {
  mustInclude(repair, 'DRY-RUN', 'repair defaults to dry-run')
  mustInclude(repair, '--apply', 'repair mutates only with --apply')
  mustInclude(repair, 'REPORT_ONLY_high_risk', 'rendered/sent rows are never mutated')
  mustInclude(repair, 'facility_or_metering_point_missing', 'repair applies the canonical blocker')
  mustInclude(repair, 'request_facility_information', 'repair records required admin action')
  const repairSrc = read(repair)
  if (/\.delete\(/.test(repairSrc)) failures.push('repair script must never delete rows')
}

// package.json wiring.
const pkg = JSON.parse(read('package.json'))
if (!pkg.scripts['gridex:repair-missing-facility-z01']) failures.push('npm script gridex:repair-missing-facility-z01 missing')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-z01-missing-facility-outbound-blocker-regression: all checks passed')
