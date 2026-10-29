// masterplan: none (simulation finding 20261029-3f1a8ab1/claude-track2/015)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const forward = 'supabase/migrations/20261029213000_contract_termination_notice_first_wins.sql'
const company = '00000000-0000-0000-0000-00000000c001'
const otherCompany = '00000000-0000-0000-0000-00000000c002'
const customer = '00000000-0000-0000-0000-00000000a001'
const contract = '00000000-0000-0000-0000-00000000b001'
const actor = '00000000-0000-0000-0000-00000000d001'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Isolated command execution on synthetic rows. Only the columns the command
  // reads or writes are modelled; production triggers, RLS and PostgREST stay
  // outside this proof.
  await db.exec(`
    create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role;
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
    create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable as $$ select sha256(convert_to(value, 'UTF8')) $$;
    create table public.customer_contracts (
      id uuid primary key, company_id uuid not null, customer_id uuid not null,
      status text not null, starts_at date, actual_start_date date, signed_at timestamptz,
      locked_at timestamptz, signature_snapshot_sha256 text, contract_publication_version_id uuid,
      contract_product_version_id uuid, legal_bundle_version_id uuid, contract_price_snapshot_id uuid,
      ends_at date, ended_at timestamptz, termination_notice_date date, termination_reason text,
      withdrawal_requested_at timestamptz, rejected_reason text, status_reason_code text,
      metadata jsonb default '{}'::jsonb, updated_by uuid, updated_at timestamptz);
    create table public.customer_contract_events (
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      customer_contract_id uuid not null, customer_id uuid not null, event_type text not null,
      happened_at timestamptz not null, note text, metadata jsonb, actor_user_id uuid,
      created_at timestamptz not null default clock_timestamp());
    create table public.domain_events (
      id uuid primary key default gen_random_uuid(), company_id uuid, event_type text,
      aggregate_type text, aggregate_id uuid, actor_user_id uuid, source text,
      idempotency_key text unique, payload jsonb);
    create table public.event_outbox (
      id uuid primary key default gen_random_uuid(), company_id uuid, domain_event_id uuid unique,
      destination_type text, destination_key text, payload jsonb);
  `)
  await db.exec(fs.readFileSync(forward, 'utf8'))
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`)
})

beforeEach(async () => {
  await db.exec('truncate public.customer_contracts, public.customer_contract_events, public.domain_events, public.event_outbox')
  await db.query(`insert into public.customer_contracts(id,company_id,customer_id,status,starts_at,actual_start_date,signed_at)
    values ($1,$2,$3,'active','2026-03-01','2026-03-01','2026-02-10T09:00:00Z')`, [contract, company, customer])
})

afterAll(async () => { await db.close() })

type Notice = { happenedAt: string; derived?: string | null; key: string; metadata?: Record<string, unknown> }
const notice = (input: Notice, companyId = company) => db.query<{ result: Record<string, unknown> }>(
  `select public.gridex_record_customer_contract_event_v1($1,$2,$3,'termination_notice_received',$4::timestamptz,
     null,$5::jsonb,$6,$7::timestamptz,$8) as result`,
  [companyId, contract, customer, input.happenedAt, JSON.stringify(input.metadata ?? {}), actor,
    input.derived ?? null, input.key])
const state = async () => (await db.query(`select termination_notice_date::text as notice,
  ended_at::date::text as ended from public.customer_contracts`)).rows[0]
const eventCount = async () => (await db.query<{ count: number }>(`select count(*)::int as count
  from public.customer_contract_events where event_type='termination_notice_received'`)).rows[0].count

describe('termination notice: first valid receipt wins', () => {
  it('records the first receipt and its derived end', async () => {
    await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    expect(await state()).toEqual({ notice: '2026-09-01', ended: '2027-03-01' })
    expect(await eventCount()).toBe(1)
  })

  it('rejects a later receipt with another date and changes nothing', async () => {
    await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    await expect(notice({ happenedAt: '2026-10-15T00:00:00Z', derived: '2027-04-30T00:00:00Z', key: 'n2' }))
      .rejects.toThrow(/termination_notice_already_recorded/)
    expect(await state()).toEqual({ notice: '2026-09-01', ended: '2027-03-01' })
    expect(await eventCount()).toBe(1)
  })

  it('treats the same date again as idempotent without a duplicate event', async () => {
    const first = await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    const again = await notice({ happenedAt: '2026-09-01T08:30:00Z', derived: '2027-05-31T00:00:00Z', key: 'n1-other-key' })
    expect(again.rows[0].result).toMatchObject({ existing: true })
    expect((again.rows[0].result.event as { id: string }).id)
      .toBe((first.rows[0].result.event as { id: string }).id)
    expect(await state()).toEqual({ notice: '2026-09-01', ended: '2027-03-01' })
    expect(await eventCount()).toBe(1)
  })

  it('records an event once when the date was already stored by a contract write', async () => {
    await db.exec(`update public.customer_contracts set termination_notice_date='2026-09-01'`)
    await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    expect(await state()).toEqual({ notice: '2026-09-01', ended: '2027-03-01' })
    expect(await eventCount()).toBe(1)
  })

  it('applies an explicit override with reason and audits old and new values', async () => {
    await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    await notice({ happenedAt: '2026-08-20T00:00:00Z', derived: '2027-02-28T00:00:00Z', key: 'n2',
      metadata: { override: true, override_reason: 'Fel datum registrerat, brevet stämplades 20 aug' } })
    expect(await state()).toEqual({ notice: '2026-08-20', ended: '2027-02-28' })
    const audit = (await db.query<{ metadata: Record<string, unknown> }>(`select metadata from public.customer_contract_events
      where event_type='termination_notice_received' order by created_at desc limit 1`)).rows[0].metadata
    expect(audit.termination_notice_override).toMatchObject({
      reason: 'Fel datum registrerat, brevet stämplades 20 aug',
      previous_termination_notice_date: '2026-09-01', new_termination_notice_date: '2026-08-20',
      new_ended_at: expect.stringMatching(/^2027-02-28/), previous_ended_at: expect.stringMatching(/^2027-03-01/),
    })
    const domain = (await db.query<{ payload: Record<string, unknown> }>(`select payload from public.domain_events
      where payload->>'termination_notice_override' is not null`)).rows
    expect(domain).toHaveLength(1)
  })

  it.each([{}, { override_reason: '   ' }])('rejects an override without a reason (%j)', async (extra) => {
    await notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })
    await expect(notice({ happenedAt: '2026-08-20T00:00:00Z', derived: '2027-02-28T00:00:00Z', key: 'n2',
      metadata: { override: true, ...extra } })).rejects.toThrow(/termination_notice_override_reason_required/)
    expect(await state()).toEqual({ notice: '2026-09-01', ended: '2027-03-01' })
    expect(await eventCount()).toBe(1)
  })

  it.each([
    ['before the contract start', '2026-02-20T00:00:00Z', `update public.customer_contracts set signed_at='2026-01-01'`],
    ['before signing', '2026-02-05T00:00:00Z', `update public.customer_contracts set actual_start_date=null, starts_at=null`],
    ['before a requested start without delivery', '2026-02-20T00:00:00Z', `update public.customer_contracts set actual_start_date=null, signed_at='2026-01-01'`],
  ])('rejects a receipt %s', async (_label, happenedAt, setup) => {
    await db.exec(setup)
    await expect(notice({ happenedAt, derived: '2027-03-01T00:00:00Z', key: 'early' }))
      .rejects.toThrow(/termination_notice_before_contract_start/)
    await expect(notice({ happenedAt, key: 'early-override',
      metadata: { override: true, override_reason: 'försök' } }))
      .rejects.toThrow(/termination_notice_before_contract_start/)
    expect(await state()).toEqual({ notice: null, ended: null })
    expect(await eventCount()).toBe(0)
  })

  it('keeps tenant isolation and service-role requirement', async () => {
    await expect(notice({ happenedAt: '2026-09-01T00:00:00Z', key: 'x' }, otherCompany))
      .rejects.toThrow(/customer_contract_not_found_for_tenant/)
    await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`)
    try {
      await expect(notice({ happenedAt: '2026-09-01T00:00:00Z', key: 'y' }))
        .rejects.toThrow(/customer_contract_event_service_role_required/)
    } finally {
      await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`)
    }
    expect(await eventCount()).toBe(0)
  })

  describe.each(['terminated', 'cancelled'])('%s event metadata', (eventType) => {
    const close = (key: string, metadata: Record<string, unknown>) => db.query(
      `select public.gridex_record_customer_contract_event_v1($1,$2,$3,$4,'2027-03-01T00:00:00Z',null,$5::jsonb,$6,null,$7)`,
      [company, contract, customer, eventType, JSON.stringify(metadata), actor, key])
    const recorded = async () => notice({ happenedAt: '2026-09-01T00:00:00Z', derived: '2027-03-01T00:00:00Z', key: 'n1' })

    it('cannot replace a recorded notice date without override', async () => {
      await recorded()
      await expect(close('c1', { termination_notice_date: '2026-10-15' }))
        .rejects.toThrow(/termination_notice_already_recorded/)
      expect((await state() as { notice: string }).notice).toBe('2026-09-01')
      await close('c2', { termination_notice_date: '2026-09-01' })
      expect((await state() as { notice: string }).notice).toBe('2026-09-01')
    })

    it('rejects an override without reason and audits an override with reason', async () => {
      await recorded()
      await expect(close('c1', { termination_notice_date: '2026-10-15', override: true }))
        .rejects.toThrow(/termination_notice_override_reason_required/)
      expect((await state() as { notice: string }).notice).toBe('2026-09-01')
      await close('c2', { termination_notice_date: '2026-10-15', override: true, override_reason: 'Rättat datum' })
      expect((await state() as { notice: string }).notice).toBe('2026-10-15')
      const audit = (await db.query<{ metadata: Record<string, unknown> }>(`select metadata from public.customer_contract_events
        where event_type=$1`, [eventType])).rows[0].metadata
      expect(audit.termination_notice_override).toMatchObject({ reason: 'Rättat datum',
        previous_termination_notice_date: '2026-09-01', new_termination_notice_date: '2026-10-15' })
    })
  })
})
