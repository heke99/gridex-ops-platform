#!/usr/bin/env node
// Verifies that the partial-state repair logic (existing communication_route +
// missing profile/party-route) is correctly handled in both the TypeScript
// materializer and the SQL migration function.

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

const materializer = read('lib/ediel/routeMaterializer.ts')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')
const bulkMigration = read('supabase/migrations/20260622133000_bulk_operational_route_materialization_repair.sql')

// ---- 1. DB-valid ack_mode in all three layers ----
assert(!/contrl_aperak/.test(materializer), 'routeMaterializer.ts: no contrl_aperak literal')
// Fix migration legitimately contains 'contrl_aperak' in WHERE/CASE filter contexts
// (to target old rows for repair). Assert it is never used as a written value.
assert(
  !/set\s+ack_mode\s*=\s*'contrl_aperak'/i.test(fixMigration) &&
  !/'edifact',\s*'contrl_aperak'/.test(fixMigration),
  'fix migration: never writes contrl_aperak as new ack_mode value (filter-only use is ok)'
)
assert(!/contrl_aperak/.test(bulkMigration), 'bulk migration: no contrl_aperak literal')

assert(
  /contrl_and_aperak/.test(materializer) || /ackModeForProcess/.test(materializer),
  'routeMaterializer.ts: uses contrl_and_aperak (directly or via ackModeForProcess)'
)
assert(/contrl_and_aperak/.test(fixMigration), 'fix migration: uses contrl_and_aperak')
assert(/contrl_and_aperak/.test(bulkMigration), 'bulk migration: uses contrl_and_aperak')

// ---- 2. TypeScript materializer: existing communication_route is reused ----
assert(
  /auth_config.*platform_actor_route_id/.test(materializer),
  'routeMaterializer.ts: looks up existing route by platform_actor_route_id in auth_config'
)
assert(
  /match\?\.id[\s\S]*update[\s\S]*insert|match &&/.test(materializer),
  'routeMaterializer.ts: upserts (update if exists, insert if not)'
)

// ---- 3. SQL function: partial state handled (existing id reuse) ----
assert(
  /select cr\.id into v_existing_id/.test(fixMigration),
  'fix migration: looks up existing communication_route id'
)
assert(
  /select erp\.id into v_existing_id/.test(fixMigration),
  'fix migration: looks up existing ediel_route_profile id'
)
assert(
  /select cmpr\.id into v_existing_id/.test(fixMigration),
  'fix migration: looks up existing company_market_party_route id'
)

// ---- 4. No duplicate communication_route created ----
assert(
  /v_existing_id is null then[\s\S]{0,200}insert into public\.communication_routes/s.test(fixMigration),
  'fix migration: only inserts communication_route when v_existing_id is null'
)

// ---- 5. Postcheck: all three IDs must exist before reporting success ----
assert(
  /v_post\.communication_route_id is null[\s\S]{0,60}v_post\.ediel_route_profile_id is null[\s\S]{0,60}v_post\.company_market_party_route_id is null/s.test(fixMigration),
  'fix migration: postcheck requires all three route IDs'
)
assert(
  /route_materialization_postcheck_failed/.test(fixMigration),
  'fix migration: returns route_materialization_postcheck_failed on postcheck failure'
)

// ---- 6. Audit logging on every operation ----
assert(
  /audit_logs/.test(fixMigration) && /route_readiness\.materialized_and_repaired/.test(fixMigration),
  'fix migration: audit logs successful materialization'
)
assert(
  /route_readiness\.materialize_postcheck_failed/.test(fixMigration),
  'fix migration: audit logs postcheck failure'
)

// ---- 7. Landskrona partial repair ----
assert(
  /ea248513-2490-4e29-a037-a2e61c8213ec/.test(fixMigration),
  'fix migration: handles known Landskrona communication_route id'
)
assert(
  /landscrona_partial_route_repair/.test(fixMigration),
  'fix migration: labels Landskrona repair in metadata/audit'
)
assert(
  /ediel_route_profiles[\s\S]*v_cr_id[\s\S]*v_erp_id is null/s.test(fixMigration),
  'fix migration: Landskrona ediel_route_profiles insert is guarded by is-null check'
)
assert(
  /company_market_party_routes[\s\S]*v_cmpr_id is null/s.test(fixMigration),
  'fix migration: Landskrona company_market_party_routes insert is guarded by is-null check'
)

// ---- 8. Single-route apply parameters ----
assert(
  /p_grid_owner_id uuid default null/.test(fixMigration),
  'fix migration: function accepts p_grid_owner_id parameter'
)
assert(
  /p_platform_actor_route_id uuid default null/.test(fixMigration),
  'fix migration: function accepts p_platform_actor_route_id parameter'
)
assert(
  /p_message_code text default null/.test(fixMigration),
  'fix migration: function accepts p_message_code parameter'
)

// ---- 9. p_dry_run defaults to true (safe default) ----
assert(
  /p_dry_run boolean default true/.test(fixMigration),
  'fix migration: p_dry_run defaults to true'
)

// ---- 10. No SMTP sent by materializer ----
assert(
  !/smtp_send|send_email|ediel_outbound_queue/.test(fixMigration),
  'fix migration: does not send SMTP or enqueue outbound sends'
)

console.log('\nRoute materialization partial repair regression passed.')
