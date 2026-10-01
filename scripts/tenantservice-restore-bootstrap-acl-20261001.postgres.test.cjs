'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS proof, matching the existing PostgreSQL core tests. */

// Actual PostgreSQL 17 core proof of a bounded recovery plan. This does not run
// pg_dump, native Supabase or the guarded restore wrapper and claims none of them.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { PGlite } = require('@electric-sql/pglite')

const generator = join(__dirname, 'tenantservice-restore-bootstrap-acl.cjs')
const fingerprint = readFileSync(join(__dirname, 'sql/tenantservice-restore-data-fingerprint.sql'), 'utf8')
const catalogSql = fingerprint.slice(fingerprint.indexOf('with namespaces as ('))
  .replace(/select case when :'tenantservice_catalog_is_detail'::boolean then body::text[\s\S]*?from payload;/,
    'select body from payload;')
if (!catalogSql.startsWith('with namespaces as (') || catalogSql.includes('\\set') || catalogSql.includes(" :'")) throw new Error('actual_catalog_query_required')
const qi = value => '"' + value.replaceAll('"', '""') + '"'
const owner = 'restore owner "quoted" \'$bootstrap_acl_guard_0$'
const schemaOwner = 'graphql source owner'
const alpha = 'alpha"; DROP SCHEMA public CASCADE;--'
const beta = 'beta reader'
const gamma = 'gamma writer'
const delta = 'delta receiver'
const relations = ['geography_columns', 'geometry_columns', 'spatial_ref_sys']
const schemas = ['graphql', 'graphql_public']
const rows = async db => (await db.query(catalogSql)).rows[0].body
const objectAcl = (body, kind, schema, object) => body.acl.filter(row => row.kind === kind && row.schema_name === schema && row.object_name === object)

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role ${qi(owner)}; create role ${qi(schemaOwner)};
    create role ${qi(alpha)}; create role ${qi(beta)}; create role ${qi(gamma)}; create role ${qi(delta)};
    create schema extensions authorization ${qi(owner)};
    grant usage on schema extensions to ${qi(alpha)};
    create view extensions.geography_columns as select 1 as synthetic_id;
    create view extensions.geometry_columns as select 2 as synthetic_id;
    create table extensions.spatial_ref_sys(synthetic_id integer primary key);
    insert into extensions.spatial_ref_sys values(3);
    alter view extensions.geography_columns owner to ${qi(owner)};
    alter view extensions.geometry_columns owner to ${qi(owner)};
    alter table extensions.spatial_ref_sys owner to ${qi(owner)};
    create schema graphql authorization ${qi(schemaOwner)};
    create schema graphql_public authorization ${qi(schemaOwner)};
    create table public.synthetic_restore_business(id integer primary key,payload text not null);
    insert into public.synthetic_restore_business values(1,'unchanged synthetic financial row');
    alter table public.synthetic_restore_business enable row level security;
    create policy synthetic_restore_read on public.synthetic_restore_business for select to ${qi(beta)} using(id=1);
    grant select on public.synthetic_restore_business to ${qi(beta)};
  `)
  for (const name of relations) await db.exec(`begin;set local role ${qi(owner)};
    grant select on table extensions.${qi(name)} to public;
    grant select,update on table extensions.${qi(name)} to ${qi(alpha)} with grant option;
    grant select,update on table extensions.${qi(name)} to ${qi(beta)},${qi(gamma)},${qi(delta)};commit;`)
  for (const name of schemas) await db.exec(`begin;set local role ${qi(schemaOwner)};
    grant usage on schema ${qi(name)} to public;
    grant create on schema ${qi(name)} to ${qi(alpha)} with grant option;
    grant usage,create on schema ${qi(name)} to ${qi(beta)};commit;`)
  const before = await rows(db)
  async function loseKnownGrants() {
    for (const name of relations) await db.exec(`begin;set local role ${qi(owner)};
      revoke select,update on table extensions.${qi(name)} from ${qi(alpha)},${qi(beta)},${qi(gamma)},${qi(delta)} cascade;commit;`)
    for (const name of schemas) await db.exec(`begin;set local role ${qi(schemaOwner)};
      revoke usage on schema ${qi(name)} from public;
      revoke create on schema ${qi(name)} from ${qi(alpha)} cascade;
      revoke usage,create on schema ${qi(name)} from ${qi(beta)};commit;`)
  }
  return { db, before, loseKnownGrants }
}

function generate(before, after) {
  assert.equal(existsSync(generator), true, 'actual_production_acl_recovery_generator_required')
  const runnerTemp = mkdtempSync(join(tmpdir(), 'bootstrap-acl-core-root.'))
  const directory = mkdtempSync(join(runnerTemp, 'tenantservice-upgrade-restore.'))
  const source = join(directory, 'before.json'), target = join(directory, 'after.json'), output = join(directory, 'recovery.sql')
  writeFileSync(source, JSON.stringify(before), { mode: 0o600 })
  writeFileSync(target, JSON.stringify(after), { mode: 0o600 })
  const result = spawnSync(process.execPath, [generator, source, target, output], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, CI: 'true', RUNNER_TEMP: runnerTemp } })
  return { ...result, directory, output, sql: existsSync(output) ? readFileSync(output, 'utf8') : null,
    close: () => rmSync(runnerTemp, { recursive: true, force: true }) }
}
async function rejected(f, before = f.before) {
  const current = await rows(f.db), business = (await f.db.query('select * from public.synthetic_restore_business')).rows
  const result = generate(before, current)
  try {
    assert.notEqual(result.status, 0, 'unsupported catalog must not generate an applicable recovery')
    assert.equal(result.sql, null, 'unsupported recovery must produce no SQL file')
    assert.equal(result.stdout.includes(owner), false)
    assert.equal(result.stderr.includes(owner), false)
    assert.deepEqual(await rows(f.db), current)
    assert.deepEqual((await f.db.query('select * from public.synthetic_restore_business')).rows, business)
  } finally { result.close() }
}

test('actual five observed ACL losses generate exact source grants, grantors and grant options and recover the entire catalog', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    const after = await rows(f.db)
    for (const name of relations) {
      assert.equal(objectAcl(f.before, 'relation', 'extensions', name).length, 17)
      assert.equal(objectAcl(after, 'relation', 'extensions', name).length, 9)
    }
    for (const name of schemas) {
      assert.equal(objectAcl(f.before, 'schema', name, name).length, 6)
      assert.equal(objectAcl(after, 'schema', name, name).length, 2)
    }
    const business = (await f.db.query('select * from public.synthetic_restore_business')).rows
    const policies = (await f.db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    const roles = (await f.db.query('select rolname,rolsuper,rolcreaterole,rolcanlogin,rolbypassrls from pg_roles order by rolname')).rows
    const result = generate(f.before, after)
    try {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(statSync(result.output).mode & 0o777, 0o600)
      assert.match(result.sql, /DO \$bootstrap_acl_guard_1\$/)
      assert.match(result.sql, /SET LOCAL ROLE\s+/i)
      assert.match(result.sql, /WITH GRANT OPTION/i)
      assert.doesNotMatch(result.sql, /\b(?:REVOKE|CREATE\s+ROLE|ALTER\s+DEFAULT\s+PRIVILEGES|ALTER\s+.*OWNER)\b/i)
      await f.db.exec(result.sql)
      assert.deepEqual(await rows(f.db), f.before)
      assert.deepEqual((await f.db.query('select * from public.synthetic_restore_business')).rows, business)
      assert.deepEqual((await f.db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows, policies)
      assert.deepEqual((await f.db.query('select rolname,rolsuper,rolcreaterole,rolcanlogin,rolbypassrls from pg_roles order by rolname')).rows, roles)
      for (const name of relations) assert.ok(objectAcl(await rows(f.db), 'relation', 'extensions', name)
        .some(row => row.grantee === alpha && row.grantor === owner && row.privilege_type === 'SELECT' && row.is_grantable))
      const replay = generate(f.before, await rows(f.db))
      try {
        assert.equal(replay.status, 0, replay.stderr)
        assert.equal(replay.sql, '')
        assert.match(replay.stdout, /objects=0 missingPrivileges=0/)
      } finally { replay.close() }
    } finally { result.close() }
  } finally { await f.db.close() }
})

test('an extra target privilege on an allowed object rejects before any SQL or database effect', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`begin;set local role ${qi(owner)};grant delete on extensions.spatial_ref_sys to ${qi(beta)};commit;`)
    await rejected(f)
  } finally { await f.db.close() }
})
test('a missing ACL on any sixth object rejects instead of widening the bootstrap recovery list', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`revoke select on public.synthetic_restore_business from ${qi(beta)};`)
    await rejected(f)
  } finally { await f.db.close() }
})
test('global owner drift rejects even when all five bootstrap ACL losses are otherwise supported', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`alter table public.synthetic_restore_business owner to ${qi(beta)};`)
    await rejected(f)
  } finally { await f.db.close() }
})
test('global creator default ACL drift rejects without altering any default or repairing other grants', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`alter default privileges for role ${qi(owner)} grant select on tables to ${qi(beta)};`)
    await rejected(f)
  } finally { await f.db.close() }
})
test('view to table type drift rejects despite an unchanged qualified whitelist name', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`drop view extensions.geometry_columns;create table extensions.geometry_columns(synthetic_id integer);
      alter table extensions.geometry_columns owner to ${qi(owner)};begin;set local role ${qi(owner)};
      grant select on extensions.geometry_columns to public;commit;`)
    await rejected(f)
  } finally { await f.db.close() }
})
test('a genuine nonowner source grant chain rejects instead of manufacturing owner-attributed grants', async () => {
  const f = await fixture()
  try {
    await f.db.exec(`begin;set local role ${qi(alpha)};grant select on extensions.spatial_ref_sys to ${qi(gamma)};commit;`)
    const before = await rows(f.db)
    assert.ok(objectAcl(before, 'relation', 'extensions', 'spatial_ref_sys').some(row => row.grantor === alpha))
    await f.loseKnownGrants()
    await rejected(f, before)
  } finally { await f.db.close() }
})
test('a genuine nonowner target grant chain rejects even when its source privileges also exist', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`begin;set local role ${qi(owner)};grant select on extensions.spatial_ref_sys to ${qi(alpha)} with grant option;commit;
      begin;set local role ${qi(alpha)};grant select on extensions.spatial_ref_sys to ${qi(gamma)};commit;`)
    assert.ok(objectAcl(await rows(f.db), 'relation', 'extensions', 'spatial_ref_sys').some(row => row.grantor === alpha))
    await rejected(f)
  } finally { await f.db.close() }
})
test('grant-option downgrades are not silently treated as an exact target subset', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    await f.db.exec(`begin;set local role ${qi(owner)};grant select on extensions.spatial_ref_sys to ${qi(alpha)};commit;`)
    await rejected(f)
  } finally { await f.db.close() }
})

test('malformed catalog rows cannot produce an applicable recovery or expose private roles', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    for (const corrupt of [
      document => { delete document.acl[0].grantor },
      document => { document.acl[0].is_grantable = 'true' },
      document => { document.acl[0].grantee = 1 },
      document => { document.unexpected = 'private'; },
    ]) {
      const malformed = structuredClone(f.before)
      corrupt(malformed)
      await rejected(f, malformed)
    }
  } finally { await f.db.close() }
})

test('the exact generated SQL rechecks complete current target catalog before any grant and rolls back on drift', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    const result = generate(f.before, await rows(f.db))
    try {
      assert.equal(result.status, 0, result.stderr)
      await f.db.exec(`grant update on public.synthetic_restore_business to ${qi(beta)};`)
      const beforeApply = await rows(f.db)
      await assert.rejects(f.db.exec(result.sql), error => error.message === 'restore_bootstrap_target_catalog_changed')
      await f.db.exec('rollback;reset role;')
      assert.deepEqual(await rows(f.db), beforeApply)
      assert.equal(objectAcl(beforeApply, 'relation', 'extensions', 'spatial_ref_sys').length, 9)
    } finally { result.close() }
  } finally { await f.db.close() }
})

test('a late genuine grant failure leaves every earlier grant unapplied after transaction rollback', async () => {
  const f = await fixture()
  try {
    await f.loseKnownGrants()
    const result = generate(f.before, await rows(f.db))
    try {
      assert.equal(result.status, 0, result.stderr)
      // Role existence is deliberately outside the catalog ACL digest. Removing
      // an otherwise unreferenced synthetic role reaches the actual later GRANT.
      await f.db.exec(`drop role ${qi(delta)};`)
      const beforeApply = await rows(f.db)
      await assert.rejects(f.db.exec(result.sql), error => error.code === '42704')
      await f.db.exec('rollback;reset role;')
      assert.deepEqual(await rows(f.db), beforeApply)
    } finally { result.close() }
  } finally { await f.db.close() }
})
