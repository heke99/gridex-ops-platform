// Calls the actual forward SQL commands. Removing a tenant, state, evidence,
// date or idempotency guard must permit a forbidden business write and fail here.
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SQL_PATH = 'supabase/migrations/20261018183448_manual_mail_automatic_application.sql'
const CO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const INBOUND = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SWITCH = '11111111-1111-4111-8111-111111111111'
const CIR = '55555555-5555-4555-8555-555555555555'
const SUPPLIER = '22222222-2222-4222-8222-222222222222'
const ACTOR = '33333333-3333-4333-8333-333333333333'
const CONTACT = '44444444-4444-4444-8444-444444444444'
const POA = '66666666-6666-4666-8666-666666666666'
const DOCUMENT = '77777777-7777-4777-8777-777777777777'
const HASH = 'a'.repeat(64)
let db: PGlite

type Reply = { ok: boolean; applied?: boolean; alreadyApplied?: boolean; complete?: boolean; code?: string; effectiveStartDate?: string }
type TestPayload = { terms: Record<string, unknown>; evidence: Record<string, unknown>; sourceHash: string; extracted: Record<string, unknown>; nextFollowUpAt?: string; facts?: Record<string, unknown> }
const payload = (terms: Record<string, unknown> = { contractEndDate: '2027-03-31', earliestStartDate: '2027-04-01', noticePeriod: '1 månad', terminationFee: '0 kr', effectiveStartDate: '2027-04-01' }): TestPayload => ({
  terms,
  evidence: Object.fromEntries(Object.keys(terms).filter(key => key !== 'effectiveStartDate').map(key => [key, 'Motpartens uttryckliga besked i detta svar.'])),
  sourceHash: HASH,
  extracted: { current_contract_end_date: '2027-03-31' },
})

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.companies(id uuid primary key,is_active boolean,lifecycle_status text,closed_at timestamptz,status text);
    create table public.customers(id uuid primary key,company_id uuid,status text,archived_at timestamptz,anonymized_at timestamptz,merged_into_customer_id uuid,lifecycle_closed_at timestamptz,metadata jsonb,protected_identity boolean,personal_number text,org_number text);
    create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,is_active boolean,status text,archived_at timestamptz,closed_at timestamptz,protected_identity boolean,metadata jsonb,updated_at timestamptz,current_supplier_contract_end_date date,current_supplier_notice_period text,current_supplier_termination_fee numeric,current_supplier_response_status text,current_supplier_contract_status text,facility_id text,grid_area_code text,price_area_code text,grid_owner_id uuid,current_supplier_id uuid,current_supplier_name text,current_supplier_unknown boolean default true,annual_consumption_kwh numeric,resolution_status text,resolution_id uuid);
    create table public.grid_owner_information_requests(id uuid primary key,company_id uuid,customer_id uuid,customer_site_id uuid,request_type text constraint grid_owner_information_requests_request_type_check check(request_type in ('facility_identifier_lookup','facility_lookup','metering_point_lookup','grid_area_confirmation','grid_contract_information','manual_custom_donor')),status text,metadata jsonb,parsed_payload jsonb,received_payload jsonb,received_at timestamptz,completed_at timestamptz,next_follow_up_at timestamptz,last_error_code text,last_error_message text,updated_at timestamptz,dispatch_status text,grid_owner_id uuid,recipient_email text,poa_id uuid);
    create table public.manual_inbound_messages(id uuid primary key,company_id uuid,request_id uuid,customer_id uuid,customer_site_id uuid,resolution_status text,extracted_payload jsonb,received_at timestamptz,processing_state text);
    create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,status text,requested_start_date date,metadata jsonb,submitted_at timestamptz,completed_at timestamptz,paused_at timestamptz,lifecycle_blocked boolean,outbound_z03_message_id uuid,updated_at timestamptz,request_type text);
    create table public.powers_of_attorney(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,document_id uuid,status text,revoked_at timestamptz,valid_from date,valid_to date,valid_until date,expires_at timestamptz,signed_at timestamptz,accepted_at timestamptz,legal_text_version_id uuid,evidence_payload jsonb,fullmakt_snapshot jsonb,signed_scope_snapshot jsonb,scope_summary jsonb,scope text,contract_id uuid,customer_contract_id uuid,metering_point_id uuid);
    create table public.customer_authorization_documents(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,power_of_attorney_id uuid,status text,document_type text,customer_contract_id uuid,metering_point_id uuid);
    create table public.authorization_scopes(id uuid primary key,company_id uuid,customer_id uuid,authorization_document_id uuid,status text,revoked_at timestamptz,valid_from date,valid_to date,covers_current_supplier_contract boolean);
    create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid);
    create table public.customer_site_resolution(id uuid primary key,company_id uuid,customer_id uuid,customer_site_id uuid,grid_owner_id uuid,resolution_status text,automation_allowed boolean,source_claims jsonb);
    create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,reading_frequency text,metadata jsonb,updated_at timestamptz,metering_point_id text,meter_point_id text,ediel_reference text);
    create table public.customer_info_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,target_party_type text,request_type text,status text,verified_payload jsonb,received_at timestamptz,updated_at timestamptz,blocker_code text,blocker_reason text,blocker_details jsonb,next_required_action text,authorization_document_id uuid,metering_point_id uuid);
    create table public.electricity_suppliers(id uuid primary key,company_id uuid,platform_market_actor_id uuid,name text,is_active boolean,verified_for_customer_flow boolean,verification_status text,technical_owner_only boolean);
    create table public.platform_market_actors(id uuid primary key,status text,verified_at timestamptz,match_status text);
    create table public.platform_actor_roles(actor_id uuid,actor_role text,is_active boolean);
    create table public.platform_actor_contacts(id uuid primary key,actor_id uuid,email text,is_verified boolean,verified_at timestamptz,channel text,contact_type text,valid_from date,valid_to date);
    create table public.grid_owners(id uuid primary key,verified_for_customer_flow boolean,technical_owner_only boolean,verification_status text);
    create table public.manual_email_outbox(id uuid primary key,company_id uuid,request_id uuid,status text,external_delivery boolean,to_email text);
    create table public.customer_operation_events(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,customer_site_id uuid,event_code text,title text,message text,status text,severity text,action_required boolean,source text,payload jsonb,idempotency_key text,occurred_at timestamptz default now());
    create unique index event_idempotency on public.customer_operation_events(company_id,idempotency_key) where idempotency_key is not null;
    -- Canonical facility command is an independently tested existing dependency;
    -- this fixture isolates the new wrapper's authority and transaction boundary.
    create function public.gridex_complete_facility_response(p_company_id uuid,p_request_id uuid,p_actor_user_id uuid default null,p_source text default 'system',p_ediel_message_id uuid default null,p_facility_id text default null,p_metering_point_external_id text default null,p_grid_area_code text default null,p_price_area_code text default null,p_source_party_grid_owner_id uuid default null,p_raw_payload jsonb default '{}',p_note text default null) returns jsonb language plpgsql as $$
      begin
        update public.customer_sites set facility_id=p_facility_id where id=(select customer_site_id from public.grid_owner_information_requests where company_id=p_company_id and id=p_request_id);
        update public.grid_owner_information_requests set status='completed' where company_id=p_company_id and id=p_request_id;
        return jsonb_build_object('ok',true,'resolutionId','canonical-resolution','facilityId',p_facility_id,'source',p_source,'meteringPointRecordId','${OTHER}');
      end $$;
    grant all on all tables in schema public to service_role;
  `)
  await db.exec(fs.readFileSync(SQL_PATH, 'utf8'))
})

afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`
    truncate public.companies,public.customers,public.customer_sites,public.grid_owner_information_requests,public.manual_inbound_messages,public.supplier_switch_requests,public.customer_info_requests,public.electricity_suppliers,public.platform_market_actors,public.platform_actor_contacts,public.grid_owners,public.manual_email_outbox,public.platform_actor_roles,public.customer_operation_events,public.metering_points,public.powers_of_attorney,public.customer_authorization_documents,public.authorization_scopes,public.customer_contracts,public.customer_site_resolution;
    insert into public.companies values ('${CO}',true,'active',null,'active'),('${OTHER}',true,'active',null,'active');
    insert into public.customers values ('${CUSTOMER}','${CO}','active',null,null,null,null,'{}',false,'199001010015',null);
    insert into public.customer_sites(id,company_id,customer_id,is_active,status,protected_identity,metadata,grid_owner_id) values ('${SITE}','${CO}','${CUSTOMER}',true,'active',false,'{}','${OTHER}');
    insert into public.grid_owner_information_requests(id,company_id,customer_id,customer_site_id,request_type,status,metadata,parsed_payload,received_payload,next_follow_up_at,grid_owner_id) values ('${REQUEST}','${CO}','${CUSTOMER}','${SITE}','current_supplier_contract_information_request','waiting_manual_response','{}','{}','{}','2027-01-01','${OTHER}');
    insert into public.manual_inbound_messages values ('${INBOUND}','${CO}','${REQUEST}','${CUSTOMER}','${SITE}','matched','{"sender_credible":true,"sender_verification":{"status":"verified"},"manual_automation":{"sourceHash":"${HASH}"}}','2026-10-18 12:00:00+00','parsed');
    update public.customer_sites set current_supplier_id='${SUPPLIER}',grid_area_code='LKR',resolution_status='grid_area_master_validated';
    update public.grid_owner_information_requests set grid_owner_id=null,poa_id='${POA}',recipient_email='avtal@supplier.example',metadata='{"target_party":"current_supplier","authorization_document_id":"${DOCUMENT}","customer_info_request_id":"${CIR}","supplier_id":"${SUPPLIER}","supplier_actor_id":"${ACTOR}","supplier_contact_id":"${CONTACT}"}';
    insert into public.customer_info_requests values ('${CIR}','${CO}','${CUSTOMER}','${SITE}','current_supplier','contract_information','waiting_response','{"manual_supplier_request_id":"${REQUEST}","supplier_id":"${SUPPLIER}","supplier_actor_id":"${ACTOR}","supplier_contact_id":"${CONTACT}"}',null,null,null,null,'{}',null,'${DOCUMENT}',null);
    insert into public.powers_of_attorney values ('${POA}','${CO}','${CUSTOMER}','${SITE}','${SITE}','${DOCUMENT}','signed',null,current_date-1,current_date+365,null,null,now(),null,null,'{}','{}','["supplier_switch","facility_information_lookup"]','{}','supplier_switch',null,null,null);
    insert into public.customer_authorization_documents values ('${DOCUMENT}','${CO}','${CUSTOMER}','${SITE}','${POA}','active','power_of_attorney',null,null);
    insert into public.authorization_scopes values ('${OTHER}','${CO}','${CUSTOMER}','${DOCUMENT}','active',null,current_date-1,current_date+365,true);
    insert into public.electricity_suppliers values ('${SUPPLIER}',null,'${ACTOR}','Elbolaget',true,true,'verified',false);
    insert into public.platform_market_actors values ('${ACTOR}','active',now(),'verified');
    insert into public.platform_actor_roles values ('${ACTOR}','electricity_supplier',true);
    insert into public.platform_actor_contacts values ('${CONTACT}','${ACTOR}','avtal@supplier.example',true,now(),'email','poa',null,null);
    insert into public.metering_points values ('${OTHER}','${CO}','${CUSTOMER}','${SITE}','${SITE}','hourly','{}',null,'735999123456789001','735999123456789001','735999123456789001');
    insert into public.grid_owners values ('${OTHER}',true,false,'verified');
    insert into public.supplier_switch_requests values ('${SWITCH}','${CO}','${CUSTOMER}','${SITE}','${SITE}','draft','2027-03-01','{}',null,null,null,false,null,null,'switch');
  `)
})

async function apply(p: ReturnType<typeof payload> & { nextFollowUpAt?: string; facts?: Record<string, unknown> } = payload(), companyId = CO, facility = false, inboundId = INBOUND): Promise<Reply> {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role')
    const r = await tx.query<{ result: Reply }>(`select public.${facility ? 'gridex_apply_manual_facility_reply_v1' : 'gridex_apply_manual_commercial_reply_v1'}($1,$2,$3,$4::jsonb) result`, [companyId, REQUEST, inboundId, JSON.stringify(p)])
    return r.rows[0].result
  })
}
async function row(table: string) { return (await db.query<Record<string, unknown>>(`select * from public.${table} order by id`)).rows[0] }
async function snapshot() { return (await db.query(`select jsonb_build_object('sites',(select jsonb_agg(to_jsonb(t)) from public.customer_sites t),'requests',(select jsonb_agg(to_jsonb(t)) from public.grid_owner_information_requests t),'switches',(select jsonb_agg(to_jsonb(t)) from public.supplier_switch_requests t),'events',(select jsonb_agg(to_jsonb(t)) from public.customer_operation_events t),'cir',(select jsonb_agg(to_jsonb(t)) from public.customer_info_requests t),'inbound',(select jsonb_agg(to_jsonb(t)) from public.manual_inbound_messages t)) as value`)).rows }
async function unchangedReject(mutate: string, p: ReturnType<typeof payload> & { facts?: Record<string, unknown> } = payload(), companyId = CO, facility = false) {
  if (mutate) await db.exec(mutate)
  const before = await snapshot()
  const result = await apply(p, companyId, facility)
  expect(result.ok).toBe(false)
  expect(await snapshot()).toEqual(before)
  return result
}

describe('commercial mail transaction', () => {
  it('stores verified commercial facts and completes an explicit unconditional zero-fee start', async () => {
    expect(await apply()).toMatchObject({ ok: true, applied: true, complete: true, effectiveStartDate: '2027-04-01' })
    const site = await row('customer_sites')
    expect((site.current_supplier_contract_end_date as Date).toISOString().slice(0, 10)).toBe('2027-03-31')
    expect(site.current_supplier_notice_period).toBe('1 månad')
    expect(site.current_supplier_termination_fee).toBe('0')
    expect(site.current_supplier_response_status).toBe('free_to_switch')
    expect((site.metadata as { manual_supplier_terms: { inboundId: string; sourceHash: string } }).manual_supplier_terms).toMatchObject({ inboundId: INBOUND, sourceHash: HASH })
    expect(await row('grid_owner_information_requests')).toMatchObject({ status: 'completed', next_follow_up_at: null })
    expect(await row('manual_inbound_messages')).toMatchObject({ processing_state: 'applied' })
  })
  it('stores partial facts without claiming that a binding end alone releases a switch', async () => {
    const result = await apply(payload({ contractEndDate: '2027-03-31', effectiveStartDate: '2027-04-01' }))
    expect(result).toMatchObject({ ok: true, applied: true, complete: false })
    expect(await row('customer_sites')).toMatchObject({ current_supplier_response_status: 'waiting_response' })
    expect(await row('grid_owner_information_requests')).toMatchObject({ status: 'manual_response_received', completed_at: null, next_follow_up_at: null, parsed_payload: { complete: false, missingFields: ['earliest_supplier_start_date', 'termination_fee'] } })
  })
  it('does not claim a complete free-to-switch response when the fee was omitted', async () => {
    expect(await apply(payload({ earliestStartDate: '2027-04-01' }))).toMatchObject({ ok: true, complete: false })
    expect((await row('customer_sites')).current_supplier_response_status).toBe('waiting_response')
  })
  it('keeps an unrelated current customer-info blocker intact by refusing application', async () => {
    await unchangedReject("update public.customer_info_requests set blocker_code='permission_required'")
  })
  it('accepts a bounded server-calculated follow-up date only for a partial reply', async () => {
    const due = new Date(Date.now() + 5 * 86400000).toISOString()
    await apply({ ...payload({ contractEndDate: '2027-03-31' }), nextFollowUpAt: due })
    expect(((await row('grid_owner_information_requests')).next_follow_up_at as Date).toISOString()).toBe(due)
  })
  it('rejects an invalid follow-up date before any business update', async () => {
    const before = await snapshot()
    expect((await apply({ ...payload(), nextFollowUpAt: 'not-a-date' })).ok).toBe(false)
    expect(await snapshot()).toEqual(before)
  })
  it('records a positive termination fee without releasing a switch', async () => {
    expect(await apply(payload({ terminationFee: '1500 kr' }))).toMatchObject({ ok: true, complete: false })
    expect(await row('customer_sites')).toMatchObject({ current_supplier_response_status: 'termination_fee', current_supplier_termination_fee: '1500' })
  })
  it('keeps omitted established facts intact', async () => {
    await db.exec(`update public.customer_sites set current_supplier_notice_period='2 månader'`)
    expect((await apply(payload({ contractEndDate: '2027-03-31' }))).ok).toBe(true)
    expect((await row('customer_sites')).current_supplier_notice_period).toBe('2 månader')
  })
  it('is idempotent for the same source after completion and does not touch timestamps', async () => {
    await apply()
    const before = await snapshot()
    expect(await apply()).toMatchObject({ ok: true, alreadyApplied: true })
    expect(await snapshot()).toEqual(before)
  })
  it.each([
    ['request tenant', `update public.grid_owner_information_requests set company_id='${OTHER}'`],
    ['inbound tenant', `update public.manual_inbound_messages set company_id='${OTHER}'`],
    ['inbound customer', `update public.manual_inbound_messages set customer_id='${OTHER}'`],
    ['inbound site', `update public.manual_inbound_messages set customer_site_id='${OTHER}'`],
    ['site customer', `update public.customer_sites set customer_id='${OTHER}'`],
    ['customer tenant', `update public.customers set company_id='${OTHER}'`],
    ['tenant inactive', 'update public.companies set is_active=false'],
    ['tenant paused', "update public.companies set status='paused'"],
    ['customer suspended', "update public.customers set status='suspended'"],
    ['customer archived', "update public.customers set archived_at=now()"],
    ['site inactive', 'update public.customer_sites set is_active=false'],
    ['site protected', 'update public.customer_sites set protected_identity=true'],
    ['customer protected', 'update public.customers set protected_identity=true'],
    ['ambiguous source', "update public.manual_inbound_messages set resolution_status='ambiguous'"],
    ['unverified sender', `update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"unverified"')`],
    ['not credible', `update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_credible}','false')`],
    ['current hold', `update public.grid_owner_information_requests set metadata='{"counterparty_reply":{"requires_review":true}}'`],
    ['cancelled request', "update public.grid_owner_information_requests set status='cancelled'"],
    ['wrong request type', "update public.grid_owner_information_requests set request_type='facility_identifier_lookup'"],
  ])('rejects %s without any business write', async (_name, mutate) => { await unchangedReject(mutate) })
  it('rejects a stale older reply without overwriting a newer source', async () => {
    await unchangedReject(`update public.grid_owner_information_requests set received_at='2026-10-19',metadata='{"manual_supplier_terms":{"inboundId":"${OTHER}","receivedAt":"2026-10-19T00:00:00Z"}}'`)
  })
  it('rejects a conflicting established manually entered fact', async () => {
    await unchangedReject("update public.customer_sites set current_supplier_contract_end_date='2027-04-30'")
  })
  it.each([
    { earliestStartDate: '2027-02-30' },
    { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-03-31' },
    { earliestStartDate: '2027-03-31', contractEndDate: '2027-03-31' },
    { contractEndDate: '2027-03-31', cancellationDeadline: '2027-04-01' },
    { earliestStartDate: 20270401 },
    { terminationFee: '-1 kr' },
    { noticePeriod: 'när ni vill' },
  ])('rejects invalid or contradictory terms %j atomically', async terms => { await unchangedReject('', payload(terms)) })
  it('rejects a source hash that no longer matches stored source evidence', async () => {
    await unchangedReject('', { ...payload(), sourceHash: 'b'.repeat(64) })
  })
  it('rolls back request, switch and source writes when the site update fails', async () => {
    await db.exec(`create function public.fail_mail_site_update() returns trigger language plpgsql as $$ begin raise exception 'forced_site_failure'; end $$; create trigger fail_mail_site before update on public.customer_sites for each row execute function public.fail_mail_site_update()`)
    try { await unchangedReject('') } finally { await db.exec('drop trigger fail_mail_site on public.customer_sites; drop function public.fail_mail_site_update()') }
  })
  it('raises only unsent exact-identity switch dates and keeps later planned dates', async () => {
    await apply()
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-04-01')
    await db.exec(`update public.supplier_switch_requests set requested_start_date='2027-05-01'`)
    await apply()
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-05-01')
  })
  it.each([
    "status='sent'", "status='submitted'", "status='in_flight'", "status='completed'", "status='cancelled'", "status='paused'", "lifecycle_blocked=true", "submitted_at=now()", "outbound_z03_message_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'", "customer_site_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'",
  ])('does not update a sent, blocked or differently scoped switch (%s)', async clause => {
    await db.exec(`update public.supplier_switch_requests set ${clause}`)
    const before = await row('supplier_switch_requests')
    await apply()
    expect(await row('supplier_switch_requests')).toEqual(before)
  })

  it.each(['move_in', 'move_out_takeover'])('leaves an existing move request unchanged when commercial facts arrive (%s)', async type => {
    await db.exec(`update public.supplier_switch_requests set request_type='${type}',requested_start_date='2027-03-01'`)
    await apply()
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-03-01')
  })
  it('keeps a later initial planned date when applying new terms', async () => {
    await db.exec("update public.supplier_switch_requests set requested_start_date='2027-05-01'")
    await apply()
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-05-01')
  })
  it('blocks applying a date floor to an already bound outbound original', async () => {
    await unchangedReject(`update public.supplier_switch_requests set outbound_z03_message_id='${OTHER}'`)
  })
  it.each(['anon', 'authenticated'])('denies direct execution to %s', async role => {
    await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select public.gridex_apply_manual_commercial_reply_v1($1,$2,$3,$4::jsonb)', [CO, REQUEST, INBOUND, JSON.stringify(payload())]) })).rejects.toThrow(/permission denied/)
  })
})

describe('facility mail authority wrapper', () => {
  const facilityPayload = () => ({ ...payload(), facility_id: '735999123456789012', metering_point_id: '735999123456789012', grid_area_code: 'LKR', price_area_code: 'SE4', raw_payload: { source: 'reply' } })
  beforeEach(async () => { await db.exec("update public.grid_owner_information_requests set request_type='facility_identifier_lookup',grid_owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'") })
  it('applies validated facility facts and known meter cadence in the same transaction', async () => {
    const facts = { annualConsumptionKwh: 12500, currentSupplierName: 'Elbolaget', meteringMethod: 'fjärravläst', reportingFrequency: 'månad', readingFrequency: 'monthly' }
    expect(await apply({ ...facilityPayload(), facts }, CO, true)).toMatchObject({ ok: true, appliedFacts: { annualConsumptionKwh: 12500, currentSupplierName: 'Elbolaget', readingFrequency: 'monthly' } })
    expect(await row('customer_sites')).toMatchObject({ annual_consumption_kwh: '12500', current_supplier_name: 'Elbolaget', current_supplier_id: SUPPLIER, current_supplier_unknown: false })
    expect(await row('metering_points')).toMatchObject({ reading_frequency: 'monthly', metadata: { manual_facility_facts: { inboundId: INBOUND, facts: { meteringMethod: 'fjärravläst' } } } })
  })
  it('preserves quarter-hour raw reporting without assigning an unsupported reading enum', async () => {
    await apply({ ...facilityPayload(), facts: { reportingFrequency: 'kvart' } }, CO, true)
    expect((await row('metering_points')).reading_frequency).toBe('hourly')
    expect((await row('customer_sites')).metadata).toMatchObject({ manual_facility_facts: { facts: { reportingFrequency: 'kvart' } } })
  })
  it('refuses a conflicting established supplier instead of replacing the customer identity', async () => {
    await unchangedReject('', { ...facilityPayload(), facts: { currentSupplierName: 'Annan Leverantör' } }, CO, true)
  })
  it.each([{ annualConsumptionKwh: -1 }, { annualConsumptionKwh: '1000' }, { annualConsumptionKwh: 10000000000 }, { readingFrequency: 'quarter_hourly' }])('rejects invalid facility facts %j atomically', async facts => {
    await unchangedReject('', { ...facilityPayload(), facts }, CO, true)
  })
  it('returns the full canonical completion unchanged on same-source replay', async () => {
    const first = await apply(facilityPayload(), CO, true)
    const before = await snapshot()
    expect(await apply(facilityPayload(), CO, true)).toMatchObject({ ...first, alreadyApplied: true })
    expect(await snapshot()).toEqual(before)
  })
  it('preserves canonical completion output after source validation', async () => {
    expect(await apply(facilityPayload(), CO, true)).toMatchObject({ ok: true, resolutionId: 'canonical-resolution', facilityId: '735999123456789012' })
    expect((await row('customer_sites')).facility_id).toBe('735999123456789012')
  })
  it.each([
    `update public.manual_inbound_messages set company_id='${OTHER}'`,
    `update public.grid_owner_information_requests set metadata='{"counterparty_reply":{"requires_review":true}}'`,
    'update public.customer_sites set protected_identity=true',
    `update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"unverified"')`,
  ])('refuses a stale or unauthorized facility source atomically (%s)', async mutation => { await unchangedReject(mutation, facilityPayload(), CO, true) })
})


describe('verified supplier floor at future switch creation', () => {
  async function floor() {
    return db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{ value: Date | null }>('select public.gridex_manual_supplier_start_floor_v1($1,$2,$3) as value', [CO, CUSTOMER, SITE])).rows[0].value?.toISOString().slice(0, 10) ?? null
    })
  }
  it('returns the applied exact-identity source floor', async () => {
    await apply()
    expect(await floor()).toBe('2027-04-01')
  })
  it('never treats tenant-editable metadata without an applied source as proof', async () => {
    await db.exec(`update public.customer_sites set metadata='{"manual_supplier_terms":{"version":1,"companyId":"${CO}","customerId":"${CUSTOMER}","siteId":"${SITE}","requestId":"${REQUEST}","inboundId":"${INBOUND}","sourceHash":"${HASH}","terms":{"effectiveStartDate":"2027-04-01"}}}'`)
    expect(await floor()).toBeNull()
  })
  it.each([
    "update public.manual_inbound_messages set processing_state='needs_review'",
    `update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"unverified"')`,
    `update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation,sourceHash}','"${'b'.repeat(64)}"')`,
    `update public.grid_owner_information_requests set parsed_payload=jsonb_set(parsed_payload,'{applied}','false')`,
  ])('requires the retained atomic application proof (%s)', async mutate => {
    await apply()
    await db.exec(mutate)
    expect(await floor()).toBeNull()
  })
  it('raises a newly inserted stale normal switch to the verified floor', async () => {
    await apply()
    await db.exec(`delete from public.supplier_switch_requests; insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,status,requested_start_date,lifecycle_blocked,metadata,request_type) values ('${SWITCH}','${CO}','${CUSTOMER}','${SITE}','${SITE}','draft','2027-03-01',false,'{}','switch')`)
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-04-01')
  })
  it('stops a later stale date edit from shortening the verified floor', async () => {
    await apply()
    await db.exec("update public.supplier_switch_requests set requested_start_date='2027-03-01'")
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-04-01')
  })
  it.each(['move_in', 'move_out_takeover'])('leaves unrelated move dates unchanged (%s)', async type => {
    await apply()
    await db.exec(`update public.supplier_switch_requests set request_type='${type}',requested_start_date='2027-03-01'`)
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-03-01')
  })
})


describe('supplier request identity and commercial process projection', () => {
  it('updates the linked exact tenant customer-info request atomically', async () => {
    await apply()
    expect(await row('customer_info_requests')).toMatchObject({ status: 'ready_for_switch', blocker_code: null })
    expect((await row('customer_info_requests')).verified_payload).toMatchObject({ manual_supplier_terms: { inboundId: INBOUND, sourceHash: HASH } })
    expect(await row('customer_operation_events')).toMatchObject({ company_id: CO, customer_id: CUSTOMER, customer_site_id: SITE, event_code: 'manual_supplier_terms_applied', idempotency_key: `manual-supplier-terms:${INBOUND}` })
  })
  it.each([
    `update public.customer_info_requests set company_id='${OTHER}'`,
    `update public.customer_info_requests set customer_id='${OTHER}'`,
    `update public.customer_info_requests set site_id='${OTHER}'`,
    "update public.customer_info_requests set target_party_type='grid_owner'",
    "update public.customer_info_requests set status='cancelled'",
    `update public.customer_sites set current_supplier_id='${OTHER}'`,
  ])('rejects stale or differently scoped commercial CIR without any write (%s)', async mutate => { await unchangedReject(mutate) })
})

describe('purpose-bound outbound email guard', () => {
  async function enqueue() {
    return db.exec(`insert into public.manual_email_outbox values ('${SWITCH}','${CO}','${REQUEST}','queued',true,'avtal@supplier.example')`)
  }
  it('accepts the exact current supplier verified commercial contact without a false grid owner', async () => {
    await enqueue()
    expect(await row('manual_email_outbox')).toMatchObject({ status: 'queued' })
  })
  it.each([
    "update public.platform_actor_contacts set is_verified=false",
    "update public.platform_actor_contacts set valid_to='2000-01-01'",
    "update public.platform_actor_contacts set contact_type='technical'",
    "update public.electricity_suppliers set is_active=false",
    "update public.platform_market_actors set match_status='unverified'",
    "update public.platform_market_actors set status='inactive'",
    "update public.platform_actor_roles set is_active=false", 
    `update public.electricity_suppliers set company_id='${OTHER}'`,
    `update public.customer_sites set current_supplier_id='${OTHER}'`,
    `update public.customer_info_requests set company_id='${OTHER}'`,
    "update public.grid_owner_information_requests set recipient_email='attacker@example.net'",
    `update public.grid_owner_information_requests set grid_owner_id='${OTHER}'`,
  ])('refuses an unverified or mismatched supplier queue (%s)', async mutate => {
    await db.exec(mutate)
    await expect(enqueue()).rejects.toThrow(/manual_supplier_outbox_requires_verified_current_supplier/)
    expect((await db.query('select * from public.manual_email_outbox')).rows).toEqual([])
  })
  it('blocks contact priority ambiguity instead of selecting either address', async () => {
    await db.exec(`insert into public.platform_actor_contacts values ('${OTHER}','${ACTOR}','second@supplier.example',true,now(),'email','poa',null,null)`)
    await expect(enqueue()).rejects.toThrow(/manual_supplier_outbox_requires_verified_current_supplier/)
  })
  it('retains an unrelated request type admitted by the preexisting CHECK', async () => {
    await db.exec(`insert into public.grid_owner_information_requests(id,company_id,request_type,status) values ('${OTHER}','${CO}','manual_custom_donor','draft')`)
    expect((await db.query("select request_type from public.grid_owner_information_requests where request_type='manual_custom_donor'")).rows).toHaveLength(1)
  })
  it('prevents a duplicate open commercial GOIR for the same tenant CIR', async () => {
    await expect(db.exec(`insert into public.grid_owner_information_requests(id,company_id,customer_id,customer_site_id,request_type,status,metadata) select '${SWITCH}',company_id,customer_id,customer_site_id,request_type,status,metadata from public.grid_owner_information_requests`)).rejects.toThrow(/unique|duplicate key/)
  })
  it('rejects an outbox row claiming another tenant for an existing request', async () => {
    await expect(db.exec(`insert into public.manual_email_outbox values ('${SWITCH}','${OTHER}','${REQUEST}','queued',true,'avtal@supplier.example')`)).rejects.toThrow(/manual_outbox_request_ownership/)
  })
  it('rechecks current supplier POA revocation before admitting a queued provider attempt', async () => {
    await enqueue()
    await db.exec('update public.powers_of_attorney set revoked_at=now()')
    await expect(db.exec("update public.manual_email_outbox set status='sending'")).rejects.toThrow(/manual_supplier_outbox_requires_verified_current_supplier/)
  })
  it('rechecks a changed recipient and revoked contact when the worker starts sending', async () => {
    await enqueue()
    await expect(db.exec("update public.manual_email_outbox set to_email='attacker@example.net'")).rejects.toThrow(/manual_supplier_outbox_requires_verified_current_supplier/)
    await db.exec('update public.platform_actor_contacts set is_verified=false')
    await expect(db.exec("update public.manual_email_outbox set status='sending'")).rejects.toThrow(/manual_supplier_outbox_requires_verified_current_supplier/)
  })
  it('retains the canonical geography authority for facility requests', async () => {
    await db.exec(`update public.grid_owner_information_requests set request_type='facility_identifier_lookup',grid_owner_id='${OTHER}'; update public.grid_owners set verified_for_customer_flow=false`)
    await enqueue()
    expect((await row('manual_email_outbox')).status).toBe('queued')
  })
  it('preserves the existing network-owner gate', async () => {
    await db.exec(`update public.grid_owner_information_requests set request_type='grid_contract_information',grid_owner_id='${OTHER}'`)
    await enqueue()
    await db.exec('update public.grid_owners set verified_for_customer_flow=false')
    await expect(db.exec("update public.manual_email_outbox set status='sending'")).rejects.toThrow(/manual_grid_owner_outbox_requires_verified_site_owner/)
  })
})


describe('complete supplier terms snapshot proof', () => {
  async function verified(snapshotOverride?: unknown) {
    const s = await row('customer_sites')
    const snapshot = snapshotOverride ?? (s.metadata as { manual_supplier_terms: unknown }).manual_supplier_terms
    return db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{ value: boolean }>('select public.gridex_manual_supplier_terms_verified_v1($1,$2,$3,$4::jsonb) value', [CO, CUSTOMER, SITE, JSON.stringify(snapshot)])).rows[0].value
    })
  }
  it('proves the entire stored complete snapshot rather than just its date', async () => {
    await apply()
    expect(await verified()).toBe(true)
  })
  it.each([
    "update public.grid_owner_information_requests set status='needs_review'",
    `update public.grid_owner_information_requests set metadata=jsonb_set(metadata,'{counterparty_reply}','{"requires_review":true}')`,
  ])('withdraws a complete waiver proof when its conversation is held (%s)', async mutate => {
    await apply()
    await db.exec(mutate)
    expect(await verified()).toBe(false)
  })
  it('refuses a forged explicit earliest start on an otherwise genuine partial floor', async () => {
    await apply(payload({ contractEndDate: '2027-03-31' }))
    const s = await row('customer_sites')
    const snapshot = (s.metadata as { manual_supplier_terms: { terms: Record<string, unknown> } }).manual_supplier_terms
    expect(await verified({ ...snapshot, terms: { ...snapshot.terms, earliestStartDate: '2027-04-01' } })).toBe(false)
  })
  it('does not authorize notice waiver for genuinely partial terms', async () => {
    await apply(payload({ contractEndDate: '2027-03-31' }))
    expect(await verified()).toBe(false)
  })
  it('rejects changed context even when the date is identical', async () => {
    await apply()
    const s = await row('customer_sites')
    const snapshot = (s.metadata as { manual_supplier_terms: object }).manual_supplier_terms
    expect(await verified({ ...snapshot, customerId: OTHER })).toBe(false)
  })
})


describe('internal SQL command access', () => {
  it.each([
    ['gridex_apply_manual_facility_reply_v1', [CO, REQUEST, INBOUND, '{}'], '$1::uuid,$2::uuid,$3::uuid,$4::jsonb'],
    ['gridex_manual_reply_context_v1', [CO, REQUEST, INBOUND, HASH, 'commercial'], '$1::uuid,$2::uuid,$3::uuid,$4::text,$5::text'],
    ['gridex_manual_supplier_start_floor_v1', [CO, CUSTOMER, SITE], '$1::uuid,$2::uuid,$3::uuid'],
    ['gridex_manual_supplier_terms_verified_v1', [CO, CUSTOMER, SITE, '{}'], '$1::uuid,$2::uuid,$3::uuid,$4::jsonb'],
  ])('denies tenant SQL callers access to %s', async (fn, args, placeholders) => {
    await expect(db.transaction(async tx => {
      await tx.exec('set local role authenticated')
      await tx.query(`select public.${fn}(${placeholders})`, args as string[])
    })).rejects.toThrow(/permission denied/)
  })
})


describe('verified commercial partial response accumulation', () => {
  async function nextReply(terms: Record<string, unknown>) {
    await db.exec(`insert into public.manual_inbound_messages select '${OTHER}',company_id,request_id,customer_id,customer_site_id,resolution_status,jsonb_set(extracted_payload-array['manual_automation'],'{manual_automation}','{"sourceHash":"${'b'.repeat(64)}"}'),received_at+interval '1 hour','parsed' from public.manual_inbound_messages where id='${INBOUND}'`)
    return apply({ ...payload(terms), sourceHash: 'b'.repeat(64) }, CO, false, OTHER)
  }
  it.each([
    [{ earliestStartDate: '2027-04-01' }, { terminationFee: 'Ingen' }],
    [{ terminationFee: 'Ingen' }, { earliestStartDate: '2027-04-01' }],
  ])('completes genuinely verified partial replies in either order (%j then %j)', async (first, second) => {
    expect(await apply(payload(first))).toMatchObject({ ok: true, complete: false })
    expect(await nextReply(second)).toMatchObject({ ok: true, complete: true, effectiveStartDate: '2027-04-01' })
    expect((await row('customer_sites')).current_supplier_response_status).toBe('free_to_switch')
    const parsed = (await row('grid_owner_information_requests')).parsed_payload as { missingFields: string[]; evidence: Record<string,string>; fieldSources: Record<string, { inboundId: string }> }
    expect(parsed.missingFields).toEqual([])
    expect(Object.keys(parsed.evidence)).toEqual(expect.arrayContaining(['earliestStartDate', 'terminationFee']))
    expect(parsed.fieldSources).toMatchObject(Object.fromEntries([...Object.keys(first).map(key => [key, { inboundId: INBOUND }]), ...Object.keys(second).map(key => [key, { inboundId: OTHER }])]))
  })
  it('rechecks contradictions across separate source messages', async () => {
    await apply(payload({ contractEndDate: '2027-03-31' }))
    const before = await snapshot()
    expect((await nextReply({ earliestStartDate: '2027-03-31', terminationFee: '0 kr' })).ok).toBe(false)
    // The newly inserted raw reply is retained, while business projections remain.
    expect((await snapshot())[0]).toMatchObject({ value: { sites: (before[0] as { value: { sites: unknown[] } }).value.sites } })
  })
  it('does not reuse a prior reply after the request was rebound to another CIR', async () => {
    await apply(payload({ earliestStartDate: '2027-04-01' }))
    await db.exec(`update public.customer_info_requests set id='${OTHER}'; update public.grid_owner_information_requests set metadata=jsonb_set(metadata,'{customer_info_request_id}','"${OTHER}"')`)
    expect((await nextReply({ terminationFee: 'Ingen' })).ok).toBe(false)
  })
  it('does not promote forged editable site metadata into verified response facts', async () => {
    await db.exec(`update public.customer_sites set metadata='{"manual_supplier_terms":{"version":1,"terms":{"earliestStartDate":"2027-04-01","terminationFee":"Ingen","effectiveStartDate":"2027-04-01"}}}'`)
    expect(await apply(payload({ noticePeriod: '1 månad' }))).toMatchObject({ ok: true, complete: false })
    const parsed = (await row('grid_owner_information_requests')).parsed_payload as { terms: unknown }
    expect(parsed.terms).toEqual({ noticePeriod: '1 månad' })
  })
})


describe('current power-of-attorney authority at application', () => {
  it.each([
    "update public.powers_of_attorney set revoked_at=now()",
    "update public.powers_of_attorney set status='replaced'",
    "update public.powers_of_attorney set valid_to='2000-01-01'",
    "update public.powers_of_attorney set expires_at=now()-interval '1 second'",
    "update public.powers_of_attorney set signed_at=null",
    `update public.powers_of_attorney set signed_at=null,fullmakt_snapshot=null,evidence_payload='{"verification_reference":"archive-only"}'`,
    `update public.powers_of_attorney set company_id='${OTHER}'`,
    `update public.customer_authorization_documents set site_id='${OTHER}'`,
    "update public.customer_authorization_documents set status='archived'",
    "update public.authorization_scopes set revoked_at=now()",
    "update public.authorization_scopes set covers_current_supplier_contract=false",
    `update public.powers_of_attorney set signed_scope_snapshot='["facility_information_lookup"]'`,
  ])('refuses a revoked, expired or mismatched commercial authority (%s)', async mutate => { await unchangedReject(mutate) })
  it('requires current facility scope and POA lifecycle even for a previously correlated source', async () => {
    await db.exec("update public.grid_owner_information_requests set request_type='facility_identifier_lookup'; update public.powers_of_attorney set revoked_at=now()")
    await unchangedReject('', { ...payload(), facility_id: '735999123456789012', grid_area_code: 'LKR' } as ReturnType<typeof payload>, CO, true)
  })
})


// Live metadata read on 2026-10-18 confirmed: normal tenant managers may write
// GOIR, while inbound writes require platform admin or service role. These
// fixtures retain that authorization union; a human platform-admin session is
// still not a cryptographic mail transport attestation producer.
describe('server-owned mail provenance under actual table privileges and RLS', () => {
  beforeAll(async () => {
    await db.exec(`
      create schema auth;
      create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) $$;
      create function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.mail_platform_admin',true),'off')='on' $$;
      create function public.gridex_can_read_company(p_id uuid) returns boolean language sql stable as $$ select p_id='${CO}'::uuid or public.gridex_user_is_platform_admin() $$;
      create function public.gridex_user_can_manage_company(p_id uuid) returns boolean language sql stable as $$ select public.gridex_can_read_company(p_id) $$;
      grant usage on schema auth to authenticated,service_role;
      grant select,insert,update,delete on public.manual_inbound_messages,public.grid_owner_information_requests to authenticated;
      alter table public.manual_inbound_messages enable row level security;
      alter table public.grid_owner_information_requests enable row level security;
      create policy manual_inbound_messages_tenant_read on public.manual_inbound_messages for select using (auth.role()='service_role' or public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)));
      create policy manual_inbound_messages_write_update on public.manual_inbound_messages for update using (auth.role()='service_role' or public.gridex_user_is_platform_admin()) with check (auth.role()='service_role' or public.gridex_user_is_platform_admin());
      create policy manual_inbound_messages_write_insert on public.manual_inbound_messages for insert with check (auth.role()='service_role' or public.gridex_user_is_platform_admin());
      create policy manual_inbound_messages_write_delete on public.manual_inbound_messages for delete using (auth.role()='service_role' or public.gridex_user_is_platform_admin());
      create policy goir_select on public.grid_owner_information_requests for select to authenticated using (public.gridex_can_read_company(company_id));
      create policy goir_write on public.grid_owner_information_requests for all to authenticated using (public.gridex_user_can_manage_company(company_id)) with check (public.gridex_user_can_manage_company(company_id));
    `)
  })
  async function asHuman<T>(admin: boolean, fn: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) {
    return db.transaction(async tx => {
      await tx.exec(`set local role authenticated; select set_config('test.mail_platform_admin','${admin ? 'on' : 'off'}',true)`)
      return fn(tx)
    })
  }
  it('does not misclassify a normal tenant as able to update the inbound attestation', async () => {
    const before = await row('manual_inbound_messages')
    const changed = await asHuman(false, tx => tx.query(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"verified"') where id='${INBOUND}' returning id`))
    expect(changed.rows).toEqual([])
    expect(await row('manual_inbound_messages')).toEqual(before)
  })
  it.each(['sender_verification', 'manual_automation', 'sender_credible', 'source_fingerprint', 'ai_read_only', 'manual_reply_structure_requires_review', 'mime_requires_review', 'customer_identity_review_reasons'])('blocks an authenticated platform admin fabricating %s', async key => {
    const before = await row('manual_inbound_messages')
    await expect(asHuman(true, tx => tx.query(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,array[$1],$2::jsonb) where id=$3`, [key, JSON.stringify(key === 'sender_credible' ? false : { status: 'verified', sourceHash: 'b'.repeat(64), application: { applied: true } }), INBOUND]))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
    expect(await row('manual_inbound_messages')).toEqual(before)
  })
  it('cannot forge both stores into a complete source accepted by the service proof reader', async () => {
    await apply(payload({ contractEndDate: '2027-03-31' }))
    const r = await row('grid_owner_information_requests')
    const original = r.parsed_payload as Record<string, unknown>
    const forged = { ...original, complete: true, responseStatus: 'free_to_switch', missingFields: [], terms: { contractEndDate: '2027-03-31', earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01', terminationFee: 'Ingen' } }
    let denied = false
    try {
      await asHuman(true, async tx => {
        await tx.query(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation,application}',$1::jsonb) where id=$2`, [JSON.stringify(forged), INBOUND])
        await tx.query('update public.grid_owner_information_requests set parsed_payload=$1::jsonb where id=$2', [JSON.stringify(forged), REQUEST])
      })
    } catch (error) {
      expect(String(error)).toMatch(/manual_mail_provenance_service_role_required/)
      denied = true
    }
    const snapshot = Object.fromEntries(Object.entries(forged).filter(([key]) => !['applied', 'inbound_id', 'complete', 'responseStatus', 'missingFields'].includes(key)))
    const proof = await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{ value: boolean }>('select public.gridex_manual_supplier_terms_verified_v1($1,$2,$3,$4::jsonb) value', [CO, CUSTOMER, SITE, JSON.stringify(snapshot)])).rows[0].value
    })
    expect(proof).toBe(false)
    expect(denied).toBe(true)
  })
  it('blocks creating an automatic GOIR proof through a normal tenant write', async () => {
    await expect(asHuman(false, tx => tx.query(`update public.grid_owner_information_requests set parsed_payload=$1::jsonb where id=$2`, [JSON.stringify({ version: 1, applied: true, sourceHash: HASH, inbound_id: INBOUND, terms: { earliestStartDate: '2027-04-01' } }), REQUEST]))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
  })
  it('blocks editing or deleting an existing authoritative request proof', async () => {
    await apply()
    await expect(asHuman(false, tx => tx.exec(`update public.grid_owner_information_requests set parsed_payload='{}' where id='${REQUEST}'`))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
    await expect(asHuman(false, tx => tx.exec(`delete from public.grid_owner_information_requests where id='${REQUEST}'`))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
  })
  it('blocks rebinding an existing witness to a different source identity', async () => {
    await apply()
    await expect(asHuman(true, tx => tx.exec(`update public.manual_inbound_messages set received_at=now() where id='${INBOUND}'`))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
    await expect(asHuman(false, tx => tx.exec(`update public.grid_owner_information_requests set metadata=jsonb_set(metadata,'{supplier_id}','"${OTHER}"') where id='${REQUEST}'`))).rejects.toThrow(/manual_mail_provenance_service_role_required/)
  })
  it('does not trust a role value supplied in JWT context as the database execution role', async () => {
    await expect(asHuman(true, async tx => {
      await tx.exec("select set_config('request.jwt.claim.role','service_role',true)")
      await tx.exec(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"unverified"') where id='${INBOUND}'`)
    })).rejects.toThrow(/manual_mail_provenance_service_role_required/)
  })
  it('keeps ordinary tenant request notes and non-machine review data writable', async () => {
    await asHuman(false, tx => tx.exec(`update public.grid_owner_information_requests set parsed_payload='{"manual_note":"Kontrollera det bifogade underlaget."}',metadata=metadata||'{"manual_note":"Granskning pågår"}' where id='${REQUEST}'`))
    expect((await row('grid_owner_information_requests')).parsed_payload).toEqual({ manual_note: 'Kontrollera det bifogade underlaget.' })
  })
  it('preserves server-side ingestion, source application and manual review writes', async () => {
    expect(await apply()).toMatchObject({ ok: true, applied: true })
    await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      await tx.exec(`update public.grid_owner_information_requests set parsed_payload='{"applied":false,"inbound_id":"${INBOUND}","review_reason":"manual_review"}' where id='${REQUEST}'`)
    })
    expect((await row('grid_owner_information_requests')).parsed_payload).toMatchObject({ applied: false, review_reason: 'manual_review' })
  })
})

describe('receipt-anchored reminders on delayed source processing', () => {
  beforeEach(async () => {
    await db.exec(`update public.manual_inbound_messages set received_at='2026-09-01T12:00:00Z'; update public.powers_of_attorney set valid_from='2026-01-01',signed_at='2026-01-01'`)
  })
  it('completes a delayed complete source even when its unused reminder date already elapsed', async () => {
    expect(await apply({ ...payload(), nextFollowUpAt: '2026-09-08T12:00:00Z' })).toMatchObject({ ok: true, complete: true })
    const request = await row('grid_owner_information_requests')
    expect(request.next_follow_up_at).toBeNull()
    expect((request.received_at as Date).toISOString()).toBe('2026-09-01T12:00:00.000Z')
  })
  it('keeps an overdue partial reminder immediately due without moving the source receipt clock', async () => {
    expect(await apply({ ...payload({ contractEndDate: '2027-03-31' }), nextFollowUpAt: '2026-09-08T12:00:00Z' })).toMatchObject({ ok: true, complete: false })
    const request = await row('grid_owner_information_requests')
    expect((request.next_follow_up_at as Date).toISOString()).toBe('2026-09-08T12:00:00.000Z')
    expect((request.received_at as Date).toISOString()).toBe('2026-09-01T12:00:00.000Z')
  })
  it('still rejects a nonsensical reminder far in the future', async () => {
    const before = await snapshot()
    expect((await apply({ ...payload(), nextFollowUpAt: '2099-01-01T00:00:00Z' })).ok).toBe(false)
    expect(await snapshot()).toEqual(before)
  })
})

describe('current supplier identity for retained date floors', () => {
  async function applyOldProviderThenChange() {
    await apply(payload({ earliestStartDate: '2027-12-01', terminationFee: 'Ingen' }))
    await db.exec(`insert into public.electricity_suppliers select '${OTHER}',company_id,platform_market_actor_id,'Nya Elbolaget',is_active,verified_for_customer_flow,verification_status,technical_owner_only from public.electricity_suppliers where id='${SUPPLIER}'; update public.customer_sites set current_supplier_id='${OTHER}'`)
  }
  it('does not reuse an applied earlier provider date as the current provider floor', async () => {
    await applyOldProviderThenChange()
    const floor = await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{ value: Date | null }>('select public.gridex_manual_supplier_start_floor_v1($1,$2,$3) value', [CO, CUSTOMER, SITE])).rows[0].value
    })
    expect(floor).toBeNull()
  })
  it('does not clamp a newly planned current-provider switch against the earlier provider date', async () => {
    await applyOldProviderThenChange()
    await db.exec(`delete from public.supplier_switch_requests; insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,status,requested_start_date,lifecycle_blocked,metadata,request_type) values ('${SWITCH}','${CO}','${CUSTOMER}','${SITE}','${SITE}','draft','2027-06-01',false,'{}','switch')`)
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-06-01')
  })
})

describe('current verified supplier route at atomic application', () => {
  it.each([
    'update public.platform_actor_contacts set is_verified=false',
    "update public.platform_actor_contacts set verified_at=null",
    "update public.platform_actor_contacts set valid_to='2000-01-01'",
    "update public.platform_actor_contacts set channel='phone'",
    "update public.platform_actor_contacts set contact_type='technical'",
    "update public.platform_actor_contacts set email='changed@supplier.example'",
    "update public.platform_market_actors set status='inactive'",
    "update public.platform_market_actors set match_status='unverified'",
    'update public.platform_actor_roles set is_active=false',
  ])('rejects a route revoked or changed after correlation (%s)', async mutate => { await unchangedReject(mutate) })
})


describe('commercial reply identity hints remain bound to the locked site', () => {
  beforeEach(async () => { await db.exec("update public.customer_sites set facility_id='735999123456789001'") })
  it('rejects an explicit facility of another site even when the email thread matched this request', async () => {
    await db.exec(`insert into public.customer_sites(id,company_id,customer_id,is_active,status,protected_identity,metadata,facility_id,current_supplier_id) values ('${OTHER}','${CO}','${CUSTOMER}',true,'active',false,'{}','735999123456789002','${SUPPLIER}')`)
    await unchangedReject('', { ...payload(), extracted: { facility_id: '735999123456789002' } } as ReturnType<typeof payload>)
  })
  it('rejects a meter belonging to another site of the same customer', async () => {
    await db.exec(`insert into public.metering_points values ('${ACTOR}','${CO}','${CUSTOMER}','${ACTOR}','${ACTOR}','hourly','{}',null,'735999123456789002','735999123456789002','735999123456789002')`)
    await unchangedReject('', { ...payload(), extracted: { metering_point_id: '735999123456789002' } } as ReturnType<typeof payload>)
  })
  it.each([
    { customer_id: OTHER }, { company_id: OTHER }, { customer_site_id: OTHER }, { metering_point_record_id: ACTOR },
  ])('rejects contradictory post-correlation identity hints %j', async extracted => {
    await unchangedReject('', { ...payload(), extracted } as ReturnType<typeof payload>)
  })
  it('accepts matching explicit identities without requiring a reply to repeat all identifiers', async () => {
    expect(await apply({ ...payload(), extracted: { facility_id: '735999123456789001', metering_point_id: '735999123456789001', customer_id: CUSTOMER, customer_site_id: SITE, company_id: CO } } as ReturnType<typeof payload>)).toMatchObject({ ok: true, complete: true })
  })
})


describe('quarantined message structure has no business authority', () => {
  it.each(['manual_reply_structure_requires_review','mime_requires_review'])('refuses trusted source quarantine flag %s before any business writes', async key => {
    await unchangedReject(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,array['${key}'],'true')`)
  })
  it.each([['identity_conflict'], 'identity_conflict', null])('refuses nonempty or malformed trusted identity quarantine reasons (%j)', async reasons => {
    await db.query("update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}',$1::jsonb)", [JSON.stringify(reasons)])
    await unchangedReject('')
  })
  it('allows an explicitly clear trusted identity assessment', async () => {
    await db.exec("update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','[]')")
    expect(await apply()).toMatchObject({ ok: true, complete: true })
  })
  it('withdraws both proof readers when the trusted source acquires identity review reasons', async () => {
    await apply()
    const site = await row('customer_sites')
    const proof = (site.metadata as { manual_supplier_terms: unknown }).manual_supplier_terms
    await db.exec("update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','[\"identity_conflict\"]')")
    await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      expect((await tx.query<{ value: Date | null }>('select public.gridex_manual_supplier_start_floor_v1($1,$2,$3) value', [CO, CUSTOMER, SITE])).rows[0].value).toBeNull()
      expect((await tx.query<{ value: boolean }>('select public.gridex_manual_supplier_terms_verified_v1($1,$2,$3,$4::jsonb) value', [CO, CUSTOMER, SITE, JSON.stringify(proof)])).rows[0].value).toBe(false)
    })
    await db.exec(`delete from public.supplier_switch_requests; insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,status,requested_start_date,lifecycle_blocked,metadata,request_type) values ('${SWITCH}','${CO}','${CUSTOMER}','${SITE}','${SITE}','draft','2027-03-01',false,'{}','switch')`)
    expect(((await row('supplier_switch_requests')).requested_start_date as Date).toISOString().slice(0, 10)).toBe('2027-03-01')
  })
})


describe('explicit customer identity numbers in commercial replies', () => {
  it.each([{ personal_number: '198001010015' }, { org_number: '5566778899' }, { customer_identity_number: '198001010015' }])('also rejects contradictory explicit customer identity before facility completion (%j)', async extracted => {
    await db.exec("update public.grid_owner_information_requests set request_type='facility_lookup'")
    await unchangedReject('', { ...payload(), extracted, facility_id: '735999123456789012', grid_area_code: 'LKR' } as TestPayload, CO, true)
  })
  it.each(['198001010015','199001010015 198001010015','invalid',''])('rejects contradictory or malformed generic identity hint %s', async customer_identity_number => {
    await unchangedReject('', { ...payload(), extracted: { customer_identity_number } })
  })
  it.each(['19900101-0015','900101-0015'])('accepts generic person/organization label with the known person (%s)', async customer_identity_number => {
    expect(await apply({ ...payload(), extracted: { customer_identity_number } })).toMatchObject({ ok: true, complete: true })
  })
  it('checks a generic person/organization label against the known organization', async () => {
    await db.exec("update public.customers set personal_number=null,org_number='5566778899'")
    await unchangedReject('', { ...payload(), extracted: { customer_identity_number: '556677-8800' } })
    expect(await apply({ ...payload(), extracted: { customer_identity_number: '556677-8899' } })).toMatchObject({ ok: true, complete: true })
  })
  it.each(['198001010015','199001010015 198001010015','invalid',''])('rejects contradictory or malformed personal-number hint %s', async personal_number => {
    await unchangedReject('', { ...payload(), extracted: { personal_number } } as ReturnType<typeof payload>)
  })
  it.each(['19900101-0015','900101-0015'])('accepts full or short identity format against the known canonical person (%s)', async personal_number => {
    expect(await apply({ ...payload(), extracted: { personal_number } } as ReturnType<typeof payload>)).toMatchObject({ ok: true, complete: true })
  })
  it('checks organization numbers against the current customer instead of treating any organization number as a match', async () => {
    await db.exec("update public.customers set personal_number=null,org_number='5566778899'")
    await unchangedReject('', { ...payload(), extracted: { org_number: '556677-8800' } } as ReturnType<typeof payload>)
    expect(await apply({ ...payload(), extracted: { org_number: '556677-8899' } } as ReturnType<typeof payload>)).toMatchObject({ ok: true, complete: true })
  })
})
