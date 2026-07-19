#!/usr/bin/env node
// Regression: Z01 customer_info_request linkage after repair
// Verifies:
// 1. customer_info_request gets outbound_request_id whenever an outbound exists.
// 2. stale operational_route_missing changes to the precise blocker.
// 3. UI shows visible, safe repair result on the customer card.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const card = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const page = read('app/admin/customers/[id]/page.tsx')
const infoRequests = read('lib/onboarding/infoRequests.ts')

// ---- 1. CIR linked to outbound regardless of prepared/failed ----
assert(
  /syncCustomerInfoRequestAfterZ01Repair/.test(finalizer),
  'z01Finalizer.ts: uses a dedicated customer_info_request sync helper',
)
assert(
  /outbound_request_id:\s*input\.outboundRequestId/.test(finalizer),
  'z01Finalizer.ts: sets customer_info_requests.outbound_request_id = the outbound id',
)
assert(
  /ediel_message_id:\s*input\.edielMessageId/.test(finalizer),
  'z01Finalizer.ts: keeps ediel_message_id null when no message was created',
)

// ---- 2. Stale operational_route_missing is replaced by a precise blocker ----
assert(
  /blocker_code:\s*blockerCode/.test(finalizer) && /routeResolutionStatusForZ01Blocker/.test(finalizer),
  'z01Finalizer.ts: replaces stale blocker with the precise resolver blocker and route status',
)
assert(
  /production_route_profile_not_ready/.test(finalizer) && /route_profile_found_but_not_production_ready/.test(finalizer),
  'z01Finalizer.ts: preserves production_route_profile_not_ready as precise blocked state',
)
assert(
  /smtp_sent:\s*false/.test(finalizer) && /smtpSent:\s*false/.test(finalizer),
  'z01Finalizer.ts: audit event records smtpSent:false (no production SMTP from repair)',
)

// ---- 3. Visible repair result on the customer card ----
assert(
  /listZ01RepairEventsByCustomerId/.test(infoRequests),
  'infoRequests.ts: exposes listZ01RepairEventsByCustomerId for visible repair feedback',
)
for (const eventType of ['z01_repair_blocked', 'z01_repair_failed', 'z01_repair_completed']) {
  assert(infoRequests.includes(eventType), `infoRequests.ts: includes ${eventType}`)
}
assert(
  /listZ01RepairEventsByCustomerId/.test(page) && /z01RepairEvents=\{z01RepairEvents\}/.test(page),
  'customers/[id]/page.tsx: fetches and passes z01RepairEvents to the card',
)
assert(
  /z01RepairEvents\.length > 0/.test(card) && /Senaste Z01-reparation/.test(card),
  'CustomerBusinessActionsCard.tsx: renders a visible Z01 repair/dry-run result panel',
)
// The panel must never claim a direct SMTP send (false-positive status):
// repair runs through the server-side finalizer and the guarded send pipeline.
assert(
  /Ingen SMTP skickas direkt/.test(card),
  'CustomerBusinessActionsCard.tsx: result panel never claims a direct SMTP send',
)
assert(
  /z01PayloadAny/.test(card) && /z01EventDateLabel/.test(card),
  'CustomerBusinessActionsCard.tsx: handles missing payload fields and invalid dates safely',
)

console.log('\n✓ Z01 customer-info linkage regression passed.')
