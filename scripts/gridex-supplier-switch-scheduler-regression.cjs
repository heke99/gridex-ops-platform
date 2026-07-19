#!/usr/bin/env node
// Batch 5 regression: SupplierSwitchScheduler gates Z03 timing + duplicates + negative ACK.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const scheduler = read('lib/operations/supplierSwitchScheduler.ts')
const start = read('lib/operations/businessActions/startSupplierSwitch.ts')

assert(scheduler.includes('export function evaluateSupplierSwitchSendWindow'), 'scheduler exposes pure send-window evaluation')
assert(scheduler.includes('export async function evaluateSupplierSwitchSchedule'), 'scheduler exposes full schedule evaluation')
// The hardcoded SUPPLIER_SWITCH_WINDOW_OPEN_LEAD_DAYS constant became a
// DB-driven market policy (send_window_open_lead_days via
// loadSupplierSwitchPolicy); the invariant is that an explicit lead policy
// still gates the window and cannot silently default.
assert(scheduler.includes('sendWindowOpenLeadDays') && scheduler.includes('send_window_open_lead_days') && scheduler.includes('loadSupplierSwitchPolicy'), 'scheduler defines explicit send-window lead policy')
assert(scheduler.includes('ACTIVE_SUPPLIER_SWITCH_STATUSES'), 'scheduler defines active switch statuses for duplicate guard')
assert(scheduler.includes('sendNotBefore') && scheduler.includes('sendWindowOpensAt') && scheduler.includes('sendWindowClosesAt'), 'scheduler computes send-not-before and send window')

// Window blockers are reason-specific (`supplier_switch_send_window_<reason>`
// for too_early/expired/missing_start_date) instead of one generic code.
assert(scheduler.includes('supplier_switch_send_window_${window.reason}') || scheduler.includes('supplier_switch_send_window_not_open'), 'scheduler blocks when the send window is not open')
assert(scheduler.includes('supplier_switch_policy_unavailable'), 'scheduler fails closed when the market policy cannot be read')
for (const code of ['duplicate_active_supplier_switch', 'unresolved_negative_ack']) {
  assert(scheduler.includes(code), `scheduler blocks with ${code}`)
}
assert(scheduler.includes('outbound_z03_message_id') && scheduler.includes("=== 'negative'"), 'scheduler inspects Z03 ACK outcome for negative ACK')

// Integrated into the Z03 start path as a hard gate
assert(start.includes('evaluateSupplierSwitchSchedule'), 'startSupplierSwitch evaluates the schedule')
assert(start.includes('if (!schedule.ok)') && start.includes('return {') && start.includes('schedule'), 'startSupplierSwitch blocks Z03 when schedule is not ok')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 5 SupplierSwitchScheduler regression passed.')
