// SC046 prerequisite SOURCE component only; no native/ACK/whole-contract claim.
// Actual schema-derived business tables/index and actual atomic PL/pgSQL execute
// in finite in-process PGlite. Tenant/customer/point authority rows are declared
// synthetic ports. No PostgreSQL server, source-original collection or transport.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const hash = text => createHash('sha256').update(text).digest('hex')
const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
const migrationPath = 'supabase/migrations/20261015003736_ediel_sc046_newest_metering_duplicate_guard.sql'
const signature = 'public.gridex_ingest_metering_value_atomic(jsonb)'
const oldHash = 'a5806ee9dce67d299e1e06cb4eb47f19a90710c9a9760f35aa071fb7c70b5f9f'
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uid(1), customer = uid(2), point = uid(3), firstSource = uid(4), nextSource = uid(5)
const result = { scope: 'DECLARED_SYNTHETIC_SOURCE_SQL_COMPONENT_ONLY', oldBaseline: null, checks: [] }
function table(name) {
  const marker = `CREATE TABLE ${name} (`
  assert.equal(schema.split(marker).length, 2, `unique actual table ${name}`)
  const tail = schema.slice(schema.indexOf(marker))
  return tail.slice(0, tail.indexOf('\n);') + 3)
}
function definition(name) {
  const marker = `CREATE FUNCTION ${name}(`
  assert.equal(schema.split(marker).length, 2, `unique actual function ${name}`)
  const tail = schema.slice(schema.indexOf(marker)), dollar = /\bAS (\$\$|\$_\$)/.exec(tail)
  assert(dollar)
  const end = tail.indexOf(`${dollar[1]};`, dollar.index + dollar[0].length)
  assert(end > 0)
  return tail.slice(0, end + dollar[1].length + 1)
}
const originalAtomic = readFileSync(resolve('supabase/migrations/20260901165500_link_ediel_sources_during_atomic_metering_ingest_recovery.sql'), 'utf8')
assert.equal(hash(originalAtomic), '8c8edf8b15a32587082e39361b4f415fdf96eea0ee3e422a45bde2a6a65255e3')
const body = /\bas \$\$([\s\S]*?)\$\$;/i.exec(originalAtomic)?.[1]
assert.equal(hash(body), oldHash)
const atomicDDL = definition('public.gridex_ingest_metering_value_atomic')
const bodyDelimiter = /\bAS (\$\$|\$_\$)/.exec(atomicDDL)
assert(bodyDelimiter)
const currentBody = atomicDDL.slice(bodyDelimiter.index + bodyDelimiter[0].length, atomicDDL.lastIndexOf(bodyDelimiter[1] + ';'))
// GEN may later carry the new body. Fixture always installs exact immutable
// original a580; the actual forward remains the only implementation under test.
const oldDDL = atomicDDL.replace(/^CREATE FUNCTION /, 'CREATE OR REPLACE FUNCTION ').replace(currentBody, () => body)
const indexLine = schema.split('\n').filter(line => line.startsWith('CREATE UNIQUE INDEX ux_metering_values_company_ediel_duplicate_guard '))
assert.equal(indexLine.length, 1)
assert.equal(hash(indexLine[0]), 'eb2cc04b810f3015a19c5cd7eb50f440a306aeb50153c824f55182af56efcab2')
const db = new PGlite()
let checks = 0
async function check(label, action) { await action(); result.checks.push(label); checks++ }
async function metadata() {
  return (await db.query(`SELECT to_jsonb(p)-'prosrc' AS meta, p.prosrc AS body FROM pg_proc p WHERE oid=$1::regprocedure`, [signature])).rows[0]
}
async function witnesses() {
  return (await db.query(`SELECT jsonb_build_object(
   'otherFunctions',(SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid<>$1::regprocedure AND (n.nspname='public' OR starts_with(n.nspname,'gridex_'))),
   'index',(SELECT jsonb_build_object('class',to_jsonb(c),'index',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid='public.ux_metering_values_company_ediel_duplicate_guard'::regclass)) AS value`, [signature])).rows[0].value
}
async function snapshot() {
  return (await db.query(`SELECT jsonb_build_object(
   'meter',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.metering_values m),
   'normalized',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.normalized_metering_values n),
   'sources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.metering_value_sources s)) AS state`)).rows[0].state
}
async function call(payload) {
  return (await db.query('SELECT to_jsonb(public.gridex_ingest_metering_value_atomic($1::jsonb)) AS value', [JSON.stringify(payload)])).rows[0].value
}
async function reset() { await db.exec('TRUNCATE public.metering_value_sources, public.normalized_metering_values, public.metering_values') }
const payload = (quantity, reference, source = firstSource) => ({
  company_id: company, customer_id: customer, metering_point_id: point,
  period_start: '2026-07-01T00:00:00Z', period_end: '2026-07-01T00:15:00Z', read_at: '2026-07-01T00:15:00Z',
  value_kwh: quantity, quality_code: 'actual', reading_type: 'consumption', direction: 'consumption', unit: 'kWh',
  register_code: 'R1', product_code: 'P1', canonical_dedupe_key: 'declared-component-one-key',
  source_system: 'grid_owner', source_ediel_message_id: source, source_transaction_reference: reference,
  source_line_reference: '1', raw_payload: { declaredSyntheticSource: true }, resolution: 'PT15M',
})
async function rejectsAtomic(label, input, code, constraint) {
  const before = await snapshot()
  await assert.rejects(() => call(input), error => error.code === code && (!constraint || error.constraint === constraint), label)
  assert.deepEqual(await snapshot(), before, `${label}: entire attempted revision rolled back`)
}
async function setup() {
  await db.exec(`CREATE ROLE service_role; CREATE SCHEMA gridex_utilts_binding;
   CREATE TABLE public.customers(id uuid, company_id uuid);
   CREATE TABLE public.metering_points(id uuid, company_id uuid, customer_id uuid);
   INSERT INTO public.customers VALUES('${customer}','${company}');
   INSERT INTO public.metering_points VALUES('${point}','${company}','${customer}');`)
  for (const name of ['public.metering_values', 'public.normalized_metering_values', 'public.metering_value_sources',
    'public.meter_reading_series', 'public.ediel_messages']) await db.exec(table(name))
  for (const name of ['public.metering_values', 'public.normalized_metering_values', 'public.metering_value_sources']) {
    const escaped = name.replaceAll('.', '\\.')
    const constraints = [...schema.matchAll(new RegExp(`ALTER TABLE ONLY ${escaped}\\n    ADD CONSTRAINT [^;]+;`, 'g'))]
      .map(match => match[0]).filter(sql => /PRIMARY KEY|UNIQUE/.test(sql))
    for (const sql of constraints) await db.exec(sql)
  }
  await db.exec(indexLine[0])
  for (const name of ['public.gridex_consume_utilts_metering_v1', 'gridex_utilts_binding.check_metering_result_v1']) await db.exec(definition(name))
  await db.exec(oldDDL)
  await db.exec(`REVOKE ALL ON FUNCTION public.gridex_ingest_metering_value_atomic(jsonb) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.gridex_ingest_metering_value_atomic(jsonb) TO service_role`)
}
try {
  await setup()
  await check('actual old atomic reproduces distinct-reference NEWEST23505 with complete rollback', async () => {
    const first = await call(payload(500, 'DECLARED-NEWER'))
    assert.equal(first.value_kwh, 500); assert.equal(first.source_transaction_id, null)
    await rejectsAtomic('old NEWEST', payload(11, 'DECLARED-NEWEST', nextSource), '23505', 'ux_metering_values_company_ediel_duplicate_guard')
    result.oldBaseline = { state: 'RED_REPRODUCED_ACTUAL_ATOMIC', code: '23505', constraint: 'ux_metering_values_company_ediel_duplicate_guard' }
  })
  if (process.argv.includes('--baseline-only')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const forward = readFileSync(resolve(migrationPath), 'utf8'), before = await metadata(), rowsBefore = await snapshot(), guardsBefore = await witnesses()
    await check('actual forward preserves target metadata and all preexisting business rows', async () => {
      await db.exec(forward)
      const after = await metadata()
      assert.deepEqual(after.meta, before.meta)
      assert.equal(hash(after.body), '7c3afe5c7fec6a5def5b0b64d4459bf6af21369a8e55e647c50308e772815af7')
      assert.deepEqual(await snapshot(), rowsBefore)
      assert.deepEqual(await witnesses(), guardsBefore)
      result.prosrc = { before: hash(before.body), after: hash(after.body) }
    })
    await check('existing original NULL legacy-ID history is retained when distinct-reference correction arrives after forward', async () => {
      const prior = rowsBefore.meter[0], next = await call(payload(11, 'DECLARED-NEWEST', nextSource)), state = await snapshot()
      assert.equal(next.value_kwh, 11); assert.equal(next.previous_value_id, prior.id)
      assert.equal(state.meter.find(row => row.id === prior.id).source_transaction_id, null)
      assert.equal(state.meter.find(row => row.id === prior.id).value_kwh, 500)
      assert.equal(state.meter.length, 2); assert.equal(state.normalized.length, 2); assert.equal(state.sources.length, 2)
    })
    await reset()
    await check('distinct-reference500 to11 revision retains500 history, normalized rows and two source links', async () => {
      const first = await call(payload(500, 'DECLARED-NEWER')), next = await call(payload(11, 'DECLARED-NEWEST', nextSource))
      const state = await snapshot(), prior = state.meter.find(row => row.id === first.id)
      assert.equal(state.meter.length, 2); assert.equal(state.meter.filter(row => row.is_current).length, 1)
      assert.equal(first.source_transaction_id, 'DECLARED-NEWER'); assert.equal(next.source_transaction_id, 'DECLARED-NEWEST')
      assert.equal(next.value_kwh, 11); assert.equal(next.previous_value_id, first.id); assert.equal(next.revision_number, 2)
      assert.equal(prior.value_kwh, 500); assert.equal(prior.is_current, false); assert.equal(prior.revision_status, 'replaced'); assert.equal(prior.replaced_by_value_id, next.id)
      assert.equal(state.normalized.length, 2); assert.equal(state.sources.length, 2)
      assert.equal(state.normalized.find(row => row.source_metering_value_id === next.id).quantity_kwh, 11)
      assert.equal(state.normalized.find(row => row.source_metering_value_id === first.id).quantity_kwh, 500)
      const saved = await snapshot(), retry = await call(payload(11, 'DECLARED-NEWEST', nextSource))
      assert.equal(retry.id, next.id); assert.deepEqual(await snapshot(), saved)
    })
    await check('same nonblank reference quantity change retains23505 and atomic rollback', async () => {
      await rejectsAtomic('same reference', payload(13, 'DECLARED-NEWEST', nextSource), '23505', 'ux_metering_values_company_ediel_duplicate_guard')
    })
    await check('same-value different-source reuse preserves one current row and records only its new lineage', async () => {
      const saved = await snapshot(), current = saved.meter.find(row => row.is_current)
      const reused = await call(payload(11, 'DECLARED-EQUAL', uid(6))), state = await snapshot()
      assert.equal(reused.id, current.id)
      assert.deepEqual(state.meter, saved.meter); assert.deepEqual(state.normalized, saved.normalized)
      assert.equal(state.sources.length, saved.sources.length + 1)
    })
    await reset()
    await check('blank and missing references retain legacy23505 and atomic rollback', async () => {
      const first = await call(payload(500, '')); assert.equal(first.source_transaction_id, null)
      await rejectsAtomic('blank', payload(11, '', nextSource), '23505', 'ux_metering_values_company_ediel_duplicate_guard')
      const missing = payload(11, '', nextSource); delete missing.source_transaction_reference
      await rejectsAtomic('missing', missing, '23505', 'ux_metering_values_company_ediel_duplicate_guard')
    })
    await check('tenant, key, period, direction and unit validation failures remain atomic', async () => {
      for (const [key, value, code] of [['company_id', null, '22023'], ['canonical_dedupe_key', null, '22023'],
        ['customer_id', uid(90), '23503'], ['metering_point_id', uid(91), '23503'],
        ['period_end', '2026-06-30T23:00:00Z', '22023'], ['direction', 'forged', '22023'], ['unit', 'forged', '22023']]) {
        await rejectsAtomic(key, { ...payload(13, 'OTHER'), [key]: value }, code)
      }
    })
    await check('unchanged legacy expression index rejects a duplicate even with a different canonical key', async () => {
      const saved = await snapshot()
      await assert.rejects(() => db.query(`INSERT INTO public.metering_values(
       id,company_id,customer_id,metering_point_id,period_start,period_end,reading_type,register_code,product_code,meter_number,source_transaction_id,canonical_dedupe_key)
       SELECT $1,company_id,customer_id,metering_point_id,period_start,period_end,reading_type,register_code,product_code,meter_number,source_transaction_id,'declared-other-key'
       FROM public.metering_values LIMIT 1`, [uid(70)]),
      error => error.code === '23505' && error.constraint === 'ux_metering_values_company_ediel_duplicate_guard')
      assert.deepEqual(await snapshot(), saved)
    })
    const cleanDefinition = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS value', [signature])).rows[0].value
    await check('second migration execution refuses unexpected predecessor and changes nothing', async () => {
      const saved = await snapshot(), meta = await metadata()
      await assert.rejects(() => db.exec(forward), /sc046_duplicate_guard_predecessor_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta)
    })
    await check('tampered original body refuses migration before any source/data change', async () => {
      await db.exec(oldDDL.replace(body, () => body + '\n-- DECLARED TAMPER'))
      const saved = await snapshot(), meta = await metadata()
      await assert.rejects(() => db.exec(forward), /sc046_duplicate_guard_predecessor_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta)
      await db.exec(oldDDL)
    })
    await check('tampered original target security metadata refuses migration atomically', async () => {
      await db.exec('ALTER FUNCTION public.gridex_ingest_metering_value_atomic(jsonb) SECURITY INVOKER')
      const saved = await snapshot(), meta = await metadata()
      await assert.rejects(() => db.exec(forward), /sc046_duplicate_guard_metadata_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta)
      await db.exec('ALTER FUNCTION public.gridex_ingest_metering_value_atomic(jsonb) SECURITY DEFINER')
    })
    await check('tampered helper refuses migration without changing target, rows or other catalog entries', async () => {
      const helper = definition('gridex_utilts_binding.check_metering_result_v1').replace(/^CREATE FUNCTION /, 'CREATE OR REPLACE FUNCTION ')
      await db.exec(helper.replace(/\bAS (\$\$|\$_\$)/, (_, delimiter) => `AS ${delimiter}\n-- DECLARED HELPER TAMPER\n`))
      const saved = await snapshot(), meta = await metadata(), witness = await witnesses()
      await assert.rejects(() => db.exec(forward), /sc046_duplicate_guard_helper_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta); assert.deepEqual(await witnesses(), witness)
      await db.exec(helper)
    })
    await check('incorrect expected postimage hash refuses before replacement and leaves all state unchanged', async () => {
      const wrongHash = forward.replaceAll('7c3afe5c7fec6a5def5b0b64d4459bf6af21369a8e55e647c50308e772815af7', '0'.repeat(64))
      const saved = await snapshot(), meta = await metadata(), witness = await witnesses()
      await assert.rejects(() => db.exec(wrongHash), /sc046_duplicate_guard_source_inverse_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta); assert.deepEqual(await witnesses(), witness)
    })
    await check('postcondition failure rolls back actual function DDL and preserves rows/helpers/index', async () => {
      const forcedFailure = forward.replace('IF after_metadata IS DISTINCT FROM before_metadata', 'IF true OR after_metadata IS DISTINCT FROM before_metadata')
      assert.notEqual(forcedFailure, forward)
      const saved = await snapshot(), meta = await metadata(), witness = await witnesses()
      await assert.rejects(() => db.exec(forcedFailure), /sc046_duplicate_guard_postcondition_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta); assert.deepEqual(await witnesses(), witness)
    })
    await check('tampered index definition refuses migration atomically without weakening guard', async () => {
      await db.exec('DROP INDEX public.ux_metering_values_company_ediel_duplicate_guard')
      await db.exec(indexLine[0].replace('USING btree (', 'USING btree (revision_number, '))
      const saved = await snapshot(), meta = await metadata()
      await assert.rejects(() => db.exec(forward), /sc046_duplicate_guard_index_conflict/)
      assert.deepEqual(await snapshot(), saved); assert.deepEqual(await metadata(), meta)
      await db.exec('DROP INDEX public.ux_metering_values_company_ediel_duplicate_guard'); await db.exec(indexLine[0])
    })
    await db.exec(cleanDefinition)
    result.completedChecks = checks
    result.limits = ['Declared synthetic SOURCE SQL fixture only, no canonical tenant/admission/native/ACK/billing/capture proof.',
      'Same-reference changed quantity and blank-reference legacy guard refusals retained; no general same-reference correction approval.',
      'Existing native740 and current genuine PRIMARY/CI/final reviews remain required from incumbent chain.']
    console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  console.error(JSON.stringify({ scope: result.scope, completed: result.checks, message: error.message, code: error.code }, null, 2))
  process.exitCode = 1
} finally { await db.close() }
