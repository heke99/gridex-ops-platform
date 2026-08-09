#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`✗ ${msg}`); process.exitCode = 1 } else console.log(`✓ ${msg}`) }

const approval = read('lib/ediel/productionSendApproval.ts')
const guard = read('lib/ediel/outbox/readinessGuard.ts')
const send = read('lib/ediel/outbox/sendOutboxItem.ts')
const routeContract = read('lib/ediel/outbox/routeContract.ts')
const actions = read('app/admin/ediel/route-readiness/actions.ts')
const migration = read('supabase/migrations/20260621143000_company_route_materialization_production_readiness.sql')
const certificateStatusMigration = read('supabase/migrations/20260809114500_ediel_certificate_status_consistency.sql')

assert(approval.includes('getProductionSendApprovalBlocker'), 'production send approval blocker helper exists')
assert(approval.includes('canonical_production_state_missing') && approval.includes('canonical_production_not_live') && approval.includes('first_live_send_approval_required'), 'production approval helper returns canonical fail-closed production-state blockers')
assert(guard.includes('const productionApprovalBlocker = await getProductionSendApprovalBlocker') && guard.indexOf('const productionApprovalBlocker = await getProductionSendApprovalBlocker') < guard.indexOf('const routeContract = await evaluateEdielRouteContract'), 'outbound readiness checks production lock before route contract send')
assert(send.includes('getEdielOutboundReadinessBlocker'), 'send path uses outbound readiness guard before SMTP')
assert(routeContract.includes('receiver_certificate_missing') && routeContract.includes('certificateRequired'), 'route contract blocks missing S/MIME receiver certificate')
assert(routeContract.includes("['valid', 'active', 'renewal_available']"), 'route contract accepts the same renewal-available receiver certificate status as the strict certificate resolver')
assert(certificateStatusMigration.includes('gridex_ops_health_checks_v2()') && certificateStatusMigration.includes("('valid','active','renewal_available')"), 'OPS health certificate gate accepts renewal-available certificates consistently')
assert(actions.includes('approveFirstProductionSendAction'), 'platform admin approval action exists')
assert(migration.includes('ediel_production_send_approvals') && migration.includes('gridex_approve_first_production_send'), 'SQL approval audit/function exists')
if (process.exitCode) process.exit(process.exitCode)
