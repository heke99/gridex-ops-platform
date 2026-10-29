// reality-defects: G-6
// G-6 (and the G-2 open item): gridex_read_billing_source_values_v1 timed out (57014) on every quarter-hour month
// because basis_before_precision_v1 re-validated the whole source message (stored_contract_v1) and tokenized it
// several times for EVERY value. Migration 20261024130000 moves that logic, unchanged, into
// gridex_billing_source.bases_v1, which evaluates many values in one call with a per-call memo, and makes
// basis_before_precision_v1 / basis_v1 one-value calls of it. These tests run the exact reviewed pre-image bodies
// (the migration's own needles) and the installed post-images in embedded PostgreSQL over generated inputs and
// require identical outcomes, one validation per (source, transaction), captured errors raised unchanged, and the
// migration's refusal over any other body.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261024130000_g6_billing_source_bases_once_per_source.sql'), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

type Spec = { name: string; pre: string; post: string; old: string[]; next: string[] }
function quoted(text: string, tag: string) {
  const out: string[] = []
  const re = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1])
  return out
}
function specs(): Spec[] {
  return migration.split('\nselect pg_temp.g6_rewrite(\n').slice(1).map((chunk) => {
    const head = /^\s*'([^']+)'::regprocedure,\s*'([0-9a-f]{64})',\s*'([0-9a-f]{64})',/.exec(chunk)!
    return { name: head[1], pre: head[2], post: head[3], old: quoted(chunk, 'g6old'), next: quoted(chunk, 'g6new') }
  })
}
const spec = (name: string) => specs().find((s) => s.name === name)!
const newFunctions = /\nCREATE FUNCTION gridex_billing_source\.bases_v1[\s\S]*?\$g6entry\$;\n/.exec(migration)![0]

const C = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'

async function fixture() {
  const db = new PGlite()
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema extensions; create schema gridex_billing_source; create schema gridex_utilts_binding; create schema gridex_ediel_source_rules;
   create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
   create table public.ediel_messages(id uuid primary key,company_id uuid,direction text,message_family text,message_code text,raw_payload text,status text);
   create table public.metering_values(id uuid primary key,company_id uuid,is_current boolean,revision_status text,value_kwh numeric,period_start timestamptz,period_end timestamptz,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,metering_point_id uuid,customer_id uuid,raw_payload jsonb);
   create table public.normalized_metering_values(id uuid primary key,company_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,revision_status text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,metering_point_id uuid,customer_id uuid,raw_payload jsonb,product_code text,register_code text);
   create table public.calls(fn text,arg text);
   create table public.fx_contracts(source uuid,tx text,contract jsonb,fail text);
   create table public.fx_rules(source uuid,fail text);
   create table public.fx_observations(tx text,ordinal integer,physical jsonb);
   create table public.fx_decimal(tx text,rules jsonb);
   create function gridex_utilts_binding.canonical_decimal_v2(text) returns text language sql immutable as $$select $1$$;
   create function gridex_billing_source.lock_values_v1(p_company uuid,p_values uuid[],p_period uuid default null) returns void language plpgsql as $$begin
    insert into public.calls values('lock',array_to_string(p_values,','));
    if (select count(*) from public.normalized_metering_values where company_id=p_company and id=any(p_values))<>cardinality(p_values) then raise exception 'billing_source_value_missing' using errcode='P0002'; end if;
    perform 1 from public.normalized_metering_values where company_id=p_company and id=any(p_values) order by id for update; end$$;
   create function gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_tx text) returns jsonb language plpgsql as $$declare r public.fx_contracts; begin
    insert into public.calls values('contract',p_source||'/'||p_tx); perform pg_sleep(0.002);
    select * into r from public.fx_contracts where source=p_source and tx=p_tx;
    if r.source is null or r.fail='P0U01' then raise exception 'utilts_consumption_contract_conflict' using errcode='P0U01'; end if;
    if r.fail='other' then raise exception 'fixture_unexpected_contract_error' using errcode='XX001', detail='d', hint='h'; end if;
    return r.contract; end$$;
   create function gridex_ediel_source_rules.require_v1(p_company uuid,p_source uuid) returns jsonb language plpgsql as $$declare f text; begin
    select fail into f from public.fx_rules where source=p_source;
    if f is not null then raise exception '%',f; end if; return jsonb_build_object('pack','v1'); end$$;
   create function gridex_utilts_binding.wire_tokens_v1(raw text) returns jsonb language plpgsql as $$begin
    insert into public.calls values('tokens',md5(raw)); return jsonb_build_object('raw',md5(raw)); end$$;
   create function gridex_billing_source.observation_v1(tokens jsonb,tx text,ordinal integer,mark text) returns jsonb language sql as $$select physical from public.fx_observations where fx_observations.tx=$2 and fx_observations.ordinal=$3$$;
   create function gridex_utilts_binding.decimal_rules_v1(tokens jsonb,tx text,mark text) returns jsonb language sql as $$select rules from public.fx_decimal where fx_decimal.tx=$2$$;
  `)
  return db
}

function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) }
const uuid = (n: number, k: number) => `${String(k).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

// Sources with one transaction each; values per source with seeded mismatches and failure modes.
async function seed(db: PGlite, seedNo: number, sources: number, perSource: number) {
  const r = rng(seedNo)
  const ids: string[] = []
  for (let s = 0; s < sources; s++) {
    const source = uuid(s, 1), tx = `TX${s}`, point = uuid(s, 2), customer = uuid(s, 3)
    const code = r() < 0.85 ? 'E66' : r() < 0.5 ? 'E30' : 'E31'
    await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7)', [source, C, r() < 0.97 ? 'inbound' : 'outbound', 'UTILTS', code, `UNA:+.? 'UNB+raw${s}'`, 'processed'])
    const observations = Array.from({ length: perSource }, (_, k) => ({ ordinal: k, sourceOrdinal: k, unit: 'kWh', quantity: String(k + 1), periodStart: `2026-09-01T${String(k % 24).padStart(2, '0')}:00:00Z`, periodEnd: `2026-09-01T${String(k % 24).padStart(2, '0')}:15:00Z`, direction: 'consumption', quality: null, productCode: '8716867000030', registerCode: null }))
    const contract = { observations, metering: { capability: 'write', meteringPointId: point, customerId: customer } }
    const fail = r() < 0.12 ? 'P0U01' : null
    await db.query('insert into public.fx_contracts values($1,$2,$3,$4)', [source, tx, contract, fail])
    if (r() < 0.08) await db.query('insert into public.fx_rules values($1,$2)', [source, r() < 0.5 ? 'ediel_source_rule_pack_basis_required' : 'ediel_historical_rule_pack_basis_unavailable'])
    await db.query('insert into public.fx_decimal values($1,$2)', [tx, r() < 0.1 ? null : r() < 0.15 ? { guide: ['x'], functional: [] } : { guide: [], functional: [] }])
    for (let k = 0; k < perSource; k++) {
      const o = observations[k]
      const id = uuid(s * 1000 + k, 4), mv = uuid(s * 1000 + k, 5)
      const physical = r() < 0.05 ? null : { quantityKwh: r() < 0.04 ? '999' : o.quantity, periodStart: o.periodStart, periodEnd: o.periodEnd, messageCode: code, quantityType: r() < 0.03 ? '220' : '136', quality: null, productCode: r() < 0.04 ? '8716867000047' : o.productCode, registerCode: null, applicationReference: '23-DDQ-E66-T' }
      await db.query('insert into public.fx_observations values($1,$2,$3)', [tx, k, physical])
      const payload = { consumptionContract: r() < 0.03 ? { other: true } : contract, edielMessageId: source, sourceOrdinal: r() < 0.02 ? perSource + 5 : k }
      const quantity = r() < 0.03 ? k + 100 : k + 1
      await db.query('insert into public.metering_values values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [mv, C, r() < 0.97, 'current', quantity, o.periodStart, o.periodEnd, 'consumption', null, source, tx, point, customer, payload])
      await db.query('insert into public.normalized_metering_values values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [id, r() < 0.98 ? C : OTHER, mv, source, r() < 0.98 ? tx : null, 'current', quantity, o.periodStart, o.periodEnd, 'kWh', 'consumption', null, point, customer, payload, '8716867000030', null])
      ids.push(id)
    }
  }
  return [...ids, uuid(999999, 9)] // plus one id that does not exist
}

async function installPre(db: PGlite) {
  const bbp = spec('gridex_billing_source.basis_before_precision_v1(uuid,uuid)'), basis = spec('gridex_billing_source.basis_v1(uuid,uuid)')
  expect(sha(bbp.old[0])).toBe(bbp.pre)
  expect(sha(basis.old[0])).toBe(basis.pre)
  await db.exec(`CREATE OR REPLACE FUNCTION gridex_billing_source.basis_before_precision_v1(p_company uuid, p_value uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog, public, extensions AS $pre$${bbp.old[0]}$pre$;`)
  await db.exec(`CREATE OR REPLACE FUNCTION gridex_billing_source.basis_v1(p_company uuid, p_value uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $pre$${basis.old[0]}$pre$;`)
  // Production ACL: owner-only EXECUTE (the migration gives its new helpers exactly this ACL and checks it).
  await db.exec('REVOKE ALL ON FUNCTION gridex_billing_source.basis_before_precision_v1(uuid,uuid), gridex_billing_source.basis_v1(uuid,uuid) FROM PUBLIC')
}
async function installPost(db: PGlite) {
  await db.exec(newFunctions)
  for (const name of ['gridex_billing_source.basis_before_precision_v1(uuid,uuid)', 'gridex_billing_source.basis_v1(uuid,uuid)']) {
    const s = spec(name)
    let body = s.old[0]
    s.old.forEach((old, i) => { body = body.split(old).join(s.next[i]) })
    expect(sha(body)).toBe(s.post)
    const fn = name.replace('(uuid,uuid)', '')
    const path = fn.endsWith('basis_v1') ? `'pg_catalog'` : 'pg_catalog, public, extensions'
    await db.exec(`CREATE OR REPLACE FUNCTION ${fn}(p_company uuid, p_value uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path TO ${path} AS $post$${body}$post$;`)
  }
}

async function each(db: PGlite, fn: string, ids: string[]) {
  const out: unknown[] = []
  for (const id of ids) {
    try { out.push((await db.query<{ b: unknown }>(`select ${fn}($1,$2) b`, [C, id])).rows[0].b) }
    catch (error) { out.push({ error: (error as Error).message }) }
  }
  return out
}
const calls = async (db: PGlite, fn: string) => Number((await db.query<{ n: number }>('select count(*)::int n from public.calls where fn=$1', [fn])).rows[0].n)

describe('G-6 billing source bases once per source', () => {
  it('pins the reviewed pre-images, post-images and new helper bodies', () => {
    const names = specs().map((s) => s.name)
    expect(names).toEqual([
      'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)',
      'gridex_billing_source.basis_before_precision_v1(uuid,uuid)',
      'gridex_billing_source.basis_v1(uuid,uuid)',
      'public.gridex_read_billing_source_values_v1(uuid,uuid[])',
      'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)',
    ])
    expect(Object.fromEntries(specs().map((s) => [s.name, [s.pre, s.post]]))).toEqual({
      // Pre-image: main's S01 body (20261023201053) since the main integration; it added the S01 area branch.
      'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)': ['63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c', '1ea52c365e001d5d9a99fd86210242791a3b9feb5094a430de06b2a2c2b9944f'],
      'gridex_billing_source.basis_before_precision_v1(uuid,uuid)': ['d1965eb86c40723593accc3c1249ec382091bde14a4f6a3b84adc3daf4db2644', '70f24d94162cd04b82a886230edb5abea551b4e9715a3b3d83037159c4ce2e25'],
      'gridex_billing_source.basis_v1(uuid,uuid)': ['cf5325a4fa00b070ca0be113354497f818d308c2c482371a91d2668f724f69de', 'd2a211ec8b87ca1e403e49de57046cf8b171c7d89d5f900e638ef6f9526d7d50'],
      'public.gridex_read_billing_source_values_v1(uuid,uuid[])': ['3d1a829f6b04f93ae332a3ee35168e8c15efdbb0861ef65266b5fb6bc5634b50', 'f7cdbd917f7c956e7acd168576e98671afc91456d29e02f0c550b1fc84df5be5'],
      'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)': ['bd80a4d3600f047d4ea7a330204bd293ee8f99315a4c29b960a5b61c646c0c47', '014b52dff80a6fed8d95aa4e1549dfe2d304fa16c63641018a6aa36f14e9115b'],
    })
    // Every needle is replaced, never dropped: stored_contract_v1 tokenizes once per path (the S01 area branch, else the
    // point branch) instead of four times, and passes the tokens on.
    const sc = spec('gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)')
    expect(sc.old.join('').split('wire_tokens_v1(').length - 1).toBe(4)
    expect(sc.next.join('').split('wire_tokens_v1(').length - 1).toBe(2)
    expect(sc.next.join('')).toContain('s01_l359_area_identity_v1(v_tokens,')
    expect(sc.next.join('')).toContain('s01_l359_item_matches_v1(v_tokens,')
    expect(sc.next.join('')).toContain('validate_decimal_source_v2(v_tokens,')
    const [bases, entry] = [quoted(migration, 'g6bases')[0], quoted(migration, 'g6entry')[0]]
    expect(migration).toContain(`'${sha(bases)}'`)
    expect(migration).toContain(`'${sha(entry)}'`)
  })

  it('returns identical bases before and after, single and batched, with one validation per source', async () => {
    const db = await fixture()
    const ids = await seed(db, 7, 12, 25)
    await installPre(db)
    const beforeBasis = await each(db, 'gridex_billing_source.basis_v1', ids)
    const beforePrecision = await each(db, 'gridex_billing_source.basis_before_precision_v1', ids)
    const oldContractCalls = await calls(db, 'contract')
    await installPost(db)
    await db.exec('delete from public.calls')
    expect(await each(db, 'gridex_billing_source.basis_v1', ids)).toEqual(beforeBasis)
    expect(await each(db, 'gridex_billing_source.basis_before_precision_v1', ids)).toEqual(beforePrecision)
    for (const [precision, before] of [[true, beforeBasis], [false, beforePrecision]] as const) {
      await db.exec('delete from public.calls')
      const shuffled = [...ids].sort(() => 0).reverse()
      const { rows } = await db.query<{ v: Array<Record<string, unknown>> }>('select gridex_billing_source.bases_v1($1,$2::uuid[],$3,false) v', [C, shuffled, precision])
      const batched = await Promise.all(rows[0].v.map(async (entry) => (await db.query<{ b: unknown }>('select gridex_billing_source.basis_entry_v1($1) b', [entry])).rows[0].b))
      expect(batched).toEqual(shuffled.map((id) => before[ids.indexOf(id)]))
      // One stored_contract_v1 per (source, transaction) reached and one tokenization per source.
      const contractCalls = await calls(db, 'contract')
      const distinct = Number((await db.query<{ n: number }>("select count(distinct arg)::int n from public.calls where fn='contract'")).rows[0].n)
      expect(contractCalls).toBe(distinct)
      expect(contractCalls).toBeLessThanOrEqual(12)
      expect(await calls(db, 'tokens')).toBeLessThanOrEqual(12)
    }
    expect(oldContractCalls).toBeGreaterThan(100)
    // The generator exercises qualified, unqualified, failing and missing values, so equality is not vacuous.
    const outcomes = beforeBasis.map((b) => (b === null ? 'null' : (b as { qualified?: boolean; reason?: string }).qualified ? 'qualified' : (b as { reason: string }).reason))
    expect(new Set(outcomes).size).toBeGreaterThanOrEqual(5)
    expect(outcomes.filter((o) => o === 'qualified').length).toBeGreaterThan(50)
    await db.close()
  }, 180_000)

  it('keeps a batch of many values far below the per-value cost (timing guard)', async () => {
    const db = await fixture()
    const ids = await seed(db, 11, 3, 100)
    await installPre(db)
    let t0 = performance.now()
    await each(db, 'gridex_billing_source.basis_v1', ids)
    const perValue = performance.now() - t0
    await installPost(db)
    await db.exec('delete from public.calls')
    t0 = performance.now()
    await db.query('select gridex_billing_source.bases_v1($1,$2::uuid[],true,false)', [C, ids])
    const batched = performance.now() - t0
    expect(await calls(db, 'contract')).toBeLessThanOrEqual(3)
    expect(batched).toBeLessThan(perValue / 2)
    await db.close()
  }, 180_000)

  it('captures a value error and raises it unchanged at that value; without capture it propagates', async () => {
    const db = await fixture()
    const ids = await seed(db, 3, 2, 4)
    await installPost(db)
    await db.exec(`update public.fx_contracts set fail='other' where source='${uuid(1, 1)}'`)
    const { rows } = await db.query<{ v: Array<Record<string, unknown>> }>('select gridex_billing_source.bases_v1($1,$2::uuid[],true,true) v', [C, ids])
    const errors = rows[0].v.filter((e) => 'e' in e)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toEqual({ e: { state: 'XX001', message: 'fixture_unexpected_contract_error', detail: 'd', hint: 'h' } })
    await expect(db.query('select gridex_billing_source.basis_entry_v1($1)', [errors[0]])).rejects.toMatchObject({ message: 'fixture_unexpected_contract_error', code: 'XX001', detail: 'd', hint: 'h' })
    await expect(db.query('select gridex_billing_source.bases_v1($1,$2::uuid[],true,false)', [C, ids])).rejects.toThrow('fixture_unexpected_contract_error')
    await db.close()
  }, 60_000)

  it('refuses to install over any other body and leaves nothing behind', async () => {
    const db = await fixture()
    await installPre(db)
    await expect(db.exec(migration)).rejects.toThrow('g6_billing_source_basis_rule_source_changed')
    await db.exec('rollback')
    expect((await db.query("select to_regprocedure('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)') p")).rows[0]).toEqual({ p: null })
    await db.close()
  }, 60_000)
})
