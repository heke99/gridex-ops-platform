// ops-api-review: F33 (policy parity after initplan rewrite)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

it('keeps read/write decisions identical for service, admin, tenant reader and other tenant', async () => {
  const db = new PGlite()
  await db.exec(`
    create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
    create function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$ select current_setting('test.admin', true) = 'on' $$;
    create function public.gridex_can_read_company(c uuid) returns boolean language sql stable as $$ select c::text = current_setting('test.company', true) $$;
    create table public.inbound_operation_events(id serial primary key, company_id uuid);
    alter table public.inbound_operation_events enable row level security;
    create policy inbound_operation_events_read on public.inbound_operation_events for select using (((auth.role() = 'service_role'::text) or public.gridex_user_is_platform_admin() or ((company_id is not null) and public.gridex_can_read_company(company_id))));
    create policy inbound_operation_events_write on public.inbound_operation_events using (((auth.role() = 'service_role'::text) or public.gridex_user_is_platform_admin())) with check (((auth.role() = 'service_role'::text) or public.gridex_user_is_platform_admin()));
    grant usage on schema auth to authenticated; grant all on public.inbound_operation_events to authenticated; grant usage, select on sequence public.inbound_operation_events_id_seq to authenticated;
    insert into public.inbound_operation_events(company_id) values ('${A}'), ('${B}'), (null);
  `)
  const cases = [
    { role: 'service_role', admin: 'off', company: '' },
    { role: 'authenticated', admin: 'on', company: '' },
    { role: 'authenticated', admin: 'off', company: A },
    { role: 'authenticated', admin: 'off', company: '' },
  ]
  async function observe() {
    const out: string[] = []
    for (const c of cases) {
      out.push(await db.transaction(async (tx) => {
        await tx.exec(`set local role authenticated; select set_config('test.role','${c.role}',true), set_config('test.admin','${c.admin}',true), set_config('test.company','${c.company}',true);`)
        const read = (await tx.query<{ n: number }>('select count(*)::int n from public.inbound_operation_events')).rows[0].n
        let write = 'ok'
        try { await tx.exec(`insert into public.inbound_operation_events(company_id) values ('${A}')`) } catch { write = 'denied' }
        await tx.rollback()
        return `${c.role}/${c.admin}/${c.company || '-'}: read=${read} write=${write}`
      }))
    }
    return out
  }
  const before = await observe()
  await db.exec(fs.readFileSync('supabase/migrations/20261009171000_ops_api_inbound_events_policy_initplan.sql', 'utf8'))
  expect(await observe()).toEqual(before)
  expect(before).toContain(`authenticated/off/${A}: read=1 write=denied`)
  const qual = (await db.query<{ qual: string }>(`select qual from pg_policies where policyname = 'inbound_operation_events_read'`)).rows[0].qual
  expect(qual).toMatch(/SELECT auth\.role\(\)/)
  await db.close()
})
