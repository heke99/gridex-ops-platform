#!/usr/bin/env node
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const recognition = read('lib/ediel/inbound/inboundFacilityRecognition.ts')
const matcher = read('lib/ediel/matching/processMatcher.ts')
ok(recognition.includes('recognizeInboundFacilityData'), 'inbound facility recognition helper exists')
// Parsed hints cannot authorize completion. Run the current physical-Z02,
// actor, exact/ambiguous/foreign-reference and incomplete-atomic-result cases.
// These component probes retain their declared ports and native-proof limits.
require('node:child_process').execFileSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run',
  '__tests__/ediel-facility-recognition-source-owner.test.ts',
  '__tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts',
], { cwd: process.cwd(), stdio: 'inherit' })
ok(matcher.includes('facility_lookup') && matcher.includes('customer_info_requests') && matcher.includes('grid_owner_information_requests'), 'process matcher includes facility/customer info processes')
if(process.exitCode) process.exit(1)
console.log('Inbound facility recognition regression passed')
