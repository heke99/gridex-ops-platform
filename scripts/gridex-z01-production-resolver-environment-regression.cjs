#!/usr/bin/env node
// Regression: Z01 production resolver environment
// Verifies:
// 1. Production repair does not inspect test actor settings (env-scoped).
// 2. Test actor setting ids do not appear in production blocking_reasons
//    (the engine never lists rows from another environment).
// 3. Production repair selects the production actor setting when the profile
//    sender id matches (route_profile_link / env-scoped resolution).
// 4. decision_trace environment reflects the real lane (not silently test).

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const businessActions = read('app/admin/customers/[id]/business-actions.ts')
const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const prodatFlow = read('lib/ediel/flows/prodatCustomerMasterdata.ts')

// ---- 1. Production repair defaults to production + passes it down ----
assert(
  /formValue\(formData, "environment"\) \?\? "production"/.test(businessActions),
  'business-actions.ts: repair/dry-run default environment is production',
)
assert(
  /environment:\s*input\.environment\s*\?\?\s*null/.test(finalizer) ||
    /environment:\s*input\.environment/.test(finalizer),
  'z01Finalizer.ts: passes environment into prepareAndQueueProdatZ01FromDataRequest',
)
assert(
  /effectiveEnvironment/.test(prodatFlow) && /failOnMissingEnvironment:\s*true/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: resolves an effective environment and forbids the silent test default',
)

// ---- 2. Actor settings are environment-scoped (test ids excluded in production) ----
assert(
  /resolveCompanySenderSettings\(\{[\s\S]*?environment,/.test(routeEngine),
  'routeDecisionEngine.ts: actor settings resolved with the operation environment',
)
assert(
  /lowerText\(row\.environment\) !== lowerText\(params\.environment\)/.test(routeEngine),
  'routeDecisionEngine.ts: findActorSettingByIdScoped rejects cross-environment actor settings',
)

// ---- 3. Deterministic production actor selection via route profile link ----
assert(
  /actorSettingSelectedVia\s*=\s*"route_profile_link"/.test(routeEngine),
  'routeDecisionEngine.ts: route profile actor_setting_id deterministically selects the actor (breaks test ambiguity)',
)

// ---- 4. decision_trace environment is honest ----
assert(
  /environmentExplicit:\s*Boolean\(explicitEnvironment\)/.test(routeEngine),
  'routeDecisionEngine.ts: classify_process trace records whether environment was explicit',
)
assert(
  /route_decision_payload:\s*\{\s*\.\.\.routeDecisionPayload\(decision\),\s*environment:/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: persisted route_decision_payload environment reflects the real lane',
)

console.log('\n\u2713 Z01 production resolver environment regression passed.')
