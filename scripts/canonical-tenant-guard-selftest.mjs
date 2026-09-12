// Isolated SQL behavior check, never a canonical schema provenance substitute.
// Install pinned @electric-sql/pglite@0.3.14 in a disposable directory and set
// GRIDEX_PGLITE_MODULE to its absolute dist/index.js path. No network/DB access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (!process.env.GRIDEX_PGLITE_MODULE) throw new Error('Set GRIDEX_PGLITE_MODULE to a disposable PGlite installation');
const { PGlite } = await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const sql = name => readFileSync(new URL(`sql/canonical-tenant-guard-${name}.sql`, import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260905141608_canonical_tenant_relationship_guards.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const snapshot = schema.match(/CREATE FUNCTION public\.gridex_contract_price_snapshots_company_guard\(\)[\s\S]*?\n\$\$;/)?.[0];
assert(snapshot, 'Canonical snapshot guard definition must already exist');
const db = new PGlite();
try {
  await db.exec(sql('fixture'));
  await db.exec(snapshot);
  for (const [name, expected] of [
    ['catalog', /Missing canonical same-company assertion helper/],
    ['behavior', /Cross-company INSERT accepted: customer_sites.customer_id/],
  ]) {
    await assert.rejects(db.exec(sql(name)), expected);
    await db.exec('rollback');
    console.log(`RED confirmed: ${name}`);
  }
  const before = (await db.query("select pg_get_functiondef('public.gridex_contract_price_snapshots_company_guard()'::regprocedure) definition")).rows[0].definition;
  for (let pass = 1; pass <= 2; pass++) {
    await db.exec(migration);
    await db.exec(sql('catalog'));
    for (const role of ['authenticated', 'service_role']) {
      await db.exec(sql('behavior').replace('set local role authenticated', `set local role ${role}`));
    }
    const after = (await db.query("select pg_get_functiondef('public.gridex_contract_price_snapshots_company_guard()'::regprocedure) definition")).rows[0].definition;
    assert.equal(after, before, 'Forward restoration must preserve the newer snapshot guard');
    console.log(`GREEN pass ${pass}: seven guards; 18 reference cases under authenticated/service_role; snapshot unchanged`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
