#!/usr/bin/env node
// Isolated PostgreSQL catalog regression. Install @electric-sql/pglite@0.3.14
// outside the repository and set GRIDEX_PGLITE_MODULE to its dist/index.js.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, delimiter, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const scripts = dirname(fileURLToPath(import.meta.url))
const modulePath = process.env.GRIDEX_PGLITE_MODULE
const { PGlite } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '@electric-sql/pglite')
const temp = mkdtempSync(join(tmpdir(), 'gridex-parity-semantics-'))
const db = new PGlite()
const failures = []
const test = (name, fn) => { try { fn(); console.log(`PASS: ${name}`) } catch (error) { failures.push(name); console.error(`FAIL: ${name}: ${error.message}`) } }
try {
  await db.exec(`create role parity_reader;
    create schema parity_semantics;
    create table parity_semantics.records (id integer);
    create view parity_semantics.visible_records with (security_invoker=true, security_barrier=true) as select id from parity_semantics.records;
    create function parity_semantics.answer() returns integer language sql as 'select 42';
    grant select on parity_semantics.records to parity_reader;
    grant execute on function parity_semantics.answer() to parity_reader;
    grant usage on schema parity_semantics to parity_reader;`)
  const sql = readFileSync(join(scripts, 'sql/gridex-db-parity-introspect.sql'), 'utf8').replaceAll(":'schemas'", "'{parity_semantics}'")
  const capture = async () => JSON.parse((await db.query(sql)).rows[0].jsonb_pretty)
  const baseline = await capture()
  writeFileSync(join(temp, 'psql'), `#!${process.execPath}\nconst fs=require('node:fs'); process.stdout.write(fs.readFileSync(process.argv[2].endsWith('/canonical')?process.env.GRIDEX_TEST_CANONICAL:process.env.GRIDEX_TEST_TARGET));\n`, {mode: 0o755})
  writeFileSync(join(temp, 'pg_dump'), `#!${process.execPath}\nprocess.stdout.write('-- fixture dump: only fingerprint behavior is tested\\n');\n`, {mode: 0o755})
  const env = {...process.env, PATH: `${temp}${delimiter}${process.env.PATH}`, GRIDEX_TEST_CANONICAL: join(temp, 'canonical.json'), GRIDEX_TEST_TARGET: join(temp, 'target.json'), GRIDEX_PG_DUMP: join(temp, 'pg_dump')}
  const compare = (left, right) => {
    writeFileSync(env.GRIDEX_TEST_CANONICAL, JSON.stringify(left)); writeFileSync(env.GRIDEX_TEST_TARGET, JSON.stringify(right))
    const result = spawnSync(process.execPath, [join(scripts, 'gridex-db-parity.cjs'), '--canonical', 'postgresql://fixture/canonical', '--target', 'postgresql://fixture/target', '--schemas', 'parity_semantics', '--mode', 'blocking', '--no-ignore', '--json', join(temp, 'report.json')], {env, encoding:'utf8'})
    return {...result, findings: result.status === 0 || result.status === 1 ? JSON.parse(readFileSync(join(temp, 'report.json'), 'utf8')).findings : []}
  }
  const snapshot = document => {
    writeFileSync(env.GRIDEX_TEST_CANONICAL, JSON.stringify(document))
    const result = spawnSync(process.execPath, [join(scripts, 'gridex-schema-snapshot.cjs'), '--url', 'postgresql://fixture/canonical', '--schemas', 'parity_semantics', '--mode', 'write', '--out-dir', join(temp, 'snapshot')], {env, encoding:'utf8'})
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(readFileSync(join(temp, 'snapshot/schema.fingerprint.json'), 'utf8'))
  }
  const identical = await capture()
  test('identical independently captured schema has no drift', () => assert.equal(compare(baseline, identical).status, 0))
  const baseFingerprint = snapshot(baseline)
  const mutations = [
    ['view security_invoker', 'alter view parity_semantics.visible_records set (security_invoker=false)', 'relations', 'reloptions'],
    ['view security_barrier', 'alter view parity_semantics.visible_records set (security_barrier=false)', 'relations', 'reloptions'],
    ['table options', 'alter table parity_semantics.records set (fillfactor=80)', 'relations', 'reloptions'],
    ['relation grant option', 'grant select on parity_semantics.records to parity_reader with grant option', 'relation_grants', 'is_grantable'],
    ['function grant option', 'grant execute on function parity_semantics.answer() to parity_reader with grant option', 'function_grants', 'is_grantable'],
    ['schema grant option', 'grant usage on schema parity_semantics to parity_reader with grant option', 'schema_grants', 'is_grantable'],
  ]
  for (const [name, mutation, section, field] of mutations) {
    await db.exec('begin'); await db.exec(mutation)
    const changed = await capture()
    await db.exec('rollback')
    for (const [direction, left, right] of [['forward', baseline, changed], ['reverse', changed, baseline]]) {
      test(`${name} detected ${direction}`, () => {
        const result = compare(left, right)
        assert.equal(result.status, 1, result.stderr || 'blocking comparator accepted altered catalog')
        assert.equal(result.findings.length, 1)
        assert.equal(result.findings[0].section, section)
        assert.equal(result.findings[0].field, field)
      })
    }
    test(`${name} changes snapshot fingerprint`, () => assert.notEqual(snapshot(changed).sha256, baseFingerprint.sha256))
  }
  await db.exec('alter view parity_semantics.visible_records reset (security_invoker, security_barrier); alter view parity_semantics.visible_records set (security_barrier=true, security_invoker=true)')
  const reordered = await capture()
  test('option insertion order does not cause drift', () => assert.equal(compare(baseline, reordered).status, 0))
  test('option insertion order preserves fingerprint', () => assert.equal(snapshot(reordered).sha256, baseFingerprint.sha256))
  await db.exec(`create role parity_grantor;
    grant usage on schema parity_semantics to parity_grantor;
    grant select on parity_semantics.records to parity_grantor with grant option;
    set role parity_grantor;
    grant select on parity_semantics.records to parity_reader with grant option;
    reset role;`)
  const multipleGrantors = await capture()
  test('multiple grantors cannot silently collapse delegation semantics', () => {
    assert.equal(multipleGrantors.relation_grants.filter(row => row.relname === 'records' && row.grantee === 'parity_reader' && row.privilege_type === 'SELECT').length, 2)
    const result = compare(multipleGrantors, multipleGrantors)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /ambiguous relation grant identity/)
  })
  for (const [section, field] of [['relations','reloptions'], ['relation_grants','is_grantable'], ['function_grants','is_grantable'], ['schema_grants','is_grantable']]) {
    const incomplete = structuredClone(baseline); delete incomplete[section][0][field]
    test(`missing ${section}.${field} fails closed`, () => assert.equal(compare(incomplete, incomplete).status, 2))
  }
} finally { await db.close(); rmSync(temp, {recursive:true, force:true}) }
assert.equal(failures.length, 0, `${failures.length} parity semantics checks failed`)
console.log('PASS: isolated catalog semantics only; no canonical or production parity claim')
