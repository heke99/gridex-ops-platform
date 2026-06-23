#!/usr/bin/env node
// Regression: Z01 customer_info_request linkage after repair
// Verifies:
// 1. customer_info_request gets outbound_request_id whenever an outbound exists.
// 2. blocker changes away from operational_route_missing (precise blocker used).
// 3. UI shows a visible repair result on the customer card.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const card = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const page = read('app/admin/customers/[id]/page.tsx')
const infoRequests = read('lib/onboarding/infoRequests.ts')

// ---- 1. CIR linked to outbound regardless of prepared/failed ----
assert(
  /if \(cir\) \{/.test(finalizer),
  'z01Finalizer.ts: links the customer_info_request whenever it exists (not only when blocked/route_missing)',
)
assert(
  /outbound_request_id:\s*z01\.outbound\.id/.test(finalizer),
  'z01Finalizer.ts: sets customer_info_requests.outbound_request_id = the outbound id',
)
// Keep ediel_message_id null when no message was created.
assert(
  /ediel_message_id:\s*z01\.message\?\.id\s*\?\?\s*cir\.ediel_message_id\s*\?\?\s*null/.test(finalizer),
  'z01Finalizer.ts: keeps ediel_message_id null when no message was created',
)

// ---- 2. Stale operational_route_missing is replaced by a precise blocker ----
assert(
  /wasRouteMissingBlocker/.test(finalizer) && /z01\.blockerCode/.test(finalizer),
  'z01Finalizer.ts: replaces stale operational_route_missing with the precise resolver blocker',
)
assert(
  /smtp_sent:\s*false/.test(finalizer),
  'z01Finalizer.ts: audit event records smtp_sent:false (no production SMTP from repair)',
)

// ---- 3. Visible repair result on the customer card ----
assert(
  /listZ01RepairEventsByCustomerId/.test(infoRequests),
  'infoRequests.ts: exposes listZ01RepairEventsByCustomerId for visible repair feedback',
)
assert(
  /listZ01RepairEventsByCustomerId/.test(page) && /z01RepairEvents=\{z01RepairEvents\}/.test(page),
  'customers/[id]/page.tsx: fetches and passes z01RepairEvents to the card',
)
assert(
  /z01RepairEvents\.length > 0/.test(card) && /Senaste Z01-reparation/.test(card),
  'CustomerBusinessActionsCard.tsx: renders a visible Z01 repair/dry-run result panel',
)
assert(
  /SMTP skickad/.test(card),
  'CustomerBusinessActionsCard.tsx: result panel states no SMTP was sent',
)

console.log('\n\u2713 Z01 customer-info linkage regression passed.')
