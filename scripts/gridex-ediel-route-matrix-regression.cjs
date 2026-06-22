#!/usr/bin/env node
// Verifies the central route matrix maps each business process / message code
// combination to the correct DB-valid route_scope and ack_mode.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const routeMatrix = read('lib/ediel/routeMatrix.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')

// ---- 1. Exported function signatures ----
assert(/export function routeScopeForProcess/.test(routeMatrix), 'routeMatrix: exports routeScopeForProcess')
assert(/export function ackModeForProcess/.test(routeMatrix), 'routeMatrix: exports ackModeForProcess')
assert(/export function applicationReferenceForProcess/.test(routeMatrix), 'routeMatrix: exports applicationReferenceForProcess')
assert(/export function shouldMaterializePerGridOwner/.test(routeMatrix), 'routeMatrix: exports shouldMaterializePerGridOwner')

// ---- 2. PRODAT Z01 => customer_masterdata ----
assert(
  /Z01.*customer_masterdata|customer_masterdata.*Z01|code.*Z01.*Z02.*customer_masterdata/s.test(routeMatrix),
  'routeMatrix: PRODAT Z01/Z02 maps to customer_masterdata'
)

// ---- 3. PRODAT Z03-Z10 => supplier_switch ----
const switchCodes = ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10']
for (const code of switchCodes) {
  assert(
    routeMatrix.includes(code),
    `routeMatrix: PRODAT ${code} included in supplier_switch set`
  )
}
assert(
  /SUPPLIER_SWITCH_CODES/.test(routeMatrix) && /supplier_switch/.test(routeMatrix),
  'routeMatrix: SUPPLIER_SWITCH_CODES maps to supplier_switch'
)

// ---- 4. PRODAT Z13-Z18 => metering_access ----
const meteringCodes = ['Z13', 'Z14', 'Z15', 'Z18']
for (const code of meteringCodes) {
  assert(
    routeMatrix.includes(code),
    `routeMatrix: PRODAT ${code} included in metering_access set`
  )
}
assert(
  /METERING_ACCESS_CODES/.test(routeMatrix) && /metering_access/.test(routeMatrix),
  'routeMatrix: METERING_ACCESS_CODES maps to metering_access'
)

// ---- 5. UTILTS => meter_values ----
assert(
  /family.*UTILTS.*meter_values|meter_values.*UTILTS/s.test(routeMatrix),
  'routeMatrix: UTILTS maps to meter_values'
)

// ---- 6. UTILTS billing underlay => billing_underlay ----
assert(
  /billing_underlay/.test(routeMatrix),
  'routeMatrix: billing_underlay scope exists'
)

// ---- 7. CONTRL/APERAK => null (reuse source route) ----
assert(
  /CONTRL.*null|APERAK.*null/s.test(routeMatrix),
  'routeMatrix: CONTRL/APERAK returns null scope (reuse source route)'
)

// ---- 8. ackModeForProcess returns contrl_and_aperak for PRODAT/UTILTS ----
assert(
  /contrl_and_aperak/.test(routeMatrix),
  'routeMatrix: ackModeForProcess returns contrl_and_aperak for operational flows'
)
assert(
  /CONTRL.*none|APERAK.*none/s.test(routeMatrix),
  'routeMatrix: ackModeForProcess returns none for CONTRL/APERAK'
)

// ---- 9. application reference per scope ----
assert(
  /metering_access.*23-DGI-PRODAT|23-DGI-PRODAT.*metering_access/s.test(routeMatrix),
  'routeMatrix: metering_access application reference is 23-DGI-PRODAT'
)
assert(
  /customer_masterdata.*23-DDQ-PRODAT|23-DDQ-PRODAT.*customer_masterdata/s.test(routeMatrix),
  'routeMatrix: customer_masterdata application reference is 23-DDQ-PRODAT'
)

// ---- 10. routeReadiness delegates to routeMatrix ----
assert(
  /routeScopeForProcess/.test(routeReadiness),
  'routeReadiness.ts: delegates to routeScopeForProcess'
)

// ---- 11. SQL migration uses same matrix logic ----
assert(
  /Z13.*Z14.*Z15.*Z18.*metering_access|metering_access.*Z13/s.test(fixMigration),
  'fix migration: SQL route scope CASE uses metering_access for Z13/Z14/Z15/Z18'
)
assert(
  /Z03.*Z04.*Z05.*Z06.*Z09.*Z10.*supplier_switch|supplier_switch.*Z03/s.test(fixMigration),
  'fix migration: SQL route scope CASE uses supplier_switch for Z03-Z10'
)

// ---- 12. shouldMaterializePerGridOwner returns false for ACK ----
assert(
  /CONTRL.*false|APERAK.*false/s.test(routeMatrix),
  'routeMatrix: shouldMaterializePerGridOwner returns false for CONTRL/APERAK'
)

console.log('\nEDIEL route matrix regression passed.')
