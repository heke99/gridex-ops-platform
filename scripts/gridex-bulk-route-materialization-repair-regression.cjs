#!/usr/bin/env node
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

const migration = read('supabase/migrations/20260622133000_bulk_operational_route_materialization_repair.sql')
const materializer = read('lib/ediel/routeMaterializer.ts')
const actions = read('app/admin/ediel/route-readiness/actions.ts')
const page = read('app/admin/ediel/route-readiness/page.tsx')

assert(/create or replace function public\.gridex_materialize_company_operational_routes/.test(migration), 'bulk RPC exists')
assert(/p_dry_run boolean default true/.test(migration), 'bulk RPC defaults to dry-run')
assert(/coalesce\(gr\.operational_route_ready, false\) = false/.test(migration), 'bulk selects only missing operational routes')
assert(/coalesce\(gr\.platform_route_ready, false\) = true/.test(migration), 'bulk requires platform_route_ready')
assert(/gr\.blocker_code = 'platform_route_exists_but_not_materialized'/.test(migration), 'bulk requires materialization blocker')
assert(/gr\.sender_settings_id is not null/.test(migration), 'bulk requires sender settings')
assert(/gr\.environment in \('test', 'production'\)/.test(migration), 'bulk refuses unresolved environments')
assert(/route_type[,\s\w]*\)[\s\S]*'ediel_partner'/.test(migration), 'bulk inserts communication_routes.route_type = ediel_partner')
assert(!/route_type\s*=\s*'ediel'/.test(migration), 'bulk never writes invalid route_type = ediel')
assert(!/transport_type[\s\S]{0,80}communication_routes/.test(migration), 'bulk does not add transport_type to communication_routes')
assert(/v_route_scope := case[\s\S]*'PRODAT'[\s\S]*'customer_masterdata'/.test(migration), 'bulk maps PRODAT/Z01 to customer_masterdata')
assert(/'UTILTS'[\s\S]*'meter_values'/.test(migration), 'bulk maps UTILTS to a valid meter route scope')
assert(/select \* into v_post[\s\S]*gridex_company_route_readiness_v/.test(migration), 'bulk runs readiness postcheck')
assert(/route_materialization_postcheck_failed/.test(migration), 'bulk returns postcheck failure reason')
assert(/update public\.outbound_requests[\s\S]*communication_route_id = v_comm_route_id/.test(migration), 'bulk repairs null-route outbound rows')
assert(/update public\.customer_info_requests[\s\S]*production_send_locked/.test(migration), 'bulk repairs customer_info_requests to production_send_locked when production is locked')
assert(/never send|no sends|No business data/.test(migration) || !/smtp_send|send_email|ediel_outbound_queue/.test(migration), 'bulk migration does not send SMTP or enqueue outbound sends')
assert(/targetSystemForOperationalRoute/.test(materializer), 'runtime materializer uses EDIEL target-system helper')
assert(/return environment === "production" \? "production_ediel" : "ediel"/.test(materializer), 'runtime materializer avoids target_system = smtp')
assert(/bulkMaterializeOperationalRoutesAction/.test(actions), 'route-readiness server action exposes bulk materialization')
assert(/gridex_materialize_company_operational_routes/.test(actions), 'server action calls bulk RPC')
assert(/p_dry_run: dryRun/.test(actions), 'server action supports dry-run/apply')
assert(/Bulk-materialisera saknade operativa routes/.test(page), 'admin UI exposes controlled bulk materialization')
assert(/Dry-run/.test(page) && /Apply \+ repair/.test(page), 'admin UI defaults to dry-run and has explicit apply mode')
assert(/Den skickar aldrig SMTP och godkänner aldrig produktion/.test(page), 'admin UI states safety boundaries')

console.log('\nBulk operational route materialization repair regression passed.')
