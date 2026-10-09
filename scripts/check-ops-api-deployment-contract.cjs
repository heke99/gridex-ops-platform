#!/usr/bin/env node
/**
 * OPS API deployment contract preflight (OPS API review F29).
 *
 * Each API feature declares the database objects it needs. A missing object
 * blocks only the feature that depends on it; unrelated API families stay
 * ready. A documentation revision never substitutes for this check.
 *
 *   node scripts/check-ops-api-deployment-contract.cjs --static
 *       every declared object is created by a repository migration
 *   node scripts/check-ops-api-deployment-contract.cjs --url <postgres-url> [--require feature,...]
 *       read-only catalog check against a database; exits 1 when a required
 *       feature is blocked (default: every feature)
 */
const { spawnSync } = require('node:child_process')
const { readdirSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const SERVICE_ONLY = { forbidden_execute: ['anon', 'authenticated'] }

const FEATURES = {
  staff_core: {
    surface: 'staff',
    tables: ['tenant_customer_identity_providers', 'tenant_staff_assertion_replays'],
    functions: [
      { signature: 'gridex_staff_active_membership_v1(uuid,uuid)', ...SERVICE_ONLY },
      { signature: 'gridex_staff_permission_overrides_v1(uuid,uuid)', ...SERVICE_ONLY },
      { signature: 'gridex_staff_customer_id_for_reference_v1(uuid,text)', ...SERVICE_ONLY },
    ],
  },
  staff_external_identity: {
    surface: 'staff_onboarding',
    tables: ['tenant_staff_actor_anchors', 'tenant_staff_identity_deliveries', 'tenant_staff_identity_bindings'],
    functions: [
      { signature: 'gridex_validate_staff_identity_binding_v1(jsonb)', ...SERVICE_ONLY },
      { signature: 'gridex_resolve_staff_identity_v1(jsonb)', ...SERVICE_ONLY },
      { signature: 'gridex_lookup_pending_staff_identity_binding_v1(jsonb)', ...SERVICE_ONLY },
      { signature: 'gridex_accept_external_staff_invitation_v1(jsonb)', ...SERVICE_ONLY },
    ],
  },
  staff_session_revocation: {
    surface: 'staff',
    functions: [{ signature: 'gridex_is_current_session_allowed()', body_contains: 'banned_until' }],
  },
  website_poa_exact_document: {
    surface: 'website',
    triggers: [
      { table: 'powers_of_attorney', name: 'powers_of_attorney_legal_reference_normalize_tg' },
      { table: 'customer_onboarding_legal_snapshots', name: 'customer_onboarding_legal_snapshots_poa_bundle_guard_tg' },
    ],
  },
  contract_confirmation_delivery: {
    surface: 'customer',
    tables: ['customer_contract_confirmation_deliveries'],
    triggers: [{ table: 'customer_contract_signature_requests', name: 'customer_contract_signature_requests_confirmation_delivery_tg' }],
  },
}

function parseArgs(argv) {
  const args = { mode: null, url: null, require: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--static') args.mode = 'static'
    else if (argv[i] === '--url') { args.mode = 'catalog'; args.url = argv[++i] }
    else if (argv[i] === '--require') args.require = String(argv[++i] ?? '').split(',').filter(Boolean)
  }
  return args
}

function functionName(signature) {
  return signature.slice(0, signature.indexOf('('))
}

/** Pure evaluation of a catalog snapshot against the manifest. */
function evaluateDeploymentContract(catalog, features = FEATURES) {
  const tables = new Set(catalog.tables ?? [])
  const triggers = new Set((catalog.triggers ?? []).map((t) => `${t.table}.${t.name}`))
  const functions = new Map((catalog.functions ?? []).map((f) => [f.signature, f]))
  const result = {}
  for (const [key, feature] of Object.entries(features)) {
    const missing = []
    for (const table of feature.tables ?? []) if (!tables.has(table)) missing.push(`table ${table}`)
    for (const trigger of feature.triggers ?? []) if (!triggers.has(`${trigger.table}.${trigger.name}`)) missing.push(`trigger ${trigger.table}.${trigger.name}`)
    for (const fn of feature.functions ?? []) {
      const found = functions.get(fn.signature)
      if (!found) { missing.push(`function ${fn.signature}`); continue }
      for (const role of fn.forbidden_execute ?? []) {
        if ((found.execute_roles ?? []).includes(role)) missing.push(`acl ${fn.signature} executable by ${role}`)
      }
      if (fn.body_contains && !String(found.body ?? '').includes(fn.body_contains)) missing.push(`function ${fn.signature} lacks ${fn.body_contains}`)
    }
    result[key] = { surface: feature.surface, ready: missing.length === 0, missing }
  }
  return result
}

function staticCatalog(root) {
  const dir = join(root, 'supabase/migrations')
  const sql = readdirSync(dir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).map((name) => readFileSync(join(dir, name), 'utf8')).join('\n').toLowerCase()
  const catalog = { tables: [], triggers: [], functions: [] }
  for (const feature of Object.values(FEATURES)) {
    for (const table of feature.tables ?? []) if (new RegExp(`create table (if not exists )?public\\.${table}\\b`).test(sql)) catalog.tables.push(table)
    for (const trigger of feature.triggers ?? []) if (new RegExp(`create trigger ${trigger.name}\\b[\\s\\S]{0,400}?on public\\.${trigger.table}\\b`).test(sql)) catalog.triggers.push(trigger)
    for (const fn of feature.functions ?? []) {
      if (new RegExp(`function public\\.${functionName(fn.signature)}\\(`).test(sql)) {
        catalog.functions.push({ signature: fn.signature, execute_roles: [], body: fn.body_contains && sql.includes(fn.body_contains) ? fn.body_contains : '' })
      }
    }
  }
  return catalog
}

function psqlJson(url, query) {
  const run = spawnSync('psql', [url, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`psql failed: ${run.stderr.trim()}`)
  return JSON.parse(run.stdout.trim() || 'null')
}

function liveCatalog(url) {
  const tables = psqlJson(url, "select coalesce(json_agg(c.relname), '[]') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')")
  const triggers = psqlJson(url, "select coalesce(json_agg(json_build_object('table', c.relname, 'name', t.tgname)), '[]') from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal")
  const functions = psqlJson(url, `select coalesce(json_agg(json_build_object(
      'signature', p.proname || '(' || coalesce((select string_agg(format_type(t, null), ',' order by ord) from unnest(p.proargtypes) with ordinality a(t, ord)), '') || ')',
      'execute_roles', (select coalesce(json_agg(r.rolname), '[]') from pg_roles r where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'EXECUTE')),
      'body', p.prosrc)), '[]')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'gridex_%'`)
  return {
    tables,
    triggers,
    functions: functions.map((f) => ({ ...f, signature: f.signature.replace(/character varying/g, 'text').replace(/\s+/g, '') })),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.mode) {
    console.error('Usage: --static | --url <postgres-url> [--require feature,...]')
    process.exit(2)
  }
  const catalog = args.mode === 'static' ? staticCatalog(resolve(__dirname, '..')) : liveCatalog(args.url)
  const result = evaluateDeploymentContract(catalog)
  const required = args.require ?? Object.keys(FEATURES)
  const unknown = required.filter((key) => !FEATURES[key])
  if (unknown.length) {
    console.error(`Unknown feature(s): ${unknown.join(', ')}`)
    process.exit(2)
  }
  let blocked = false
  for (const [key, entry] of Object.entries(result)) {
    const mark = entry.ready ? 'READY  ' : required.includes(key) ? 'BLOCKED' : 'SKIPPED'
    if (!entry.ready && required.includes(key)) blocked = true
    console.log(`${mark} ${key} (${entry.surface})${entry.missing.length ? `: ${entry.missing.join('; ')}` : ''}`)
  }
  process.exit(blocked ? 1 : 0)
}

module.exports = { FEATURES, evaluateDeploymentContract }
if (require.main === module) main()
