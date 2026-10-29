import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Component SQL/RLS proof only. Deployment/native catalogue qualification is
// performed by the existing database producer, never by this fixture.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), customer = id(2), site = id(3), request = id(4), inbound = id(5), poa = id(6)
const hash = 'a'.repeat(64)
type Row = Record<string, unknown>
const app = (requestId = request, siteId = site, inboundId = inbound): Row => ({ version: 1, applied: true, complete: false,
  sourceHash: hash, inboundId, inbound_id: inboundId, companyId: company, customerId: customer, siteId, requestId,
  terms: { terminationFee: '1250 kr' }, responseStatus: 'termination_fee', missingFields: [] })
const payload = (application = app()): Row => ({ sender_credible: true, sender_verification: { status: 'verified' },
  manual_automation: { sourceHash: hash, application } })
let db: PGlite
async function pending() {
  return (await db.query<{ pending: boolean }>('select public.gridex_manual_mail_has_pending_partial_v1(i) as pending from public.manual_inbound_messages i where id=$1', [inbound])).rows[0]?.pending
}
async function setPayload(value: Row) { await db.query('update public.manual_inbound_messages set extracted_payload=$1 where id=$2', [value, inbound]) }
async function seedChild() {
  const child = app(id(14), id(13))
  await db.query('insert into public.grid_owner_information_requests values($1,$2,$3,$4,$5,$6,$7,$8)',
    [id(14), company, customer, id(13), 'manual_response_received', 'current_supplier_contract_information_request', poa, child])
  const member: Row = { version: 1, status: 'applied', parentRequestId: request, requestId: id(14), companyId: company, customerId: customer,
    siteId: id(13), powerOfAttorneyId: poa, requestType: 'current_supplier_contract_information_request', sourceHash: hash, application: child }
  const value = payload({ ...app(), complete: true })
  ;(value.manual_automation as Row).site_applications = { [id(14)]: member }
  await setPayload(value)
  await db.query("update public.grid_owner_information_requests set status='completed' where id=$1", [request])
  return { value, member, child }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create table public.manual_inbound_messages(id uuid primary key, company_id uuid, customer_id uuid, customer_site_id uuid,
      request_id uuid, resolution_status text, processing_state text, extracted_payload jsonb);
    create table public.grid_owner_information_requests(id uuid primary key, company_id uuid, customer_id uuid, customer_site_id uuid,
      status text, request_type text, poa_id uuid, parsed_payload jsonb);
    grant select on public.manual_inbound_messages,public.grid_owner_information_requests to authenticated,service_role;
    alter table public.manual_inbound_messages enable row level security;
    alter table public.grid_owner_information_requests enable row level security;
    create policy fixture_inbound_tenant on public.manual_inbound_messages for select to authenticated
      using(company_id=nullif(current_setting('fixture.company',true),'')::uuid);
    create policy fixture_request_tenant on public.grid_owner_information_requests for select to authenticated
      using(company_id=nullif(current_setting('fixture.company',true),'')::uuid);`)
  await db.exec(readFileSync('supabase/migrations/20261022110000_manual_mail_pending_partial_review.sql', 'utf8'))
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('reset role; truncate public.manual_inbound_messages,public.grid_owner_information_requests')
  await db.query('insert into public.manual_inbound_messages values($1,$2,$3,$4,$5,$6,$7,$8)', [inbound, company, customer, site, request, 'matched', 'applied', payload()])
  await db.query('insert into public.grid_owner_information_requests values($1,$2,$3,$4,$5,$6,$7,$8)',
    [request, company, customer, site, 'manual_response_received', 'current_supplier_contract_information_request', poa, app()])
})

describe('current unresolved partial applications', () => {
  it('includes a genuine fee-bearing partial even without missing fields', async () => { expect(await pending()).toBe(true) })
  it.each(['completed', 'cancelled', 'closed'])('removes historical partials when the current request is %s', async status => {
    await db.query('update public.grid_owner_information_requests set status=$1', [status]); expect(await pending()).toBe(false)
  })
  it.each(['needs_review', 'failed', 'manual_response_received'])('retains unresolved %s for actual review', async status => {
    await db.query('update public.grid_owner_information_requests set status=$1', [status]); expect(await pending()).toBe(true)
  })
  it('hides an older partial after a newer canonical response without rewriting the old source', async () => {
    await db.query('update public.grid_owner_information_requests set parsed_payload=$1', [{ ...app(), terms: { earliestStartDate: '2027-05-01' } }])
    expect(await pending()).toBe(false)
    expect((await db.query<{ extracted_payload: Row }>('select extracted_payload from public.manual_inbound_messages')).rows[0].extracted_payload).toEqual(payload())
  })
  it('includes an unresolved registered child even after the parent is complete, then removes it on child completion', async () => {
    await seedChild(); expect(await pending()).toBe(true)
    await db.query("update public.grid_owner_information_requests set status='completed'")
    expect(await pending()).toBe(false)
  })
  it.each(['companyId', 'customerId', 'siteId', 'requestId', 'parentRequestId', 'powerOfAttorneyId', 'requestType', 'sourceHash'])('rejects a child with a wrong %s binding', async key => {
    const { value, member } = await seedChild(); member[key] = id(999); await setPayload(value); expect(await pending()).toBe(false)
  })
  it.each(['companyId', 'customerId', 'siteId', 'requestId', 'inboundId', 'inbound_id', 'sourceHash', 'version', 'applied', 'complete'])('rejects a partial with an invalid %s application binding', async key => {
    const application = app(); application[key] = key === 'complete' ? true : 'invalid'; await setPayload(payload(application))
    expect(await pending()).toBe(false)
  })
  it.each([null, [], 'invalid', { 'bad-uuid': { version: 1, status: 'applied', requestId: 'bad-uuid', siteId: 'bad-uuid' } }])('safely handles malformed membership %j', async members => {
    const value = payload({ ...app(), complete: true }); (value.manual_automation as Row).site_applications = members
    await setPayload(value); expect(await pending()).toBe(false)
  })
  it.each(['company_id', 'customer_id', 'customer_site_id', 'id'])('rejects a wrong canonical %s', async key => {
    await db.query(`update public.grid_owner_information_requests set ${key}=$1`, [id(999)]); expect(await pending()).toBe(false)
  })
  it.each(['unmatched', 'ambiguous'])('does not treat %s mail as applied partial proof', async status => {
    await db.query('update public.manual_inbound_messages set resolution_status=$1', [status]); expect(await pending()).toBe(false)
  })
  it('requires the protected verified sender and applied source state', async () => {
    const value = payload(); value.sender_credible = false; await setPayload(value); expect(await pending()).toBe(false)
    await setPayload(payload()); await db.exec("update public.manual_inbound_messages set processing_state='needs_review'")
    expect(await pending()).toBe(false)
  })
})

it('filters before exact count and range even with more than one page of newer resolved mail', async () => {
  await db.exec(`insert into public.manual_inbound_messages
    select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,company_id,customer_id,customer_site_id,request_id,
      resolution_status,processing_state,jsonb_set(extracted_payload,'{manual_automation,application,complete}','true')
    from public.manual_inbound_messages cross join generate_series(100,140) n;
    insert into public.manual_inbound_messages
    select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,company_id,customer_id,customer_site_id,request_id,
      'unmatched','needs_review','{}'::jsonb from public.manual_inbound_messages cross join generate_series(200,225) n where id='${inbound}';`)
  const query = `select id,count(*) over()::int as total from public.manual_inbound_messages i
    where resolution_status in ('unmatched','ambiguous') or public.gridex_manual_mail_has_pending_partial_v1(i) order by id limit 25 offset $1`
  const first = (await db.query<{ id: string; total: number }>(query, [0])).rows
  const second = (await db.query<{ id: string; total: number }>(query, [25])).rows
  expect(first).toHaveLength(25); expect(second).toHaveLength(2)
  expect(first[0]).toEqual({ id: inbound, total: 27 }); expect(second.every(row => row.total === 27)).toBe(true)
})

it('retains invoker RLS even when a caller supplies a fabricated composite row for another tenant', async () => {
  const source = (await db.query<Row>('select * from public.manual_inbound_messages')).rows[0]
  await db.query("select set_config('fixture.company',$1,false)", [id(999)])
  await db.exec('set role authenticated')
  expect((await db.query('select id from public.manual_inbound_messages')).rows).toHaveLength(0)
  const result = await db.query<{ pending: boolean }>('select public.gridex_manual_mail_has_pending_partial_v1(jsonb_populate_record(null::public.manual_inbound_messages,$1)) as pending', [source])
  expect(result.rows[0].pending).toBe(false)
  await db.exec('reset role')
})

it('is a stable invoker computed field with an unnamed argument and no anonymous execution grant', async () => {
  const result = await db.query<{ prosecdef: boolean; provolatile: string; proargnames: string[] | null; anon: boolean; staff: boolean }>(`select prosecdef,provolatile,proargnames,
    has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as staff
    from pg_proc where oid='public.gridex_manual_mail_has_pending_partial_v1(public.manual_inbound_messages)'::regprocedure`)
  expect(result.rows[0]).toEqual({ prosecdef: false, provolatile: 's', proargnames: null, anon: false, staff: true })
})
