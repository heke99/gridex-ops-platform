#!/usr/bin/env node
// DB-02 step 1: tenant FK inventory + ratchet gate (read-only, no production change).
//
// Sources (in priority order):
//   --native          run scripts/sql/tenant-fk-inventory.sql via psql against
//                     DATABASE_URL (a clean replay DB in CI, see
//                     scripts/gridex-aud-003-clean-replay.sh). Never writes.
//   default           load the committed pg_dump snapshot supabase/schema.sql
//                     into embedded PGlite and run the same query.
//
// Modes:
//   (none)            print the inventory JSON
//   --write           regenerate quality/audits/ediel-masterplan-v2/tenant-fk-baseline.json
//   --check           ratchet: fail when a single-column tenant->tenant FK exists
//                     that is not in the baseline (the baseline may only shrink)
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
export const INVENTORY_SQL_PATH = resolve(root, 'scripts/sql/tenant-fk-inventory.sql')
export const BASELINE_PATH = resolve(root, 'quality/audits/ediel-masterplan-v2/tenant-fk-baseline.json')
export const SCHEMA_SNAPSHOT_PATH = resolve(root, 'supabase/schema.sql')

export const fkKey = (fk) => `${fk.child}.${fk.col} -> ${fk.parent} (${fk.conname})`

/** Pure ratchet comparison. `added` must be empty for the gate to pass. */
export function compareToBaseline(inventory, baseline) {
  const allowed = new Set((baseline.single_tenant_fks ?? []).map(fkKey))
  const current = new Set((inventory.single_tenant_fks ?? []).map(fkKey))
  const added = [...current].filter((k) => !allowed.has(k)).sort()
  const removed = [...allowed].filter((k) => !current.has(k)).sort()
  return { ok: added.length === 0, added, removed }
}

export async function runInventoryQuery(db) {
  const res = await db.query(readFileSync(INVENTORY_SQL_PATH, 'utf8'))
  const value = res.rows[0].inventory
  return typeof value === 'string' ? JSON.parse(value) : value
}

async function loadPGlite() {
  const mod = process.env.EDIEL_PGLITE_MODULE
    ? await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
    : await import('@electric-sql/pglite')
  return mod.PGlite
}

/** Load the pg_dump snapshot object-by-object; only failures of relations/constraints matter. */
export async function inventoryFromSnapshot(path = SCHEMA_SNAPSHOT_PATH) {
  const PGlite = await loadPGlite()
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create role supabase_admin; create role authenticator;
    create schema if not exists auth; create table auth.users(id uuid primary key);
    create schema if not exists extensions; create schema if not exists storage;`)
  for (const ext of ['pgcrypto', 'btree_gist', 'citext', 'pg_trgm', 'uuid-ossp']) {
    try { await db.exec(`create extension if not exists "${ext}"`) } catch { /* not bundled */ }
  }
  // Supabase keeps pgcrypto/PostGIS in schema `extensions`; PGlite has no PostGIS.
  // Shim only what column definitions need (FK/unique/EXCLUDE shape is unaffected).
  await db.exec(`create or replace function extensions.gen_random_uuid() returns uuid
    language sql as 'select pg_catalog.gen_random_uuid()';
    create or replace function extensions.digest(text, text) returns bytea
    language sql immutable as 'select pg_catalog.sha256(convert_to($1, ''UTF8''))';`)
  const src = readFileSync(path, 'utf8')
    .replace(/^\\(un)?restrict.*$/gm, '')
    .replace(/^CREATE SCHEMA public;$/m, '')
    .replace(/extensions\.geometry\([^)]*\)/g, 'bytea')
  const chunks = src.split(/\n(?=--\n-- Name: )/)
  const relevant = /Type: (TABLE|CONSTRAINT|FK CONSTRAINT|INDEX|SCHEMA|TYPE|DOMAIN|SEQUENCE);/
  const failures = []
  let loaded = 0
  for (const chunk of chunks) {
    try { await db.exec(chunk); loaded++ } catch (error) {
      const m = chunk.match(/-- Name: ([^;]*); Type: ([A-Z ]+);/)
      // PostGIS spatial index cannot exist without PostGIS; it is not FK/unique/EXCLUDE shape.
      if (m && /USING gist \(geometry\)/.test(chunk)) continue
      if (m && relevant.test(chunk)) failures.push({ object: m[1], type: m[2], error: String(error.message).slice(0, 200) })
    }
  }
  const inventory = await runInventoryQuery(db)
  await db.close()
  return { inventory, load: { objects: chunks.length, loaded, relevant_failures: failures } }
}

function inventoryFromNative() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('--native requires DATABASE_URL (replay database)')
  const out = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    '-c', 'set default_transaction_read_only = on', '-f', INVENTORY_SQL_PATH], { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(out.stderr)
  return { inventory: JSON.parse(out.stdout.trim().split('\n').pop()), load: { source: 'native' } }
}

function summarize(inv) {
  return {
    tenant_tables: inv.tenant_table_count,
    single_tenant_fks: inv.single_tenant_fks.length,
    composite_tenant_fks: inv.composite_tenant_fks.length,
    company_id_id_unique: inv.company_id_id_unique.length,
    period_tables_without_exclude: inv.period_tables_without_exclude.length,
  }
}

async function main(argv) {
  const native = argv.includes('--native')
  const { inventory, load } = native ? inventoryFromNative() : await inventoryFromSnapshot()
  if (load.relevant_failures?.length) {
    console.error(`snapshot load: ${load.relevant_failures.length} relation/constraint objects failed`)
    for (const f of load.relevant_failures.slice(0, 20)) console.error(`  ${f.type} ${f.object}: ${f.error}`)
    if (argv.includes('--write') || argv.includes('--check')) process.exit(2)
  }
  if (argv.includes('--write')) {
    const baseline = {
      _comment: 'DB-02 ratchet baseline. Regenerate: node scripts/tenant-fk-inventory.mjs --write (PGlite over supabase/schema.sql) or DATABASE_URL=<replay db> node scripts/tenant-fk-inventory.mjs --native --write. Entries may only be removed.',
      source: native ? 'native DATABASE_URL' : 'supabase/schema.sql (pg_dump snapshot) loaded into PGlite',
      summary: summarize(inventory),
      ...inventory,
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
    console.log(JSON.stringify(baseline.summary))
    return
  }
  if (argv.includes('--check')) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const result = compareToBaseline(inventory, baseline)
    console.log(JSON.stringify({ summary: summarize(inventory), removed_since_baseline: result.removed.length }))
    if (!result.ok) {
      console.error('New single-column tenant->tenant FK(s) not in baseline; use composite (company_id, id) FK instead:')
      for (const k of result.added) console.error(`  + ${k}`)
      process.exit(1)
    }
    return
  }
  console.log(JSON.stringify({ summary: summarize(inventory), ...inventory }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exit(2) })
}
