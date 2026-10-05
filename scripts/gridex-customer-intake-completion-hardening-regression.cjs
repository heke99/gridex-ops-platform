#!/usr/bin/env node
const fs = require('node:fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const orchestrator = read('lib/customer-operations/facilityResponseOrchestrator.ts')
ok(orchestrator.includes('completeFacilityLookupAndRunNextSteps'), 'facility response orchestrator entrypoint exists')
ok(orchestrator.includes('triggerNextStep: false'), 'orchestrator completes facility lookup before running next steps')
ok(orchestrator.includes('evaluateCustomerIntake') && orchestrator.includes('apply: true'), 'orchestrator refreshes customer intake source of truth')
ok(orchestrator.includes('skipZ01Finalization: true'), 'facility response starts supplier switch without creating a second Z01')
ok(orchestrator.includes('facility_response.orchestrated') && orchestrator.includes('Leverantörsbyte startat automatiskt'), 'orchestrator emits business timeline event')

const workflow = read('lib/facility/facilityLookupWorkflow.ts')
ok(workflow.includes("rpc('gridex_complete_facility_response'"), 'facility completion delegates the transactional write to the canonical RPC')
ok(workflow.includes('atomic_completion: true'), 'workflow records atomic facility completion evidence')
ok(workflow.includes('customerId: completion.customerId') && workflow.includes('customerSiteId: completion.customerSiteId') && workflow.includes('operationId: completion.operationId'), 'facility completion returns context for orchestrator')

const authority = read('supabase/migrations/20260825112000_ops_precision_resolution_authority.sql')
ok(authority.includes("status='completed',dispatch_status='completed'"), 'canonical facility RPC closes request and dispatch lifecycle')
ok(authority.includes("status='ready_for_switch'"), 'canonical facility RPC marks customer-info flow ready for switch')
ok(authority.includes("blocker_code=null") && authority.includes("route_resolution_status='facility_identifier_received'"), 'canonical facility RPC clears the missing-facility blocker with explicit resolution evidence')
ok(authority.includes('customer_site_resolution') && authority.includes("facility_verified"), 'canonical facility RPC materializes facility-verified site resolution')

const nextStep = read('lib/customer-operations/customerProcessNextStepEngine.ts')
ok(nextStep.includes('skipZ01Finalization?: boolean'), 'next-step engine supports skipping Z01 repair for facility responses')
ok(nextStep.includes('input.skipZ01Finalization !== true'), 'skip flag prevents duplicate Z01 before supplier switch')

const inbound = read('lib/ediel/inbound/inboundFacilityRecognition.ts')
ok(inbound.includes('completeFacilityLookupAndRunNextSteps'), 'inbound facility recognition uses response orchestrator')
ok(!inbound.includes("import { completeFacilityLookup }"), 'inbound recognition no longer calls raw completion directly')

const actions = read('app/admin/facility-requests/actions.ts')
ok(actions.includes('completeFacilityLookupAndRunNextSteps'), 'manual facility completion uses the same response orchestrator')

const workQueue = read('app/admin/work-queue/page.tsx')
ok(workQueue.includes("'grid_owner_information_requests'") && workQueue.includes('dispatch_status'), 'work queue reads facility lookup dispatch rows')
ok(workQueue.includes('Nätägaruppgifter') && workQueue.includes('Väntar på anläggningssvar'), 'work queue has customer-friendly facility lookup states')
ok(workQueue.includes('dispatch_error_message'), 'work queue surfaces facility dispatch errors')

// Monthly automation prepares/reconciles invoice candidates frequently, but it
// must never bypass the explicit review/approval/send workflow.
const vercel = JSON.parse(read('vercel.json'))
const monthlyBillingCron = (vercel.crons ?? []).find((entry) => entry.path === '/api/cron/billing/monthly')
ok(Boolean(monthlyBillingCron), 'monthly billing preparation cron is scheduled in Vercel')
ok(monthlyBillingCron?.schedule === '20 */6 * * *', 'monthly billing preparation runs every six hours at minute 20')
const monthlyBillingRoute = read('app/api/cron/billing/monthly/route.ts')
ok(monthlyBillingRoute.includes("mode: 'prepare_only'") && monthlyBillingRoute.includes('approval_required: true'), 'scheduled billing remains prepare-only and requires approval')
ok(!monthlyBillingRoute.includes('send_to_partner'), 'scheduled billing cannot opt into provider sending through a query parameter')

const migration = read('supabase/migrations/20260624183000_gridex_customer_intake_completion_hardening.sql')
ok(migration.includes('grid_owner_information_requests_work_queue_idx'), 'migration adds work queue index for facility lookup rows')
ok(migration.includes("dispatch_status = 'completed'"), 'historical migration backfills completed facility lookup dispatch status')
ok(migration.includes('customer_info_requests_ready_for_switch_idx'), 'migration adds ready-for-switch customer-info index')

const pkg = read('package.json')
ok(pkg.includes('gridex:customer-intake-completion-hardening-regression'), 'package script exposes completion hardening regression')

console.log('Gridex customer intake completion hardening regression passed')
