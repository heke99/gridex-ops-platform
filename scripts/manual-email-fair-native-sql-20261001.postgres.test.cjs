const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { PGlite } = require('@electric-sql/pglite')

// Compile only the actual trusted snapshot builder, never run the native suite.
const native = readFileSync(resolve(__dirname, 'manual-email-fair-claim-20261001-native.test.ts'), 'utf8')
const quote = native.match(/^const quote = .*$/m)?.[0]
const start = native.indexOf('function otherRows(')
const end = native.indexOf('\nfunction fixture(', start)
assert.ok(quote && start >= 0 && end > start)
assert.equal(native.indexOf('function otherRows(', start + 1), -1)
const emitted = stripTypeScriptTypes(quote + '\n' + native.slice(start, end), { mode: 'strip' })
const otherRowsSql = new Function('sql', emitted + ';return otherRows;')(command => command)
const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const manualDDL = schema.match(/CREATE TABLE public\.manual_email_outbox \([\s\S]*?\n\);/)?.[0]
assert.ok(manualDDL, 'actual published manual_email_outbox DDL required')
const id = n => 'e9330000-0000-4000-8000-' + String(n).padStart(12, '0')
const owned = [id(1), id(2)]

async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE SCHEMA private;
    CREATE TABLE public.companies(id uuid PRIMARY KEY,name text,status text);
    CREATE TABLE public.snapshot_scoped(id uuid PRIMARY KEY,company_id uuid,amount numeric(40,8),payload jsonb);
    CREATE TABLE private.snapshot_scoped(id uuid PRIMARY KEY,company_id uuid,payload text);
    CREATE TABLE private.snapshot_legal(id uuid PRIMARY KEY,amount numeric(40,8),payload jsonb);
    ${manualDDL}
    INSERT INTO public.companies VALUES('${id(1)}','owned A','active'),('${id(2)}','owned B','active'),('${id(3)}','foreign','active');
    INSERT INTO public.snapshot_scoped VALUES
      ('${id(11)}','${id(1)}',1.00000001,'{"kind":"owned"}'),
      ('${id(12)}','${id(3)}',10000000000000000000.00000001,'{"kind":"foreign"}'),
      ('${id(13)}',NULL,10000000000000000000.00000002,'{"kind":"nullable"}');
    INSERT INTO private.snapshot_scoped VALUES
      ('${id(21)}','${id(2)}','owned'),('${id(22)}','${id(3)}','foreign'),('${id(23)}',NULL,'nullable');
    INSERT INTO private.snapshot_legal VALUES('${id(31)}',10000000000000000000.00000003,'{"kind":"already-created-legal-child"}');`)
  return {
    db,
    async snapshot(companies = owned) {
      // Native psql opens a fresh connection; the core fixture reuses one.
      await db.exec('DROP TABLE IF EXISTS pg_temp.original_row_hashes;')
      try {
        const results = await db.exec(otherRowsSql(companies))
        return results.at(-1).rows[0].jsonb_agg
      } catch (error) {
        // A RED must not print PostgreSQL's private query/context payload.
        throw Object.assign(new Error('actual_other_rows_snapshot_sqlstate_' + error.code), { code: error.code })
      }
    },
    async complete() {
      const result = await db.query(`SELECT encode(sha256(convert_to(jsonb_build_object(
        'companies',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.companies t),
        'public_scoped',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.snapshot_scoped t),
        'private_scoped',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM private.snapshot_scoped t),
        'unscoped',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM private.snapshot_legal t),
        'manual',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.manual_email_outbox t))::text,'UTF8')),'hex') AS digest;`)
      return result.rows[0].digest
    },
  }
}
const surface = (snapshot, name) => snapshot.find(row => row.surface === name)

test('actual two-company snapshot SQL parses and includes foreign, NULL and existing legal rows', async () => {
  const f = await fixture()
  try {
    const rows = await f.snapshot()
    assert.deepEqual(rows.map(row => [row.surface, row.rows]), [
      ['private.snapshot_legal', 1], ['private.snapshot_scoped', 2],
      ['public.companies', 1], ['public.manual_email_outbox', 0], ['public.snapshot_scoped', 2],
    ])
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.digest)))
  } finally { await f.db.close() }
})

test('actual snapshot is read-only and deterministic across calls', async () => {
  const f = await fixture()
  try {
    const before = await f.complete()
    assert.deepEqual(await f.snapshot(), await f.snapshot())
    assert.equal(await f.complete(), before)
  } finally { await f.db.close() }
})

test('owned rows stay excluded while a NULL-company change remains visible', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    await f.db.exec(`UPDATE public.companies SET name='owned changed' WHERE id='${id(1)}';
      UPDATE public.snapshot_scoped SET payload='{"kind":"owned changed"}' WHERE id='${id(11)}';
      UPDATE private.snapshot_scoped SET payload='owned changed' WHERE id='${id(21)}';`)
    assert.deepEqual(await f.snapshot(), before)
    await f.db.exec(`UPDATE public.snapshot_scoped SET payload='{"kind":"NULL changed"}' WHERE id='${id(13)}';`)
    const after = await f.snapshot()
    assert.notEqual(surface(after, 'public.snapshot_scoped').digest, surface(before, 'public.snapshot_scoped').digest)
    assert.deepEqual(after.filter(row => row.surface !== 'public.snapshot_scoped'), before.filter(row => row.surface !== 'public.snapshot_scoped'))
  } finally { await f.db.close() }
})

test('foreign numeric precision is hashed inside PostgreSQL before JavaScript', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    await f.db.exec(`UPDATE public.snapshot_scoped SET amount=amount+0.00000001 WHERE id='${id(12)}';`)
    const after = await f.snapshot()
    assert.notEqual(surface(after, 'public.snapshot_scoped').digest, surface(before, 'public.snapshot_scoped').digest)
    assert.deepEqual(after.filter(row => row.surface !== 'public.snapshot_scoped'), before.filter(row => row.surface !== 'public.snapshot_scoped'))
  } finally { await f.db.close() }
})

test('existing unscoped legal rows are protected and rollback restores the complete graph', async () => {
  const f = await fixture()
  try {
    const complete = await f.complete(), before = await f.snapshot()
    await f.db.exec(`BEGIN;UPDATE private.snapshot_legal SET amount=amount+0.00000001;`)
    assert.notEqual(surface(await f.snapshot(), 'private.snapshot_legal').digest, surface(before, 'private.snapshot_legal').digest)
    await f.db.exec('ROLLBACK;')
    assert.deepEqual(await f.snapshot(), before)
    assert.equal(await f.complete(), complete)
  } finally { await f.db.close() }
})

test('single-company quoting retains the other company rather than excluding it', async () => {
  const f = await fixture()
  try {
    const rows = await f.snapshot([id(1)])
    assert.equal(surface(rows, 'public.companies').rows, 2)
    assert.equal(surface(rows, 'private.snapshot_scoped').rows, 3)
  } finally { await f.db.close() }
})
