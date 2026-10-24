// reality-defects: G-6b
// G-6b: gridex_store_billing_underlay_batch could not store one quarter-hour meter-month inside the 8 s statement
// timeout (world DB, rolled back: 82 s for 2 880 values). Migration 20261024140000 (a) evaluates
// gridex_billing_source.observation_v1 for every ordinal of a transaction in one pass (observations_v1, used by
// bases_v1 with a per-call memo and a per-(source, transaction) sourceOrdinal map), (b) accumulates the store's value
// bases in an array instead of an O(n^2) jsonb concatenation and (c) evaluates jsonb_populate_record once per stored
// item. The month engine stores underlays in batches within a statement budget (lib/billing/underlayEngine.ts).
// These tests run the real observation_v1 (supabase/schema.sql) against observations_v1 over generated token
// streams, the reviewed pre-image of bases_v1 against its post-image, the old and new accumulation and insert
// statements, and the batch split; they require identical outcomes and a large speed-up.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { estimatedUnderlayStoreCost, underlayStoreBatches, UNDERLAY_BATCH_COST_BUDGET } from '@/lib/billing/underlayEngine'

const root = path.resolve(__dirname, '..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261024140000_g6b_billing_source_observations_once_per_transaction.sql'), 'utf8')
const g6 = readFileSync(path.join(root, 'supabase/migrations/20261024130000_g6_billing_source_bases_once_per_source.sql'), 'utf8')
const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

function quoted(text: string, tag: string) {
  const out: string[] = []
  const re = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1])
  return out
}
type Spec = { name: string; pre: string; post: string; old: string[]; next: string[] }
const specs: Spec[] = migration.split('\nselect pg_temp.g6b_rewrite(\n').slice(1).map((chunk) => {
  const head = /^\s*'([^']+)'::regprocedure,\s*'([0-9a-f]{64})',\s*'([0-9a-f]{64})',/.exec(chunk)!
  return { name: head[1], pre: head[2], post: head[3], old: quoted(chunk, 'g6bold'), next: quoted(chunk, 'g6bnew') }
})
const spec = (name: string) => specs.find((s) => s.name === name)!
function schemaFunction(name: string) {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
  const tail = schema.slice(start)
  const m = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(tail)!
  return { sql: tail.slice(0, m.index + m[0].length), body: m[2] }
}
const observationsFn = /\nCREATE FUNCTION gridex_billing_source\.observations_v1[\s\S]*?\$g6bobs\$;\n/.exec(migration)![0]

async function observationDb() {
  const db = new PGlite()
  await db.exec('create schema gridex_billing_source; create schema gridex_utilts_binding; create role anon; create role authenticated; create role service_role;')
  await db.exec(schemaFunction('gridex_utilts_binding.canonical_decimal_v2').sql)
  await db.exec(schemaFunction('gridex_billing_source.observation_v1').sql)
  await db.exec(observationsFn)
  return db
}

function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) }
type Token = { index: number | string; tag: string; elements: string[][] }
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]

// A UTILTS-shaped token stream with seeded anomalies in every field observation_v1 reads.
function message(r: () => number, txs: string[]) {
  const t: Token[] = []
  const push = (tag: string, ...elements: string[][]) => t.push({ index: t.length, tag, elements: [[tag], ...elements] })
  const unb = r() < 0.95 ? 1 : r() < 0.5 ? 0 : 2
  for (let i = 0; i < unb; i++) push('UNB', ['UNOC', '3'], ['1', 'ZZ'], ['2', 'ZZ'], ['260928', '0700'], ['R'], [''], [pick(r, ['23-DDQ-E66-T', '23-DDQ-E66-S', 'X'])])
  push('UNH', ['1'])
  if (r() < 0.97) push('BGM', [pick(r, ['E66', 'E30', 'E31'])])
  const offsets = r() < 0.92 ? 1 : r() < 0.5 ? 0 : 2
  for (let i = 0; i < offsets; i++) push('DTM', ['735', pick(r, ['+0100', '+0100', '+0200', '-0130', '+2500', '+0160', '0100']), '406'])
  for (const tx of txs) {
    push('IDE', ['24'], [tx])
    if (r() < 0.9) push('LIN', [''], [''], [pick(r, ['8716867000030', '8716867000047', '']), '', '', '9'])
    if (r() < 0.95) push('DTM', ['324', pick(r, ['202609270000202609280000', '202609270000202609280000', '202609272300202609282300', '202609270000202609270100', '202613270000202609280000', '20260927']), '719'])
    if (r() < 0.95) {
      const [res, fmt] = pick(r, [['15', '806'], ['15', '806'], ['60', '806'], ['1', '805'], ['1', '802'], ['1', '801'], ['0', '806'], ['x', '806'], ['15', '999'], ['99999999999', '806']])
      push('DTM', ['354', res, fmt])
    }
    if (r() < 0.95) push('MEA', ['AAZ'], [''], [pick(r, ['KWH', 'KWH', 'MWH', 'GWH', 'WH'])])
    if (r() < 0.05) push('QTY', ['136', '1'])
    const groups = 1 + Math.floor(r() * 12)
    for (let g = 0; g < groups; g++) {
      if (r() < 0.93) push('SEQ', [''], [String(g + 1)])
      const refs = r() < 0.75 ? 0 : r() < 0.9 ? 1 : 2
      for (let i = 0; i < refs; i++) push('RFF', ['AES', pick(r, ['1', '2', ''])])
      const qtys = r() < 0.9 ? 1 : 2
      for (let q = 0; q < qtys; q++) {
        push('QTY', [pick(r, ['136', '136', '136', '220']), pick(r, ['0.021', '1,5', '12', '-3', 'abc', '', '0'])])
        if (r() < 0.6) push('DTM', ['597', '202609270000', '203'])
        const sts = r() < 0.7 ? 0 : r() < 0.85 ? 1 : 2
        for (let i = 0; i < sts; i++) push('STS', [pick(r, ['8', '8', '7'])], [pick(r, ['21', '56', '99', ''])])
      }
    }
  }
  push('UNT', ['1'])
  if (r() < 0.03 && t.length > 4) t[3].index = t[2].index // duplicate index
  if (r() < 0.03) t.reverse() // array order differs from index order
  if (r() < 0.02) t[1].index = 'x'
  return t
}

// The caller's evaluation (bases_v1): observations_v1's element, or observation_v1 itself on NULL or ordinal < 0.
async function compareAll(db: PGlite, tokens: Token[] | unknown, tx: string, mark: string, extra = 2) {
  const { rows } = await db.query<{ a: unknown[] | null }>('select gridex_billing_source.observations_v1($1::jsonb,$2,$3) a', [JSON.stringify(tokens), tx, mark])
  const a = rows[0].a
  const n = Array.isArray(a) ? a.length : 0
  let nonNull = 0, raised = 0
  // Negative ordinals never reach observations_v1 (the caller evaluates observation_v1 itself).
  for (let k = 0; k < n + extra; k++) {
    let old: unknown
    try { old = (await db.query<{ o: unknown }>('select gridex_billing_source.observation_v1($1::jsonb,$2,$3,$4) o', [JSON.stringify(tokens), tx, k, mark])).rows[0].o }
    catch (error) { old = { error: (error as Error).message }; raised++ }
    // Where observation_v1 raises, observations_v1 must have returned NULL so that the caller raises the same.
    const next = Array.isArray(a) ? (a[k] ?? null) : old
    expect(next).toEqual(old)
    if (old !== null && !(old as { error?: string }).error) nonNull++
  }
  return { fallback: !Array.isArray(a), nonNull, ordinals: n, raised }
}

describe('G-6b observations_v1 equals observation_v1', () => {
  it('pins the reviewed bodies and needles', () => {
    expect(specs.map((s) => [s.name, s.pre, s.post])).toEqual([
      ['gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)', 'fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2', 'e4a8b979a5ce5d6316fbc6ad2548fff3b28b31df6404a5fb4bd63e0171315193'],
      ['public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)', '014b52dff80a6fed8d95aa4e1549dfe2d304fa16c63641018a6aa36f14e9115b', spec('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)').post],
      ['gridex_billing_source.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid)', '790cc345f79352526b83ae18c3bd1de637d94521d5c06f2400389ecd30a51303', spec('gridex_billing_source.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid)').post],
    ])
    // observations_v1 copies this exact observation_v1 body; the migration refuses any other.
    expect(sha(schemaFunction('gridex_billing_source.observation_v1').body)).toBe('c5528b30547f784af93965091c1550391e937a40beadceaa3a922533042ad132')
    expect(migration).toContain("'c5528b30547f784af93965091c1550391e937a40beadceaa3a922533042ad132'")
    expect(migration).toContain(`'${sha(quoted(migration, 'g6bobs')[0])}'`)
    // The G-6 bases_v1 body is the pre-image; the needles turn it into the pinned post-image.
    const bases = spec('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)')
    let body = quoted(g6, 'g6bases')[0]
    expect(sha(body)).toBe(bases.pre)
    bases.old.forEach((old, i) => { expect(body.split(old)).toHaveLength(2); body = body.replace(old, () => bases.next[i]) })
    expect(sha(body)).toBe(bases.post)
    // The original observation_v1 call and STRICT lookup remain as the fallback paths.
    expect(body.split('gridex_billing_source.observation_v1(').length - 1).toBe(1)
    expect(body.split('INTO STRICT o,ordinal').length - 1).toBe(1)
  })

  it('returns observation_v1 for every ordinal over generated token streams', async () => {
    const db = await observationDb()
    let fallback = 0, nonNull = 0, ordinals = 0, cases = 0, raisedTotal = 0
    for (let seed = 1; seed <= 260; seed++) {
      const r = rng(seed)
      const txs = Array.from({ length: 1 + Math.floor(r() * 2) }, (_, i) => (r() < 0.05 ? 'T0' : `T${i}`))
      const tokens = message(r, txs)
      for (const tx of [...new Set(txs), 'MISSING']) {
        const res = await compareAll(db, tokens, tx, r() < 0.8 ? '.' : ',')
        cases++; raisedTotal += res.raised; ordinals += res.ordinals; nonNull += res.nonNull; if (res.fallback) fallback++
      }
    }
    for (const odd of [null, {}, [], 'x', [{ tag: 'IDE', index: 0, elements: [['IDE'], ['24'], ['T0']] }]]) await compareAll(db, odd, 'T0', '.')
    // Not vacuous: many observations, many ordinals, and both the one-pass and the fallback path taken.
    expect(cases).toBeGreaterThan(500)
    expect(ordinals).toBeGreaterThan(1500)
    expect(nonNull).toBeGreaterThan(200)
    expect(fallback).toBeGreaterThan(5)
    expect(raisedTotal).toBeGreaterThan(0)
    expect(fallback).toBeLessThan(cases / 3)
    await db.close()
  }, 600_000)

  it('evaluates a quarter-hour meter-month transaction far faster than per value (timing guard)', async () => {
    const db = await observationDb()
    const t: Token[] = []
    const push = (tag: string, ...elements: string[][]) => t.push({ index: t.length, tag, elements: [[tag], ...elements] })
    push('UNB', ['UNOC', '3'], ['1', 'ZZ'], ['2', 'ZZ'], ['260928', '0700'], ['R'], [''], ['23-DDQ-E66-T'])
    push('BGM', ['E66']); push('DTM', ['735', '+0100', '406']); push('IDE', ['24'], ['T0'])
    push('LIN', [''], [''], ['8716867000030', '', '', '9']); push('DTM', ['324', '202608312300202609302300', '719'])
    push('DTM', ['354', '15', '806']); push('MEA', ['AAZ'], [''], ['KWH'])
    for (let k = 0; k < 2880; k++) { push('SEQ', [''], [String(k + 1)]); push('QTY', ['136', `0.${String(k % 997).padStart(3, '0')}`]); push('STS', ['7'], ['21']) }
    push('UNT', ['1'])
    let t0 = performance.now()
    const { rows } = await db.query<{ a: unknown[] }>('select gridex_billing_source.observations_v1($1::jsonb,$2,$3) a', [JSON.stringify(t), 'T0', '.'])
    const batch = performance.now() - t0
    expect(rows[0].a).toHaveLength(2880)
    const sample = [0, 1, 95, 96, 1439, 2878, 2879]
    t0 = performance.now()
    for (const k of sample) {
      const old = (await db.query<{ o: unknown }>('select gridex_billing_source.observation_v1($1::jsonb,$2,$3,$4) o', [JSON.stringify(t), 'T0', k, '.'])).rows[0].o
      expect(rows[0].a[k]).toEqual(old)
      expect(old).not.toBeNull()
    }
    const perValue = (performance.now() - t0) / sample.length
    // All 2 880 observations in one pass cost less than 100 single observation_v1 calls.
    expect(batch).toBeLessThan(perValue * 100)
    expect((rows[0].a[2879] as { periodEnd: string }).periodEnd).toBe('2026-09-30T22:00:00+00:00')
    await db.close()
  }, 600_000)

  it('refuses to install over any other observation_v1 body and leaves nothing behind', async () => {
    const db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema gridex_billing_source;
      create function gridex_billing_source.observation_v1(tokens jsonb, tx text, ordinal integer, decimal_mark text default '.') returns jsonb language sql immutable as $$select null::jsonb$$;`)
    await expect(db.exec(migration)).rejects.toThrow('g6b_billing_source_observation_rule_source_changed:observation_v1')
    await db.exec('rollback')
    expect((await db.query("select to_regprocedure('gridex_billing_source.observations_v1(jsonb,text,text)') p")).rows[0]).toEqual({ p: null })
    await db.close()
  }, 60_000)
})

// bases_v1 pre-image (G-6) against its post-image with the G-6 fixture: observation_v1 and observations_v1 are
// consistent stubs over fx_observations (observations_v1 NULL for some transactions to take the fallback), and the
// contracts carry duplicate, missing and non-integer sourceOrdinals for the STRICT lookup's error paths.
const C = '11111111-1111-4111-8111-111111111111'
const uuid = (n: number, k: number) => `${String(k).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
async function basesFixture() {
  const db = new PGlite()
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema extensions; create schema gridex_billing_source; create schema gridex_utilts_binding; create schema gridex_ediel_source_rules;
   create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
   create table public.ediel_messages(id uuid primary key,company_id uuid,direction text,message_family text,message_code text,raw_payload text,status text);
   create table public.metering_values(id uuid primary key,company_id uuid,is_current boolean,revision_status text,value_kwh numeric,period_start timestamptz,period_end timestamptz,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,metering_point_id uuid,customer_id uuid,raw_payload jsonb);
   create table public.normalized_metering_values(id uuid primary key,company_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,revision_status text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,metering_point_id uuid,customer_id uuid,raw_payload jsonb,product_code text,register_code text);
   create table public.calls(fn text,arg text);
   create table public.fx_contracts(source uuid,tx text,contract jsonb);
   create table public.fx_observations(tx text,ordinal integer,physical jsonb);
   create table public.fx_fallback(tx text);
   create function gridex_utilts_binding.canonical_decimal_v2(text) returns text language sql immutable as $$select $1$$;
   create function gridex_billing_source.lock_values_v1(p_company uuid,p_values uuid[],p_period uuid default null) returns void language plpgsql as $$begin
    if (select count(*) from public.normalized_metering_values where company_id=p_company and id=any(p_values))<>cardinality(p_values) then raise exception 'billing_source_value_missing' using errcode='P0002'; end if; end$$;
   create function gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_tx text) returns jsonb language sql as $$select contract from public.fx_contracts where source=p_source and tx=p_tx$$;
   create function gridex_ediel_source_rules.require_v1(p_company uuid,p_source uuid) returns jsonb language sql as $$select jsonb_build_object('pack','v1')$$;
   create function gridex_utilts_binding.wire_tokens_v1(raw text) returns jsonb language sql as $$select jsonb_build_object('raw',md5(raw))$$;
   create function gridex_billing_source.observation_v1(tokens jsonb,tx text,ordinal integer,mark text) returns jsonb language plpgsql as $$begin
    insert into public.calls values('observation',tx||'/'||ordinal);
    if ordinal<0 then raise exception 'OFFSET must not be negative' using errcode='2201X'; end if;
    return (select physical from public.fx_observations where fx_observations.tx=$2 and fx_observations.ordinal=coalesce($3,0)); end$$;
   create function gridex_billing_source.observations_v1(tokens jsonb,tx text,mark text) returns jsonb language plpgsql as $$begin
    insert into public.calls values('observations',tx);
    if exists(select from public.fx_fallback f where f.tx=$2) then return null; end if;
    return coalesce((select jsonb_agg(physical order by ordinal) from public.fx_observations where fx_observations.tx=$2),'[]'); end$$;
   create function gridex_utilts_binding.decimal_rules_v1(tokens jsonb,tx text,mark text) returns jsonb language sql as $$select jsonb_build_object('guide','[]'::jsonb,'functional','[]'::jsonb)$$;
  `)
  return db
}
async function basesSeed(db: PGlite, seedNo: number, sources: number, perSource: number) {
  const r = rng(seedNo)
  const ids: string[] = []
  for (let s = 0; s < sources; s++) {
    const source = uuid(s, 1), tx = `TX${s}`, point = uuid(s, 2), customer = uuid(s, 3)
    await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7)', [source, C, 'inbound', 'UTILTS', 'E66', `UNA:+.? 'UNB+raw${s}'`, 'processed'])
    if (r() < 0.25) await db.query('insert into public.fx_fallback values($1)', [tx])
    const shape = s < 6 ? s : 6
    const observations: Array<Record<string, unknown>> = Array.from({ length: perSource }, (_, k) => ({ ordinal: k, sourceOrdinal: k, unit: 'kWh', quantity: String(k + 1), periodStart: `2026-09-01T${String(k % 24).padStart(2, '0')}:00:00Z`, periodEnd: `2026-09-01T${String(k % 24).padStart(2, '0')}:15:00Z`, direction: 'consumption', quality: null, productCode: '8716867000030', registerCode: null }))
    if (shape === 1) observations.push({ ...observations[0], ordinal: 'x' }) // duplicate sourceOrdinal 0
    else if (shape === 2) observations[1] = { ...observations[1], sourceOrdinal: 'one' } // not an integer
    else if (shape === 3) observations.splice(2, 1) // missing sourceOrdinal 2
    else if (shape === 4) observations[3] = { ...observations[3], ordinal: 'bad' } // ordinal cast fails on match
    else if (shape === 5) observations[4] = { ...observations[4], sourceOrdinal: -1 } // reaches observation_v1 with -1
    const contract = { observations: shape === 0 ? { not: 'an array' } : observations, metering: { capability: 'write', meteringPointId: point, customerId: customer } }
    await db.query('insert into public.fx_contracts values($1,$2,$3)', [source, tx, contract])
    for (let k = 0; k < perSource; k++) {
      const id = uuid(s * 1000 + k, 4), mv = uuid(s * 1000 + k, 5)
      const o = observations.find((x) => x.sourceOrdinal === k) ?? observations[0]
      const physical = r() < 0.05 ? null : { quantityKwh: String(k + 1), periodStart: o.periodStart, periodEnd: o.periodEnd, messageCode: 'E66', quantityType: '136', quality: null, productCode: '8716867000030', registerCode: null, applicationReference: '23-DDQ-E66-T' }
      await db.query('insert into public.fx_observations values($1,$2,$3)', [tx, k, physical])
      const sourceOrdinal = shape === 5 && k === 4 ? -1 : r() < 0.03 ? -1 : r() < 0.03 ? null : r() < 0.02 ? perSource + 4 : k
      const payload = { consumptionContract: contract, edielMessageId: source, sourceOrdinal }
      await db.query('insert into public.metering_values values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [mv, C, true, 'current', k + 1, o.periodStart, o.periodEnd, 'consumption', null, source, tx, point, customer, payload])
      await db.query('insert into public.normalized_metering_values values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [id, C, mv, source, tx, 'current', k + 1, o.periodStart, o.periodEnd, 'kWh', 'consumption', null, point, customer, payload, '8716867000030', null])
      ids.push(id)
    }
  }
  return ids
}
async function installBases(db: PGlite, post: boolean) {
  const s = spec('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)')
  let body = quoted(g6, 'g6bases')[0]
  if (post) s.old.forEach((old, i) => { body = body.replace(old, () => s.next[i]) })
  expect(sha(body)).toBe(post ? s.post : s.pre)
  await db.exec(`CREATE OR REPLACE FUNCTION gridex_billing_source.bases_v1(p_company uuid, p_values uuid[], p_precision boolean, p_capture boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog, public, extensions AS $b$${body}$b$;`)
}

describe('G-6b bases_v1 with observations_v1 and the sourceOrdinal map', () => {
  it('returns identical bases and captured errors before and after, with one observations_v1 per transaction', async () => {
    const db = await basesFixture()
    const ids = await basesSeed(db, 5, 16, 20)
    const run = async () => {
      const out: unknown[] = []
      for (const precision of [true, false]) {
        const { rows } = await db.query<{ v: unknown }>('select gridex_billing_source.bases_v1($1,$2::uuid[],$3,true) v', [C, ids, precision])
        out.push(rows[0].v)
      }
      return out
    }
    await installBases(db, false)
    const before = await run()
    const oldCalls = Number((await db.query<{ n: number }>("select count(*)::int n from public.calls where fn='observation'")).rows[0].n)
    await db.exec('delete from public.calls')
    await installBases(db, true)
    expect(await run()).toEqual(before)
    const calls = (await db.query<{ fn: string; n: number }>('select fn, count(*)::int n from public.calls group by fn order by fn')).rows
    const observations = calls.find((c) => c.fn === 'observations')?.n ?? 0
    const fallback = calls.find((c) => c.fn === 'observation')?.n ?? 0
    expect(observations).toBeLessThanOrEqual(2 * 16)
    expect(fallback).toBeGreaterThan(0)
    expect(fallback).toBeLessThan(oldCalls / 2)
    // Not vacuous: qualified bases, unqualified bases and captured errors (negative ordinals) are all present.
    const flat = (before[0] as Array<Record<string, { qualified?: boolean }>>)
    expect(flat.filter((e) => e.b?.qualified === true).length).toBeGreaterThan(100)
    expect(flat.filter((e) => e.b && e.b.qualified === false).length).toBeGreaterThan(10)
    expect(flat.filter((e) => 'e' in e).length).toBeGreaterThan(0)
    await db.close()
  }, 300_000)
})

describe('G-6b store statements', () => {
  it('accumulates the value bases into the same JSON array', async () => {
    const db = new PGlite()
    const s = spec('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)')
    const make = (decl: string, step: string, use: string) => `create or replace function pg_temp.acc(p jsonb) returns text language plpgsql as $f$declare basis jsonb;sp record;n record;${decl}
      begin select 'sp-1'::text id into sp; for basis in select value from jsonb_array_elements(p) loop select (basis->>'r')::int revision_number into n; ${step} end loop;
      return (${use}'x',1))::text; end$f$`
    const r = rng(3)
    const input = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ r: i, q: r() < 0.5 ? null : String(r()), nested: { a: [i, 'x'] } })))
    await db.exec(make(s.old[0], s.old[1], s.old[2]))
    const before = (await db.query<{ t: string }>('select pg_temp.acc($1) t', [input])).rows[0].t
    await db.exec(make(s.next[0], s.next[1], s.next[2]))
    const after = (await db.query<{ t: string }>('select pg_temp.acc($1) t', [input])).rows[0].t
    expect(after).toBe(before)
    expect(JSON.parse(after).values).toHaveLength(300)
    await db.close()
  }, 60_000)

  it('inserts the same item rows with one jsonb_populate_record per item', async () => {
    const db = new PGlite()
    await db.exec(`create table public.billing_underlay_items(id uuid not null, company_id uuid, billing_underlay_id uuid, created_at timestamptz, updated_at timestamptz,
      source_normalized_metering_value_id uuid, quantity numeric, unit text, warnings jsonb not null, metadata jsonb, period_start timestamptz)`)
    const s = spec('gridex_billing_source.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid)')
    const items = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ source_normalized_metering_value_id: uuid(i, 4), quantity: i / 7, unit: 'kWh', warnings: [], metadata: { i }, period_start: '2026-09-01T00:00:00Z' })))
    const run = async (select: string) => {
      await db.exec('delete from public.billing_underlay_items')
      await db.exec(`create or replace function pg_temp.ins(p_items jsonb) returns void language plpgsql as $f$declare p_company_id uuid:='${C}';v_id uuid:='${uuid(1, 9)}';
        begin insert into public.billing_underlay_items\n${select}\nend$f$`)
      await db.query('select pg_temp.ins($1)', [items])
      return (await db.query<Record<string, unknown>>('select company_id,billing_underlay_id,source_normalized_metering_value_id,quantity,unit,warnings,metadata,period_start,created_at=now() t0 from public.billing_underlay_items order by source_normalized_metering_value_id')).rows
    }
    const before = await run(s.old[0])
    const after = await run(s.next[0])
    expect(after).toEqual(before)
    expect(after).toHaveLength(200)
    expect(Number((await db.query<{ n: number }>('select count(distinct id)::int n from public.billing_underlay_items')).rows[0].n)).toBe(200)
    await db.close()
  }, 60_000)
})

describe('G-6b month engine stores underlays within the statement budget', () => {
  const entry = (sources: number, perSource: number, mp: string) => ({
    underlay: { metering_point_id: mp, payload: { lineage: Array.from({ length: sources * perSource }, (_, i) => ({ source_message_id: `m-${mp}-${i % sources}` })) } },
    items: Array.from({ length: sources * perSource }, (_, i) => ({ source_normalized_metering_value_id: `${mp}-${i}` })),
  })
  it('keeps a small month in one batch and splits quarter-hour meter-months, in order', () => {
    const small = [entry(1, 4, 'a'), entry(2, 24, 'b'), { underlay: { metering_point_id: 'c' }, items: [] }]
    expect(underlayStoreBatches(small)).toEqual([small])
    const quarterHour = ['p1', 'p2', 'p3', 'p4'].map((mp) => entry(30, 96, mp))
    // Measured in the world DB after 20261024140000: one such meter-month stores in 6.0-6.8 s (limit 8 s).
    expect(estimatedUnderlayStoreCost(quarterHour[0])).toBe(2880 + 3000)
    const batches = underlayStoreBatches([...quarterHour, ...small])
    expect(batches.map((b) => b.map((e) => e.underlay.metering_point_id))).toEqual([['p1'], ['p2'], ['p3'], ['p4'], ['a', 'b', 'c']])
    for (const batch of batches) {
      const cost = batch.reduce((sum, e) => sum + estimatedUnderlayStoreCost(e), 0)
      expect(batch.length === 1 || cost <= UNDERLAY_BATCH_COST_BUDGET).toBe(true)
    }
    // Without lineage (reconciliation underlays) the source count is estimated from the items.
    expect(estimatedUnderlayStoreCost({ underlay: {}, items: Array.from({ length: 48 }, () => ({})) })).toBe(48 + 200)
  })
})
