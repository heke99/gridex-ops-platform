// reality-defects: G-8
// G-8: storing one UTILTS file took 2-3 minutes because gridex_utilts_binding.stored_contract_v1 re-tokenized the
// source and re-ran validate_contract_v1, supported_point_v1 and validate_decimal_source_v2 on every call (several
// calls per stored value). Migration 20261024150000 runs these IMMUTABLE checks once per hash-bound content and rule
// set. These tests execute the real pre-image (20260930145350 + the G-6 rewrite) and the migrated body in embedded
// PostgreSQL over counting stubs of the pure checks and require identical results and errors, first and repeated,
// that a failed check is never remembered, that a rule change bypasses the memo, that
// the migration installs only over the exact pre-image and that function metadata is unchanged.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const migration = read('supabase/migrations/20261024150000_g8_utilts_stored_contract_pure_checks_once.sql')
const g6 = read('supabase/migrations/20261024130000_g6_billing_source_bases_once_per_source.sql')
const v2 = read('supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql')
const s01 = read('supabase/migrations/20261023201053_ediel_s01_area_aggregate_identity.sql')
const FN = 'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'

function preImage() {
  const start = v2.indexOf('CREATE OR REPLACE FUNCTION gridex_utilts_binding.stored_contract_v1')
  const m = /AS \$\$([\s\S]*?)\$\$;/.exec(v2.slice(start))!
  let body = m[1]
  const chunk = g6.split('\nselect pg_temp.g6_rewrite(\n').find((c) => c.includes(`'${FN}'::regprocedure`))!
  const quoted = (tag: string) => [...chunk.matchAll(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g'))].map((x) => x[1])
  const old = quoted('g6old'), next = quoted('g6new')
  expect(sha(body)).toBe('0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9')
  // main's S01 patch of stored_contract_v1 (its second old_body/new_body pair), installed before G-6.
  const patch = s01.slice(s01.lastIndexOf('DECLARE old_body text; new_body text; ddl text;'))
  const s01Old = /old_body:=\$old\$([\s\S]*?)\$old\$/.exec(patch)![1], s01New = /new_body:=\$new\$([\s\S]*?)\$new\$/.exec(patch)![1]
  expect(body.split(s01Old).length - 1).toBe(1)
  body = body.split(s01Old).join(s01New)
  expect(sha(body)).toBe('63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c')
  old.forEach((o, i) => { body = body.split(o).join(next[i]) })
  return body
}

const C = '11111111-1111-4111-8111-111111111111'
const PURE = ['wire_tokens_v1', 'supported_point_v1', 'validate_contract_v1', 'validate_decimal_source_v2']

async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema gridex_utilts_binding; create schema extensions;
    create function public.digest(b bytea, alg text) returns bytea language sql immutable as $$ select sha256(b) $$;
    create table public.ediel_messages(id uuid primary key, company_id uuid, environment text, message_code text, raw_payload text);
    create table gridex_utilts_binding.receipts(source_message_id uuid, company_id uuid, environment text, message_code text, source_context text, raw_hash text, membership jsonb, contract_version int);
    create table public.ediel_ack_transaction_results(company_id uuid, environment text, source_message_id uuid, source_transaction_id text, disposition text, persistence_status text, planned_response_type text, persisted_series_id uuid);
    create table public.meter_reading_series(id uuid primary key, company_id uuid, immutable_hash text, raw_transaction jsonb);
    create table gridex_utilts_binding.contracts(series_id uuid, company_id uuid, contract_version int, contract jsonb, environment text, transaction_id text, contract_hash text);
    create function gridex_utilts_binding.source_context_v1(s public.ediel_messages) returns text language sql immutable as $$ select 'ctx' $$;
    create function gridex_utilts_binding.wire_tokens_v1(raw text) returns jsonb language plpgsql immutable set search_path to pg_catalog as $$
      begin perform set_config('calls.wire_tokens_v1',(coalesce(nullif(current_setting('calls.wire_tokens_v1',true),''),'0')::int+1)::text,false); return jsonb_build_array(raw); end $$;
    create function gridex_utilts_binding.supported_point_v1(tokens jsonb, transaction_id text) returns text language plpgsql immutable set search_path to pg_catalog as $$
      begin perform set_config('calls.supported_point_v1',(coalesce(nullif(current_setting('calls.supported_point_v1',true),''),'0')::int+1)::text,false); return case when tokens->>0 like '%NOPOINT%' then null else 'P-'||transaction_id end; end $$;
    create function gridex_utilts_binding.validate_contract_v1(c jsonb) returns boolean language plpgsql immutable set search_path to pg_catalog as $$
      begin perform set_config('calls.validate_contract_v1',(coalesce(nullif(current_setting('calls.validate_contract_v1',true),''),'0')::int+1)::text,false); return c->>'bad' is null; end $$;
    create function gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb, item jsonb, mark text) returns boolean language plpgsql immutable set search_path to pg_catalog as $$
      begin perform set_config('calls.validate_decimal_source_v2',(coalesce(nullif(current_setting('calls.validate_decimal_source_v2',true),''),'0')::int+1)::text,false); return tokens->>0 not like '%BADDEC%'; end $$;
    -- main's S01 area helpers (20261023201053): the sources here are not S01, so they are only planned, never reached.
    create function gridex_utilts_binding.s01_l359_area_identity_v1(tokens jsonb, transaction_id text) returns jsonb language sql immutable as $$ select null::jsonb $$;
    create function gridex_utilts_binding.s01_l359_item_matches_v1(tokens jsonb, item jsonb) returns boolean language sql immutable as $$ select false $$;
    create function gridex_utilts_binding.require_s01_l359_basis_v1(p_company uuid, p_source uuid) returns void language sql as $$ select $$;
  `)
  await db.exec(`CREATE FUNCTION ${FN.replace('(uuid,uuid,text)', '(p_company uuid,p_source uuid,p_transaction text)')} RETURNS jsonb
    LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $pre$${preImage()}$pre$;
    REVOKE ALL ON FUNCTION ${FN} FROM PUBLIC,anon,authenticated,service_role;`)
  return db
}

type Fault = 'none' | 'bad_contract' | 'no_point' | 'foreign_point' | 'bad_decimal' | 'raw_hash' | 'contract_hash' | 'not_accepted'
const FAULTS: Fault[] = ['none', 'bad_contract', 'no_point', 'foreign_point', 'bad_decimal', 'raw_hash', 'contract_hash', 'not_accepted']
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

async function seed(db: PGlite, fault: Fault, version: 1 | 2) {
  const source = uuid(), series = uuid(), tx = `TX${n}`
  const raw = `UNB+${tx}+${fault === 'no_point' ? 'NOPOINT' : ''}${fault === 'bad_decimal' ? 'BADDEC' : ''}`
  const contract: Record<string, unknown> = { version, companyId: C, environment: 'test', messageCode: 'E66', transactionId: tx,
    observations: [{ externalPoint: fault === 'foreign_point' ? 'OTHER' : `P-${tx}` }, { externalPoint: `P-${tx}` }] }
  if (fault === 'bad_contract') contract.bad = true
  const rawTx = { consumptionContract: contract, transactionId: tx }
  await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5)', [source, C, 'test', 'E66', raw])
  await db.query("insert into gridex_utilts_binding.receipts values($1,$2,'test','E66','ctx',$3,$4,$5)",
    [source, C, fault === 'raw_hash' ? 'x' : sha(raw), JSON.stringify([tx]), version])
  await db.query("insert into public.ediel_ack_transaction_results values($1,'test',$2,$3,'accepted','persisted',$4,$5)",
    [C, source, tx, fault === 'not_accepted' ? 'negative_aperak' : 'positive_aperak', series])
  await db.query('insert into public.meter_reading_series values($1,$2,null,$3)', [series, C, JSON.stringify(rawTx)])
  await db.query("update public.meter_reading_series set immutable_hash=encode(sha256(convert_to(raw_transaction::text,'UTF8')),'hex') where id=$1", [series])
  await db.query("insert into gridex_utilts_binding.contracts select $1,$2,$3,raw_transaction->'consumptionContract','test',$4,null from public.meter_reading_series where id=$1", [series, C, version, tx])
  await db.query(`update gridex_utilts_binding.contracts set contract_hash=${fault === 'contract_hash' ? "'x'" : "encode(sha256(convert_to(contract::text,'UTF8')),'hex')"} where series_id=$1`, [series])
  return { source, tx }
}

async function call(db: PGlite, c: { source: string; tx: string }) {
  try {
    const { rows } = await db.query<{ r: unknown }>(`select gridex_utilts_binding.stored_contract_v1($1,$2,$3) r`, [C, c.source, c.tx])
    return { ok: rows[0].r }
  } catch (error) { return { error: (error as Error).message } }
}
const pureCalls = async (db: PGlite) => {
  const out: Record<string, number> = {}
  for (const f of PURE) out[f] = Number((await db.query<{ v: string }>(`select coalesce(nullif(current_setting('calls.${f}',true),''),'0') v`)).rows[0].v)
  return out
}
const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0)
const catalog = async (db: PGlite) => (await db.query<{ m: Record<string, unknown> }>(
  `select to_jsonb(p)-'prosrc' m from pg_proc p where oid='${FN}'::regprocedure`)).rows[0].m

async function run(db: PGlite, cases: Array<{ source: string; tx: string }>) {
  const out: unknown[] = []
  for (const c of cases) out.push(await call(db, c), await call(db, c), await call(db, c))
  return out
}

describe('G-8 stored_contract_v1 runs its pure checks once per hash-bound content and rule set', () => {
  it('reconstructs the installed pre-image', () => {
    expect(sha(preImage())).toBe('1ea52c365e001d5d9a99fd86210242791a3b9feb5094a430de06b2a2c2b9944f')
  })

  it('returns identical results and errors before and after, and skips the pure checks on repeated passed calls', async () => {
    const before = await freshDb(), after = await freshDb()
    const metaBefore = await catalog(after)
    await after.exec(migration)
    expect(await catalog(after)).toEqual(metaBefore)
    const casesBefore: Array<{ source: string; tx: string }> = [], casesAfter: typeof casesBefore = []
    for (const version of [1, 2] as const) for (const fault of FAULTS) {
      n = 1000 * version + FAULTS.indexOf(fault) * 10; casesBefore.push(await seed(before, fault, version))
      n = 1000 * version + FAULTS.indexOf(fault) * 10; casesAfter.push(await seed(after, fault, version))
    }
    const a = await run(before, casesBefore), b = await run(after, casesAfter)
    expect(b).toEqual(a)
    // Not vacuous: both outcomes and every error occur.
    // v1 has no decimal rule, so v1 with a bad decimal passes too: three passing combinations, three calls each.
    expect(a.filter((r) => (r as { ok?: unknown }).ok).length).toBe(9)
    expect(new Set(a.flatMap((r) => (r as { error?: string }).error ?? [])).size).toBe(5)
    // Only the three passing combinations are remembered.
    expect(Number((await after.query<{ n: number }>('select count(*)::int n from gridex_utilts_binding.stored_contract_pure_checks')).rows[0].n)).toBe(3)

    // A repeated passing call runs no pure check after the migration; before it, every call ran them again.
    const ok = casesAfter[0], okBefore = casesBefore[0]
    const beforeCount = total(await pureCalls(before)); await call(before, okBefore)
    const afterCount = total(await pureCalls(after)); await call(after, ok)
    expect(total(await pureCalls(before)) - beforeCount).toBeGreaterThan(0)
    expect(total(await pureCalls(after)) - afterCount).toBe(0)
    await before.close(); await after.close()
  }, 120_000)

  it('validates afresh after any rule change', async () => {
    const db = await freshDb()
    await db.exec(migration)
    const c = await seed(db, 'none', 2)
    expect(await call(db, c)).toHaveProperty('ok')
    const memo = total(await pureCalls(db)); await call(db, c)
    expect(total(await pureCalls(db))).toBe(memo)
    // The rule now refuses this contract: the memo must not hide that.
    await db.exec(`create or replace function gridex_utilts_binding.validate_contract_v1(c jsonb) returns boolean language plpgsql immutable set search_path to pg_catalog as $$
      begin perform set_config('calls.validate_contract_v1',(coalesce(nullif(current_setting('calls.validate_contract_v1',true),''),'0')::int+1)::text,false); return false; end $$;`)
    expect(await call(db, c)).toEqual({ error: 'utilts_consumption_contract_conflict' })
    await db.close()
  }, 120_000)

  it('keeps the memo table closed to every API role and refuses to install over any other body', async () => {
    const db = await freshDb()
    await db.exec(migration)
    const { rows } = await db.query<{ r: string; p: boolean }>(`select r, has_table_privilege(r,'gridex_utilts_binding.stored_contract_pure_checks','select,insert,update,delete') p from unnest(array['anon','authenticated','service_role']) r`)
    expect(rows.every((row) => !row.p)).toBe(true)
    await db.close()
    const other = await freshDb()
    await other.exec(`create or replace function ${FN.replace('(uuid,uuid,text)', '(p_company uuid,p_source uuid,p_transaction text)')} returns jsonb language plpgsql set search_path=pg_catalog,public,extensions as $$begin return null; end$$;`)
    await expect(other.exec(migration)).rejects.toThrow('g8_stored_contract_pre_image_changed')
    await other.close()
  })
})
