#!/usr/bin/env node
// Regression: Z01 repair schema + route-profile contract
// Verifies the repair path uses the correct schema relations and the guarded
// backfill migration is present and safe.
// 1. ediel_route_profiles.communication_route_id is the join (not a column on
//    communication_routes).
// 2. ediel_actor_settings sender columns are the real ones (sender_sub_address,
//    sender_subaddress, sender_subaddress_prodat, sender_subaddress_utilts).
// 3. Outbound persists ediel_route_profile_id (column on outbound_requests).
// 4. The actor_setting_id backfill migration exists and is guarded/idempotent.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const senderResolver = read('lib/ediel/senderSettingsResolver.ts')

// ---- 1. Correct route-profile join ----
assert(
  /\.eq\("communication_route_id", routeId\)/.test(routeEngine),
  'routeDecisionEngine.ts: route profile is resolved via communication_route_id',
)

// ---- 2. Real sender columns on ediel_actor_settings ----
for (const col of ['sender_sub_address', 'sender_subaddress', 'sender_subaddress_prodat', 'sender_subaddress_utilts']) {
  assert(senderResolver.includes(col), `senderSettingsResolver.ts: reads real column ${col}`)
}
assert(
  !/row\.subaddress\b/.test(senderResolver),
  'senderSettingsResolver.ts: never reads a bare `subaddress` field',
)

// ---- 3. Outbound carries ediel_route_profile_id ----
assert(
  /ediel_route_profile_id/.test(read('lib/cis/db-outbound.ts')),
  'db-outbound.ts: outbound insert/update uses ediel_route_profile_id',
)

// ---- 4. Guarded backfill migration present ----
const migrationDir = path.join(root, 'supabase/migrations')
const backfill = fs
  .readdirSync(migrationDir)
  .find((f) => /z01_route_profile_actor_setting_backfill\.sql$/.test(f))
assert(Boolean(backfill), 'migrations: z01 route profile actor_setting backfill migration exists')
const backfillSql = read(path.join('supabase/migrations', backfill))
assert(
  backfillSql.includes('600a8023-bb8c-4eb5-9781-111178b5ff31') &&
    backfillSql.includes('3844d428-03b4-4875-a6e3-fadba31dde6a'),
  'backfill migration: targets only the known profile and production actor setting',
)
assert(
  /actor_setting_id is null/.test(backfillSql),
  'backfill migration: idempotent (only sets actor_setting_id when null)',
)
assert(
  /lower\(coalesce\(p\.environment, ''\)\) = 'production'/.test(backfillSql) &&
    /lower\(coalesce\(a\.environment, ''\)\) = 'production'/.test(backfillSql),
  'backfill migration: only touches production rows (never crosses test/production)',
)


// ---- 5. Transport mode / profile id schema safety ----
assert(
  /function uuidOrNull/.test(routeEngine) && /transport_profile_id:\s*uuidOrNull/.test(routeEngine),
  'routeDecisionEngine.ts: UUID-only guard protects ediel_routing_decisions.transport_profile_id',
)
assert(
  /transport_mode:\s*text\(profile\?\.transport_mode\)/.test(routeEngine),
  'routeDecisionEngine.ts: transport_mode remains text metadata, not a UUID reference',
)
assert(
  !/transport_profile_id:\s*profile\?\.transport_profile_id \?\? profile\?\.mailbox_id \?\? profile\?\.transport_mode/.test(routeEngine),
  'routeDecisionEngine.ts: smtp_imap cannot be assigned to transport_profile_id',
)

console.log('\n\u2713 Z01 repair schema + route-profile regression passed.')
