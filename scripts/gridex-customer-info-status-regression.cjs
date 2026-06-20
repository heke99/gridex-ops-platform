#!/usr/bin/env node
const fs = require('node:fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${message}`)
  }
}

const automation = read('lib/customer-operations/automation.ts')
const card = read('components/admin/customers/CustomerDataRequestsCard.tsx')
const info = read('lib/onboarding/infoRequests.ts')

assert(!/\['z01_prepared', 'sent_to_grid_owner'/.test(automation), 'z01_prepared is not grouped with sent/waiting response states')
assert(/preparedOnly = dispatch\.status === 'z01_prepared'/.test(automation), 'customer automation has a prepared-only branch')
assert(/Uppgiftsbegäran förberedd/.test(card), 'customer UI labels z01_prepared as prepared, not sent')
assert(!/case "ready_to_send":\s*case "z01_prepared":\s*return \{\s*label: "Uppgiftsbegäran skickad"/s.test(card), 'ready/prepared is not displayed as sent')
assert(/Utskick räknas först när outbox\/send guard/.test(info), 'info request message separates prepared from sent')

if (process.exitCode) process.exit(process.exitCode)
