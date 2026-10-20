// masterplan: DB-05, AT-DB-05
// AT-DB-05 "tenant ends": once a tenant leaves active/onboarding the member's
// ordinary access is revoked by the real RLS helpers, while retained journals
// stay in place. Executes in PGlite: the actual bodies of
// gridex_can_read_company, gridex_can_write_company and their dependencies
// (copied verbatim from supabase/schema.sql), the actual audit_logs RLS policies
// from supabase/schema.sql, and the actual DB-05 hard-delete guard migrations.
// Fixture-only: auth.uid() mirrors Supabase's JWT-claim reader; tables carry
// only the columns these bodies read; status changes are made by the database
// owner, modelling the canonical lifecycle command without claiming RPC proof.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8');
const helpers = [
  'public.gridex_normalize_platform_role',
  'public.gridex_is_current_session_allowed',
  'public.gridex_user_is_platform_admin',
  'public.gridex_user_company_ids',
  'public.gridex_can_read_company',
  'public.gridex_can_write_company',
] as const;
const journals = [
  'canonical_audit_events', 'canonical_command_results', 'canonical_domain_events',
  'canonical_event_outbox', 'pricing_audit_logs', 'domain_events',
  'ediel_ack_transaction_results', 'ediel_business_correlations', 'ediel_business_errors',
  'ediel_route_history', 'ediel_certification_evidence',
] as const;
const originalCategories = [
  'customer_contracts', 'customer_invoices', 'invoice_documents', 'billing_underlays', 'contract_charge_ledger',
] as const;

const company = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const owner = '33333333-3333-4333-8333-333333333333';
const member = '44444444-4444-4444-8444-444444444444';
const platformAdmin = '55555555-5555-4555-8555-555555555555';
// Terminal / non-writable statuses from companies_canonical_status_check.
const ended = ['closed', 'pending_deletion', 'archived', 'suspended'] as const;

function functionDefinition(name: string): string {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const tail = schema.slice(start);
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(tail);
  if (!tag) throw new Error(`missing body ${name}`);
  const end = tail.indexOf(`${tag[1]};`, tag.index + tag[0].length);
  return tail.slice(0, end + tag[1].length + 1);
}

function auditLogPolicies(): string[] {
  const policies = schema.match(/^CREATE POLICY \S+ ON public\.audit_logs .*;$/gm) ?? [];
  if (policies.length !== 7) throw new Error(`audit_logs policy count changed: ${policies.length}`);
  return policies;
}

let db: PGlite;

type Outcome<T> = { value?: T; code?: string };

async function asUser<T>(user: string, run: () => Promise<T>): Promise<Outcome<T>> {
  await db.exec('savepoint actor');
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await db.exec('set local role authenticated');
  try {
    const value = await run();
    await db.exec('reset role; release savepoint actor');
    return { value };
  } catch (error) {
    await db.exec('rollback to savepoint actor; reset role; release savepoint actor');
    return { code: (error as { code?: string }).code };
  }
}

async function access(user: string, target = company): Promise<{ read: boolean; write: boolean }> {
  const outcome = await asUser(user, async () => (await db.query<{ read: boolean; write: boolean }>(
    'select public.gridex_can_read_company($1::uuid) as read, public.gridex_can_write_company($1::uuid) as write',
    [target],
  )).rows[0]);
  if (!outcome.value) throw new Error(`helper call failed: ${outcome.code}`);
  return outcome.value;
}

async function visibleAuditLogs(user: string): Promise<number> {
  const outcome = await asUser(user, async () => (await db.query<{ n: number }>(
    'select count(*)::int as n from public.audit_logs where company_id = $1', [company],
  )).rows[0].n);
  if (outcome.value === undefined) throw new Error(`audit_logs select failed: ${outcome.code}`);
  return outcome.value;
}

async function insertAuditLog(user: string): Promise<string | undefined> {
  const outcome = await asUser(user, () => db.query(
    `insert into public.audit_logs (company_id, action) values ($1, 'member_write')`, [company],
  ));
  return outcome.code;
}

async function stored(table: string, target = company): Promise<number> {
  const column = table === 'companies' ? 'id' : 'company_id';
  return (await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${column} = $1::uuid`, [target],
  )).rows[0].n;
}

async function setStatus(status: string): Promise<void> {
  await db.query('update public.companies set status = $1 where id = $2', [status, company]);
}

describe('DB05 tenant end revokes member access and keeps retained journals', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role supabase_admin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
      $$;
      create table auth.users (id uuid primary key, deleted_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz);
      create table public.user_profiles (id uuid primary key, user_status text, disabled_at timestamptz);
      create table public.companies (id uuid primary key, status text not null);
      create table public.company_memberships (
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id), user_id uuid not null,
        status text not null default 'active', is_active boolean not null default true,
        membership_role text default 'member'
      );
      create table public.admin_users (user_id uuid, role text, is_active boolean);
      create table public.roles (id uuid primary key, key text, name text);
      create table public.user_roles (user_id uuid, company_id uuid, role_id uuid, role text, status text, is_active boolean);
      create table public.customers (
        id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id),
        is_test_data boolean, source text
      );
      -- audit_logs_company_id_fkey has no ON DELETE action in schema.sql.
      create table public.audit_logs (
        id uuid primary key default gen_random_uuid(),
        company_id uuid references public.companies(id),
        action text not null
      );
    `);
    for (const table of [...originalCategories, ...journals]) {
      await db.exec(`create table public.${table} (
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade
      )`);
    }
    for (const name of helpers) await db.exec(functionDefinition(name));
    for (const name of ['gridex_can_read_company', 'gridex_can_write_company']) {
      await db.exec(`revoke all on function public.${name}(uuid) from public;
        grant all on function public.${name}(uuid) to authenticated, service_role`);
    }
    await db.exec('alter table public.audit_logs enable row level security');
    for (const policy of auditLogPolicies()) await db.exec(policy);
    await db.exec(readFileSync(resolve('supabase/migrations/20261005130000_hard_delete_guard_companies_customers.sql'), 'utf8'));
    await db.exec(readFileSync(resolve('supabase/migrations/20261011121542_db05_retained_audit_ediel_journals.sql'), 'utf8'));
    await db.exec(`grant all on table public.audit_logs to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to service_role`);
  }, 30_000);

  beforeEach(async () => {
    await db.exec(`begin;
      insert into auth.users values
        ('${owner}', null, null, now()), ('${member}', null, null, now()), ('${platformAdmin}', null, null, now());
      insert into public.user_profiles values
        ('${owner}', 'active', null), ('${member}', 'active', null), ('${platformAdmin}', 'active', null);
      insert into public.companies values ('${company}', 'active'), ('${other}', 'active');
      insert into public.company_memberships (company_id, user_id, membership_role) values
        ('${company}', '${owner}', 'owner'), ('${company}', '${member}', 'member');
      insert into public.admin_users values ('${platformAdmin}', 'super_admin', true);
      insert into public.audit_logs (company_id, action) values ('${company}', 'tenant_history');
    `);
    for (const table of journals) await db.query(`insert into public.${table} (company_id) values ($1)`, [company]);
  });
  afterEach(async () => { await db.exec('rollback'); });
  afterAll(async () => { await db.close(); });

  it('grants the active members read and role-scoped write through the real helpers', async () => {
    expect(await access(owner)).toEqual({ read: true, write: true });
    expect(await access(member)).toEqual({ read: true, write: false });
    // Membership is tenant-scoped: no access to a company the user is not in.
    expect(await access(owner, other)).toEqual({ read: false, write: false });
    expect(await visibleAuditLogs(owner)).toBe(1);
    expect(await insertAuditLog(owner)).toBeUndefined();
  });

  it.each(ended)('revokes member read and write when the tenant becomes %s', async (status) => {
    await setStatus(status);
    expect(await access(owner)).toEqual({ read: false, write: false });
    expect(await access(member)).toEqual({ read: false, write: false });
    // Real audit_logs RLS: the former member no longer sees or writes tenant history.
    expect(await visibleAuditLogs(owner)).toBe(0);
    expect(await visibleAuditLogs(member)).toBe(0);
    expect(await insertAuditLog(owner)).toBe('42501');
    // Unrelated tenant is unaffected.
    await db.exec(`insert into public.company_memberships (company_id, user_id, membership_role) values ('${other}', '${owner}', 'owner')`);
    expect(await access(owner, other)).toEqual({ read: true, write: true });
  });

  it.each(ended)('retains audit_logs and every named journal after the tenant becomes %s', async (status) => {
    await setStatus(status);
    expect(await stored('companies')).toBe(1);
    expect(await stored('audit_logs')).toBe(1);
    for (const table of journals) expect(await stored(table)).toBe(1);
    // Raw parent deletion of the ended tenant is refused; nothing is cascaded away.
    await db.exec('savepoint del; set local role service_role');
    let code: string | undefined;
    try {
      await db.exec(`delete from public.companies where id = '${company}'`);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    await db.exec('rollback to savepoint del; reset role; release savepoint del');
    expect(code).toBe('23001');
    expect(await stored('companies')).toBe(1);
    expect(await stored('audit_logs')).toBe(1);
    for (const table of journals) expect(await stored(table)).toBe(1);
  });

  it('keeps paused tenants read-only, exactly as the helper SQL states', async () => {
    await setStatus('paused');
    expect(await access(owner)).toEqual({ read: true, write: false });
    expect(await access(member)).toEqual({ read: true, write: false });
    expect(await visibleAuditLogs(owner)).toBe(1);
    expect(await insertAuditLog(owner)).toBe('42501');
  });

  it('revokes access for a removed membership while the tenant is still active', async () => {
    await db.query(`update public.company_memberships set status = 'removed', is_active = false where user_id = $1`, [owner]);
    expect(await access(owner)).toEqual({ read: false, write: false });
    expect(await visibleAuditLogs(owner)).toBe(0);
    expect(await access(member)).toEqual({ read: true, write: false });
  });

  it('platform admin keeps read of closed-tenant history but loses write (helper SQL as written)', async () => {
    await setStatus('closed');
    expect(await access(platformAdmin)).toEqual({ read: true, write: false });
    expect(await visibleAuditLogs(platformAdmin)).toBe(1);
    expect(await insertAuditLog(platformAdmin)).toBe('42501');
  });
});
