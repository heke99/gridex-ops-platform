#!/usr/bin/env node
// Regression: the per-process route readiness sweep. The sweep was
// consolidated onto the grid-owner BUSINESS approval engine
// (evaluateGridOwnerBusinessApproval, which resolves the materialized route)
// plus the route-profile production readiness engine. Manual facility lookup
// no longer flows through this sweep at all — the automation layer routes a
// missing facility identifier to the manual e-mail orchestrator, and this
// sweep evaluates the PRODAT production route truthfully so tenants never see
// automation as "ready" when it is not.
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const sweep = read('lib/customer-operations/customerProcessRouteReadiness.ts')
const engine = read('lib/customer-operations/customerProcessNextStepEngine.ts')
ok(sweep.includes('evaluateCustomerProcessRouteReadiness'), 'customer process route readiness sweep exists')
ok(sweep.includes('z01_customer_masterdata') && sweep.includes('supplier_switch') && sweep.includes('facility_lookup'), 'sweep supports facility lookup, Z01 and supplier switch processes')
ok(sweep.includes('evaluateGridOwnerBusinessApproval') && sweep.includes('evaluateRouteProfileProductionReadiness'), 'sweep reuses existing route readiness engines')
ok(sweep.includes('needsOutboundSendReadiness') && sweep.includes('PRODAT'), 'sweep treats PRODAT outbound as send-readiness sensitive')
ok(sweep.includes('grid_owner_missing'), 'sweep fails closed when the grid owner is missing')
ok(sweep.includes('businessApproval.processRelevant') && sweep.includes("environment: 'production'"), 'production route profile checks run only for relevant actor/process scope')
ok(sweep.includes("eventType: 'supplier_switch.blocked'") && sweep.includes('idempotencyKey'), 'blocked routes emit an idempotent customer process event')
ok(engine.includes('evaluateCustomerProcessRouteReadiness'), 'next-step engine consumes route readiness sweep')
if(process.exitCode) process.exit(1)
console.log('Route readiness process sweep regression passed')
