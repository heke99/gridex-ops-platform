/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node --test CommonJS entrypoint; no production module or browser bundle. */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')

const source = readFileSync(join(__dirname, 'webhook-readonly-controls-20261001-native.test.ts'), 'utf8')
const currentSql = source.match(/\/\/ ROW_FINGERPRINT_PROOF_BEGIN([\s\S]*?)\/\/ ROW_FINGERPRINT_PROOF_END/)
assert.ok(currentSql, 'actual owned native PostgreSQL fingerprint implementation must be present')
const actual = runInNewContext(ts.transpileModule(currentSql[1], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\n databaseRowsFingerprintSql;')

async function fingerprint(db, relation = 'public.fingerprint_rows') {
  return (await db.query(actual(relation))).rows[0].to_jsonb
}
async function fixture() {
  const db = await PGlite.create()
  await db.exec(`CREATE TABLE public.fingerprint_rows(id integer, large bigint, precise numeric, payload jsonb);
    INSERT INTO public.fingerprint_rows VALUES(1,9007199254740992,0.123456789123456789,'{"large":9007199254740992}');`)
  return db
}
test('actual native fingerprint detects bigint changes invisible after JavaScript JSON parsing', async () => {
  const db = await fixture()
  try {
    const before = await fingerprint(db)
    await db.exec('UPDATE public.fingerprint_rows SET large=9007199254740993;')
    assert.notEqual(await fingerprint(db), before)
  } finally { await db.close() }
})
test('actual native fingerprint detects exact numeric changes below JavaScript double precision', async () => {
  const db = await fixture()
  try {
    const before = await fingerprint(db)
    await db.exec('UPDATE public.fingerprint_rows SET precise=0.123456789123456790;')
    assert.notEqual(await fingerprint(db), before)
  } finally { await db.close() }
})
test('actual native fingerprint detects large JSON numbers before any JavaScript projection', async () => {
  const db = await fixture()
  try {
    const before = await fingerprint(db)
    await db.exec(`UPDATE public.fingerprint_rows SET payload='{"large":9007199254740993}';`)
    assert.notEqual(await fingerprint(db), before)
  } finally { await db.close() }
})
test('actual native fingerprint remains stable when physical row insertion order changes', async () => {
  const db = await fixture()
  try {
    await db.exec(`INSERT INTO public.fingerprint_rows VALUES(2,5,7,'{}');`)
    const before = await fingerprint(db)
    await db.exec(`CREATE TEMP TABLE swapped AS SELECT * FROM public.fingerprint_rows;
      TRUNCATE public.fingerprint_rows; INSERT INTO public.fingerprint_rows SELECT * FROM swapped ORDER BY id DESC;`)
    assert.equal(await fingerprint(db), before)
  } finally { await db.close() }
})
test('actual native fingerprint retains an exact empty relation digest', async () => {
  const db = await fixture()
  try {
    await db.exec('TRUNCATE public.fingerprint_rows;')
    assert.equal(await fingerprint(db), createHash('sha256').update('[]').digest('hex'))
  } finally { await db.close() }
})
test('actual native fingerprint refuses a missing required relation instead of accepting empty finance', async () => {
  const db = await fixture()
  try { await assert.rejects(fingerprint(db, 'public.missing_fingerprint_rows'), /does not exist/) }
  finally { await db.close() }
})
