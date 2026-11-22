import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('replays a matching scoped receipt across a Swedish date change before checking new requests', async () => {
  const original = readFileSync('supabase/migrations/20260730153000_customer_portal_api_production_completion.sql', 'utf8')
  const commandDefinition = original.match(/create or replace function public\.gridex_submit_customer_move_out_v1\([\s\S]*?\n\$\$;/)?.[0]
  expect(commandDefinition).toBeTruthy()
  const migration = readFileSync('supabase/migrations/20261122152000_move_out_stockholm_receipt_replay.sql', 'utf8')
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
      create table public.customers (id uuid, company_id uuid, external_customer_id text, customer_number text);
      create table public.customer_sites (id uuid default gen_random_uuid(), company_id uuid, customer_id uuid, facility_reference text);
      create table public.customer_contracts (id uuid);
      create table public.customer_portal_completions (
        company_id uuid, api_client_id uuid, customer_id uuid, completion_type text,
        idempotency_key text, request_hash text, completion_reference text default gen_random_uuid()::text,
        status text, created_at timestamptz default now(), id uuid default gen_random_uuid(),
        site_id uuid, submitted_payload jsonb, result_payload jsonb, linked_case_id uuid, updated_at timestamptz
      );
      create table public.customer_cases (
        id uuid default gen_random_uuid(), company_id uuid, customer_id uuid, site_id uuid, customer_contract_id uuid,
        case_type text, status text, priority text, title text, description text, next_action text, source text, metadata jsonb
      );
      create table public.domain_events (
        id uuid default gen_random_uuid(), company_id uuid, event_type text, aggregate_type text,
        aggregate_id text, subject_customer_id uuid, source text, idempotency_key text, payload jsonb
      );
      create table public.event_outbox (
        company_id uuid, domain_event_id uuid, destination_type text, destination_key text, payload jsonb
      );
      create table public.audit_logs (
        company_id uuid, actor_user_id uuid, entity_type text, entity_id text, action text,
        new_values jsonb, metadata jsonb
      );
      set time zone 'Pacific/Honolulu';
    `)
    await db.exec(commandDefinition!)
    await db.exec(migration)
    await db.exec(readFileSync('supabase/migrations/20261122154500_coalesce_active_move_out_submissions.sql', 'utf8'))
    const company = '00000000-0000-4000-8000-000000000001'
    const customer = '00000000-0000-4000-8000-000000000002'
    const other = '00000000-0000-4000-8000-000000000003'
    const client = '00000000-0000-4000-8000-000000000004'
    await db.query("insert into customers values ($1, $2, 'owner', null), ($3, $2, 'other', null)", [customer, company, other])
    const command = (date: string, key = 'stored-operation') => ({
      company_id: company, customer_id: customer, api_client_id: client,
      requested_move_out_date: date, idempotency_key: key, facility_reference: 'synthetic-site',
    })
    const { rows: [days] } = await db.query<{ yesterday: string; final: string; outside: string }>(`
      select (today - 1)::text as yesterday, (today + 730)::text as final, (today + 731)::text as outside
      from (select (statement_timestamp() at time zone 'Europe/Stockholm')::date as today) as local
    `)
    const stored = command(days.yesterday)
    await db.query(`
      insert into customer_portal_completions (company_id, api_client_id, customer_id, completion_type, idempotency_key, request_hash, completion_reference, status, created_at) values
      ($1, $2, $3, 'move_out', 'stored-operation', md5(($4::jsonb - 'idempotency_key')::text), 'saved-receipt', 'received', now())
    `, [company, client, customer, JSON.stringify(stored)])
    const submit = (body: typeof stored & { reason?: string }) => db.query<{ receipt: Record<string, unknown> }>(
      'select public.gridex_submit_customer_move_out_v1($1::jsonb) as receipt', [JSON.stringify(body)],
    )
    expect((await submit(stored)).rows[0]?.receipt).toMatchObject({ completion_reference: 'saved-receipt', replayed: true })
    await expect(submit({ ...stored, facility_reference: 'changed' })).rejects.toThrow('customer_move_out_idempotency_conflict')
    await expect(submit({ ...stored, customer_id: other })).rejects.toThrow('customer_move_out_date_invalid')
    await expect(submit(command(days.yesterday, 'new-past-operation'))).rejects.toThrow('customer_move_out_date_invalid')
    await expect(submit(command(days.outside, 'new-future-operation'))).rejects.toThrow('customer_move_out_date_invalid')
    // A valid day reaches facility validation. This fixture deliberately has no site.
    await expect(submit(command(days.final, 'new-final-operation'))).rejects.toThrow('customer_move_out_facility_not_found')

    await db.query("insert into customer_sites (company_id, customer_id, facility_reference) values ($1, $2, 'synthetic-site')", [company, customer])
    const first = command(days.final, 'first-active-intent')
    const repeat = command(days.final, 'other-active-intent')
    const results = await Promise.all([submit(first), submit(repeat)])
    const receipts = results.map(result => result.rows[0]?.receipt)
    expect(receipts[0]).toMatchObject({ replayed: false })
    expect(receipts[1]).toMatchObject({ completion_reference: receipts[0]?.completion_reference, replayed: true })
    await expect(submit({ ...repeat, reason: 'changed' })).rejects.toThrow('customer_move_out_active_submission_conflict')
    for (const table of ['customer_cases', 'domain_events', 'event_outbox', 'audit_logs']) {
      expect((await db.query(`select count(*)::int as total from ${table}`)).rows[0]).toEqual({ total: 1 })
    }
  } finally {
    await db.close()
  }
})
