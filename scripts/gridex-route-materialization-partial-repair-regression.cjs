#!/usr/bin/env node
// Verifies partial-state route repair while enforcing canonical ACK projection.

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
const ackProjection = read('lib/ediel/ack/routeAckModeProjection.ts')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')
const bulkMigration = read('supabase/migrations/20260622133000_bulk_operational_route_materialization_repair.sql')

// 1. DB-valid ACK mode in current runtime and historical repair migrations.
assert(!/contrl_aperak/.test(materializer), 'routeMaterializer has no contrl_aperak literal')
assert(!/contrl_aperak/.test(ackProjection), 'ACK projection has no contrl_aperak literal')
assert(/projectCanonicalAckMode/.test(materializer), 'routeMaterializer uses canonical ACK projection')
assert(/canonicalAckRequirements/.test(ackProjection), 'ACK projection delegates to canonical ACK requirements')
assert(/contrl_and_aperak/.test(ackProjection), 'ACK projection exposes DB-valid contrl_and_aperak')
assert(
  !/set\s+ack_mode\s*=\s*'contrl_aperak'/i.test(fixMigration) &&
  !/'edifact',\s*'contrl_aperak'/.test(fixMigration),
  'fix migration never writes contrl_aperak as a new value',
)
assert(!/contrl_aperak/.test(bulkMigration), 'bulk migration has no contrl_aperak literal')
assert(/contrl_and_aperak/.test(fixMigration), 'fix migration uses DB-valid contrl_and_aperak')
assert(/contrl_and_aperak/.test(bulkMigration), 'bulk migration uses DB-valid contrl_and_aperak')

// 2. TypeScript materializer reuses existing communication_route.
assert(/auth_config.*platform_actor_route_id/.test(materializer), 'materializer looks up existing route by platform_actor_route_id')
assert(/match\?\.id[\s\S]*update[\s\S]*insert|match &&/.test(materializer), 'materializer updates existing rows and inserts only when absent')

// 3. Materializer refuses route-level Application Reference drift.
assert(/validateRouteDeclaredApplicationReference/.test(materializer), 'materializer validates configured Application Reference canonically')
assert(/ediel_application_reference_route_mismatch/.test(materializer), 'materializer fails closed on Application Reference mismatch')

// 4. SQL repair function handles partial state through existing-id reuse.
assert(/select cr\.id into v_existing_id/.test(fixMigration), 'fix migration looks up existing communication_route id')
assert(/select erp\.id into v_existing_id/.test(fixMigration), 'fix migration looks up existing ediel_route_profile id')
assert(/select cmpr\.id into v_existing_id/.test(fixMigration), 'fix migration looks up existing company_market_party_route id')
assert(/v_existing_id is null then[\s\S]{0,200}insert into public\.communication_routes/s.test(fixMigration), 'fix migration inserts communication_route only if missing')

// 5. Postcheck requires all route components before success.
assert(
  /v_post\.communication_route_id is null[\s\S]{0,60}v_post\.ediel_route_profile_id is null[\s\S]{0,60}v_post\.company_market_party_route_id is null/s.test(fixMigration),
  'fix migration postcheck requires all three route IDs',
)
assert(/route_materialization_postcheck_failed/.test(fixMigration), 'fix migration reports postcheck failure')

// 6. Audit logging on repair operations.
assert(/audit_logs/.test(fixMigration) && /route_readiness\.materialized_and_repaired/.test(fixMigration), 'fix migration audits successful materialization')
assert(/route_readiness\.materialize_postcheck_failed/.test(fixMigration), 'fix migration audits postcheck failure')

// 7. Known Landskrona partial repair remains guarded.
assert(/ea248513-2490-4e29-a037-a2e61c8213ec/.test(fixMigration), 'fix migration retains known Landskrona route repair')
assert(/landscrona_partial_route_repair/.test(fixMigration), 'fix migration labels Landskrona repair')
assert(/ediel_route_profiles[\s\S]*v_cr_id[\s\S]*v_erp_id is null/s.test(fixMigration), 'Landskrona profile insert is guarded')
assert(/company_market_party_routes[\s\S]*v_cmpr_id is null/s.test(fixMigration), 'Landskrona party-route insert is guarded')

// 8. Single-route apply parameters and safe dry-run default remain intact.
assert(/p_grid_owner_id uuid default null/.test(fixMigration), 'fix migration accepts p_grid_owner_id')
assert(/p_platform_actor_route_id uuid default null/.test(fixMigration), 'fix migration accepts p_platform_actor_route_id')
assert(/p_message_code text default null/.test(fixMigration), 'fix migration accepts p_message_code')
assert(/p_dry_run boolean default true/.test(fixMigration), 'fix migration defaults to dry-run')

// 9. Repair migration performs no outbound send.
assert(!/smtp_send|send_email|ediel_outbound_queue/.test(fixMigration), 'fix migration does not send SMTP or enqueue outbound messages')

console.log('\nRoute materialization partial repair regression passed.')
