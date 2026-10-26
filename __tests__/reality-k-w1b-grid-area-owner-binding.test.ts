// reality-defects: K-W1b
// K-W1b / owner decision 31: a spelling or company-name difference alone never changes a grid area's grid-owner binding.
// The SVK import (gridex_import_grid_area_master_row, pre-image from supabase/schema.sql) keeps an area's mapped owner,
// creates no new owner and logs the conflict (source, existing binding, imported data) for review; a real owner change
// goes only through gridex_change_platform_grid_area_owner_v1, verified and with history.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync(path.resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261026100000_k_w1b_grid_area_owner_binding_conflicts.sql'), 'utf8')
const fnFromSchema = (name: string, end: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  return schema.slice(start, schema.indexOf(end, start) + end.length)
}
const nameKey = fnFromSchema('gridex_grid_owner_name_key', '$_$;')
const importRow = fnFromSchema('gridex_import_grid_area_master_row', '$$;')

const MAPPED = '11111111-1111-4111-8111-111111111111', OPS = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333', OTHER_OPS = '44444444-4444-4444-8444-444444444444'
const ACTOR = '55555555-5555-4555-8555-555555555555'

let db: PGlite
let role = 'service_role'
beforeEach(async () => {
  db = new PGlite()
  role = 'service_role'
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create table public.platform_grid_owners (id uuid primary key default gen_random_uuid(), owner_code text, name text not null, org_number text,
      ediel_id text, is_active boolean not null default true, source text not null default 'svk_esett', metadata jsonb not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), market_actor_id uuid, ops_grid_owner_id uuid);
    create unique index platform_grid_owners_name_uidx on public.platform_grid_owners (lower(name));
    create table public.platform_grid_areas (id uuid primary key default gen_random_uuid(), grid_area_code text not null unique, grid_area_name text,
      grid_owner_id uuid, grid_owner_name text, price_area text, source text not null default 'svk_esett', source_version text,
      is_active boolean not null default true, valid_from date, valid_to date, metadata jsonb not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    insert into public.platform_grid_owners(id,name,ediel_id,ops_grid_owner_id) values
      ('${MAPPED}','Alingsås Energi Elnät AB','16700','${OPS}'), ('${OTHER}','Annat Elnät AB','19999','${OTHER_OPS}');
    insert into public.platform_grid_areas(grid_area_code,grid_area_name,grid_owner_id,grid_owner_name,price_area)
      values ('ALS','Alingsås','${MAPPED}','Alingsås Energi Elnät AB','SE3');
  `)
  await db.exec(nameKey)
  await db.exec(importRow)
  await db.exec(`create function auth.role() returns text language sql as $$ select current_setting('test.role', true) $$;`)
})
const setRole = async (r: string) => { role = r; await db.query(`select set_config('test.role', $1, false)`, [r]) }
const importAls = (owner: string) => db.query(`select public.gridex_import_grid_area_master_row($1,'Alingsås','ALS','SE3','svk_arcgis',$2)`, [owner, JSON.stringify({ feature: 'als' })])
const als = async () => (await db.query<{ grid_owner_id: string; grid_owner_name: string }>(`select grid_owner_id, grid_owner_name from public.platform_grid_areas where grid_area_code='ALS'`)).rows[0]
const fails = async (sql: string, params: unknown[]) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }

describe('K-W1b before the fix: a name difference rebinds a mapped area', () => {
  it('the pre-image import moves ALS to a new unmapped owner', async () => {
    await importAls('Alingsås Energi Nät AB')
    const row = await als()
    expect(row.grid_owner_id).not.toBe(MAPPED)
    expect((await db.query<{ ops: string | null }>(`select ops_grid_owner_id ops from public.platform_grid_owners where id=$1`, [row.grid_owner_id])).rows[0].ops).toBeNull()
  })
})

describe('K-W1b after the fix: the mapped binding stays, the conflict is logged, an owner change is verified', () => {
  beforeEach(async () => { await setRole('service_role'); await db.exec(migration) })

  it('keeps the mapped owner and its name, creates no owner, and logs source, existing binding and imported data once per conflict', async () => {
    const owners = (await db.query<{ n: number }>(`select count(*)::int n from public.platform_grid_owners`)).rows[0].n
    await importAls('Alingsås Energi Nät AB')
    await importAls('Alingsås Energi Nät AB')
    expect(await als()).toEqual({ grid_owner_id: MAPPED, grid_owner_name: 'Alingsås Energi Elnät AB' })
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.platform_grid_owners`)).rows[0].n).toBe(owners)
    const { rows } = await db.query(`select grid_area_code, existing_platform_grid_owner_id, existing_owner_name, existing_ops_grid_owner_id,
      imported_owner_name, imported_owner_key, candidate_platform_grid_owner_id, source, imported_metadata, status, occurrences from public.platform_grid_area_owner_conflicts`)
    expect(rows).toEqual([{ grid_area_code: 'ALS', existing_platform_grid_owner_id: MAPPED, existing_owner_name: 'Alingsås Energi Elnät AB', existing_ops_grid_owner_id: OPS,
      imported_owner_name: 'Alingsås Energi Nät AB', imported_owner_key: 'alingsåsenerginät', candidate_platform_grid_owner_id: null, source: 'svk_arcgis',
      imported_metadata: { feature: 'als' }, status: 'open', occurrences: 2 }])
  })

  it('a name match of another mapped owner is a conflict too; the same name keeps the binding without a conflict', async () => {
    await importAls('Annat Elnät AB')
    expect((await als()).grid_owner_id).toBe(MAPPED)
    expect((await db.query(`select candidate_platform_grid_owner_id c from public.platform_grid_area_owner_conflicts`)).rows).toEqual([{ c: OTHER }])
    await db.exec(`delete from public.platform_grid_area_owner_conflicts`)
    await importAls('Alingsås Energi Elnät AB')
    expect((await als()).grid_owner_id).toBe(MAPPED)
    expect((await db.query(`select 1 from public.platform_grid_area_owner_conflicts`)).rows).toEqual([])
  })

  it('an unbound area is still bound by the import as before', async () => {
    await db.exec(`update public.platform_grid_areas set grid_owner_id=null`)
    await importAls('Annat Elnät AB')
    expect((await als()).grid_owner_id).toBe(OTHER)
  })

  it('a real owner change goes only through the verified change path, with history, and resolves the conflict', async () => {
    await importAls('Annat Elnät AB')
    const conflict = (await db.query<{ id: string }>(`select id from public.platform_grid_area_owner_conflicts`)).rows[0].id
    const change = `select public.gridex_change_platform_grid_area_owner_v1($1,$2,$3,$4,$5,$6) r`
    expect(await fails(change, ['ALS', OTHER, '', JSON.stringify({ doc: 'x' }), conflict, ACTOR])).toBe('grid_area_owner_change_reason_and_evidence_required')
    expect(await fails(change, ['ALS', OTHER, 'Ägarbyte', '{}', conflict, ACTOR])).toBe('grid_area_owner_change_reason_and_evidence_required')
    await db.exec(`insert into public.platform_grid_owners(name) values ('Omappad Nät AB')`)
    const unmapped = (await db.query<{ id: string }>(`select id from public.platform_grid_owners where name='Omappad Nät AB'`)).rows[0].id
    expect(await fails(change, ['ALS', unmapped, 'Ägarbyte', JSON.stringify({ doc: 'x' }), null, ACTOR])).toBe('grid_area_owner_change_target_not_verified')
    expect(await fails(change, ['ALS', MAPPED, 'Ägarbyte', JSON.stringify({ doc: 'x' }), null, ACTOR])).toBe('grid_area_owner_change_no_change')
    await setRole('authenticated')
    expect(await fails(change, ['ALS', OTHER, 'Ägarbyte', JSON.stringify({ doc: 'x' }), conflict, ACTOR])).toBe('grid_area_owner_change_service_role_required')
    await setRole('service_role')
    await db.query(change, ['ALS', OTHER, 'Verifierat ägarbyte enligt Ei', JSON.stringify({ register: 'Ei nätkoncession 2026-11' }), conflict, ACTOR])
    expect(await als()).toEqual({ grid_owner_id: OTHER, grid_owner_name: 'Annat Elnät AB' })
    expect((await db.query(`select from_platform_grid_owner_id f, to_platform_grid_owner_id t, reason, conflict_id c, changed_by b from public.platform_grid_area_owner_changes`)).rows)
      .toEqual([{ f: MAPPED, t: OTHER, reason: 'Verifierat ägarbyte enligt Ei', c: conflict, b: ACTOR }])
    expect((await db.query(`select status, resolved_by from public.platform_grid_area_owner_conflicts`)).rows).toEqual([{ status: 'resolved', resolved_by: ACTOR }])
    expect(await fails(change, ['ALS', MAPPED, 'Tillbaka', JSON.stringify({ doc: 'x' }), conflict, ACTOR])).toBe('grid_area_owner_conflict_not_open_for_area')
  })

  it('no direct access for anon or authenticated, and another pre-image is refused', async () => {
    const { rows } = await db.query<{ p: boolean }>(`select bool_or(has_table_privilege(r, t, 'select,insert,update,delete')) p
      from unnest(array['anon','authenticated']) r, unnest(array['public.platform_grid_area_owner_conflicts','public.platform_grid_area_owner_changes']) t`)
    expect(rows[0].p).toBe(false)
    expect(role).toBe('service_role')
    const again = new PGlite()
    await again.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
      create table public.platform_grid_owners (id uuid primary key, name text, ediel_id text, is_active boolean, ops_grid_owner_id uuid, metadata jsonb, source text, updated_at timestamptz);
      create table public.platform_grid_areas (id uuid primary key, grid_area_code text unique, grid_area_name text, grid_owner_id uuid, grid_owner_name text, price_area text, source text, metadata jsonb, updated_at timestamptz);
      create function public.gridex_import_grid_area_master_row(p_grid_owner_name text, p_grid_area_name text, p_grid_area_code text, p_price_area text, p_source text default 'svk_esett', p_metadata jsonb default '{}') returns uuid language plpgsql as $$ begin return null; end $$;`)
    await expect(again.exec(migration)).rejects.toThrow(/k_w1b_import_pre_image_changed/)
  })
})
