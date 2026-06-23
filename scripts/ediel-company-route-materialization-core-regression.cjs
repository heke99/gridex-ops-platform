#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`✗ ${msg}`); process.exitCode = 1 } else console.log(`✓ ${msg}`) }

const materializer = read('lib/ediel/routeMaterializer.ts')
const prodat = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const migration = read('supabase/migrations/20260621143000_company_route_materialization_production_readiness.sql')
const readiness = read('lib/ediel/companyRouteReadiness.ts')
const actions = read('app/admin/ediel/route-readiness/actions.ts')

assert(materializer.includes('export async function materializeCompanyGridOwnerRoute'), 'deterministic company/grid-owner materializer exists')
assert(materializer.includes('gridOwner.platform_market_actor_id !== route.actor_id'), 'materializer blocks grid-owner/platform-actor mismatch')
assert(materializer.includes('company_id: params.companyId') && materializer.includes('platform_actor_route_id: params.platformActorRouteId'), 'materializer writes company-scoped route identity')
assert(prodat.includes('materializeCompanyGridOwnerRoute') && (prodat.includes("messageCode: 'Z01'") || prodat.includes('messageCode: "Z01"')), 'PRODAT Z01 dispatch uses deterministic materializer')
assert(prodat.includes('route_materialization_required'), 'Z01 blocker preserves route materialization reason')
assert(migration.includes('drop index if exists public.company_market_party_routes_active_uidx'), 'migration removes coarse active unique index')
assert(migration.includes('company_market_party_routes_active_route_uidx'), 'migration creates route-specific active unique index')
assert(migration.includes('gridex_company_route_readiness_v'), 'tenant-aware route readiness view is rebuilt')
assert(readiness.includes('getCompanyGridOwnerRouteReadiness'), 'typed company route readiness helper exists')
assert(actions.includes('materializeCompanyGridOwnerRouteAction'), 'platform admin action can materialize exact company/grid-owner route')

if (process.exitCode) process.exit(process.exitCode)
