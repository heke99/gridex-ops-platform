#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Communication-route materializer DB-contract regression.
// Locks the communication_routes payload to the real check constraints:
//   communication_routes_route_type_check  in (partner_api, ediel_partner, file_export, email_manual)
//   communication_routes_route_scope_check in (supplier_switch, customer_masterdata, meter_values, metering_values, billing_underlay, metering_access)
// and guards against re-introducing route_type='ediel' or a transport_type
// column write on communication_routes.
// Note: scope mapping logic moved from routeScopeForFamily() in routeMaterializer
// to routeScopeForProcess() in lib/ediel/routeMatrix.ts.
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
let failures = 0
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`\u2717 ${message}`)
    failures += 1
  } else {
    console.log(`\u2713 ${message}`)
  }
}

// Extract a named function's text by slicing from its declaration to the next
// top-level function declaration. Brace matching is unreliable here because the
// destructured params type ({ ... }) would close depth before the body opens.
function functionBody(source, name) {
  const start = source.search(new RegExp(`function ${name}\\b`))
  if (start === -1) return ''
  const rest = source.slice(start + 1)
  const nextDecl = rest.search(/\n(?:export )?(?:async )?function \w/)
  return nextDecl === -1 ? source.slice(start) : source.slice(start, start + 1 + nextDecl)
}

const materializer = read('lib/ediel/routeMaterializer.ts')
const commBody = functionBody(materializer, 'upsertCommunicationRoute')
const profileBody = functionBody(materializer, 'upsertRouteProfile')

assert(commBody.length > 0, 'upsertCommunicationRoute exists in routeMaterializer')

// Error A — route_type contract for communication_routes
assert(/route_type:\s*"ediel_partner"/.test(commBody), 'communication_routes route uses route_type = ediel_partner')
assert(!/route_type:\s*"ediel"\s*,/.test(commBody), 'communication_routes route does not use invalid route_type = ediel')

const ALLOWED_ROUTE_TYPES = ['partner_api', 'ediel_partner', 'file_export', 'email_manual']
const writtenRouteType = (commBody.match(/route_type:\s*"([^"]+)"/) || [])[1]
assert(
  writtenRouteType && ALLOWED_ROUTE_TYPES.includes(writtenRouteType),
  `communication_routes route_type "${writtenRouteType}" is within the DB check constraint`,
)

// Error B — no transport_type write on communication_routes
assert(!/transport_type/.test(commBody), 'communication_routes payload never writes transport_type (column does not exist)')

// Error C — valid route_scope mapping
// Scope logic moved to routeMatrix.ts; materializer calls routeScopeForProcess()
assert(
  /route_scope:\s*routeScope/.test(commBody) || /routeScopeForProcess/.test(commBody),
  'communication_routes route_scope comes from routeScopeForProcess (central route matrix)'
)
const routeMatrix = read('lib/ediel/routeMatrix.ts')
const ALLOWED_SCOPES = ['supplier_switch', 'customer_masterdata', 'meter_values', 'metering_values', 'billing_underlay', 'metering_access']
assert(/PRODAT[\s\S]*?"customer_masterdata"/.test(routeMatrix), 'PRODAT maps to customer_masterdata route_scope')
assert(/UTILTS[\s\S]*?"(meter_values|metering_values)"/.test(routeMatrix), 'UTILTS maps to a valid meter route_scope')
// All scope literals returned inside routeScopeForProcess must be DB-valid.
// Extract only the routeScopeForProcess function body to avoid picking up
// ack_mode or other return values from other functions.
const scopeFnBody = functionBody(routeMatrix, 'routeScopeForProcess')
const scopeLiterals = [...scopeFnBody.matchAll(/return "([a-z_]+)"/g)].map((m) => m[1])
for (const scope of scopeLiterals) {
  assert(ALLOWED_SCOPES.includes(scope) || scope === 'null', `routeScopeForProcess scope "${scope}" is within the DB check constraint`)
}

// Required operational columns still present on the communication_routes payload
for (const col of [
  'company_id',
  'grid_owner_id',
  'endpoint',
  'target_email',
  'environment_type',
  'market_party_role',
  'counterparty_ediel_id',
  'supported_message_families',
  'supported_message_codes',
]) {
  assert(new RegExp(`${col}:`).test(commBody), `communication_routes payload sets ${col}`)
}

// transport_type is only valid on ediel_route_profiles, not communication_routes
assert(/transport_type:\s*"smtp"/.test(profileBody), 'ediel_route_profiles payload keeps transport_type (its own column)')

if (failures > 0) {
  console.error(`\nCommunication-route materializer contract regression FAILED (${failures} assertions).`)
  process.exit(1)
}
console.log('\nCommunication-route materializer contract regression passed.')
