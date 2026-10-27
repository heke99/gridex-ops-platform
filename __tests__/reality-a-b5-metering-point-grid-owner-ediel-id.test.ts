// reality-defects: A-B5
// A-B5: a metering point the Z02 core created was bound to its grid owner but carried no grid_owner_ediel_id, so the
// new agreement's requested metering method (F46) was held and no website customer's Z03 could be prepared. The
// trigger from migration 20261027110000 fills the column from the bound, usable grid owner. Actual migration in PGlite
// on declared minimal tables.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const forward = readFileSync(resolve('supabase/migrations/20261027110000_metering_point_grid_owner_ediel_id_from_bound_owner.sql'), 'utf8')
const T = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002'
const OWN = '00000000-0000-4000-8000-0000000000a1', SHARED = '00000000-0000-4000-8000-0000000000a2', FOREIGN = '00000000-0000-4000-8000-0000000000a3', INACTIVE = '00000000-0000-4000-8000-0000000000a4'
let db: PGlite
const point = async (id: number, owner: string | null, ediel: string | null = null, company = T) => {
  await db.query(`INSERT INTO public.metering_points(id,company_id,grid_owner_id,grid_owner_ediel_id) VALUES($1,$2,$3,$4)`, [`00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, company, owner, ediel])
  return (await db.query<{ e: string | null }>(`SELECT grid_owner_ediel_id e FROM public.metering_points WHERE id=$1`, [`00000000-0000-4000-8000-${String(id).padStart(12, '0')}`])).rows[0].e
}
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.grid_owners(id uuid PRIMARY KEY, company_id uuid, ediel_id text, is_active boolean);
    CREATE TABLE public.metering_points(id uuid PRIMARY KEY, company_id uuid, grid_owner_id uuid, grid_owner_ediel_id text);
    INSERT INTO public.grid_owners VALUES('${OWN}','${T}','11111',true),('${SHARED}',NULL,'16700',true),('${FOREIGN}','${OTHER}','99999',true),('${INACTIVE}',NULL,'55555',false);`)
  await db.exec(forward)
})

it("fills the Ediel id from the tenant's own or a shared bound grid owner", async () => {
  expect(await point(1, SHARED)).toBe('16700')
  expect(await point(2, OWN)).toBe('11111')
})

it("never reads another tenant's or an inactive grid owner, and leaves an unbound point alone", async () => {
  expect(await point(3, FOREIGN)).toBeNull()
  expect(await point(4, INACTIVE)).toBeNull()
  expect(await point(5, null)).toBeNull()
})

it('keeps an explicit value that differs from the bound owner', async () => {
  expect(await point(6, SHARED, '12345')).toBe('12345')
})

it('follows a change of grid owner when the stored value was the previous owner\'s, never an explicit one', async () => {
  await point(7, OWN)
  await db.query(`UPDATE public.metering_points SET grid_owner_id='${SHARED}' WHERE id='00000000-0000-4000-8000-000000000007'`)
  expect((await db.query<{ e: string }>(`SELECT grid_owner_ediel_id e FROM public.metering_points WHERE id='00000000-0000-4000-8000-000000000007'`)).rows[0].e).toBe('16700')
  await point(8, OWN, '12345')
  await db.query(`UPDATE public.metering_points SET grid_owner_id='${SHARED}' WHERE id='00000000-0000-4000-8000-000000000008'`)
  expect((await db.query<{ e: string }>(`SELECT grid_owner_ediel_id e FROM public.metering_points WHERE id='00000000-0000-4000-8000-000000000008'`)).rows[0].e).toBe('12345')
})
