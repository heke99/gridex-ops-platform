#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
ok(dispatch.includes('dispatchFacilityLookupEdifact'), 'facility lookup Edifact dispatch service exists')
ok(dispatch.includes('processReadyFacilityLookupEdifactDispatches'), 'ready facility lookup dispatcher batch runner exists')
ok(dispatch.includes('createOutboundRequest') && dispatch.includes('createEdielMessageIntent') && dispatch.includes('renderAndQueueFacilityLookupZ01'), 'dispatcher creates outbound + intent and delegates render/queue to the gateway')
ok(dispatch.includes('grid_owner_information_request_id'), 'dispatcher links outbound/Ediel message to grid_owner_information_request')
ok(dispatch.includes('facility_lookup.edifact_queued'), 'dispatcher emits tenant timeline event when queued')
ok(!dispatch.includes("'UNKNOWN'") && !dispatch.includes('placeholderMeterPointId'), 'facility lookup no longer renders an UNKNOWN placeholder identifier')
ok(dispatch.includes('findExistingDispatchForRequest') && dispatch.includes('already_queued'), 'dispatcher is idempotent if an outbound already exists for the request')
ok(dispatch.includes("sourceType: 'manual'"), 'outbound request uses supported source type while preserving request linkage')
ok(!dispatch.includes('queueCustomerInfoRequestForDispatch') && !dispatch.includes('prepareAndQueueProdatZ01FromDataRequest'), 'dispatcher does not loosen existing customer-info Z01 preflight path')

// Facility automation is manual-only by design: missing identifiers go through
// the controlled manual information request pipeline. The Edifact dispatcher
// remains available ONLY for requests explicitly configured with
// channel='ediel' (resumed via the intent sweep), and it hard-guards that.
const facilityAutomation = read('lib/customer-operations/facilityLookupAutomation.ts')
ok(!facilityAutomation.includes('dispatchFacilityLookupEdifact'), 'facility lookup automation never calls the Edifact dispatcher directly (manual-only)')
ok(facilityAutomation.includes('requestMissingFacilityInformation'), 'facility automation delegates to the manual information orchestrator')
ok(facilityAutomation.includes("'waiting_response'") && facilityAutomation.includes('mapStatus'), 'facility automation maps manual dispatch statuses to waiting_response')
ok(facilityAutomation.includes('manual_information_orchestrator'), 'facility automation surfaces orchestrator blockers with their source')
ok(dispatch.includes("request.channel !== 'ediel'"), 'Edifact dispatcher blocks requests not explicitly configured with the ediel channel')
const resumeSweep = read('lib/ediel/intent/resumeStuckIntents.ts')
ok(resumeSweep.includes("process === 'facility_lookup'") && resumeSweep.includes('dispatchFacilityLookupEdifact'), 'only the stuck-intent sweep resumes explicitly configured Ediel facility lookups')

const gridOwnerRequests = read('lib/energy/gridOwnerRequests.ts')
ok(gridOwnerRequests.includes('communication_route_id: operationalRoute') && gridOwnerRequests.includes('ediel_route_profile_id: operationalRoute'), 'grid owner request stores materialized route columns')
ok(gridOwnerRequests.includes("dispatch_status: operationalRoute?.ready ? 'ready' : 'not_started'"), 'new facility lookup requests get dispatch lifecycle status')
ok(gridOwnerRequests.includes('outboundRequestId') && gridOwnerRequests.includes('edielMessageId'), 'grid owner request result exposes dispatch references')

const cron = read('app/api/internal/customer-operations/cron/route.ts')
ok(cron.includes('processReadyFacilityLookupEdifactDispatches'), 'customer operation cron drains ready facility lookup Edifact dispatches')
ok(cron.includes('facilityLookupDispatch'), 'cron response reports facility lookup dispatch result')

const migration = read('supabase/migrations/20260624170000_gridex_automatic_facility_lookup_edifact_dispatch.sql')
ok(migration.includes('communication_route_id uuid') && migration.includes('ediel_route_profile_id uuid'), 'migration adds first-class route columns to facility lookup requests')
ok(migration.includes('outbound_request_id uuid') && migration.includes('ediel_message_id uuid') && migration.includes('operation_id uuid'), 'migration adds first-class dispatch linkage columns')
ok(migration.includes('grid_owner_information_request_id uuid') && migration.includes('outbound_requests') && migration.includes('ediel_messages'), 'migration links outbound_requests and ediel_messages back to facility lookup request')
ok(migration.includes('dispatch_status') && migration.includes('grid_owner_information_requests_dispatch_idx'), 'migration adds dispatch lifecycle and operational indexes')
ok(migration.includes("status = 'ready_to_send' and channel = 'ediel' then 'ready'"), 'migration backfills ready Ediel facility lookups as ready for dispatch')

const pkg = read('package.json')
ok(pkg.includes('gridex:automatic-facility-lookup-edifact-dispatch-regression'), 'package script exposes regression command')

console.log('Automatic facility lookup Edifact dispatch regression passed')
