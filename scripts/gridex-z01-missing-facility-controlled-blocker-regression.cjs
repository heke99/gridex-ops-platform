const fs = require('fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const blockers = read('lib/customer-operations/blockers.ts')
const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const infoRequests = read('lib/onboarding/infoRequests.ts')
const actions = read('app/admin/customers/[id]/business-actions.ts')
const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
const card = read('components/admin/customers/CustomerBusinessActionsCard.tsx')

assert(/facility_or_metering_point_missing/.test(blockers), 'facility/metering blocker exists in blocker registry')
assert(/PRODAT Z01 kan inte förberedas eftersom anläggnings-id eller mätpunkt saknas/.test(blockers), 'facility blocker uses clear Swedish reason')
assert(/Anläggningsuppgifter saknas/.test(blockers) || /Anläggningsuppgifter saknas/.test(workflow), 'UI/model labels missing facility as Anläggningsuppgifter saknas')

assert(/facility_or_metering_point_missing/.test(finalizer), 'Z01 finalizer treats missing facility as controlled blocker')
assert(/Z01_FACILITY_IDENTIFIER_ROUTE_STATUS/.test(finalizer), 'Z01 finalizer maps missing facility to awaiting facility identifier')
assert(/z01_repair_blocked/.test(finalizer), 'blocked Z01 repair event is supported')

assert(/facility_or_metering_point_missing\|anläggnings-id\|mätpunkt/.test(infoRequests), 'dispatch blocker maps missing facility text to business blocker')
assert(/Z01_FACILITY_IDENTIFIER_ROUTE_STATUS/.test(infoRequests), 'info request route status maps to awaiting facility identifier')

assert(/isMissingFacility/.test(actions), 'action catch has safety net for missing facility')
assert(/outcome: isMissingFacility \? \"blocked\" : \"failed\"/.test(actions), 'action safety net writes blocked event instead of technical_error')

assert(/Fortsätt Z01-finalisering/.test(card), 'continue finalization UI remains present for solved route blockers')
assert(!/sendEmail|smtp\.send|sendMail\(/.test(finalizer), 'Z01 finalizer does not send SMTP directly')

console.log('Z01 missing facility controlled blocker regression passed')
