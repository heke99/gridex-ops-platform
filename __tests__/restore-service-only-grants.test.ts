// ops-api-review: F5 (permanent regression from evidence/database-acl.probe.mjs)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('clean restore + upgrade leaves both legacy helpers service-only', async () => {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.gridex_db4b_archive_customer_registry_row(p_lookup text, p_email text, p_apply boolean, p_reason text) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
    create function public.gridex_next_customer_number(p_company_id uuid) returns text language sql security definer as $$ select '1' $$;
    -- Grants exactly as in the canonical snapshot before this fix.
    revoke all on function public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) from public;
    grant all on function public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) to authenticated, service_role;
    revoke all on function public.gridex_next_customer_number(uuid) from public;
    grant all on function public.gridex_next_customer_number(uuid) to authenticated, service_role;
  `)
  await db.exec(fs.readFileSync('supabase/migrations/20261009160000_ops_api_service_only_restore_grants.sql', 'utf8'))
  const r = await db.query<{ fn: string; role: string; ok: boolean }>(`
    select f.fn, r.role, has_function_privilege(r.role, f.fn, 'EXECUTE') ok
      from (values ('public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text)'), ('public.gridex_next_customer_number(uuid)')) f(fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r(role) order by 1, 2`)
  expect(r.rows.map((row) => `${row.role}:${row.ok}`)).toEqual([
    'anon:false', 'authenticated:false', 'service_role:true',
    'anon:false', 'authenticated:false', 'service_role:true',
  ])
  const service = await db.transaction(async (tx) => {
    await tx.exec('set local role service_role')
    return (await tx.query<{ n: string }>(`select public.gridex_next_customer_number(gen_random_uuid()) n`)).rows[0].n
  })
  expect(service).toBe('1')
  await db.close()
})
