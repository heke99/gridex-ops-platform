#!/usr/bin/env node
// Component regression only: actual pure status producer + PostgreSQL CHECK compatibility.
// No public dispatch/native replay/first-worker attribution/whole-contract approval.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { test } = require('node:test')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')

const root = path.resolve(__dirname, '..')
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migrationPath = 'supabase/migrations/20261006225500_customer_info_requests_z01_status_compatibility.sql'
const withoutMigration = process.argv.includes('--without-migration')

// Authenticated 929f3444 native run 37538439715, artifact 11448391720:
// ZIP SHA256 0d3a689bd5a6ec637b3460d0a2a07230d64a8d26d71e1a78346547c85a65ff2b.
// Exact pg_get_constraintdef from the actual customer_info_requests_status_check.
// Stored here as a declared historical schema input; no scratch/runtime receipt dependency.
const authentic17 = "CHECK ((status = ANY (ARRAY['draft'::text, 'missing_authorization'::text, 'ready_to_send'::text, 'sent_to_grid_owner'::text, 'waiting_for_contrl'::text, 'waiting_for_aperak'::text, 'waiting_for_z02'::text, 'z02_received'::text, 'negative_aperak'::text, 'manual_review_required'::text, 'missing_binding_info'::text, 'missing_termination_info'::text, 'ready_for_switch'::text, 'cancelled'::text, 'rejected'::text, 'completed'::text, 'blocked'::text])))"

function extractHistoricalCheck(file) {
  const sql = read(file)
  const start = sql.toLowerCase().indexOf('check (status in (')
  assert(start >= 0, `${file}: original status CHECK required`)
  let depth = 0, quoted = false
  for (let i = start; i < sql.length; i++) {
    const char = sql[i]
    if (char === "'") {
      if (quoted && sql[i + 1] === "'") { i++; continue }
      quoted = !quoted
    } else if (!quoted) {
      if (char === '(') depth++
      if (char === ')' && --depth === 0) return { predicate: sql.slice(start, i + 1), sourceHash: sha256(sql), file }
    }
  }
  throw new Error(`${file}: unterminated original CHECK`)
}

const producerPath = 'lib/onboarding/infoRequests.ts'
const producerSource = read(producerPath)
const ast = ts.createSourceFile(producerPath, producerSource, ts.ScriptTarget.Latest, true)
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'customerInfoStatusFromZ01Result')
assert.equal(functions.length, 1, 'exact actual status function required')
const actualFunction = functions[0].getText(ast)
const emitted = ts.transpileModule(`${actualFunction}\nmodule.exports = customerInfoStatusFromZ01Result;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
})
assert.equal((emitted.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
const context = { module: { exports: null } }
vm.runInNewContext(emitted.outputText, context, { timeout: 1000 })
const actualStatus = context.module.exports
const controls = [
  ['prepared', { prepared: true }, 'z01_prepared'],
  ['prepared precedence', { prepared: true, blockerCode: 'missing_power_of_attorney' }, 'z01_prepared'],
  ['operational_route_missing', { prepared: false, blockerCode: 'operational_route_missing' }, 'route_missing'],
  ['missing_route', { prepared: false, blockerCode: 'missing_route' }, 'route_missing'],
  ['missing_power_of_attorney', { prepared: false, blockerCode: 'missing_power_of_attorney' }, 'missing_authorization'],
  ['details route', { prepared: false, blockerDetails: { blocker_code: 'missing_route' } }, 'route_missing'],
  ['details POA', { prepared: false, blockerDetails: { blocker_code: 'missing_power_of_attorney' } }, 'missing_authorization'],
  ['unknown blocker', { prepared: false, blockerCode: 'SYNTHETIC_UNKNOWN' }, 'blocked'],
  ['no blocker', { prepared: false }, 'blocked'],
].map(([label, input, expected]) => {
  const status = actualStatus(input)
  assert.equal(status, expected, `actual producer ${label}`)
  return { label, status }
})
const historical = [
  { label: 'authentic17', predicate: authentic17, count: 17, sourceHash: sha256(authentic17) },
  { label: 'original19', count: 19, ...extractHistoricalCheck('supabase/migrations/20260521_final_customer_info_request_status_check.sql') },
  { label: 'original24', count: 24, ...extractHistoricalCheck('supabase/migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql') },
]
for (const source of historical) {
  source.statuses = [...source.predicate.matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.equal(source.statuses.length, source.count)
  assert.equal(new Set(source.statuses).size, source.count)
  if (source.count !== 17) assert(historical[0].statuses.every(status => source.statuses.includes(status)))
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function fixture(predicate, { missing = false, unvalidated = false, customOperator = false, constructionOperator = false } = {}) {
  const db = new PGlite()
  await db.waitReady
  const operatorSetup = `CREATE SCHEMA synthetic_operator;
    CREATE FUNCTION synthetic_operator.text_equal(text,text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
    CREATE OPERATOR synthetic_operator.= (FUNCTION=synthetic_operator.text_equal, LEFTARG=text, RIGHTARG=text);
    SET search_path=synthetic_operator,pg_catalog,public;`
  await db.exec(`CREATE ROLE synthetic_z01_reader;
    CREATE TABLE public.customer_info_requests (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, customer_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'blocked', marker text NOT NULL, payload jsonb NOT NULL,
      CONSTRAINT synthetic_other_guard CHECK (marker = 'SYNTHETIC_UNCHANGED'));
    ${customOperator ? operatorSetup : ''}
    ${missing ? '' : `ALTER TABLE public.customer_info_requests ADD CONSTRAINT customer_info_requests_status_check ${predicate}${unvalidated ? ' NOT VALID' : ''};
      COMMENT ON CONSTRAINT customer_info_requests_status_check ON public.customer_info_requests IS 'SYNTHETIC_STATUS_METADATA';`}
    ${constructionOperator ? operatorSetup : ''}
    CREATE INDEX synthetic_customer_info_company_idx ON public.customer_info_requests(company_id);
    COMMENT ON TABLE public.customer_info_requests IS 'SYNTHETIC_TABLE_METADATA';
    COMMENT ON COLUMN public.customer_info_requests.status IS 'SYNTHETIC_COLUMN_METADATA';
    CREATE TABLE public.synthetic_transactional_audit(request_id uuid, old_row jsonb, new_row jsonb);
    CREATE FUNCTION public.synthetic_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO public.synthetic_transactional_audit VALUES(NEW.id, to_jsonb(OLD), to_jsonb(NEW)); RETURN NEW; END $$;
    CREATE TRIGGER synthetic_status_audit AFTER UPDATE ON public.customer_info_requests
      FOR EACH ROW EXECUTE FUNCTION public.synthetic_status_audit();
    GRANT USAGE ON SCHEMA public TO synthetic_z01_reader;
    GRANT SELECT, UPDATE(status) ON public.customer_info_requests TO synthetic_z01_reader;
    GRANT INSERT ON public.synthetic_transactional_audit TO synthetic_z01_reader;
    ALTER TABLE public.customer_info_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.customer_info_requests FORCE ROW LEVEL SECURITY;
    CREATE POLICY synthetic_company_scope ON public.customer_info_requests TO synthetic_z01_reader
      USING (company_id = current_setting('z01.company_id', true)::uuid)
      WITH CHECK (company_id = current_setting('z01.company_id', true)::uuid);
    INSERT INTO public.customer_info_requests VALUES
      ('${id(1)}', '${id(2)}', '${id(3)}', 'blocked', 'SYNTHETIC_UNCHANGED', '{"own":"unchanged"}'),
      ('${id(4)}', '${id(5)}', '${id(6)}', 'blocked', 'SYNTHETIC_UNCHANGED', '{"foreign":"unchanged"}');`)
  return db
}

async function snapshot(db) {
  const rows = sql => db.query(sql).then(result => result.rows)
  return {
    rows: await rows('SELECT to_jsonb(r) row FROM public.customer_info_requests r ORDER BY id'),
    audit: await rows('SELECT to_jsonb(a) row FROM public.synthetic_transactional_audit a ORDER BY request_id'),
    table: await rows("SELECT relrowsecurity,relforcerowsecurity,relacl,relowner,obj_description(oid) comment FROM pg_class WHERE oid='public.customer_info_requests'::regclass"),
    columns: await rows("SELECT to_jsonb(a) metadata,col_description(attrelid,attnum) comment FROM pg_attribute a WHERE attrelid='public.customer_info_requests'::regclass AND attnum>0 ORDER BY attnum"),
    indexes: await rows("SELECT to_jsonb(i) metadata,pg_get_indexdef(indexrelid) definition FROM pg_index i WHERE indrelid='public.customer_info_requests'::regclass ORDER BY indexrelid"),
    triggers: await rows("SELECT to_jsonb(t) metadata,pg_get_triggerdef(oid) definition FROM pg_trigger t WHERE tgrelid='public.customer_info_requests'::regclass ORDER BY oid"),
    policies: await rows("SELECT to_jsonb(p) metadata FROM pg_policy p WHERE polrelid='public.customer_info_requests'::regclass ORDER BY oid"),
    function: await rows("SELECT proacl,proowner,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid='public.synthetic_status_audit()'::regprocedure"),
    otherConstraints: await rows("SELECT to_jsonb(c) metadata,pg_get_constraintdef(oid) definition,obj_description(oid) comment FROM pg_constraint c WHERE conrelid='public.customer_info_requests'::regclass AND conname<>'customer_info_requests_status_check' ORDER BY oid"),
    statusConstraint: await rows("SELECT to_jsonb(c) metadata,pg_get_constraintdef(oid) definition,obj_description(oid) comment FROM pg_constraint c WHERE conrelid='public.customer_info_requests'::regclass AND conname OPERATOR(pg_catalog.=) 'customer_info_requests_status_check'"),
  }
}

async function apply(db) {
  if (!withoutMigration) await db.exec(read(migrationPath))
}

async function tryUpdate(db, value, column = 'status') {
  const before = await snapshot(db)
  let result
  await db.exec('BEGIN;')
  try {
    const changed = await db.query(`UPDATE public.customer_info_requests SET ${column}=$1 WHERE id=$2 AND company_id=$3 RETURNING *`, [value, id(1), id(2)])
    assert.equal(changed.affectedRows, 1)
    assert.equal((await db.query('SELECT * FROM public.synthetic_transactional_audit')).rows.length, 1)
    result = { accepted: true }
  } catch (error) {
    if (!error.code) throw error
    result = { accepted: false, code: error.code, constraint: error.constraint_name || error.constraint || null }
  } finally {
    await db.exec('ROLLBACK;')
  }
  assert.deepEqual(await snapshot(db), before, 'UPDATE/refusal rollback preserves both full rows and all metadata')
  return result
}

function invariantMetadata(state) {
  const { statusConstraint, ...rest } = state
  return { ...rest, statusMetadata: statusConstraint.map(item => {
    const { oid, conbin, ...metadata } = item.metadata
    void oid; void conbin
    return { metadata, comment: item.comment }
  }) }
}

test('actual producer compatibility preserves recognized original CHECK17/19/24 and table protections', async () => {
  console.log(JSON.stringify({ componentOnly: true, withoutMigration, producerPath,
    producerSourceHash: sha256(producerSource), actualFunctionHash: sha256(actualFunction),
    migrationHash: withoutMigration ? null : sha256(read(migrationPath)),
    predicates: historical.map(({ label, sourceHash, predicate }) => ({ label, sourceHash, predicateHash: sha256(predicate) })) }))
  for (const source of [...historical, { ...historical[0], label: 'authentic17 with custom-first caller operator', constructionOperator: true }]) {
    const db = await fixture(source.predicate, { constructionOperator: source.constructionOperator })
    try {
      const before = await snapshot(db)
      const originalSearchPath = (await db.query('SHOW search_path')).rows
      if (source.count === 17) {
        for (const status of ['z01_prepared', 'route_missing']) {
          assert.deepEqual(await tryUpdate(db, status), { accepted: false, code: '23514', constraint: 'customer_info_requests_status_check' })
        }
      }
      await apply(db)
      assert.deepEqual((await db.query('SHOW search_path')).rows, originalSearchPath, 'successful repair/no-op preserves caller search_path')
      const repaired = await snapshot(db)
      assert.deepEqual(invariantMetadata(repaired), invariantMetadata(before), 'migration preserves all unrelated metadata/data and target constraint attributes/comment')
      if (source.count !== 17) assert.deepEqual(repaired, before, 'recognized19/24 is an exact OID/expression/metadata no-op')
      for (const { label, status } of controls) {
        const result = await tryUpdate(db, status)
        assert.equal(result.accepted, true, `${source.label}: actual ${label} → ${status} must persist; observed ${JSON.stringify(result)}`)
      }
      for (const status of source.statuses) assert.equal((await tryUpdate(db, status)).accepted, true, `${source.label}: preserve ${status}`)
      const allowed = [...repaired.statusConstraint[0].definition.matchAll(/'([^']+)'/g)].map(match => match[1])
      assert.deepEqual([...allowed].sort(), [...new Set([...source.statuses, 'z01_prepared', 'route_missing'])].sort(), 'exact old values plus two; no broadening')
      for (const value of [null, 'synthetic_unknown', 'SYNTHETIC_UNKNOWN', 'Z01_PREPARED', 'ROUTE_MISSING', 'Missing_Authorization', 'BLOCKED', 'draft ']) {
        const result = await tryUpdate(db, value)
        assert.equal(result.accepted, false, `${source.label}: invalid status ${JSON.stringify(value)} must refuse; observed ${JSON.stringify(result)}`)
        assert.equal(result.code, value === null ? '23502' : '23514')
        if (value !== null) assert.equal(result.constraint, 'customer_info_requests_status_check')
      }
      assert.deepEqual(await tryUpdate(db, 'SYNTHETIC_CHANGED', 'marker'), { accepted: false, code: '23514', constraint: 'synthetic_other_guard' })
      await db.exec(`BEGIN; SET LOCAL ROLE synthetic_z01_reader; SELECT set_config('z01.company_id','${id(2)}',true);`)
      assert.equal((await db.query('SELECT id FROM public.customer_info_requests')).rows.length, 1)
      assert.equal((await db.query('UPDATE public.customer_info_requests SET status=$1 WHERE id=$2', ['blocked', id(4)])).affectedRows, 0)
      assert.equal((await db.query('UPDATE public.customer_info_requests SET status=$1 WHERE id=$2', ['z01_prepared', id(1)])).affectedRows, 1)
      await db.exec('ROLLBACK;')
      assert.deepEqual(await snapshot(db), repaired, 'real restricted-role RLS update leaves own/foreign rows and audit unchanged after rollback')
      await apply(db)
      assert.deepEqual(await snapshot(db), repaired, 'idempotent replay preserves target OID/expression and all metadata')
      console.log(`${source.label}: producer/old/null/unknown/other CHECK/RLS/ACL/metadata/idempotency PASS`)
    } finally { await db.close() }
  }
})

test('unknown, mixed-column, NOT VALID and missing status CHECK fail closed without any change', { skip: withoutMigration }, async () => {
  const cases = [
    ['unknown extra allowed status', authentic17.replace("'blocked'::text", "'blocked'::text, 'synthetic_extra'::text"), {}],
    ['unknown extra predicate', `${authentic17.slice(0, -1)} AND status <> 'draft')`, {}],
    ['mixed-column predicate', `${authentic17.slice(0, -1)} AND marker = 'SYNTHETIC_UNCHANGED')`, {}],
    ['NOT VALID', authentic17, { unvalidated: true }],
    ['missing', authentic17, { missing: true }],
    ['visible custom equality operator', authentic17, { customOperator: true }],
  ]
  for (const [label, predicate, options] of cases) {
    const db = await fixture(predicate, options)
    try {
      const before = await snapshot(db)
      const originalSearchPath = (await db.query('SHOW search_path')).rows
      await assert.rejects(apply(db), error => error.code === 'P0001' && error.message === 'customer_info_requests_status_compatibility_unrecognized', `${label}: genuine named migration refusal required`)
      assert.deepEqual((await db.query('SHOW search_path')).rows, originalSearchPath, `${label}: caller search_path preserved`)
      assert.deepEqual(await snapshot(db), before, `${label}: refusal preserves all data/protections/metadata`)
      console.log(`${label}: fail-closed/no-change PASS`)
    } finally { await db.close() }
  }
})
