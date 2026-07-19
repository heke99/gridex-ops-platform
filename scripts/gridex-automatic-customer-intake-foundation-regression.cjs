const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const businessApproval = read('lib/ediel/gridOwnerBusinessApproval.ts')
assert(/businessProductionApproved/.test(businessApproval), 'business production approval is separate from technical readiness')
assert(/technicalSendReady/.test(businessApproval), 'technical send readiness is preserved')
assert(/actorScope/.test(businessApproval), 'actor scope is classified for customer-flow safety')
assert(/dummy/.test(businessApproval) && /gas/.test(businessApproval) && /system_actor/.test(businessApproval), 'dummy, gas and system actors are handled explicitly')
assert(/messageConfigForGridOwnerProcess/.test(businessApproval), 'process-specific message-family requirements exist')

const routeReadiness = read('lib/customer-operations/customerProcessRouteReadiness.ts')
assert(/evaluateGridOwnerBusinessApproval/.test(routeReadiness), 'customer route readiness uses business approval guard')
assert(/businessApproval\.processRelevant/.test(routeReadiness), 'route profile checks only run for relevant actor/process scope')

// Facility lookup automation delegates to the manual information orchestrator
// (requestMissingFacilityInformation), which owns idempotency (deterministic
// manual-facility-request key), POA gating and blocker states. Route readiness
// only applies to the explicitly configured Ediel channel in the dispatcher.
const facilityAutomation = read('lib/customer-operations/facilityLookupAutomation.ts')
assert(/ensureFacilityLookupAutomation/.test(facilityAutomation), 'facility lookup automation service exists')
assert(/requestMissingFacilityInformation/.test(facilityAutomation), 'facility lookup delegates to the manual information orchestrator')
const manualOrchestrator = read('lib/customer-operations/requestMissingFacilityInformation.ts')
assert(/manual-facility-request:/.test(manualOrchestrator), 'facility lookup uses idempotent grid-owner request creation (deterministic key)')
assert(/blocked_missing_poa/.test(manualOrchestrator), 'facility lookup blocks without signed power of attorney')
const edifactDispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
assert(/evaluateCustomerProcessRouteReadiness/.test(edifactDispatch), 'explicit Ediel facility lookup checks production route readiness')

const gridOwnerRequests = read('lib/energy/gridOwnerRequests.ts')
assert(/company_operational_routes/.test(gridOwnerRequests), 'grid owner information request can use materialized company routes')
assert(/business_production_approved/.test(gridOwnerRequests), 'grid owner request metadata stores business approval')
assert(/ready_to_send/.test(gridOwnerRequests), 'existing draft request can be upgraded to ready_to_send')
assert(/communication_route_id/.test(gridOwnerRequests) && /ediel_route_profile_id/.test(gridOwnerRequests), 'operational route identifiers are persisted in metadata')

const orchestrator = read('lib/customer-operations/customerIntakeOrchestrator.ts')
assert(/evaluateCustomerIntake/.test(orchestrator), 'central customer intake orchestrator exists')
assert(/facility_lookup_ready_to_send/.test(orchestrator), 'orchestrator models facility lookup ready-to-send state')
assert(/ready_for_supplier_switch/.test(orchestrator), 'orchestrator models ready-for-supplier-switch state')
assert(/autoEnsureFacilityLookup/.test(orchestrator), 'orchestrator can trigger facility lookup automation')

const automation = read('lib/customer-operations/automation.ts')
assert(/ensureFacilityLookupAutomation/.test(automation), 'customer data automation delegates facility blocker to facility lookup automation')
assert(/customer_data\.facility_lookup_ready/.test(automation), 'facility lookup ready event is emitted')
assert(/facility_lookup_ready/.test(automation), 'facility lookup no longer ends only as generic z01 blocker')

const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
assert(/facilityLookupReady/.test(workflow), 'customer card workflow recognises facility lookup readiness')
assert(/Nätägarbegäran är redo/.test(workflow), 'customer card shows concrete facility lookup next step')
assert(!/Anläggningsuppgifter saknas\. Begär uppgifter från nätägaren eller komplettera kundkortet\./.test(workflow), 'old generic facility blocker copy is removed')

const registry = read('lib/customer-operations/customerActionRegistry.ts')
assert(/Hämta uppgifter från nätägare/.test(registry), 'tenant action copy uses business wording for facility lookup')
assert(/facilityLookupInProgress/.test(registry), 'facility status card reflects facility lookup progress')

const tenantView = read('lib/customer-operations/customerCardTenantView.ts')
assert(/Hämtas/.test(tenantView), 'tenant card shows facility data as being fetched instead of only missing')

const migration = read('supabase/migrations/20260624150000_gridex_automatic_customer_intake_foundation.sql')
assert(/gridex_grid_owner_business_readiness_v/.test(migration), 'business readiness SQL view is created')
assert(/technical_send_ready/.test(migration) && /business_production_approved/.test(migration), 'SQL view separates technical and business readiness')
assert(/Dummy Systemleverantör|systemleverantör/.test(migration), 'SQL view excludes dummy/system actors from standard customer flows')

console.log('Automatic customer intake foundation regression passed')
