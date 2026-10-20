// Calls the actual forward SQL commands. Removing a tenant, state, evidence,
// date or idempotency guard must permit a forbidden business write and fail here.
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

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
    create role anon; create role authenticated; create role service_role bypassrls; create role test_hold_writer bypassrls;
    create table public.companies(id uuid primary key,is_active boolean,lifecycle_status text,closed_at timestamptz,status text);
    create table public.customers(id uuid primary key,company_id uuid,status text,archived_at timestamptz,anonymized_at timestamptz,merged_into_customer_id uuid,lifecycle_closed_at timestamptz,metadata jsonb,protected_identity boolean,personal_number text,org_number text);
    create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,is_active boolean,status text,archived_at timestamptz,closed_at timestamptz,protected_identity boolean,metadata jsonb,updated_at timestamptz,current_supplier_contract_end_date date,current_supplier_notice_period text,current_supplier_termination_fee numeric,current_supplier_response_status text,current_supplier_contract_status text,facility_id text,grid_area_code text,price_area_code text,grid_owner_id uuid,current_supplier_id uuid,current_supplier_name text,current_supplier_unknown boolean default true,annual_consumption_kwh numeric,resolution_status text,resolution_id uuid);
    create table public.grid_owner_information_requests(id uuid primary key,company_id uuid,customer_id uuid,customer_site_id uuid,request_type text constraint grid_owner_information_requests_request_type_check check(request_type in ('facility_identifier_lookup','facility_lookup','metering_point_lookup','grid_area_confirmation','grid_contract_information','manual_custom_donor')),status text,metadata jsonb,parsed_payload jsonb,received_payload jsonb,received_at timestamptz,completed_at timestamptz,next_follow_up_at timestamptz,last_error_code text,last_error_message text,updated_at timestamptz,dispatch_status text,grid_owner_id uuid,recipient_email text,poa_id uuid);
    alter table public.grid_owner_information_requests add column channel text default 'manual_email',add column idempotency_key text;
    create unique index grid_owner_information_requests_market_open_uidx on public.grid_owner_information_requests(company_id,customer_site_id,request_type) where channel<>'manual_email' and status in ('draft','ready_to_send','sent','waiting_response','needs_review');
    create unique index grid_owner_information_requests_open_idempotency_uidx on public.grid_owner_information_requests(idempotency_key) where idempotency_key is not null and status in ('draft','ready_to_send','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received','needs_review','blocked_missing_poa','blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox','sent','waiting_response');
    create table public.manual_inbound_messages(id uuid primary key,company_id uuid,request_id uuid,customer_id uuid,customer_site_id uuid,resolution_status text,extracted_payload jsonb,received_at timestamptz,processing_state text);
    alter table public.manual_inbound_messages add column from_email text;
    create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,status text,requested_start_date date,metadata jsonb,submitted_at timestamptz,completed_at timestamptz,paused_at timestamptz,lifecycle_blocked boolean,outbound_z03_message_id uuid,updated_at timestamptz,request_type text);
    alter table public.supplier_switch_requests add column prodat_variant text,add column prodat_reason text;
    alter table public.supplier_switch_requests add column lifecycle_block_source text,add column pause_reason text;
    create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,customer_id uuid,site_id uuid,switch_request_id uuid,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz);
    create schema gridex_ediel_transport;
    create table gridex_ediel_transport.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,actor_user_id uuid,owner jsonb,binding jsonb,created_at timestamptz default now(),entered_at timestamptz,observed_at timestamptz,classification text,provider_result jsonb);
    create schema gridex_received_sources;
    create table gridex_received_sources.switch_originals(message_id uuid primary key,company_id uuid,switch_id uuid,original_object jsonb);
    create schema gridex_switch_cancellations;
    create table gridex_switch_cancellations.origins(message_id uuid primary key,company_id uuid,switch_id uuid,original_message_id uuid,payload_hash text);
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
    grant select,update on public.grid_owner_information_requests to test_hold_writer;
    grant select on public.customer_sites to test_hold_writer;
  `)
  // Use the existing native date decoder unchanged. Native source creation and
  // admission remain independent dependencies; fixtures provide their rows.
  const nativeSql = fs.readFileSync('supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql', 'utf8')
  const dateStart = nativeSql.indexOf('CREATE FUNCTION gridex_received_sources.permission_date_v1(')
  const dateEnd = nativeSql.indexOf('CREATE FUNCTION gridex_received_sources.permission_time_v1(', dateStart)
  await db.exec(nativeSql.slice(dateStart, dateEnd))
  await db.exec(`create function public.test_manual_transport_enter(p_id uuid) returns void language plpgsql security definer set search_path=public as $$begin update gridex_ediel_transport.attempts set entered_at=now() where id=p_id;end$$; grant execute on function public.test_manual_transport_enter(uuid) to service_role`)
  await db.exec(fs.readFileSync(SQL_PATH, 'utf8'))
})

afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`
    truncate public.companies,public.customers,public.customer_sites,public.grid_owner_information_requests,public.manual_inbound_messages,public.supplier_switch_requests,public.customer_info_requests,public.electricity_suppliers,public.platform_market_actors,public.platform_actor_contacts,public.grid_owners,public.manual_email_outbox,public.platform_actor_roles,public.customer_operation_events,public.metering_points,public.powers_of_attorney,public.customer_authorization_documents,public.authorization_scopes,public.customer_contracts,public.customer_site_resolution,public.ediel_messages,gridex_ediel_transport.attempts,gridex_received_sources.switch_originals,gridex_switch_cancellations.origins;
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
    insert into public.supplier_switch_requests values ('${SWITCH}','${CO}','${CUSTOMER}','${SITE}','${SITE}','draft','2027-03-01','{}',null,null,null,false,null,null,'switch',null,null);
  `)
})


const MULTI_SQL = 'supabase/migrations/20261019010000_manual_mail_multi_site_application.sql'
const SITE_B = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
const REQUEST_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const POA_B = '66666666-6666-4666-8666-666666666662'
const DOCUMENT_B = '77777777-7777-4777-8777-777777777772'
const CIR_B = '55555555-5555-4555-8555-555555555552'
const SWITCH_B = '11111111-1111-4111-8111-111111111112'
const FACILITY_A = '735999123456789001'
const FACILITY_B = '735999123456789002'
beforeAll(async () => {
  await db.exec(`alter table public.grid_owner_information_requests add column created_by uuid,add column case_reference text;
    alter table public.grid_owners add column company_id uuid,add column is_active boolean default true,add column platform_market_actor_id uuid;
    create table public.grid_owner_contact_channels(id uuid primary key,grid_owner_id uuid,company_id uuid,email text,is_enabled boolean,is_verified boolean,verified_at timestamptz,channel_type text);
    grant all on public.grid_owner_contact_channels to service_role;
    create unique index scoped_request_fixture on public.grid_owner_information_requests(company_id,id);
    create unique index scoped_site_fixture on public.customer_sites(company_id,customer_id,id);
    alter table public.manual_inbound_messages add constraint source_parent_fixture foreign key(company_id,request_id) references public.grid_owner_information_requests(company_id,id);
    alter table public.grid_owner_information_requests add constraint target_site_fixture foreign key(company_id,customer_id,customer_site_id) references public.customer_sites(company_id,customer_id,id);`)
  if (fs.existsSync(MULTI_SQL)) await db.exec(fs.readFileSync(MULTI_SQL, 'utf8'))
})
beforeEach(async () => {
  await db.exec(`update public.customer_sites set facility_id='${FACILITY_A}' where id='${SITE}';
    insert into public.customer_sites select (jsonb_populate_record(null::public.customer_sites,to_jsonb(s)||jsonb_build_object('id','${SITE_B}','facility_id','${FACILITY_B}','metadata','{}'::jsonb))).* from public.customer_sites s where id='${SITE}';
    insert into public.grid_owner_information_requests select (jsonb_populate_record(null::public.grid_owner_information_requests,to_jsonb(r)||jsonb_build_object('id','${REQUEST_B}','customer_site_id','${SITE_B}','poa_id','${POA_B}','metadata',r.metadata||jsonb_build_object('customer_info_request_id','${CIR_B}','authorization_document_id','${DOCUMENT_B}')))).* from public.grid_owner_information_requests r where id='${REQUEST}';
    insert into public.powers_of_attorney select (jsonb_populate_record(null::public.powers_of_attorney,to_jsonb(p)||jsonb_build_object('id','${POA_B}','site_id','${SITE_B}','customer_site_id','${SITE_B}','document_id','${DOCUMENT_B}'))).* from public.powers_of_attorney p where id='${POA}';
    insert into public.customer_authorization_documents select (jsonb_populate_record(null::public.customer_authorization_documents,to_jsonb(d)||jsonb_build_object('id','${DOCUMENT_B}','site_id','${SITE_B}','power_of_attorney_id','${POA_B}'))).* from public.customer_authorization_documents d where id='${DOCUMENT}';
    insert into public.authorization_scopes select (jsonb_populate_record(null::public.authorization_scopes,to_jsonb(a)||jsonb_build_object('id','${SITE_B}','authorization_document_id','${DOCUMENT_B}'))).* from public.authorization_scopes a where id='${OTHER}';
    insert into public.customer_info_requests select (jsonb_populate_record(null::public.customer_info_requests,to_jsonb(c)||jsonb_build_object('id','${CIR_B}','site_id','${SITE_B}','authorization_document_id','${DOCUMENT_B}','verified_payload',c.verified_payload||jsonb_build_object('manual_supplier_request_id','${REQUEST_B}')))).* from public.customer_info_requests c where id='${CIR}';
    insert into public.supplier_switch_requests select (jsonb_populate_record(null::public.supplier_switch_requests,to_jsonb(s)||jsonb_build_object('id','${SWITCH_B}','site_id','${SITE_B}','customer_site_id','${SITE_B}'))).* from public.supplier_switch_requests s where id='${SWITCH}';`)
})
type Item = { facilityId: string; requestId?: string; payload?: Record<string,unknown>; reasons?: string[] }
async function batch(items: Item[] = [
  { facilityId: FACILITY_A, requestId: REQUEST, payload: payload() },
  { facilityId: FACILITY_B, requestId: REQUEST_B, payload: payload({ earliestStartDate:'2027-05-01',terminationFee:'0 kr',effectiveStartDate:'2027-05-01' }) },
]) {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role')
    return (await tx.query<{result: Record<string,unknown>}>('select public.gridex_apply_manual_multi_site_reply_v1($1,$2,$3,$4::jsonb) result', [CO, REQUEST, INBOUND, JSON.stringify({sourceHash:HASH,items})])).rows[0].result
  })
}
async function proof(siteId = SITE_B) {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role')
    return (await tx.query<{value:boolean}>('select public.gridex_manual_supplier_terms_verified_v1(company_id,customer_id,id,metadata->\'manual_supplier_terms\') value from public.customer_sites where id=$1',[siteId])).rows[0].value
  })
}
async function read(table: string,id: string) { return (await db.query<Record<string,unknown>>(`select * from public.${table} where id=$1`,[id])).rows[0] }
it('applies two independently covered sites and keeps one immutable source parent', async () => {
  const result = await batch()
  expect(result, JSON.stringify(result)).toMatchObject({ok:true,appliedCount:2,reviewCount:0})
  expect(await read('manual_inbound_messages',INBOUND)).toMatchObject({request_id:REQUEST,customer_site_id:SITE,processing_state:'applied'})
  expect((await db.query<{n:number}>('select count(*)::int n from public.manual_inbound_messages')).rows[0].n).toBe(1)
  expect(await read('grid_owner_information_requests',REQUEST_B)).toMatchObject({status:'completed'})
  expect(await proof()).toBe(true)
  expect((await read('supplier_switch_requests',SWITCH_B)).requested_start_date).toEqual(new Date('2027-05-01T00:00:00Z'))
  expect((await db.query<{n:number}>('select count(*)::int n from public.customer_operation_events')).rows[0].n).toBe(2)
})
it('replays without replacing either application, events or source identity', async () => {
  await batch()
  const before=JSON.stringify((await db.query('select extracted_payload from public.manual_inbound_messages')).rows)
  expect(await batch()).toMatchObject({ok:true,appliedCount:2,reviewCount:0,alreadyApplied:true})
  expect(JSON.stringify((await db.query('select extracted_payload from public.manual_inbound_messages')).rows)).toBe(before)
  expect((await db.query<{n:number}>('select count(*)::int n from public.customer_operation_events')).rows[0].n).toBe(2)
})
it.each([
  ['revoked own POA',`update public.powers_of_attorney set revoked_at=now() where id='${POA_B}'`],
  ['wrong-site POA',`update public.grid_owner_information_requests set poa_id='${POA}' where id='${REQUEST_B}'`],
  ['wrong-site authorization document',`update public.customer_info_requests set authorization_document_id='${DOCUMENT}' where id='${CIR_B}'`],
  ['current party changed',`update public.customer_sites set current_supplier_id='${OTHER}' where id='${SITE_B}'`],
  ['existing hold',`update public.grid_owner_information_requests set metadata=metadata||'{"counterparty_reply":{"requires_review":true}}' where id='${REQUEST_B}'`],
])('preserves a valid member while reviewing an uncovered member: %s',async (_name,mutation) => {
  await db.exec(mutation)
  expect(await batch()).toMatchObject({ok:true,appliedCount:1,reviewCount:1})
  expect(await read('grid_owner_information_requests',REQUEST_B)).toMatchObject({status:'waiting_manual_response',parsed_payload:{}})
  expect(await proof()).toBe(false)
})
it('reviews unknown IDs without creating sites, authority, outbound rows or moving the source',async () => {
  expect(await batch([{facilityId:'735999123456789099',payload:payload()}])).toMatchObject({ok:true,appliedCount:0,reviewCount:1})
  expect((await db.query<{n:number}>('select count(*)::int n from public.customer_sites')).rows[0].n).toBe(2)
  expect((await db.query<{n:number}>('select count(*)::int n from public.manual_email_outbox')).rows[0].n).toBe(0)
  expect(await read('manual_inbound_messages',INBOUND)).toMatchObject({request_id:REQUEST,customer_site_id:SITE})
})
it('raises a newly inserted child switch to that site\'s actual batch floor',async () => {
  await batch()
  await db.exec(`delete from public.supplier_switch_requests where id='${SWITCH_B}';insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,status,requested_start_date,metadata,lifecycle_blocked,request_type) values('${SWITCH_B}','${CO}','${CUSTOMER}','${SITE_B}','${SITE_B}','draft','2027-01-01','{}',false,'switch')`)
  expect((await read('supplier_switch_requests',SWITCH_B)).requested_start_date).toEqual(new Date('2027-05-01T00:00:00Z'))
})
it('never promotes source capability through an authenticated table write',async () => {
  await batch()
  await db.exec('grant select,update on public.manual_inbound_messages to authenticated')
  await expect(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec(`update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation,site_applications}','{}') where id='${INBOUND}'`)})).rejects.toThrow(/manual_mail_provenance_service_role_required/)
})
it('creates a received-only internal request using the second site\'s own existing authority',async()=>{
  await db.exec(`delete from public.grid_owner_information_requests where id='${REQUEST_B}';delete from public.customer_info_requests where id='${CIR_B}'`)
  const result=await batch([{facilityId:FACILITY_B,payload:payload()}])
  expect(result,JSON.stringify(result)).toMatchObject({ok:true,appliedCount:1,reviewCount:0})
  const child=(await db.query<{id:string;poa_id:string;metadata:Record<string,unknown>}>('select id,poa_id,metadata from public.grid_owner_information_requests where customer_site_id=$1',[SITE_B])).rows[0]
  expect(child.poa_id).toBe(POA_B)
  expect(child.metadata).toMatchObject({manual_multi_site_parent_request_id:REQUEST,authorization_document_id:DOCUMENT_B,auto_send_allowed:false})
  expect((await db.query<{n:number}>('select count(*)::int n from public.manual_email_outbox')).rows[0].n).toBe(0)
  expect(await proof()).toBe(true)
})
it('does not create an internal request from the parent\'s first-site POA',async()=>{
  await db.exec(`delete from public.grid_owner_information_requests where id='${REQUEST_B}';delete from public.powers_of_attorney where id='${POA_B}'`)
  expect(await batch([{facilityId:FACILITY_B,payload:payload()}])).toMatchObject({ok:true,appliedCount:0,reviewCount:1})
  expect((await db.query<{n:number}>('select count(*)::int n from public.grid_owner_information_requests where customer_site_id=$1',[SITE_B])).rows[0].n).toBe(0)
})
it.each([
  ["extracted_payload=jsonb_set(extracted_payload,'{sender_credible}','false')"],
  ["extracted_payload=jsonb_set(extracted_payload,'{mime_requires_review}','true')"],
  ["extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','[\"customer_identity_mismatch\"]')"],
])('never applies any site when the original immutable source is untrusted: %s',async mutation=>{
  await db.exec(`update public.manual_inbound_messages set ${mutation}`)
  expect(await batch()).toMatchObject({ok:false})
  expect((await read('customer_sites',SITE)).current_supplier_response_status).toBeNull()
  expect((await read('customer_sites',SITE_B)).current_supplier_response_status).toBeNull()
})
it('rejects contradictory duplicate facility rows before committing either site',async()=>{
  expect(await batch([{facilityId:FACILITY_A,payload:payload()},{facilityId:FACILITY_A,payload:payload({earliestStartDate:'2028-01-01'})}])).toMatchObject({ok:false,code:'manual_multi_site_duplicate_facility'})
  expect((await read('customer_sites',SITE)).current_supplier_response_status).toBeNull()
})
it('does not let a wrong-site request hint fall back onto a different request',async()=>{
  expect(await batch([{facilityId:FACILITY_B,requestId:REQUEST,payload:payload()}])).toMatchObject({ok:true,appliedCount:0,reviewCount:1})
  expect((await read('customer_sites',SITE_B)).current_supplier_response_status).toBeNull()
})
async function parentDenial(receivedAt='2026-10-18T13:00:00Z') {
  const assessment={outcome:'rejected',intent:'power_of_attorney_rejected',reason_codes:['poa_signature_missing'],evidence:['Fullmakten kan inte godkännas.'],message:'Motparten har nekat fullmakten.'}
  await db.query(`insert into public.manual_inbound_messages(id,company_id,request_id,customer_id,customer_site_id,resolution_status,processing_state,received_at,from_email,extracted_payload) values($1,$2,$3,$4,$5,'matched','parsed',$6,'avtal@supplier.example',$7::jsonb)`,[CONTACT,CO,REQUEST,CUSTOMER,SITE,receivedAt,JSON.stringify({sender_credible:true,sender_verification:{status:'verified',version:1,method:'dkim',raw_sha256:HASH,signed_headers:['from'],from_email:'avtal@supplier.example',signing_domain:'supplier.example'},reply_assessment:assessment,manual_automation:{sourceHash:'b'.repeat(64)}})])
  return db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{result:Record<string,unknown>}>('select public.gridex_hold_manual_counterparty_reply_v1($1,$2,$3,$4::jsonb) result',[CO,REQUEST,CONTACT,JSON.stringify(assessment)])).rows[0].result})
}
it('invalidates every child proof when a newer authenticated denial holds the original conversation',async()=>{
  await batch();expect(await proof()).toBe(true)
  expect(await parentDenial()).toMatchObject({ok:true,held:true})
  expect(await proof()).toBe(false)
})
it('does not let an older parent denial overrule a newer child-only batch',async()=>{
  await batch([{facilityId:FACILITY_B,requestId:REQUEST_B,payload:payload()}])
  expect(await parentDenial('2026-10-18T11:00:00Z')).toMatchObject({ok:false,held:false,code:'counterparty_hold_stale_source'})
  expect(await proof()).toBe(true)
})
it('blocks physical entry for a prepared child original after the parent is held',async()=>{
  await batch()
  await db.exec(`update public.supplier_switch_requests set status='prepared',outbound_z03_message_id='${OTHER}' where id='${SWITCH_B}';insert into public.ediel_messages values('${OTHER}','${CO}','production','outbound','PRODAT','Z03','${CUSTOMER}','${SITE_B}','${SWITCH_B}',null,null,null);insert into gridex_received_sources.switch_originals values('${OTHER}','${CO}','${SWITCH_B}','{"reason":"Z22","start":"20270501"}');insert into gridex_ediel_transport.attempts(id,message_id,company_id,environment) values('${ACTOR}','${OTHER}','${CO}','production')`)
  await parentDenial()
  await expect(db.query('select public.test_manual_transport_enter($1)',[ACTOR])).rejects.toThrow('manual_supplier_transport_not_ready')
})
it('blocks a queued child clarification claim after a later parent denial without inventing child delivery',async()=>{
  await batch([{facilityId:FACILITY_B,requestId:REQUEST_B,payload:payload({terminationFee:'0 kr'})}])
  await db.exec(`insert into public.manual_email_outbox values ('${CONTACT}','${CO}','${REQUEST_B}','queued',true,'avtal@supplier.example')`)
  expect(await parentDenial()).toMatchObject({ok:true,held:true})
  await expect(db.exec(`update public.manual_email_outbox set status='sending' where id='${CONTACT}'`)).rejects.toThrow('manual_multi_site_outbox_source_not_current')
  expect((await db.query(`select status from public.manual_email_outbox where id='${CONTACT}'`)).rows).toEqual([{status:'queued'}])
})

async function facilitySetup() {
  await db.exec(`delete from public.grid_owner_contact_channels;update public.grid_owners set platform_market_actor_id='${ACTOR}',is_active=true;
    insert into public.platform_actor_roles values('${ACTOR}','grid_owner',true);
    insert into public.grid_owner_contact_channels values('${CONTACT}','${OTHER}',null,'reply@grid.example',true,true,now(),'facility_information_request');
    update public.manual_inbound_messages set from_email='reply@grid.example';
    update public.grid_owner_information_requests set request_type='facility_identifier_lookup',grid_owner_id='${OTHER}',recipient_email='reply@grid.example',metadata='{}';`)
}
function facilityItems(): Item[] { return [
  {facilityId:FACILITY_A,requestId:REQUEST,payload:{sourceHash:HASH,facility_id:FACILITY_A,grid_area_code:'LKR',extracted:{},facts:{annualConsumptionKwh:1000}}},
  {facilityId:FACILITY_B,requestId:REQUEST_B,payload:{sourceHash:HASH,facility_id:FACILITY_B,grid_area_code:'LKR',extracted:{},facts:{annualConsumptionKwh:2000}}},
] }
it('applies separate facility facts through each canonical site request',async()=>{
  await facilitySetup()
  expect(await batch(facilityItems())).toMatchObject({ok:true,appliedCount:2,reviewCount:0})
  expect(await read('customer_sites',SITE)).toMatchObject({annual_consumption_kwh:'1000'})
  expect(await read('customer_sites',SITE_B)).toMatchObject({annual_consumption_kwh:'2000'})
})
it.each([
  ['contact disabled',`update public.grid_owner_contact_channels set is_enabled=false`],
  ['contact unverified',`update public.grid_owner_contact_channels set is_verified=false`],
  ['contact verification withdrawn',`update public.grid_owner_contact_channels set verified_at=null`],
  ['foreign scoped contact',`update public.grid_owner_contact_channels set company_id='${OTHER}'`],
  ['inactive actor',`update public.platform_market_actors set status='inactive'`],
  ['unverified actor',`update public.platform_market_actors set match_status='needs_review'`],
  ['revoked grid owner role',`update public.platform_actor_roles set is_active=false where actor_role='grid_owner'`],
])('rejects a facility source whose current authority was revoked during reading: %s',async(_name,mutation)=>{
  await facilitySetup();await db.exec(mutation)
  const result=await batch(facilityItems())
  expect(result).toMatchObject({ok:false,code:'manual_reply_grid_owner_route_revoked'})
  expect((await read('customer_sites',SITE)).annual_consumption_kwh).toBeNull()
  expect((await read('customer_sites',SITE_B)).annual_consumption_kwh).toBeNull()
})
it('revalidates current network authority in the original single-site command too',async()=>{
  await facilitySetup();await db.exec('update public.grid_owner_contact_channels set is_enabled=false')
  const result=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{result:Reply}>('select public.gridex_apply_manual_facility_reply_v1($1,$2,$3,$4::jsonb) result',[CO,REQUEST,INBOUND,JSON.stringify(facilityItems()[0].payload)])).rows[0].result})
  expect(result).toMatchObject({ok:false,code:'manual_reply_grid_owner_route_revoked'})
  expect((await read('customer_sites',SITE)).annual_consumption_kwh).toBeNull()
})
it('allows a verified technical grid owner to answer facility facts without outbound Ediel eligibility',async()=>{
  await facilitySetup();await db.exec("update public.grid_owners set verified_for_customer_flow=false,technical_owner_only=true,verification_status='needs_review'")
  expect(await batch(facilityItems())).toMatchObject({ok:true,appliedCount:2,reviewCount:0})
})
it('accumulates a later single-site reply from its earlier protected batch receipt',async()=>{
  expect(await batch([{facilityId:FACILITY_B,requestId:REQUEST_B,payload:payload({earliestStartDate:'2027-05-01',effectiveStartDate:'2027-05-01'})}])).toMatchObject({appliedCount:1})
  expect((await read('grid_owner_information_requests',REQUEST_B)).status).toBe('manual_response_received')
  await db.exec(`insert into public.manual_inbound_messages select (jsonb_populate_record(null::public.manual_inbound_messages,to_jsonb(i)||jsonb_build_object('id','${CONTACT}','request_id','${REQUEST_B}','customer_site_id','${SITE_B}','received_at','2026-10-18T13:00:00Z','processing_state','parsed','extracted_payload',jsonb_build_object('sender_credible',true,'sender_verification',jsonb_build_object('status','verified'),'manual_automation',jsonb_build_object('sourceHash','${'b'.repeat(64)}'))))).* from public.manual_inbound_messages i where id='${INBOUND}'`)
  const result=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{result:Reply}>('select public.gridex_apply_manual_commercial_reply_v1($1,$2,$3,$4::jsonb) result',[CO,REQUEST_B,CONTACT,JSON.stringify({...payload({terminationFee:'0 kr'}),sourceHash:'b'.repeat(64)})])).rows[0].result})
  expect(result).toMatchObject({ok:true,applied:true,complete:true,effectiveStartDate:'2027-05-01'})
  expect(await proof()).toBe(true)
  expect(new Date(String((await read('supplier_switch_requests',SWITCH_B)).requested_start_date)).toISOString().slice(0,10)).toBe('2027-05-01')
})
it('creates a received-only facility request using its own existing site POA',async()=>{
  await facilitySetup();await db.exec(`delete from public.grid_owner_information_requests where id='${REQUEST_B}'`)
  const item={...facilityItems()[1]};delete item.requestId
  expect(await batch([item])).toMatchObject({appliedCount:1,reviewCount:0})
  const requests=(await db.query<{poa_id:string;case_reference:string;status:string}>(`select poa_id,case_reference,status from public.grid_owner_information_requests where customer_site_id='${SITE_B}'`)).rows
  expect(requests).toEqual([{poa_id:POA_B,case_reference:expect.stringMatching(/^GX-FIR-[A-F0-9]{32}$/),status:'completed'}])
  expect((await db.query<{n:number}>('select count(*)::int n from public.manual_inbound_messages')).rows[0]).toEqual({n:1})
  expect((await db.query<{n:number}>('select count(*)::int n from public.manual_email_outbox')).rows[0]).toEqual({n:0})
})
