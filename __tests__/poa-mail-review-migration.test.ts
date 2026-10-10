// poa-mail-review: #13, #15
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = 'supabase/migrations/20261009210000_poa_mail_stockholm_expiry_and_contact_channel_guard.sql'
const CO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
    create function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$ select current_setting('test.admin', true) = 'on' $$;
    -- Deterministic clock: 2026-10-09 22:30 UTC is 2026-10-10 00:30 in Stockholm.
    create function public.now() returns timestamptz language sql stable as $$ select '2026-10-09 22:30:00+00'::timestamptz $$;
    create table public.powers_of_attorney(id text primary key, company_id uuid, status text, valid_to date, updated_at timestamptz);
    create table public.power_of_attorney_events(id serial primary key, company_id uuid, power_of_attorney_id text, event_type text, payload jsonb);
    create table public.grid_owners(id uuid primary key, communication_email text, contact_email text, email text);
    create table public.ediel_mailboxes(id serial primary key, email_address text);
    create table public.grid_owner_contact_channels(
      id serial primary key, grid_owner_id uuid not null, company_id uuid, channel_type text not null,
      email text, is_enabled boolean not null default true, is_verified boolean not null default false,
      verified_at timestamptz, updated_at timestamptz default now());
    grant usage on schema auth to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
    insert into public.grid_owners values ('${GO}', 'ediel@gateway.example', 'kontakt@owner.example', null);
    insert into public.ediel_mailboxes(email_address) values ('ediel@gridex.example');
  `)
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'))
})

afterAll(async () => { await db.close() })

async function as<T>(role: string, admin: boolean, fn: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role === 'service_role' ? 'service_role' : 'authenticated'}; select set_config('test.role','${role}',true), set_config('test.admin','${admin ? 'on' : 'off'}',true);`)
    return fn(tx)
  })
}

describe('#13 POA expiry uses the Stockholm calendar date', () => {
  it('expires a POA whose valid_to was yesterday in Stockholm even when UTC still shows that day', async () => {
    await db.exec(`
      insert into public.powers_of_attorney values
        ('ends-utc-today', '${CO}', 'signed', '2026-10-09', null),
        ('ends-stockholm-today', '${CO}', 'signed', '2026-10-10', null);
    `)
    const result = await as('service_role', false, (tx) =>
      tx.query<{ r: { expired: number } }>('select public.gridex_expire_overdue_powers_of_attorney_v1(100) as r'))
    expect(result.rows[0].r.expired).toBe(1)
    const rows = await db.query<{ id: string; status: string }>('select id, status from public.powers_of_attorney order by id')
    expect(rows.rows).toEqual([
      { id: 'ends-stockholm-today', status: 'signed' },
      { id: 'ends-utc-today', status: 'expired' },
    ])
  })

  it('keeps the service-role-only ACL', async () => {
    await expect(as('authenticated', false, (tx) => tx.query('select public.gridex_expire_overdue_powers_of_attorney_v1(1)'))).rejects.toThrow(/poa_expiry_service_role_required|permission denied/)
  })
})

describe('#15 grid_owner_contact_channels verification guard', () => {
  it('refuses a tenant admin marking a channel verified and lets the tenant keep unverified rows', async () => {
    await expect(as('authenticated', false, (tx) => tx.exec(
      `insert into public.grid_owner_contact_channels(grid_owner_id, company_id, channel_type, email, is_verified) values ('${GO}', '${CO}', 'facility_information_request', 'kundtjanst@owner.example', true)`,
    ))).rejects.toThrow(/verification_requires_platform_admin/)

    await as('authenticated', false, async (tx) => {
      await tx.exec(`insert into public.grid_owner_contact_channels(grid_owner_id, company_id, channel_type, email, is_verified, verified_at) values ('${GO}', '${CO}', 'escalation', 'tenant@owner.example', false, now())`)
      const row = await tx.query<{ verified_at: string | null }>(`select verified_at from public.grid_owner_contact_channels where email = 'tenant@owner.example'`)
      expect(row.rows[0].verified_at).toBeNull()
      await expect(tx.exec(`update public.grid_owner_contact_channels set is_verified = true where email = 'tenant@owner.example'`)).rejects.toThrow(/verification_requires_platform_admin/)
    })
  })

  it('validates the address and stamps verified_at for service role and platform admin', async () => {
    await expect(as('service_role', false, (tx) => tx.exec(
      `insert into public.grid_owner_contact_channels(grid_owner_id, channel_type, email, is_verified) values ('${GO}', 'ai_list', 'not-an-email', true)`,
    ))).rejects.toThrow(/invalid_email/)

    for (const [role, admin, type] of [['service_role', false, 'facility_information_request'], ['authenticated', true, 'power_of_attorney']] as const) {
      await as(role, admin, async (tx) => {
        await tx.exec(`insert into public.grid_owner_contact_channels(grid_owner_id, channel_type, email, is_verified) values ('${GO}', '${type}', ' Anlaggning@Owner.example ', true)`)
        const row = await tx.query<{ email: string; verified_at: string | null }>(`select email, verified_at from public.grid_owner_contact_channels where channel_type = '${type}'`)
        expect(row.rows[0].email).toBe('Anlaggning@Owner.example')
        expect(row.rows[0].verified_at).not.toBeNull()
      })
    }
  })

  it('refuses shared Ediel gateways as verified manual recipients (case-insensitive)', async () => {
    for (const email of ['EDIEL@gateway.example', 'kontakt@owner.example', 'Ediel@Gridex.example']) {
      await expect(as('service_role', false, (tx) => tx.exec(
        `insert into public.grid_owner_contact_channels(grid_owner_id, channel_type, email, is_verified) values ('${GO}', 'supplier_switch_manual', '${email}', true)`,
      ))).rejects.toThrow(/shared_ediel_gateway/)
    }
    // An unverified row may hold it; it is never selected for sending.
    await as('service_role', false, (tx) => tx.exec(
      `insert into public.grid_owner_contact_channels(grid_owner_id, channel_type, email, is_verified) values ('${GO}', 'supplier_switch_manual', 'ediel@gateway.example', false)`,
    ))
  })
})
