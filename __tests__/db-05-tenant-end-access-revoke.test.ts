// masterplan: DB-05, AT-DB-05
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Tenant end: once the company is closed its members lose read and write
// through the real generated access predicates, while the retained journals
// stay and still block parent deletion. The predicates are taken verbatim from
// the generated schema; auth/profile/role relations are a finite fixture.
const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8');
function generatedFunction(name: string): string {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`generated function missing: ${name}`);
  const tag = /AS (\$[A-Za-z_]*\$)/.exec(schema.slice(start))![1];
  const bodyStart = schema.indexOf(tag, start) + tag.length;
  const close = schema.indexOf(`${tag};`, bodyStart);
  if (close < 0) throw new Error(`generated function unterminated: ${name}`);
  return schema.slice(start, close + tag.length + 1);
}

const company = '11111111-1111-4111-8111-111111111111';
const other = '33333333-3333-4333-8333-333333333333';
const member = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const retainedJournals = ['canonical_audit_events', 'ediel_business_correlations', 'ediel_route_history'] as const;
let db: PGlite;

async function access(user: string, target: string): Promise<{ read: boolean; write: boolean }> {
  await db.exec(`savepoint probe; select set_config('test.uid', '${user}', true); set local role authenticated`);
  try {
    const result = await db.query<{ read: boolean; write: boolean }>(
      'select public.gridex_can_read_company($1::uuid) as read, public.gridex_can_write_company($1::uuid) as write', [target],
    );
    return result.rows[0];
  } finally {
    await db.exec('rollback to savepoint probe; reset role; release savepoint probe');
  }
}

async function attempt(role: 'postgres' | 'service_role', sql: string): Promise<string | undefined> {
  await db.exec(`savepoint attempt; set local role ${role}`);
  try {
    await db.exec(sql);
    await db.exec('reset role; release savepoint attempt');
    return undefined;
  } catch (error) {
    await db.exec('rollback to savepoint attempt; reset role; release savepoint attempt');
    return (error as { code?: string }).code;
  }
}

async function count(table: string, target: string): Promise<number> {
  const column = table === 'companies' ? 'id' : 'company_id';
  const result = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${column} = $1::uuid`, [target]);
  return result.rows[0].n;
}

describe('DB05 tenant end revokes member access and keeps retained history', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role supabase_admin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table auth.users (id uuid primary key, deleted_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz default now());
      create table public.companies (id uuid primary key, status text not null);
      create table public.customers (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), is_test_data boolean, source text);
      create table public.user_profiles (id uuid primary key, user_status text, disabled_at timestamptz);
      create table public.admin_users (user_id uuid, role text, is_active boolean);
      create table public.roles (id uuid primary key, key text, name text);
      create table public.user_roles (user_id uuid, company_id uuid, role_id uuid, role text, is_active boolean, status text);
      create table public.company_memberships (
        company_id uuid references public.companies(id), user_id uuid, status text, is_active boolean, membership_role text
      );
    `);
    for (const table of ['customer_contracts', 'customer_invoices', 'invoice_documents', 'billing_underlays', 'contract_charge_ledger',
      'canonical_audit_events', 'canonical_command_results', 'canonical_domain_events', 'canonical_event_outbox', 'pricing_audit_logs',
      'domain_events', 'ediel_ack_transaction_results', 'ediel_business_correlations', 'ediel_business_errors', 'ediel_route_history',
      'ediel_certification_evidence']) {
      await db.exec(`create table public.${table} (id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade)`);
    }
    await db.exec(readFileSync(resolve('supabase/migrations/20261005130000_hard_delete_guard_companies_customers.sql'), 'utf8'));
    await db.exec(readFileSync(resolve('supabase/migrations/20261011121542_db05_retained_audit_ediel_journals.sql'), 'utf8'));
    for (const name of ['gridex_normalize_platform_role', 'gridex_is_current_session_allowed', 'gridex_user_is_platform_admin',
      'gridex_can_read_company', 'gridex_can_write_company']) {
      await db.exec(generatedFunction(name));
    }
    await db.exec(`
      grant usage on schema auth to authenticated;
      grant execute on function public.gridex_can_read_company(uuid), public.gridex_can_write_company(uuid) to authenticated;
      grant select, insert, update, delete on all tables in schema public to service_role;
    `);
  }, 30_000);

  beforeEach(async () => {
    await db.exec(`begin;
      insert into public.companies values ('${company}', 'active'), ('${other}', 'active');
      insert into auth.users (id) values ('${member}');
      insert into public.user_profiles values ('${member}', 'active', null);
      insert into public.company_memberships values ('${company}', '${member}', 'active', true, 'operations'),
        ('${other}', '${member}', 'active', true, 'operations');`);
    for (const table of retainedJournals) await db.query(`insert into public.${table} (company_id) values ($1)`, [company]);
  });
  afterEach(async () => { await db.exec('rollback'); });
  afterAll(async () => { await db.close(); });

  it('grants the active member read and write before tenant end', async () => {
    expect(await access(member, company)).toEqual({ read: true, write: true });
  });

  it('revokes read and write when the company is closed, without touching retained journals', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'closed' where id = '${company}'`)).toBeUndefined();
    expect(await access(member, company)).toEqual({ read: false, write: false });
    for (const table of retainedJournals) expect(await count(table, company)).toBe(1);
    // The member's membership row is unchanged; the company status alone ends access.
    expect((await db.query('select status, is_active from public.company_memberships where company_id = $1 and user_id = $2', [company, member])).rows)
      .toEqual([{ status: 'active', is_active: true }]);
  });

  it.each(['archived', 'pending_deletion'])('revokes read and write in the %s tenant-end state', async (status) => {
    expect(await attempt('postgres', `update public.companies set status = '${status}' where id = '${company}'`)).toBeUndefined();
    expect(await access(member, company)).toEqual({ read: false, write: false });
    for (const table of retainedJournals) expect(await count(table, company)).toBe(1);
  });

  it('keeps a paused tenant readable but not writable (not a tenant end)', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'paused' where id = '${company}'`)).toBeUndefined();
    expect(await access(member, company)).toEqual({ read: true, write: false });
  });

  it('refuses service-role deletion of the closed company while journals are retained', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'closed' where id = '${company}'`)).toBeUndefined();
    expect(await attempt('service_role', `delete from public.companies where id = '${company}'`)).toBe('23001');
    expect(await count('companies', company)).toBe(1);
    for (const table of retainedJournals) expect(await count(table, company)).toBe(1);
  });

  it('isolates the member\'s other active tenant from the closed one', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'closed' where id = '${company}'`)).toBeUndefined();
    expect(await access(member, other)).toEqual({ read: true, write: true });
    expect(await access(member, company)).toEqual({ read: false, write: false });
  });

  it('gives no access to an unauthenticated session on the active tenant', async () => {
    await db.exec(`savepoint anon_probe; set local role authenticated`);
    const result = await db.query<{ read: boolean; write: boolean }>(
      'select public.gridex_can_read_company($1::uuid) as read, public.gridex_can_write_company($1::uuid) as write', [company],
    );
    await db.exec('rollback to savepoint anon_probe; reset role; release savepoint anon_probe');
    expect(result.rows[0]).toEqual({ read: false, write: false });
  });
});
