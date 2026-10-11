import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Execute the real baseline/forward/guard SQL in a finite PGlite fixture.
// Relation columns/FKs are modeled; this is not native ACL, concurrency,
// retention-class authorization, or the canonical lifecycle RPC proof.
const journals = [
  'canonical_audit_events',
  'canonical_command_results',
  'canonical_domain_events',
  'canonical_event_outbox',
  'pricing_audit_logs',
  'domain_events',
  'ediel_ack_transaction_results',
  'ediel_business_correlations',
  'ediel_business_errors',
  'ediel_route_history',
  'ediel_certification_evidence',
] as const;
const originalCategories = [
  'customers', 'customer_contracts', 'customer_invoices',
  'invoice_documents', 'billing_underlays', 'contract_charge_ledger',
] as const;
const active = '11111111-1111-4111-8111-111111111111';
const disposable = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

async function retained(company: string): Promise<string[]> {
  const result = await db.query<{ retained: string[] }>(
    'select public.gridex_company_retained_history_v1($1::uuid) as retained', [company],
  );
  return result.rows[0].retained;
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

async function count(table: string, company: string): Promise<number> {
  const column = table === 'companies' ? 'id' : 'company_id';
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${column} = $1::uuid`, [company],
  );
  return result.rows[0].n;
}

describe('DB05 named retained journals survive company disposal', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role supabase_admin;
      create table public.companies (id uuid primary key, status text not null);
      create table public.customers (
        id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id),
        is_test_data boolean, source text
      );
    `);
    for (const table of [...originalCategories.slice(1), ...journals]) {
      await db.exec(`create table public.${table} (
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade
      )`);
    }
    await db.exec(readFileSync(resolve('supabase/migrations/20261005130000_hard_delete_guard_companies_customers.sql'), 'utf8'));
    await db.exec(readFileSync(resolve('supabase/migrations/20261011121542_db05_retained_audit_ediel_journals.sql'), 'utf8'));
    await db.exec('grant select, insert, update, delete on all tables in schema public to service_role');
  }, 30_000);

  beforeEach(async () => {
    await db.exec(`begin; insert into public.companies values ('${active}', 'onboarding'), ('${disposable}', 'deleted_test_only')`);
  });
  afterEach(async () => { await db.exec('rollback'); });
  afterAll(async () => { await db.close(); });

  it.each(journals)('preserves terminal status marking without deleting %s', async (table) => {
    await db.query(`insert into public.${table} (company_id) values ($1)`, [active]);
    expect(await attempt('postgres', `update public.companies set status = 'deleted_test_only' where id = '${active}'`)).toBeUndefined();
    expect(await count(table, active)).toBe(1);
    expect((await db.query<{ status: string }>('select status from public.companies where id = $1', [active])).rows[0].status).toBe('deleted_test_only');
  });

  it.each(journals)('refuses service-role parent deletion with retained %s', async (table) => {
    await db.query(`insert into public.${table} (company_id) values ($1)`, [disposable]);
    expect(await attempt('service_role', `delete from public.companies where id = '${disposable}'`)).toBe('23001');
    expect(await count('companies', disposable)).toBe(1);
    expect(await count(table, disposable)).toBe(1);
  });

  it.each(journals)('isolates another company\'s %s from empty disposal', async (table) => {
    await db.query(`insert into public.${table} (company_id) values ($1)`, [active]);
    expect(await retained(disposable)).toEqual([]);
    expect(await attempt('service_role', `delete from public.companies where id = '${disposable}'`)).toBeUndefined();
    expect(await count('companies', disposable)).toBe(0);
    expect(await count('companies', active)).toBe(1);
    expect(await count(table, active)).toBe(1);
  });

  it.each(originalCategories)('preserves the original retained %s check', async (table) => {
    await db.query(`insert into public.${table} (company_id) values ($1)`, [active]);
    expect(await retained(active)).toContain(table);
    expect(await attempt('postgres', `update public.companies set status = 'deleted_test_only' where id = '${active}'`)).toBe('23001');
  });

  it('allows genuinely empty disposable marking and deletion', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'deleted_test_only' where id = '${active}'`)).toBeUndefined();
    expect(await attempt('service_role', `delete from public.companies where id = '${active}'`)).toBeUndefined();
    expect(await count('companies', active)).toBe(0);
  });

  it('protects a journal added after the empty disposable status check', async () => {
    expect(await attempt('postgres', `update public.companies set status = 'deleted_test_only' where id = '${active}'`)).toBeUndefined();
    await db.query('insert into public.canonical_audit_events (company_id) values ($1)', [active]);
    expect(await attempt('service_role', `delete from public.companies where id = '${active}'`)).toBe('23001');
    expect(await count('companies', active)).toBe(1);
    expect(await count('canonical_audit_events', active)).toBe(1);
  });

  it('preserves the pending-deletion journal-before-terminal-status boundary', async () => {
    // Model the real canonical caller's ordering, without claiming RPC proof.
    expect(await attempt('postgres', `update public.companies set status = 'pending_deletion' where id = '${active}'`)).toBeUndefined();
    for (const table of ['canonical_audit_events', 'canonical_domain_events', 'canonical_event_outbox', 'canonical_command_results']) {
      await db.query(`insert into public.${table} (company_id) values ($1)`, [active]);
    }
    expect(await attempt('postgres', `update public.companies set status = 'deleted_test_only' where id = '${active}'`)).toBeUndefined();
    expect(await attempt('service_role', `delete from public.companies where id = '${active}'`)).toBe('23001');
    expect(await count('companies', active)).toBe(1);
    for (const table of ['canonical_audit_events', 'canonical_domain_events', 'canonical_event_outbox', 'canonical_command_results']) {
      expect(await count(table, active)).toBe(1);
    }
  });

  it('preserves refusal of non-disposable company deletion', async () => {
    expect(await attempt('service_role', `delete from public.companies where id = '${active}'`)).toBe('23001');
    expect(await count('companies', active)).toBe(1);
  });

  it('preserves the separate raw customer deletion guard', async () => {
    await db.query('insert into public.customers (company_id, is_test_data) values ($1, true)', [active]);
    expect(await attempt('service_role', `delete from public.customers where company_id = '${active}'`)).toBe('23001');
    expect(await count('customers', active)).toBe(1);
  });

  it('preserves the existing database-owner maintenance exception', async () => {
    await db.query('insert into public.canonical_audit_events (company_id) values ($1)', [disposable]);
    expect(await attempt('postgres', `delete from public.companies where id = '${disposable}'`)).toBeUndefined();
    expect(await count('companies', disposable)).toBe(0);
  });
});
