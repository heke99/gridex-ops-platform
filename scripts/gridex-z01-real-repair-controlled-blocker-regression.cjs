#!/usr/bin/env node
// Regression: real Z01 repair controlled blocker commit.
// Verifies production_route_profile_not_ready is treated as a terminal,
// visible, controlled blocked repair rather than an exception/silent stale state.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const prodat = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const infoRequests = read('lib/onboarding/infoRequests.ts')
const card = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const businessActions = read('app/admin/customers/[id]/business-actions.ts')
const pkg = JSON.parse(read('package.json'))

assert(
  pkg.scripts['gridex:z01-real-repair-controlled-blocker-regression'] === 'node scripts/gridex-z01-real-repair-controlled-blocker-regression.cjs',
  'package.json: exposes gridex:z01-real-repair-controlled-blocker-regression',
)

// ---- Controlled blockers are not exceptions in the finalizer ----
for (const code of [
  'production_route_profile_not_ready',
  'route_profile_disabled',
  'production_send_locked',
  'route_profile_missing',
  'route_profile_ambiguous',
  'actor_settings_ambiguous',
  'sender_ediel_id_missing',
  'environment_missing',
  'environment_not_resolved',
]) {
  assert(finalizer.includes(code), `z01Finalizer.ts: recognizes controlled blocker ${code}`)
}
assert(
  /controlledBlockerCodeFromError/.test(finalizer) && /z01_repair_blocked/.test(finalizer),
  'z01Finalizer.ts: converts controlled prepare errors into blocked repair events',
)

// ---- Dedicated customer_info_request sync helper ----
assert(
  /syncCustomerInfoRequestAfterZ01Repair/.test(finalizer),
  'z01Finalizer.ts: has dedicated syncCustomerInfoRequestAfterZ01Repair helper',
)
assert(
  /outbound_request_id:\s*input\.outboundRequestId/.test(finalizer),
  'z01Finalizer.ts: always writes outbound_request_id when outbound exists',
)
assert(
  /ediel_message_id:\s*input\.edielMessageId/.test(finalizer),
  'z01Finalizer.ts: writes ediel_message_id including null',
)
assert(
  /status:\s*"z01_prepared"/.test(finalizer) && /status:\s*"blocked"/.test(finalizer),
  'z01Finalizer.ts: sync helper commits prepared and blocked states explicitly',
)
assert(
  /route_profile_found_but_not_production_ready/.test(finalizer),
  'z01Finalizer.ts: maps production_route_profile_not_ready to route_profile_found_but_not_production_ready',
)
assert(
  /Route profile finns och är kopplad till routen men är inte produktionsklar\./.test(finalizer),
  'z01Finalizer.ts: uses the exact Swedish production-profile blocker reason',
)
assert(
  /Granska och aktivera produktionsprofilen för PRODAT Z01 innan meddelandet kan förberedas eller skickas\./.test(finalizer),
  'z01Finalizer.ts: uses the exact Swedish next action for production-profile blocker',
)
assert(
  /if \(error\) \{[\s\S]*throw new Error\([\s\S]*Kundinformationsbegäran kunde inte uppdateras/.test(finalizer),
  'z01Finalizer.ts: customer_info_request update errors are thrown, not swallowed',
)
assert(
  !/updateError[\s\S]*PGRST204/.test(finalizer),
  'z01Finalizer.ts: does not silently ignore PGRST204/PGRST205/42703 on the sync update',
)

// ---- Terminal events are written for real repair, not only success ----
assert(
  /insertZ01RepairTerminalEvent/.test(finalizer),
  'z01Finalizer.ts: has insertZ01RepairTerminalEvent helper',
)
for (const eventType of ['z01_repair_blocked', 'z01_repair_failed', 'z01_repair_completed']) {
  assert(finalizer.includes(eventType), `z01Finalizer.ts: writes ${eventType}`)
  assert(infoRequests.includes(eventType), `infoRequests.ts: listZ01RepairEventsByCustomerId includes ${eventType}`)
}
assert(
  /dryRun:\s*false/.test(finalizer) && /smtpSent:\s*false/.test(finalizer),
  'z01Finalizer.ts: terminal repair event payload records dryRun:false and smtpSent:false',
)
assert(
  /edielMessageId:\s*input\.edielMessageId/.test(finalizer) && /ediel_message_id:\s*input\.edielMessageId/.test(finalizer),
  'z01Finalizer.ts: terminal event payload permits edielMessageId:null in camelCase and snake_case',
)

// ---- Route decision blocked return is merged/refetched into the outbound result ----
assert(
  /const blockedOutbound = \{[\s\S]*communication_route_id:\s*error\.decision\.communicationRouteId[\s\S]*ediel_route_profile_id:\s*error\.decision\.edielRouteProfileId[\s\S]*outbound:\s*blockedOutbound/.test(prodat),
  'prodatCustomerMasterdata.ts: blocked route decision returns merged outbound with route/profile ids',
)
assert(
  /routeResolutionStatusForZ01Blocker/.test(prodat) && /route_profile_found_but_not_production_ready/.test(prodat),
  'prodatCustomerMasterdata.ts: blocked route details keep precise route resolution status',
)

// ---- Server action and page/card safety ----
assert(
  /finalizeStuckZ01GridOwnerDataRequest/.test(businessActions) && /revalidatePath\("\/admin\/work-queue"\)/.test(businessActions),
  'business-actions.ts: real repair runs finalizer and revalidates work queue',
)
assert(
  /\.maybeSingle\(\)/.test(businessActions),
  'business-actions.ts: repair ownership lookups use maybeSingle for safe missing-row handling',
)
assert(
  /z01PayloadAny/.test(card) && /z01EventDateLabel/.test(card) && /z01EventLabel/.test(card),
  'CustomerBusinessActionsCard.tsx: renders blocked/failed/completed events defensively',
)
assert(
  /edielMessageId[\s\S]*ediel_message_id/.test(card) && /ej skapat/.test(card),
  'CustomerBusinessActionsCard.tsx: safely renders edielMessageId=null',
)
assert(
  /Number\.isNaN\(date\.getTime\(\)\)/.test(card),
  'CustomerBusinessActionsCard.tsx: handles invalid dates safely',
)

// ---- Missing controlled rows should use maybeSingle in the finalizer path ----
assert(
  !/\.single\(\)/.test(finalizer),
  'z01Finalizer.ts: does not use .single() where a missing controlled row should be maybeSingle()',
)

console.log('\n✓ Z01 real repair controlled-blocker regression passed.')
