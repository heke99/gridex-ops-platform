#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`✗ ${msg}`); process.exitCode = 1 } else console.log(`✓ ${msg}`) }

const materializer = read('lib/ediel/routeMaterializer.ts')
const prodat = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const decision = read('lib/ediel/flows/routeDecisionContext.ts')
const migration = read('supabase/migrations/20260621143000_company_route_materialization_production_readiness.sql')

assert(materializer.includes('companyId: params.companyId'), 'explicit materializer scopes every write to requested company')
assert(materializer.includes('resolveSenderSettings({') && materializer.includes('companyId: params.companyId'), 'materializer resolves sender settings inside same tenant')
assert(prodat.includes('companyId: dataRequest.company_id'), 'Z01 dispatch passes request company into materializer')
assert(decision.includes('companyId: params.companyId ?? null'), 'route decision receives company scope')
assert(migration.includes('company_id,') && migration.includes('company_market_party_routes_active_route_uidx'), 'company route uniqueness is tenant-scoped')
if (process.exitCode) process.exit(process.exitCode)
