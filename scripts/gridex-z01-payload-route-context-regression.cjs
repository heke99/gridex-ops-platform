/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: Z01/customer_masterdata outbound rows must never survive an early
// preparation exit as 'queued' with empty blockers; intent identifiers must be
// populated from live prerequisite evidence; route_profile_id must never be
// assigned a communication route id (different namespace); a blocked intent
// must stop the switch flow before rendering.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}
function mustNotInclude(file, needle, why) {
  if (read(file).includes(needle)) failures.push(`Forbidden "${needle}" in ${file} (${why})`)
}

const masterdata = 'lib/ediel/flows/prodatCustomerMasterdata.ts'
const prodatSwitch = 'lib/ediel/flows/prodatSwitch.ts'
const facilityDispatch = 'lib/customer-operations/facilityLookupEdifactDispatch.ts'

// Every early exit persists blockers on the outbound row itself.
mustInclude(masterdata, 'async function blockOutboundRowDirect', 'direct row-level blocker helper')
mustInclude(masterdata, 'prepare_prodat_z01_missing_route', 'missing-route exit must block the outbound row')
mustInclude(masterdata, 'prepare_prodat_z01_company_missing', 'company-missing exit must block the outbound row')
mustInclude(masterdata, 'prepare_prodat_z01_environment_blocked', 'environment-blocked exit must block the outbound row')

// Intent identifiers come from live prerequisite evidence.
mustInclude(masterdata, 'facilityId: z01Prerequisites.facilityId ?? facilityIdFromDataRequest(dataRequest)', 'intent facility from live evidence')
mustInclude(masterdata, 'meteringPointId: z01Prerequisites.meteringPointId ?? dataRequest.metering_point_id', 'intent metering from live evidence')

// route_profile_id namespace integrity.
mustInclude(prodatSwitch, "routeProfileId: routeContext.routeDecision.edielRouteProfileId ?? ''", 'switch intent uses real ediel route profile id')
mustNotInclude(prodatSwitch, 'routeProfileId: routeContext.route.id', 'switch intent must not use communication route id as profile id')
mustInclude(facilityDispatch, "routeProfileId: input.routeProfileId ?? ''", 'facility lookup intent must not fall back to route id')
mustNotInclude(facilityDispatch, 'routeProfileId: input.routeProfileId ?? input.routeContext.route.id', 'legacy wrong-namespace fallback removed')

// Blocked intent stops the switch flow before render/queue.
const switchSrc = read(prodatSwitch)
const blockedGateIdx = switchSrc.indexOf("intent.validationStatus === 'blocked'")
const finalizeIdx = switchSrc.indexOf('const message = await finalizeOutboundDraft')
if (blockedGateIdx === -1 || finalizeIdx === -1 || blockedGateIdx > finalizeIdx) {
  failures.push('prodatSwitch must stop on blocked intent BEFORE finalizeOutboundDraft')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-z01-payload-route-context-regression: all checks passed')
