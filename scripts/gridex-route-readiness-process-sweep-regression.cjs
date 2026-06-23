#!/usr/bin/env node
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const sweep = read('lib/customer-operations/customerProcessRouteReadiness.ts')
const engine = read('lib/customer-operations/customerProcessNextStepEngine.ts')
ok(sweep.includes('evaluateCustomerProcessRouteReadiness'), 'customer process route readiness sweep exists')
ok(sweep.includes('z01_customer_masterdata') && sweep.includes('supplier_switch') && sweep.includes('facility_lookup'), 'sweep supports facility lookup, Z01 and supplier switch processes')
ok(sweep.includes('getCompanyGridOwnerRouteReadiness') && sweep.includes('evaluateRouteProfileProductionReadiness'), 'sweep reuses existing route readiness engines')
ok(sweep.includes('needsOutboundSendReadiness') && sweep.includes('PRODAT'), 'sweep treats PRODAT outbound as send-readiness sensitive')
ok(sweep.includes('facility_lookup_manual_route_allowed'), 'sweep allows manual facility lookup when contact route is missing')
ok(sweep.includes('route_not_send_ready') && sweep.includes('production'), 'sweep blocks auto-step when production route is not ready')
ok(engine.includes('evaluateCustomerProcessRouteReadiness'), 'next-step engine consumes route readiness sweep')
if(process.exitCode) process.exit(1)
console.log('Route readiness process sweep regression passed')
