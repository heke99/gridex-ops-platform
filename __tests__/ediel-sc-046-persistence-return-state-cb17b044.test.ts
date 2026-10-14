// SC-046 prerequisite component only: no whole-contract approval tag.
// Real source95d wrapper, table definitions and immutable/tenant triggers execute
// in PGlite. Storage graph, execution actor, lower owner and validated stored
// contract are explicitly synthetic ports. Representative committed rows are
// source-schema-derived, not captured native originals or physical ACK proof.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
const migrationPath = 'supabase/migrations/20261013141048_ediel_sc046_persistence_return_state_cb17b044.sql'
const signature = 'public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)'
const sourceHash = 'd1072ccfd2c9ed9d7edd8e4bf780c0809bb4d904fe61a579be5239dfa6f220b1'
function definition(name: string) {
  const marker = `CREATE FUNCTION ${name}(`
  if (schema.split(marker).length !== 2) throw Error(`nonunique source function:${name}`)
  const tail = schema.slice(schema.indexOf(marker))
  const dollar = /\bAS (\$\$|\$_\$)/.exec(tail)
  if (!dollar) throw Error(`missing source body:${name}`)
  const end = tail.indexOf(`${dollar[1]};`, dollar.index + dollar[0].length)
  if (end < 0) throw Error(`unterminated source function:${name}`)
  return tail.slice(0, end + dollar[1].length + 1)
}
function table(name: string) {
  const marker = `CREATE TABLE ${name} (`
  if (schema.split(marker).length !== 2) throw Error(`nonunique source table:${name}`)
  const tail = schema.slice(schema.indexOf(marker))
  return tail.slice(0, tail.indexOf('\n);') + 3)
}
function constraints(name: string) {
  const escaped = name.replaceAll('.', '\\.')
  return [...schema.matchAll(new RegExp(`ALTER TABLE ONLY ${escaped}\\n    ADD CONSTRAINT [^;]+;`, 'g'))]
    .map(match => match[0]).filter(sql => /PRIMARY KEY|UNIQUE/.test(sql)).join('\n')
}
const original = definition('public.gridex_persist_utilts_consumption_v1')
const baseline = process.env.SC046_BRIDGE_BASELINE === '1'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uid(1), foreign = uid(2), source = uid(10), origin = uid(11), actor = uid(20)
const series = uid(30), previous = uid(31)
const raw = "DECLARED SYNTHETIC UTILTS SOURCE; NO NATIVE CLAIM"
type Item = Record<string, unknown>
const contract = {
  version: 2, companyId: company, environment: 'test', messageCode: 'E66',
  transactionId: 'tx-1', seriesKind: 'actual',
  observations: [{ value: null, qualifier: '136', externalPoint: '735999999999999999' }],
}
// The port owns validation, raw/source context and quantity/NULL semantics.
// This opaque representative contract is not asserted as native-valid wire.
let db: PGlite
async function forward() { await db.exec(readFileSync(resolve(process.env.SC046_REFINEMENT_MIGRATION ?? migrationPath), 'utf8')) }
async function metadata() {
  return (await db.query<{ meta: Item; body: string }>(
    `SELECT to_jsonb(p)-'prosrc' AS meta, prosrc AS body FROM pg_proc p WHERE oid=$1::regprocedure`, [signature])).rows[0]
}
async function setResult(items: Item[]) {
  await db.query('UPDATE bridge_fixture.ports SET result=$1::jsonb', [JSON.stringify(items)])
}
async function resultItem(extra: Item = {}) {
  const h = (await db.query<{ hash: string }>(`SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS hash`, [JSON.stringify(contract)])).rows[0].hash
  return { transactionId: 'tx-1', disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', seriesId: series,
    idempotentReplay: true, contractVersion: 2, contractHash: h, consumptionContract: contract,
    sourceBinding: { sourceMessageId: source, rawHash: createHash('sha256').update(raw).digest('hex'), boundAt: '2026-10-01T00:00:00Z' },
    unrelated: { nullable: null, ordered: [3, 1, 2] }, ...extra }
}
async function call(transactions: Item[] = [], args: Item = {}, asService = true) {
  const values = { company, environment: 'test', source, code: 'E66', raw, transactions, actor, ...args }
  if (asService) await db.exec('SET ROLE service_role')
  try { return (await db.query<{ result: Item[] }>(
    'SELECT public.gridex_persist_utilts_consumption_v1($1,$2,$3,$4,$5,$6::jsonb,$7) AS result',
    [values.company, values.environment, values.source, values.code, values.raw, JSON.stringify(values.transactions), values.actor])).rows[0].result
  } finally { await db.exec('RESET ROLE') }
}
async function seedBirth(version: number, predecessor: string | null, current: boolean) {
  // Disable/enable is fixture administration, before the real guard is exercised;
  // the candidate migration never changes trigger installation or data.
  await db.exec('ALTER TABLE public.meter_reading_series DISABLE TRIGGER meter_reading_series_immutable_guard')
  await db.query('UPDATE public.meter_reading_series SET version_no=$1,supersedes_series_id=$2,is_current=$3 WHERE id=$4', [version, predecessor, current, series])
  await db.exec('ALTER TABLE public.meter_reading_series ENABLE TRIGGER meter_reading_series_immutable_guard')
}
async function effects() { return (await db.query('SELECT * FROM bridge_fixture.effects ORDER BY id')).rows }

beforeAll(async () => {
  expect(createHash('sha256').update(original).digest('hex')).toBe('095f2a506e72358c60c701049f97c9a00c9146578f2e68d6ae0dc89ce0c1853e')
  db = new PGlite()
  await db.exec(`CREATE ROLE service_role; CREATE ROLE authenticated;
    CREATE SCHEMA gridex_utilts_binding; CREATE SCHEMA bridge_fixture;
    ${table('public.ediel_messages')}
    ${table('public.ediel_ack_transaction_results')}
    ${table('public.meter_reading_series')}
    ${table('gridex_utilts_binding.contracts')}
    ${table('gridex_utilts_binding.receipts')}
    ${definition('gridex_utilts_binding.source_context_v1')}
    ${['public.ediel_messages','public.ediel_ack_transaction_results','public.meter_reading_series','gridex_utilts_binding.contracts','gridex_utilts_binding.receipts'].map(constraints).join('\n')}
    CREATE TABLE bridge_fixture.ports(result jsonb, validated_contract jsonb, actor_allowed boolean, expire_after_owner boolean, lower_error text, stored_error boolean, expire_after_contract boolean);
    INSERT INTO bridge_fixture.ports VALUES ('[]',null,true,false,null,false,false);
    CREATE TABLE bridge_fixture.effects(id integer, kind text);
    CREATE TABLE bridge_fixture.head_ports(company_id uuid,source_id uuid,transaction_id text,validated_contract jsonb,refuse boolean DEFAULT false,expire_after_contract boolean DEFAULT false);
    CREATE FUNCTION gridex_utilts_binding.lock_storage_graph_v1() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      LOCK TABLE public.ediel_messages IN ROW EXCLUSIVE MODE;
      PERFORM pg_advisory_xact_lock(46046);
    END $$;
    CREATE FUNCTION gridex_utilts_binding.require_execution_actor_v1(c uuid,a uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF c IS DISTINCT FROM '${company}'::uuid OR a IS DISTINCT FROM '${actor}'::uuid OR NOT (SELECT actor_allowed FROM bridge_fixture.ports) THEN
        RAISE EXCEPTION 'utilts_execution_actor_forbidden' USING ERRCODE='42501'; END IF;
    END $$;
    CREATE FUNCTION gridex_utilts_binding.persist_consumption_before_actor_v1(c uuid,e text,s uuid,m text,r text,t jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE p bridge_fixture.ports%rowtype; BEGIN
      SELECT * INTO p FROM bridge_fixture.ports;
      IF p.lower_error IS NOT NULL THEN RAISE EXCEPTION '%',p.lower_error USING ERRCODE='P0U01'; END IF;
      INSERT INTO bridge_fixture.effects VALUES(1,'declared lower write');
      IF p.expire_after_owner THEN UPDATE bridge_fixture.ports SET actor_allowed=false; END IF;
      RETURN p.result;
    END $$;
    CREATE FUNCTION gridex_utilts_binding.stored_contract_v1(c uuid,s uuid,t text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE h bridge_fixture.head_ports%rowtype; BEGIN
      SELECT * INTO h FROM bridge_fixture.head_ports WHERE company_id=c AND source_id=s AND transaction_id=t;
      IF FOUND THEN
        IF h.refuse THEN RAISE EXCEPTION 'declared_head_contract_refusal' USING ERRCODE='P0U01'; END IF;
        IF h.expire_after_contract THEN UPDATE bridge_fixture.ports SET actor_allowed=false; END IF;
        RETURN h.validated_contract;
      END IF;
      IF c IS DISTINCT FROM '${company}'::uuid OR s IS DISTINCT FROM '${source}'::uuid OR t IS DISTINCT FROM 'tx-1'
        OR (SELECT stored_error FROM bridge_fixture.ports) THEN RAISE EXCEPTION 'declared_stored_contract_refusal' USING ERRCODE='P0U01'; END IF;
      IF (SELECT expire_after_contract FROM bridge_fixture.ports) THEN UPDATE bridge_fixture.ports SET actor_allowed=false; END IF;
      RETURN (SELECT validated_contract FROM bridge_fixture.ports);
    END $$;
    ${definition('public.gridex_guard_immutable_meter_reading_series')}
    ${definition('public.gridex_guard_meter_reading_series_tenant')}
    CREATE TRIGGER meter_reading_series_immutable_guard BEFORE DELETE OR UPDATE ON public.meter_reading_series FOR EACH ROW EXECUTE FUNCTION public.gridex_guard_immutable_meter_reading_series();
    CREATE TRIGGER meter_reading_series_tenant_guard BEFORE INSERT OR UPDATE ON public.meter_reading_series FOR EACH ROW EXECUTE FUNCTION public.gridex_guard_meter_reading_series_tenant();`)
}, 30000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE public.ediel_messages, public.ediel_ack_transaction_results,public.meter_reading_series,gridex_utilts_binding.contracts,gridex_utilts_binding.receipts,bridge_fixture.effects,bridge_fixture.head_ports;
    UPDATE bridge_fixture.ports SET actor_allowed=true,expire_after_owner=false,lower_error=null,stored_error=false,expire_after_contract=false;
    ${original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')}
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)
  // Earlier-origin reuse is a real owner behavior: the requested source ACK
  // can refer to an immutable series originating at another same-scope source.
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload)
    VALUES($1,$3,'test','inbound','UTILTS','E66',$4),($2,$3,'test','inbound','UTILTS','E66',$4)`, [source, origin, company, raw])
  await db.query(`INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,message_code,source_transaction_reference,dedupe_key,version_no,is_current,raw_transaction,immutable_hash)
    VALUES($1,$3,$4,'E66','tx-1','series',1,true,jsonb_build_object('consumptionContract',$5::jsonb),encode(sha256(convert_to(jsonb_build_object('consumptionContract',$5::jsonb)::text,'UTF8')),'hex')),
    ($2,$3,$4,'E66','tx-previous','previous',1,false,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'))`, [series, previous, company, origin, JSON.stringify(contract)])
  await db.query(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status,persisted_series_id)
    VALUES($1,'test',$2,'tx-1','positive','positive','positive','accepted','positive_aperak','persisted',$3)`, [company, source, series])
  await db.query(`INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
    VALUES($1,$2,'test',$3,'tx-1',2,$4::jsonb,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'))`, [series, company, origin, JSON.stringify(contract)])
  await db.query('UPDATE bridge_fixture.ports SET validated_contract=$1::jsonb', [JSON.stringify(contract)])
  await setResult([await resultItem()])
  if (!baseline) await forward()
  // Only RPC admission role is modeled; this is not real auth/RLS qualification.
})

describe('source-bound existing persistence wrapper JSON prerequisite', () => {
  it('classifies an initial current result from stored birth, preserving every lower member', async () => {
    const input = await resultItem()
    expect(await call()).toEqual([{ ...input, versionState: 'current' }])
    expect(await effects()).toEqual([{ id: 1, kind: 'declared lower write' }])
  })
  it.each([
    [2, previous, true, 'current'],
    [1, null, false, 'current'],
    [2, previous, false, 'current'],
    [2, null, false, 'late_older_history'],
    [7, null, false, 'late_older_history'],
  ] as const)('immutable version%s/predecessor%s/current%s returns %s', async (version, predecessor, current, want) => {
    await seedBirth(version, predecessor, current)
    expect((await call())[0].versionState).toBe(want)
  })
  it('preserves array order, NULL content and all nonpersisted/negative members', async () => {
    await seedBirth(2, null, false)
    const negative = { transactionId: 'negative', disposition: 'guide_rejected', persistenceStatus: 'not_applicable', responseType: 'negative_aperak', consumptionContract: null, issueCodes: ['BAD'], unrelated: null }
    const hold = { transactionId: 'held', disposition: 'internal_review', persistenceStatus: 'not_applicable', responseType: 'none' }
    const item = await resultItem()
    await setResult([negative, item, hold])
    expect(await call()).toEqual([negative, { ...item, versionState: 'late_older_history' }, hold])
  })
  it('ignores forged caller versionState/isCurrent/lateOlder metadata', async () => {
    await seedBirth(2, null, false)
    expect((await call([{ transactionId: 'tx-1', versionState: 'current', isCurrent: true, lateOlder: false }]))[0].versionState).toBe('late_older_history')
  })
  it('allows authentic same-scope earlier origin reuse without guessing source identity', async () => {
    expect((await call())[0]).toMatchObject({ seriesId: series, versionState: 'current', sourceBinding: { sourceMessageId: source } })
    expect((await db.query('SELECT source_ediel_message_id FROM public.meter_reading_series WHERE id=$1', [series])).rows).toEqual([{ source_ediel_message_id: origin }])
  })
  it('mutable is_current cannot relabel formerly current as late history', async () => {
    await seedBirth(2, previous, true)
    await db.query('UPDATE public.meter_reading_series SET is_current=false WHERE id=$1', [series])
    expect((await call())[0].versionState).toBe('current')
  })
  it('mutable is_current cannot revive late history', async () => {
    await seedBirth(2, null, false)
    await db.query('UPDATE public.meter_reading_series SET is_current=true WHERE id=$1', [series])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each(['version_no=3', `supersedes_series_id='${previous}'`])('installed source immutable guard protects %s', async mutation => {
    await expect(db.exec(`UPDATE public.meter_reading_series SET ${mutation} WHERE id='${series}'`)).rejects.toMatchObject({ code: '55000' })
    expect((await call())[0].versionState).toBe('current')
  })
  it('installed source BEFORE tenant guard coalesces first-version NULL to1', async () => {
    await db.query(`INSERT INTO public.meter_reading_series(company_id,dedupe_key,version_no) VALUES($1,'null-first',null)`, [company])
    expect((await db.query("SELECT version_no FROM public.meter_reading_series WHERE dedupe_key='null-first'")).rows).toEqual([{ version_no: 1 }])
  })
  it.each([
    ['missing ACK', 'DELETE FROM public.ediel_ack_transaction_results'],
    ['foreign ACK company', `UPDATE public.ediel_ack_transaction_results SET company_id='${foreign}'`],
    ['foreign ACK environment', "UPDATE public.ediel_ack_transaction_results SET environment='production'"],
    ['foreign ACK source', `UPDATE public.ediel_ack_transaction_results SET source_message_id='${origin}'`],
    ['foreign ACK transaction', "UPDATE public.ediel_ack_transaction_results SET source_transaction_id='other'"],
    ['foreign ACK series', `UPDATE public.ediel_ack_transaction_results SET persisted_series_id='${previous}'`],
    ['negative ACK', "UPDATE public.ediel_ack_transaction_results SET disposition='guide_rejected',planned_response_type='negative_aperak'"],
    ['pending ACK', "UPDATE public.ediel_ack_transaction_results SET persistence_status='pending'"],
    ['foreign origin company', `UPDATE public.ediel_messages SET company_id='${foreign}' WHERE id='${origin}'`],
    ['foreign origin environment', `UPDATE public.ediel_messages SET environment='production' WHERE id='${origin}'`],
    ['wrong origin code', `UPDATE public.ediel_messages SET message_code='E30' WHERE id='${origin}'`],
    ['wrong origin family', `UPDATE public.ediel_messages SET message_family='PRODAT' WHERE id='${origin}'`],
    ['wrong origin direction', `UPDATE public.ediel_messages SET direction='outbound' WHERE id='${origin}'`],
    ['missing origin', `DELETE FROM public.ediel_messages WHERE id='${origin}'`],
    ['missing contract', 'DELETE FROM gridex_utilts_binding.contracts'],
    ['foreign contract source', `UPDATE gridex_utilts_binding.contracts SET source_message_id='${source}'`],
    ['foreign contract company', `UPDATE gridex_utilts_binding.contracts SET company_id='${foreign}'`],
    ['foreign contract environment', "UPDATE gridex_utilts_binding.contracts SET environment='production'"],
    ['foreign contract transaction', "UPDATE gridex_utilts_binding.contracts SET transaction_id='other'"],
    ['corrupt contract hash', "UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('0',64)"],
  ])('refuses %s with full lower-write rollback', async (_name, corruption) => {
    await db.exec(corruption)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each(['public.ediel_ack_transaction_results','public.ediel_messages','gridex_utilts_binding.contracts','public.meter_reading_series'])('source PK/unique constraints preclude ambiguous %s rows', async name => {
    await expect(db.exec(`INSERT INTO ${name} SELECT * FROM ${name}`)).rejects.toMatchObject({ code: '23505' })
  })
  it('refuses ambiguous duplicate persisted results from the declared lower port', async () => {
    const item = await resultItem()
    await setResult([item, item])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each([
    ['missing returned series', { seriesId: null }],
    ['foreign returned series', { seriesId: previous }],
    ['missing returned source binding', { sourceBinding: null }],
    ['foreign returned source binding', { sourceBinding: { sourceMessageId: origin } }],
    ['wrong returned source hash', { sourceBinding: { sourceMessageId: source, rawHash: '0'.repeat(64) } }],
    ['wrong returned transaction', { transactionId: 'other' }],
    ['wrong returned disposition', { disposition: 'guide_rejected' }],
    ['wrong returned response', { responseType: 'negative_aperak' }],
    ['missing returned contract', { consumptionContract: null }],
    ['mismatched returned contract', { consumptionContract: { ...contract, observations: [] } }],
    ['wrong returned contractVersion', { contractVersion: 1 }],
    ['wrong returned contractHash', { contractHash: '0'.repeat(64) }],
    ['preexisting classification', { versionState: 'current' }],
  ])('refuses %s instead of authorizing a guessed class', async (_name, extra) => {
    await setResult([await resultItem(extra)])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each(['stored_error=true', 'validated_contract=null', `validated_contract='{}'::jsonb`])('preserves validated stored-contract refusal %s', async state => {
    await db.exec(`UPDATE bridge_fixture.ports SET ${state}`)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each([[1, previous], [2, series], [3, previous]] as const)('refuses invalid birth version%s/predecessor%s', async (version, predecessor) => {
    await seedBirth(version, predecessor, false)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each([{ name: 'JSON null', result: null }, { name: 'object', result: {} }, { name: 'array with null member', result: [null] }])('refuses malformed lower-port $name', async ({ result }) => {
    await db.query('UPDATE bridge_fixture.ports SET result=$1::jsonb', [JSON.stringify(result)])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('rechecks actor after the classification stored-contract port, rolling back all owner effects', async () => {
    await db.exec('UPDATE bridge_fixture.ports SET expire_after_contract=true')
    await expect(call()).rejects.toMatchObject({ code: '42501' })
    expect(await effects()).toEqual([])
    expect((await db.query('SELECT actor_allowed FROM bridge_fixture.ports')).rows).toEqual([{ actor_allowed: true }])
  })
  it('checks actor again after lower owner and classification, rolling back owner effects', async () => {
    await db.exec('UPDATE bridge_fixture.ports SET expire_after_owner=true')
    await expect(call()).rejects.toMatchObject({ code: '42501' })
    expect(await effects()).toEqual([])
    expect((await db.query('SELECT actor_allowed FROM bridge_fixture.ports')).rows).toEqual([{ actor_allowed: true }])
  })
  it.each(['actor', 'raw', 'company', 'environment', 'code'])('preserves pre-owner %s refusal', async field => {
    await expect(call([], { [field]: field === 'actor' || field === 'company' ? foreign : 'wrong' })).rejects.toMatchObject({ code: field === 'actor' ? '42501' : 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('preserves service-role admission', async () => {
    await expect(call([], {}, false)).rejects.toMatchObject({ code: '42501' })
    expect(await effects()).toEqual([])
  })
  it.each(['utilts_quantity_quality_required', 'utilts_consumption_contract_invalid', 'utilts_source_decimal_or_unit_rules_failed'])('propagates unchanged lower owner refusal %s', async lowerError => {
    await db.query('UPDATE bridge_fixture.ports SET lower_error=$1', [lowerError])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01', message: lowerError })
    expect(await effects()).toEqual([])
  })
  it('preserves complete pg_proc metadata including OID/owner/ACL/defaults/security/settings and inverse source', async () => {
    await db.exec(`RESET ROLE; ${original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}`)
    const before = await metadata()
    expect(createHash('sha256').update(before.body).digest('hex')).toBe(sourceHash)
    await forward()
    const after = await metadata()
    expect(after.meta).toEqual(before.meta)
    const declarations = after.body.slice(after.body.indexOf('\n -- SC046 return-state declarations'), after.body.indexOf('\nBEGIN'))
    const start = after.body.indexOf(' -- SC046 stored return-state begin\n')
    const stop = after.body.indexOf(' -- SC046 stored return-state end\n') + ' -- SC046 stored return-state end\n'.length
    const inverse = after.body.slice(0, start) + after.body.slice(stop)
    expect(inverse.replace(declarations, '')).toBe(before.body)
  })
  it('preserves nondefault owner/ACL/configuration without broadening or resetting metadata', async () => {
    await db.exec(`${original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}
      ALTER FUNCTION ${signature} OWNER TO authenticated;
      GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;
      ALTER FUNCTION ${signature} SET statement_timeout TO '10s';`)
    const before = await metadata()
    await forward()
    expect((await metadata()).meta).toEqual(before.meta)
    // Restore fixture ownership before the next test's source reinstallation.
    await db.exec(`ALTER FUNCTION ${signature} OWNER TO postgres`)
  })
  it('refuses disabled immutable guard installation', async () => {
    await db.exec(`${original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}
      ALTER TABLE public.meter_reading_series DISABLE TRIGGER meter_reading_series_immutable_guard`)
    const before = await metadata()
    await expect(forward()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await metadata()).toEqual(before)
    await db.exec('ALTER TABLE public.meter_reading_series ENABLE TRIGGER meter_reading_series_immutable_guard')
  })
  it('refuses an altered immutable guard body that admits birth mutation', async () => {
    await db.exec(`${original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}
      ${definition('public.gridex_guard_immutable_meter_reading_series').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace("to_jsonb(new)-'is_current'", "to_jsonb(new)-'is_current'-'version_no'").replace("to_jsonb(old)-'is_current'", "to_jsonb(old)-'is_current'-'version_no'")}`)
    const before = await metadata()
    try {
      await expect(forward()).rejects.toMatchObject({ code: 'P0U01' })
      expect(await metadata()).toEqual(before)
    } finally {
      await db.exec(definition('public.gridex_guard_immutable_meter_reading_series').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
    }
  })
  it('rejects an unexpected predecessor body without changing metadata or source', async () => {
    await db.exec(`RESET ROLE; ${original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('RETURN result;', 'RETURN result; -- unexpected predecessor')}`)
    const before = await metadata()
    await expect(forward()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await metadata()).toEqual(before)
  })
})


// Conditional consumer-interpretation component: independent namespace/issuer
// admission and the lower A-alias are assumptions of declared ports. SAME-issuer
// new-source repeated505 is refused upstream; these rows do not simulate that
// gate away or establish actual cross-namespace admission/native overwrite.
const head = uid(40), headSource = uid(41)
const olderTime = '2026-09-01T00:00:00Z', newerTime = '2026-10-01T00:00:00Z'
async function editSeriesFixture(id: string, assignments: string, values: unknown[] = []) {
  await db.exec('ALTER TABLE public.meter_reading_series DISABLE TRIGGER meter_reading_series_immutable_guard')
  try { await db.query(`UPDATE public.meter_reading_series SET ${assignments} WHERE id='${id}'`, values) }
  finally { await db.exec('ALTER TABLE public.meter_reading_series ENABLE TRIGGER meter_reading_series_immutable_guard') }
}
async function qualifiedNewerHead(headTime: string | null = newerTime, returnedTime: string | null = olderTime) {
  const headContract = { ...contract, transactionId: 'tx-head', observations: [{ value: '21.00', qualifier: '135', externalPoint: '735999999999999999' }] }
  await editSeriesFixture(series, `is_current=false,registration_date=$1::timestamptz,latest_update_date=$1::timestamptz,
    raw_transaction=jsonb_build_object('consumptionContract',$2::jsonb,'registrationDate',$1::text,'latestUpdateDate',$1::text),
    immutable_hash=encode(sha256(convert_to(jsonb_build_object('consumptionContract',$2::jsonb,'registrationDate',$1::text,'latestUpdateDate',$1::text)::text,'UTF8')),'hex')`, [returnedTime, JSON.stringify(contract)])
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,sender_ediel_id)
    VALUES($1,$2,'test','inbound','UTILTS','E66','DECLARED INDEPENDENTLY ADMITTED HEAD SOURCE','different-declared-issuer')`, [headSource, company])
  await db.query(`INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,message_code,source_transaction_reference,dedupe_key,version_no,supersedes_series_id,is_current,registration_date,latest_update_date,raw_transaction,immutable_hash)
    VALUES($1,$2,$3,'E66','tx-head','head',2,$4,true,$5::timestamptz,$5::timestamptz,
    jsonb_build_object('transactionId','tx-head','registrationDate',$5::text,'latestUpdateDate',$5::text,'consumptionContract',$6::jsonb),
    encode(sha256(convert_to(jsonb_build_object('transactionId','tx-head','registrationDate',$5::text,'latestUpdateDate',$5::text,'consumptionContract',$6::jsonb)::text,'UTF8')),'hex'))`,
    [head, company, headSource, series, headTime, JSON.stringify(headContract)])
  await db.query(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status,persisted_series_id)
    VALUES($1,'test',$2,'tx-head','positive','positive','positive','accepted','positive_aperak','persisted',$3)`, [company, headSource, head])
  await db.query(`INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
    VALUES($1,$2,'test',$3,'tx-head',2,$4::jsonb,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'))`, [head, company, headSource, JSON.stringify(headContract)])
  await db.query(`INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
    SELECT id,company_id,environment,message_code,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1(s),'["tx-head"]',2 FROM public.ediel_messages s WHERE id=$1`, [headSource])
  await db.query('INSERT INTO bridge_fixture.head_ports(company_id,source_id,transaction_id,validated_contract) VALUES($1,$2,$3,$4::jsonb)', [company, headSource, 'tx-head', JSON.stringify(headContract)])
}
describe('qualified newer active cohort witness, declared admission boundary', () => {
  it('qualified strictly newer head classifies returned born-current earlier-origin A as history', async () => {
    await qualifiedNewerHead()
    const lower = await resultItem()
    expect(await call()).toEqual([{ ...lower, versionState: 'late_older_history' }])
    expect((await db.query('SELECT id,is_current,version_no FROM public.meter_reading_series WHERE id IN ($1,$2) ORDER BY id', [series, head])).rows)
      .toEqual([{ id: series, is_current: false, version_no: 1 }, { id: head, is_current: true, version_no: 2 }])
  })
  it('no newer head preserves formerly-current birth and legacy missing dates', async () => {
    await seedBirth(1, null, false)
    expect((await call())[0].versionState).toBe('current')
  })
  it.each([olderTime, '2026-08-01T00:00:00Z'])('older/equal fully validated head %s supplies no historical interpretation', async time => {
    await qualifiedNewerHead(time)
    expect((await call())[0].versionState).toBe('current')
  })
  it.each([[null,newerTime],[olderTime,null]] as const)('NULL returned/head date %s/%s refuses guessed comparison', async (returnedDate,headDate) => {
    await qualifiedNewerHead(headDate,returnedDate)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it.each([
    ['foreign ACK company', `UPDATE public.ediel_ack_transaction_results SET company_id='${foreign}' WHERE persisted_series_id='${head}'`],
    ['foreign ACK environment', `UPDATE public.ediel_ack_transaction_results SET environment='production' WHERE persisted_series_id='${head}'`],
    ['foreign ACK source', `UPDATE public.ediel_ack_transaction_results SET source_message_id='${source}' WHERE persisted_series_id='${head}'`],
    ['wrong ACK transaction', `UPDATE public.ediel_ack_transaction_results SET source_transaction_id='other' WHERE persisted_series_id='${head}'`],
    ['unaccepted ACK', `UPDATE public.ediel_ack_transaction_results SET disposition='guide_rejected',planned_response_type='negative_aperak' WHERE persisted_series_id='${head}'`],
    ['unpersisted ACK', `UPDATE public.ediel_ack_transaction_results SET persistence_status='pending' WHERE persisted_series_id='${head}'`],
    ['missing ACK', `DELETE FROM public.ediel_ack_transaction_results WHERE persisted_series_id='${head}'`],
    ['foreign source company', `UPDATE public.ediel_messages SET company_id='${foreign}' WHERE id='${headSource}'`],
    ['wrong source code', `UPDATE public.ediel_messages SET message_code='E30' WHERE id='${headSource}'`],
    ['wrong source direction', `UPDATE public.ediel_messages SET direction='outbound' WHERE id='${headSource}'`],
    ['changed source raw', `UPDATE public.ediel_messages SET raw_payload=raw_payload||' changed' WHERE id='${headSource}'`],
    ['changed source context', `UPDATE public.ediel_messages SET sender_ediel_id='unbound-context' WHERE id='${headSource}'`],
    ['foreign receipt environment', `UPDATE gridex_utilts_binding.receipts SET environment='production' WHERE source_message_id='${headSource}'`],
    ['missing receipt membership', `UPDATE gridex_utilts_binding.receipts SET membership='[]' WHERE source_message_id='${headSource}'`],
    ['foreign contract source', `UPDATE gridex_utilts_binding.contracts SET source_message_id='${origin}' WHERE series_id='${head}'`],
    ['foreign contract company', `UPDATE gridex_utilts_binding.contracts SET company_id='${foreign}' WHERE series_id='${head}'`],
    ['foreign contract environment', `UPDATE gridex_utilts_binding.contracts SET environment='production' WHERE series_id='${head}'`],
    ['wrong contract transaction', `UPDATE gridex_utilts_binding.contracts SET transaction_id='other' WHERE series_id='${head}'`],
    ['wrong contract hash', `UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('0',64) WHERE series_id='${head}'`],
    ['missing contract', `DELETE FROM gridex_utilts_binding.contracts WHERE series_id='${head}'`],
    ['stored contract refusal', 'UPDATE bridge_fixture.head_ports SET refuse=true'],
    ['stored contract NULL', 'UPDATE bridge_fixture.head_ports SET validated_contract=null'],
    ['stored contract disagreement', "UPDATE bridge_fixture.head_ports SET validated_contract='{}'"],
  ])('refuses a discovered head with %s without guessing current/history', async (_name, corruption) => {
    await qualifiedNewerHead()
    await db.exec(corruption)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('a qualified different environment is a separate cohort and supplies no TEST history authority', async () => {
    await qualifiedNewerHead()
    const productionContract = { ...contract, environment: 'production', transactionId: 'tx-head', observations: [{ value: '21.00', qualifier: '135', externalPoint: '735999999999999999' }] }
    await db.query(`UPDATE public.ediel_messages SET environment='production' WHERE id=$1`, [headSource])
    await db.query(`UPDATE public.ediel_ack_transaction_results SET environment='production' WHERE persisted_series_id=$1`, [head])
    await db.query(`UPDATE gridex_utilts_binding.contracts SET environment='production',contract=$1::jsonb,contract_hash=encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') WHERE series_id=$2`, [JSON.stringify(productionContract), head])
    await editSeriesFixture(head, `version_no=1,supersedes_series_id=null,
      raw_transaction=raw_transaction||jsonb_build_object('consumptionContract',$1::jsonb),
      immutable_hash=encode(sha256(convert_to((raw_transaction||jsonb_build_object('consumptionContract',$1::jsonb))::text,'UTF8')),'hex')`, [JSON.stringify(productionContract)])
    await db.query(`UPDATE gridex_utilts_binding.receipts r SET environment='production',source_context=gridex_utilts_binding.source_context_v1(s) FROM public.ediel_messages s WHERE r.source_message_id=s.id AND s.id=$1`, [headSource])
    await db.query('UPDATE bridge_fixture.head_ports SET validated_contract=$1::jsonb', [JSON.stringify(productionContract)])
    expect((await call())[0].versionState).toBe('current')
  })
  it('original-source A replay uses the same qualified newer-head consumer interpretation', async () => {
    await qualifiedNewerHead()
    await db.query(`INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status,persisted_series_id)
      VALUES($1,'test',$2,'tx-1','positive','positive','positive','accepted','positive_aperak','persisted',$3)`, [company, origin, series])
    // Declared finalized-positive metadata, not a physical ACK document.
    await db.query(`UPDATE public.ediel_ack_transaction_results SET final_response_type='positive_aperak',finalized_at='2026-09-01T01:00:00Z',response_message_id=$1 WHERE source_message_id=$2`, [uid(99), origin])
    const ackBefore = (await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY id')).rows
    await db.query('INSERT INTO bridge_fixture.head_ports(company_id,source_id,transaction_id,validated_contract) VALUES($1,$2,$3,$4::jsonb)', [company, origin, 'tx-1', JSON.stringify(contract)])
    const lower = await resultItem()
    lower.sourceBinding = { ...lower.sourceBinding, sourceMessageId: origin }
    await setResult([lower])
    expect(await call([], { source: origin })).toEqual([{ ...lower, versionState: 'late_older_history' }])
    expect((await db.query('SELECT * FROM public.ediel_ack_transaction_results ORDER BY id')).rows).toEqual(ackBefore)
  })
  it.each(["immutable_hash=repeat('0',64)", `raw_transaction=raw_transaction-'consumptionContract'`, 'version_no=1,supersedes_series_id=null'])('refuses head immutable/raw/birth port corruption %s', async corruption => {
    await qualifiedNewerHead()
    await editSeriesFixture(head,corruption)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('raw/column date disagreement refuses even when the raw hash is updated consistently', async () => {
    await qualifiedNewerHead()
    await editSeriesFixture(head,"latest_update_date='2026-11-01T00:00:00Z'")
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('multiple active same-cohort candidates refuse ambiguous head authority', async () => {
    await qualifiedNewerHead()
    await db.query('UPDATE public.meter_reading_series SET is_current=true WHERE id=$1',[previous])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('returned A marked current alongside active B is ambiguous and refuses', async () => {
    await qualifiedNewerHead()
    await db.query('UPDATE public.meter_reading_series SET is_current=true WHERE id=$1',[series])
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('532/512 fallback classifies with registration dates when latest-update dates are absent', async () => {
    await qualifiedNewerHead()
    for (const id of [series,head]) await editSeriesFixture(id,`latest_update_date=null,raw_transaction=raw_transaction-'latestUpdateDate',
      immutable_hash=encode(sha256(convert_to((raw_transaction-'latestUpdateDate')::text,'UTF8')),'hex')`)
    expect((await call())[0].versionState).toBe('late_older_history')
  })
  it('B3/P2/A1 permits a genuine immediate predecessor distinct from returned A', async () => {
    await qualifiedNewerHead()
    await editSeriesFixture(previous, 'version_no=2,supersedes_series_id=$1', [series])
    await editSeriesFixture(head, 'version_no=3,supersedes_series_id=$1', [previous])
    expect((await call())[0].versionState).toBe('late_older_history')
  })
  it.each([
    ['2027-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2020-01-01T00:00:00Z', '2026-10-01T00:00:00Z', 'late_older_history'],
    ['2020-01-01T00:00:00Z', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z', '2026-09-01T00:00:00Z', 'current'],
    ['2027-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2020-01-01T00:00:00Z', '2026-09-01T00:00:00Z', 'current'],
  ])('532 takes precedence over contradictory512: A%s/%s B%s/%s =>%s', async (a512,a532,b512,b532,want) => {
    await qualifiedNewerHead()
    for (const [id,reg,latest] of [[series,a512,a532],[head,b512,b532]]) await editSeriesFixture(id,
      `registration_date=$1::timestamptz,latest_update_date=$2::timestamptz,
       raw_transaction=raw_transaction||jsonb_build_object('registrationDate',$1::text,'latestUpdateDate',$2::text),
       immutable_hash=encode(sha256(convert_to((raw_transaction||jsonb_build_object('registrationDate',$1::text,'latestUpdateDate',$2::text))::text,'UTF8')),'hex')`, [reg,latest])
    expect((await call())[0].versionState).toBe(want)
  })
  it('head raw transaction identity must match its own stored series/ACK/contract transaction', async () => {
    await qualifiedNewerHead()
    await editSeriesFixture(head, `raw_transaction=raw_transaction||'{"transactionId":"other"}',
      immutable_hash=encode(sha256(convert_to((raw_transaction||'{"transactionId":"other"}')::text,'UTF8')),'hex')`)
    await expect(call()).rejects.toMatchObject({ code: 'P0U01' })
    expect(await effects()).toEqual([])
  })
  it('flag tampering cannot manufacture a genuine stored newer-head witness', async () => {
    await qualifiedNewerHead()
    await db.query('UPDATE public.meter_reading_series SET is_current=false WHERE id=$1',[head])
    expect((await call())[0].versionState).toBe('current')
  })
  it('head validation expiry reaches retained final actor refusal and rolls back effects', async () => {
    await qualifiedNewerHead()
    await db.exec('UPDATE bridge_fixture.head_ports SET expire_after_contract=true')
    await expect(call()).rejects.toMatchObject({ code: '42501' })
    expect(await effects()).toEqual([])
    expect((await db.query('SELECT actor_allowed FROM bridge_fixture.ports')).rows).toEqual([{ actor_allowed: true }])
  })
})
