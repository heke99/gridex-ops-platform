#!/usr/bin/env node
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const engine = read('lib/customer-operations/customerProcessNextStepEngine.ts')
const events = read('lib/customer-operations/customerProcessEvents.ts')
ok(engine.includes('evaluateAndRunNextCustomerStep'), 'customer process next-step engine exists')
ok(engine.includes("'facility_data_received'") && engine.includes('facility_data.received'), 'engine handles facility_data_received trigger')
ok(engine.includes('clearFacilityBlocker') && engine.includes('facility_or_metering_point_missing'), 'engine clears facility missing blocker')
ok(engine.includes('evaluateCustomerProcessRouteReadiness'), 'engine checks route readiness before next steps')
ok(engine.includes('finalizeStuckZ01GridOwnerDataRequest') && engine.includes('z01.preparing'), 'engine prepares Z01 through existing finalizer')
ok(engine.includes('findOpenSupplierSwitchRequestForSite'), 'engine checks duplicate open supplier switch requests')
// Switch creation is delegated to the shared orchestration core (same
// find-or-create used by website intake), which calls createSupplierSwitchRequest.
const sharedOrchestration = read('lib/customer-operations/supplierSwitchOrchestration.ts')
ok(
  engine.includes('ensureSupplierSwitchRequestForReadySite') &&
    sharedOrchestration.includes('createSupplierSwitchRequest') &&
    engine.includes('ensureInitialSwitchEdielAutomation'),
  'engine uses existing supplier switch and Ediel automation'
)
ok(!/sendEmail|sendEdielEmail|sendCompanyEmail|sendSmtp/i.test(engine), 'next-step engine does not send SMTP directly')
ok(events.includes('supplier_switch.requested') && events.includes('z01.prepared') && events.includes('facility_data.verified'), 'tenant timeline event codes cover facility/Z01/switch')
if(process.exitCode) process.exit(1)
console.log('Customer process next-step regression passed')
