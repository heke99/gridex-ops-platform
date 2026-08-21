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

const prereq = read('lib/customer-operations/z01Prerequisites.ts')
const prodat = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const blockers = read('lib/customer-operations/blockers.ts')

assert(/facility_or_metering_point_missing/.test(blockers), 'blocker code facility_or_metering_point_missing is registered')
assert(/evaluateZ01Prerequisites/.test(prereq), 'Z01 prerequisite helper exists')
assert(/customerInfoRequest\?\.metering_point_id/.test(prereq), 'preflight checks customer_info_requests.metering_point_id evidence')
assert(/grid_owner_data_request_metering_point_id/.test(prereq), 'preflight checks grid_owner_data_requests.metering_point_id evidence')
assert(/site_facility_id|normalized_facility_id|facility_id/.test(prereq), 'preflight checks facility identifiers')
assert(/meter_point_id/.test(prereq) && /ediel_reference/.test(prereq), 'preflight checks linked metering point identifiers')

// P0 multi-site invariant: a known site is always part of the database lookup.
// Missing data on Site B must return [] / a blocker, never Site A rows.
assert(/if \(siteId\) \{\s*query = query\.or\(`site_id\.eq\.\$\{siteId\},customer_site_id\.eq\.\$\{siteId\}`\);\s*\}/s.test(prereq), 'known site is enforced in the metering-point query')
assert(!/if \(matched\.length > 0\) return matched;\s*return rows;/s.test(prereq), 'legacy customer-wide cross-site fallback is removed')
assert(/site_customer_matches/.test(prereq), 'Z01 evidence records the site/customer relationship check')
assert(/request_site_customer_mismatch/.test(prereq), 'site/customer/request mismatch fails closed with a typed blocker')

const preflightIndex = prodat.indexOf('const z01Prerequisites = await evaluateZ01Prerequisites')
const preparedIndex = prodat.indexOf("status: \"prepared\"", preflightIndex)
// Rendering moved into the sanctioned RenderGateway (renderAndQueueCustomerMasterdataZ01):
// the flow no longer builds the EDIFACT draft inline, but the draft build must
// still only happen after the prepared decision — now inside the gateway call.
const renderIndex = prodat.indexOf('renderAndQueueCustomerMasterdataZ01({', preflightIndex)
assert(preflightIndex !== -1, 'prodat flow runs Z01 preflight')
assert(preparedIndex !== -1, 'prodat flow still persists prepared state after preflight')
assert(renderIndex !== -1, 'prodat flow renders via the sanctioned RenderGateway')
assert(preflightIndex < preparedIndex, 'preflight runs before outbound is marked prepared')
assert(preparedIndex < renderIndex, 'EDIFACT render (gateway) still happens after prepared decision in the valid path')
const gateway = read('lib/ediel/intent/renderGateway.ts')
assert(gateway.includes('buildProdatZ01Draft'), 'RenderGateway builds the EDIFACT draft for customer_masterdata')
assert(/payload_preflight_status: \"blocked\"/.test(prodat), 'blocked preflight writes payload_preflight_status=blocked')
assert(/status: \"failed\"/.test(prodat) && /failureReason: blocker\.blocker_reason/.test(prodat), 'missing identifier sets outbound failed, not prepared')
assert(/message: null/.test(prodat) && /prepared: false/.test(prodat), 'missing identifier returns no message and prepared=false')

console.log('Z01 facility preflight regression passed')