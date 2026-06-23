#!/usr/bin/env node
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const events = read('lib/customer-operations/customerProcessEvents.ts')
const workflow = read('lib/facility/facilityLookupWorkflow.ts')
const engine = read('lib/customer-operations/customerProcessNextStepEngine.ts')
ok(events.includes('emitCustomerProcessEvent') && events.includes('emitCustomerOperationEvent'), 'process events wrap existing customer operation events')
for (const code of ['facility_lookup.manual_sent','facility_lookup.completed','facility_data.received','facility_data.verified','z01.preparing','z01.blocked','z01.prepared','supplier_switch.preparing','supplier_switch.requested','supplier_switch.waiting_ack','inbound_facility_data_unmatched']) {
  ok(events.includes(code) || workflow.includes(code) || engine.includes(code), `timeline includes ${code}`)
}
ok(events.includes('tenant_message') && events.includes('technical_payload_available'), 'tenant timeline keeps plain message and technical payload marker')
ok(!events.includes('raw_edifact'), 'process timeline wrapper does not expose raw EDIFACT by default')
if(process.exitCode) process.exit(1)
console.log('Tenant process timeline regression passed')
