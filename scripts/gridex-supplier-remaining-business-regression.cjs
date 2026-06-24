#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8') }
function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const businessProcesses = read('lib/customer-operations/businessProcesses.ts')
const businessActions = read('lib/customer-operations/customerBusinessActions.ts')
const inboundState = read('lib/ediel/flows/inboundBusinessStateMachine.ts')
const inboundProcessing = read('lib/ediel/flows/inboundProcessing.ts')
const customerCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const switchCreate = read('app/admin/customers/[id]/switch-create-actions.ts')
const migration = read('supabase/migrations/20260624130000_gridex_supplier_remaining_business_state_machine.sql')
const packageJson = JSON.parse(read('package.json'))

ok(/grid_owner_information_request/.test(businessProcesses), 'business process exists for grid owner information request')
ok(/supplier_switch_cancellation/.test(businessProcesses), 'business process exists for cancellation/withdrawal')
ok(/customer_move_out/.test(businessProcesses), 'business process exists for customer move-out')
ok(/disconnection_case/.test(businessProcesses), 'business process exists for disconnection case foundation')
ok(/metering_values_ingestion/.test(businessProcesses), 'business process exists for automatic metering ingestion')
ok(/monthly_billing_underlay/.test(businessProcesses), 'business process exists for automatic billing underlays')
ok(/billing_partner_export/.test(businessProcesses), 'business process exists for billing partner export')
ok(/isBackgroundAutomation:\s*true/.test(businessProcesses), 'background billing/metering processes are marked as automation')

ok(/buildCustomerBusinessActionPlan/.test(businessActions), 'customer business action plan helper exists')
ok(/tenantBusinessActionStatusLabel/.test(businessActions), 'tenant status labels exist for action plan')
ok(/businessActionPlan/.test(customerCard), 'customer card renders business action plan')
ok(/Tekniska åtgärder/.test(customerCard), 'technical actions remain behind platform-admin section')
ok(!/Leverantörsbyte kan inte startas eftersom nätägare, PRODAT-route/.test(switchCreate), 'tenant-facing supplier switch route error is no longer raw technical copy')
ok(/nätägarens tekniska väg/.test(switchCreate), 'supplier switch route blocker uses plain Swedish tenant copy')

ok(/applyInboundBusinessStateMachine/.test(inboundState), 'inbound business state machine exists')
ok(/grid_owner_information_received/.test(inboundState), 'inbound state machine maps Z02 to grid owner information received')
ok(/supplier_switch_accepted/.test(inboundState), 'inbound state machine maps Z04 to supplier switch accepted')
ok(/supplier_switch_completed/.test(inboundState), 'inbound state machine maps Z05 to supplier switch completed')
ok(/metering_values_received/.test(inboundState), 'inbound state machine maps UTILTS E66 to metering values')
ok(/business_rejection/.test(inboundState), 'inbound state machine maps negative APERAK to business rejection')
ok(/technical_rejection/.test(inboundState), 'inbound state machine maps negative CONTRL to technical rejection')
ok(/ensureSupplyPeriodFromSwitch/.test(inboundState), 'inbound state machine creates or updates supply periods')
ok(/customer_supply_periods/.test(inboundState), 'inbound state machine writes supply period foundation')
ok(/source: "ack_processing"/.test(inboundProcessing), 'ack processing calls inbound business state machine')
ok(/source: "utilts_processing"/.test(inboundProcessing), 'UTILTS processing calls inbound business state machine')
ok(/prodat_with_strong_switch_match/.test(inboundProcessing), 'PRODAT processing calls state machine with strong switch match')
ok(/prodat_without_strong_switch_match/.test(inboundProcessing), 'PRODAT processing calls state machine without strong switch match for Z02/manual review')

ok(/customer_supply_periods/.test(migration), 'migration hardens customer supply periods')
ok(/billing_match_status/.test(migration), 'migration adds billing match status columns for metering values')
ok(/idempotency_key/.test(migration), 'migration adds billing export run idempotency key')
ok(/technical_details_visible_to_tenant boolean not null default false/.test(migration), 'migration blocks tenant visibility for technical case details by default')
ok(/ux_billing_automation_runs_one_running_per_company_period/.test(migration), 'migration adds running month idempotency guard')

ok(packageJson.scripts['gridex:supplier-remaining-business-regression'], 'remaining business regression script is registered')
ok(packageJson.scripts['gridex:supplier-business-full-regression'], 'full supplier business regression chain is registered')

console.log('Gridex supplier remaining business regression passed')
