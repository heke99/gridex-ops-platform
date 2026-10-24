// reality-defects: H-13
// H-13 (reality H run 2): a grid owner's Z05 LK (Z23, a move-out with a new customer moving in) ends our supply
// without any message of ours. recorded_supply_current_v1 sent every Z05 with a Z23 object to the closure-end check
// (an answer to OUR Z08 LK), which needs our closure receipt and original, so the ended period lost its billing basis
// and every value of it was blocked. Migration 20261024160000 sends a Z23 Z05 to the closure check only when it is a
// closure end of ours (z05_closure_owned_v1) or that cannot be decided. These tests run the captured pre-image
// (supabase/schema.sql) and the migrated body in embedded PostgreSQL over stubs of its collaborators.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const migration = read('supabase/migrations/20261024160000_h13_z05_lk_without_own_closure_is_an_ordinary_end.sql')
const FN = 'gridex_bilateral_prodat.recorded_supply_current_v1'

function preImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf(`CREATE FUNCTION ${FN}(`)
  const m = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))!
  expect(sha(m[2])).toBe('04b9de6b17709a1da8206a96265690f9ed9e182b2ba30178ca5dbecfa8900c2e')
  return m[2]
}

const C = '11111111-1111-4111-8111-111111111111'

async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create schema gridex_bilateral_prodat; create schema gridex_received_sources; create schema gridex_supply_rescission;
    create table public.ediel_messages(id uuid primary key, company_id uuid, message_code text, message_family text, direction text, environment text, raw_payload text);
    create table gridex_received_sources.supply_source_transitions(company_id uuid, source_message_id uuid, source_code text, payload_hash text, source_objects jsonb);
    create table gridex_bilateral_prodat.supply_effect_receipts(company_id uuid, source_message_id uuid, environment text, payload_hash text, transition_hash text, profiles jsonb);
    -- Collaborators: which path ran is the observable outcome.
    create table public.owned(source_message_id uuid primary key, owned boolean);
    create function gridex_bilateral_prodat.lock_supply_v1() returns void language sql as $$ select $$;
    create function public.ediel_require_source_bytes_available_v1(c uuid, s uuid) returns void language sql as $$ select $$;
    create function gridex_bilateral_prodat.recorded_closure_end_current_v1(c uuid, s uuid) returns boolean language sql as $$ select false $$;
    create function gridex_supply_rescission.recorded_end_current_v1(c uuid, s uuid) returns boolean language sql as $$ select true $$;
    create function gridex_received_sources.normal_switch_wire_v1(p_raw text) returns jsonb language sql as $$ select case when p_raw like '%BROKEN%' then null else jsonb_build_object('code','Z05','objects','[]'::jsonb) end $$;
    create function gridex_bilateral_prodat.z05_closure_owned_v1(m public.ediel_messages, w jsonb) returns boolean language sql as
      $$ select case when w is null then null else coalesce((select o.owned from public.owned o where o.source_message_id=m.id), false) end $$;
  `)
  await db.exec(`CREATE FUNCTION ${FN}(c uuid, s uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $pre$${preImage()}$pre$;`)
  return db
}

type Case = { name: string; reason: 'Z22' | 'Z23' | 'Z25'; owned?: boolean; broken?: boolean }
const CASES: Case[] = [
  { name: 'grid-owner Z05 LK, no closure of ours', reason: 'Z23', owned: false },
  { name: 'Z05 LK answering our closure', reason: 'Z23', owned: true },
  { name: 'Z05 LK with an unreadable wire', reason: 'Z23', owned: false, broken: true },
  { name: 'Z05 L', reason: 'Z22' },
  { name: 'Z05 H without its receipt', reason: 'Z25' },
]
let n = 0
async function seed(db: PGlite, c: Case) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const raw = `UNH+${id}${c.broken ? '+BROKEN' : ''}`
  await db.query("insert into public.ediel_messages values($1,$2,'Z05','PRODAT','inbound','production',$3)", [id, C, raw])
  await db.query("insert into gridex_received_sources.supply_source_transitions values($1,$2,'Z05',$3,$4)", [C, id, sha(raw), JSON.stringify([{ reason: c.reason, point: 'P1', li: 'L1' }])])
  if (c.owned !== undefined) await db.query('insert into public.owned values($1,$2)', [id, c.owned])
  return id
}
async function evaluate(db: PGlite) {
  n = 0
  const out: Record<string, boolean | null> = {}
  for (const c of CASES) {
    const id = await seed(db, c)
    out[c.name] = (await db.query<{ v: boolean | null }>(`select ${FN}($1,$2) v`, [C, id])).rows[0].v
  }
  return out
}
const catalog = async (db: PGlite) => (await db.query<{ m: Record<string, unknown> }>(
  `select to_jsonb(p)-'prosrc' m from pg_proc p where oid='${FN}(uuid,uuid)'::regprocedure`)).rows[0].m

describe('H-13 a grid-owner Z05 LK without a closure of ours is checked as an ordinary received end', () => {
  it('changes exactly the Z05 LK that answers no closure of ours', async () => {
    const before = await freshDb()
    expect(await evaluate(before)).toEqual({
      'grid-owner Z05 LK, no closure of ours': false, // the defect: the ended period loses its billing basis
      'Z05 LK answering our closure': false,
      'Z05 LK with an unreadable wire': false,
      'Z05 L': true,
      'Z05 H without its receipt': false,
    })
    const after = await freshDb()
    const meta = await catalog(after)
    await after.exec(migration)
    expect(await catalog(after)).toEqual(meta)
    expect(await evaluate(after)).toEqual({
      'grid-owner Z05 LK, no closure of ours': true,
      'Z05 LK answering our closure': false, // still the closure check (no receipt here)
      'Z05 LK with an unreadable wire': false, // undecidable: still the strict closure check
      'Z05 L': true,
      'Z05 H without its receipt': false,
    })
    await before.close(); await after.close()
  })

  it('still fails an ordinary Z05 LK whose received end is not current', async () => {
    const db = await freshDb()
    await db.exec(migration)
    await db.exec('create or replace function gridex_supply_rescission.recorded_end_current_v1(c uuid, s uuid) returns boolean language sql as $$ select false $$')
    const id = await seed(db, CASES[0])
    expect((await db.query<{ v: boolean }>(`select ${FN}($1,$2) v`, [C, id])).rows[0].v).toBe(false)
    await db.close()
  })

  it('refuses to install over any other body', async () => {
    const db = await freshDb()
    await db.exec(`create or replace function ${FN}(c uuid, s uuid) returns boolean language plpgsql security definer set search_path to 'pg_catalog' as $$begin return true; end$$`)
    await expect(db.exec(migration)).rejects.toThrow('h13_recorded_supply_pre_image_changed')
    await db.close()
  })
})
