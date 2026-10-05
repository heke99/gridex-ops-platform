#!/usr/bin/env node
// SupplierSwitchScheduler regression: Z03 timing is canonical handbook policy,
// while duplicate/negative-ACK checks remain operational DB state.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const scheduler = read('lib/operations/supplierSwitchScheduler.ts')
const start = read('lib/operations/businessActions/startSupplierSwitch.ts')
const policy = read('lib/ediel/rulebook/deadlinePolicy.ts')

assert(scheduler.includes('export function evaluateSupplierSwitchSendWindow'), 'scheduler exposes pure send-window evaluation')
assert(scheduler.includes('export async function evaluateSupplierSwitchSchedule'), 'scheduler exposes full schedule evaluation')
assert(scheduler.includes('canonicalSupplierSwitchSendPolicyProjection'), 'scheduler consumes canonical deadline facade')
assert(!scheduler.includes(".from('market_process_policies')"), 'scheduler never reads DB market_process_policies as normative timing')
assert(!scheduler.includes('send_window_open_lead_days'), 'legacy DB lead-time field cannot own Z03 timing')
assert(policy.includes("code: 'Z03', subtype: 'L'") && policy.includes("offset: -14") === false, 'canonical policy declares Z03L through structured constraints rather than scheduler literals')
assert(policy.includes("c('not_before', 'delivery_start', -14, 'calendar_months')"), 'canonical policy owns 14-month maximum advance')
assert(policy.includes("c('not_after', 'delivery_start', -14, 'calendar_days')"), 'canonical policy owns 14-day latest-send deadline')
assert(scheduler.includes('ACTIVE_SUPPLIER_SWITCH_STATUSES'), 'scheduler defines active switch statuses for duplicate guard')
assert(scheduler.includes('sendNotBefore') && scheduler.includes('sendWindowOpensAt') && scheduler.includes('sendWindowClosesAt'), 'scheduler computes send-not-before and send window')
assert(scheduler.includes('supplier_switch_send_window_${window.reason}'), 'scheduler blocks when canonical send window is not open')
assert(scheduler.includes('supplier_switch_policy_unavailable'), 'scheduler fails closed if canonical policy cannot resolve')
for (const code of ['duplicate_active_supplier_switch', 'unresolved_negative_ack']) {
  assert(scheduler.includes(code), `scheduler blocks with ${code}`)
}
assert(scheduler.includes('outbound_z03_message_id') && scheduler.includes("=== 'negative'"), 'scheduler inspects Z03 ACK outcome for negative ACK')

// Integrated into the Z03 start path as a hard gate with subtype context.
assert(start.includes('evaluateSupplierSwitchSchedule'), 'startSupplierSwitch evaluates the schedule')
assert(start.includes('request_type,prodat_variant,prodat_reason'), 'startSupplierSwitch loads Z03 subtype evidence')
assert(start.includes('transactionSubtype: row.prodat_variant ?? row.prodat_reason ?? null'), 'startSupplierSwitch passes subtype evidence to scheduler')
assert(start.includes('if (!schedule.ok)') && start.includes('return {') && start.includes('schedule'), 'startSupplierSwitch blocks Z03 when schedule is not ok')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nSupplierSwitchScheduler canonical deadline regression passed.')
