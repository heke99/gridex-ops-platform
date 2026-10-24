// reality-defects: H3d (slice 2 fixture: notice period at move-out and termination, B1/B3/D1/D3/D5/D6/D9 and the Z05
// correction after a manual end, PGlite; slice 3: owner decisions B5-B7, termination end and fee review inside the binding,
// the Z08 task 14 days before the planned end and its automatic close)
// The real bodies are installed from supabase/schema.sql (identical to the installed world database bodies before
// 20261023202000): gridex_record_customer_contract_event_v1 (the real recorder, with its event, domain-event and outbox
// writes), gridex_close_customer_lifecycle_v1, gridex_end_customer_supply_v1, the received-end trigger
// gridex_supply_end_followup_v1 (trg_supply_end_followup) and gridex_submit_customer_move_out_v1. Then 20261023202000
// (slice 1, installed in the world) and, unless `shipped`, 20261023204000, 20261023205000 and 20261023206000, then,
// unless `shipped` or `b5Shipped`, 20261024100000 (B5-B7).
// Declared fixture ports: the tables carry only the columns these bodies read and write; digest() is sha256;
// gridex_user_is_platform_admin()/gridex_can_read_company() exist for the RLS policies. Synthetic ids only.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const migration = (name) => fs.readFileSync(root + '/supabase/migrations/' + name, 'utf8')
export const SLICE1 = '20261023202000_move_out_fee_review_and_final_invoice.sql'
export const SLICE2 = ['20261023204000_h3d_contract_notice_days.sql', '20261023205000_h3d_move_out_notice_and_termination.sql',
  '20261023206000_h3d_portal_retroactive_move_out.sql']
export const SLICE3 = '20261024100000_h3d_termination_notice_end_fee_review_z08_lead.sql'
export const ids = {
  company: '11111111-1111-4111-8111-111111111111', other: '12121212-1212-4212-8212-121212121212', actor: 'abababab-abab-4bab-8bab-abababababab',
  customer: '55555555-5555-4555-8555-555555555555', site: '44444444-4444-4444-8444-444444444444', point: '66666666-6666-4666-8666-666666666666',
  supply: '77777777-7777-4777-8777-777777777777', contract: '88888888-8888-4888-8888-888888888888', offer: '99999999-9999-4999-8999-999999999999',
  newSite: '44444444-aaaa-4444-8444-444444444444', newPoint: '66666666-aaaa-4666-8666-666666666666', newSupply: '77777777-aaaa-4777-8777-777777777777',
  newContract: '88888888-aaaa-4888-8888-888888888888', moveIn: '33333333-aaaa-4333-8333-333333333333',
  otherCustomer: '56565656-5656-4656-8656-565656565656', otherSite: '45454545-4545-4545-8545-454545454545', otherPoint: '67676767-6767-4767-8767-676767676767',
  otherSupply: '78787878-7878-4878-8878-787878787878', otherContract: '89898989-8989-4989-8989-898989898989',
  apiClient: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
}
const WRITERS = ['public.gridex_record_customer_contract_event_v1', 'public.gridex_close_customer_lifecycle_v1', 'public.gridex_end_customer_supply_v1',
  'public.gridex_supply_end_followup_v1', 'public.gridex_submit_customer_move_out_v1']

function definition(schema, name) {
  const start = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (start < 0) throw Error('source_function_missing:' + name)
  const marker = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  const end = schema.indexOf(marker[1] + ';', start + marker.index + marker[0].length)
  return schema.slice(start, end + marker[1].length + 1)
}

/**
 * A PGlite database with the shipped writers and slice 1; `shipped: false` adds the slice-2 migrations and, unless
 * `b5Shipped`, the slice-3 migration (owner decisions B5-B7).
 */
export async function createNoticeDb({ PGlite, shipped = false, b5Shipped = false }) {
  const db = new PGlite()
  const schema = fs.readFileSync(root + '/supabase/schema.sql', 'utf8')
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
 create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','service_role')$$;
 create function public.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$select false$$;
 create function public.gridex_can_read_company(uuid) returns boolean language sql stable as $$select false$$;
 create table public.companies(id uuid primary key);
 create table public.customers(id uuid primary key,company_id uuid,customer_type text,status text,customer_number text,external_customer_id text,moved_out_at date,lifecycle_closed_at timestamptz,lifecycle_closed_by uuid,lifecycle_status_reason text,updated_at timestamptz);
 create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,status text,facility_reference text,move_out_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,status text,end_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.contract_offers(id uuid primary key,company_id uuid);
 create table public.customer_contracts(id uuid primary key,company_id uuid not null,customer_id uuid,metering_point_id uuid,site_id uuid,customer_site_id uuid,contract_offer_id uuid,customer_contract_reference text,
  status text,lifecycle_stage text,starts_at date,ends_at date,actual_start_at date,confirmed_start_at date,expected_start_at date,binding_months int,notice_months int,
  termination_reason text,termination_notice_date date,ended_at timestamptz,status_reason_code text,withdrawal_requested_at timestamptz,rejected_reason text,
  signed_at timestamptz,locked_at timestamptz,metadata jsonb not null default '{}',updated_by uuid,updated_at timestamptz);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,end_date date,
  actual_start_date date,actual_end_date date,status text,source_message_id uuid,metadata jsonb default '{}',updated_at timestamptz,market_start_at timestamptz,market_end_at timestamptz);
 create table public.supplier_switch_requests(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,
  request_type text,process_type text,status text,customer_contract_id uuid,contract_id uuid,failed_at timestamptz,failure_reason text,updated_by uuid);
 create table public.customer_operation_tasks(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,task_type text,status text,priority text,
  title text,description text,metadata jsonb,created_by uuid,updated_by uuid,resolved_at timestamptz,due_at timestamptz,created_at timestamptz default clock_timestamp(),updated_at timestamptz);
 create table public.customer_internal_notes(company_id uuid,customer_id uuid,body text,created_by uuid,updated_by uuid);
 create table public.customer_lifecycle_events(company_id uuid,customer_id uuid,event_type text,event_status text,effective_date date,reason text,payload jsonb,created_by uuid,
  constraint customer_lifecycle_events_type_check check (event_type = any (array['move_out'::text,'terminate'::text,'restore'::text,'note'::text])));
 create table public.customer_contract_events(id uuid primary key default gen_random_uuid(),company_id uuid,customer_contract_id uuid,customer_id uuid,event_type text,happened_at timestamptz,note text,metadata jsonb,actor_user_id uuid,created_at timestamptz default clock_timestamp());
 create table public.domain_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id text,subject_customer_id uuid,actor_user_id uuid,source text,idempotency_key text unique,payload jsonb);
 create table public.event_outbox(company_id uuid,domain_event_id uuid,destination_type text,destination_key text,payload jsonb);
 create table public.customer_portal_completions(id uuid primary key default gen_random_uuid(),completion_reference text default 'CPC-'||substr(md5(random()::text),1,12),company_id uuid,customer_id uuid,site_id uuid,
  completion_type text,status text,submitted_payload jsonb,result_payload jsonb,api_client_id uuid,idempotency_key text,request_hash text,linked_case_id uuid,created_at timestamptz default now(),updated_at timestamptz);
 create table public.customer_cases(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_contract_id uuid,case_type text,status text,priority text,title text,description text,next_action text,source text,metadata jsonb);
 create table public.audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb);`)
  for (const name of WRITERS) await db.exec(definition(schema, name))
  await db.exec(`create trigger trg_supply_end_followup after update of end_date, actual_end_date, status on public.customer_supply_periods for each row execute function public.gridex_supply_end_followup_v1();
 do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
  ('gridex_record_customer_contract_event_v1','gridex_close_customer_lifecycle_v1','gridex_end_customer_supply_v1','gridex_supply_end_followup_v1','gridex_submit_customer_move_out_v1') loop
  execute format('revoke all on function %s from public',f);execute format('grant execute on function %s to service_role',f);end loop;end$$;`)
  await db.exec(migration(SLICE1))
  if (!shipped) for (const name of SLICE2) await db.exec(migration(name))
  if (!shipped && !b5Shipped) await db.exec(migration(SLICE3))
  return { db, ...helpers(db, shipped) }
}

function helpers(db, shipped) {
  const { company, other, actor, customer, site, point, supply, contract } = ids
  // Every statement runs in its own savepoint, so a refusal a test expects leaves the scenario's transaction usable.
  const guarded = async (fn) => {
    await db.exec('savepoint h3d_step')
    try { const result = await fn(); await db.exec('release savepoint h3d_step'); return result } catch (error) { await db.exec('rollback to savepoint h3d_step'); await db.exec('release savepoint h3d_step'); throw error }
  }
  const q = async (sql, args) => guarded(async () => (await db.query(sql, args)).rows)
  const service = async (sql, args) => guarded(async () => { await db.exec('set local role service_role'); try { return (await db.query(sql, args)).rows[0]?.r } finally { await db.exec('reset role').catch(() => undefined) } })
  const asRole = async (role, sql, args) => {
    await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role })}'`)
    try { return await service(sql, args) } finally { await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'service_role' })}'`) }
  }
  /** One customer of tenant A (contract, site, metering point, supply period); tenant B mirrors it. */
  const seed = async ({ customerType = 'private', binding = 0, noticeMonths = null, noticeDays = null, noticeDate = null, startsAt = '2026-09-01', supplyStart = '2026-09-01',
    contractStatus = 'active', periodEnd = null, periodStatus = 'active', offer = false } = {}) => {
    await q(`insert into public.companies values($1),($2) on conflict do nothing`, [company, other])
    if (offer) await q(`insert into public.contract_offers values($1,$2) on conflict do nothing`, [ids.offer, company])
    for (const [c, cu, s, p, sp, ct] of [[company, customer, site, point, supply, contract], [other, ids.otherCustomer, ids.otherSite, ids.otherPoint, ids.otherSupply, ids.otherContract]]) {
      await q(`insert into public.customers(id,company_id,customer_type,status,customer_number) values($1,$2,$3,'active',$4)`, [cu, c, customerType, 'CN-' + cu.slice(0, 4)])
      await q(`insert into public.customer_sites(id,company_id,customer_id,status,facility_reference) values($1,$2,$3,'active','FAC-1')`, [s, c, cu])
      await q(`insert into public.metering_points(id,company_id,customer_id,site_id,status) values($1,$2,$3,$4,'active')`, [p, c, cu, s])
      await q(`insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,site_id,customer_site_id,contract_offer_id,status,starts_at,binding_months,notice_months,termination_notice_date,signed_at,locked_at,metadata)
        values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,'2026-08-01T10:00:00Z','2026-08-01T10:00:00Z',$12)`,
      [ct, c, cu, p, s, c === company && offer ? ids.offer : null, contractStatus, startsAt, binding, noticeMonths, noticeDate, noticeDays === null ? {} : { notice_days: noticeDays }])
      await q(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,end_date,status,metadata)
        values($1,$2,$3,$4,$5,$5,$6,$7,$8,'{}')`, [sp, c, cu, p, ct, supplyStart, periodEnd, periodStatus])
    }
  }
  /** v2 with the customer's notice date (shipped: v1, which has no notice date). */
  const close = (date, mode = 'move_out', noticeDate = null, c = company) => shipped
    ? service(`select public.gridex_close_customer_lifecycle_v1($1,$2,$3,$4,$5,$6,$7,false) r`, [c, customer, actor, mode, date, 'Kunden meddelade per telefon.', 'Syntetisk anteckning.'])
    : service(`select public.gridex_close_customer_lifecycle_v2($1,$2,$3,$4,$5,$6,$7,false,$8) r`, [c, customer, actor, mode, date, 'Kunden meddelade per telefon.', 'Syntetisk anteckning.', noticeDate])
  const closeV1 = (date, mode = 'move_out') => service(`select public.gridex_close_customer_lifecycle_v1($1,$2,$3,$4,$5,$6,$7,false) r`, [company, customer, actor, mode, date, 'Kunden meddelade per telefon.', 'Syntetisk anteckning.'])
  const endSupply = (date, reason = 'move_out') => service(`select public.gridex_end_customer_supply_v1($1,$2,$3,$4,$5) r`, [company, customer, point, date, reason])
  const expiry = (asOf, c = null) => service(`select public.gridex_termination_notice_expiry_tasks_v1($1,$2) r`, [c, asOf])
  /** A received grid-owner end (Z05 applied by the source flow): the market end at the start of its date and its status. */
  const receivedEnd = async (endDate, status = 'ended', id = supply) => q(`update public.customer_supply_periods set end_date=$2,actual_end_date=case when $3='ended' then $2::date end,status=$3,
    market_end_at=($2::date)::timestamp at time zone 'Europe/Stockholm',updated_at=now() where id=$1`, [id, endDate, status])
  const tasks = async (c = company) => q(`select task_type,status,metering_point_id,site_id,title,description,due_at,resolved_at,metadata from public.customer_operation_tasks where company_id=$1 order by task_type,created_at`, [c])
  const ofType = async (type, c = company) => (await tasks(c)).filter(t => t.task_type === type)
  const contractRow = async (id = contract) => (await q(`select status,termination_reason,termination_notice_date::text notice,ended_at,(ended_at at time zone 'Europe/Stockholm')::date::text ended,status_reason_code,metadata
    from public.customer_contracts where id=$1`, [id]))[0]
  const periodRow = async (id = supply) => (await q(`select status,end_date::text end_date,actual_end_date::text actual_end_date,metadata from public.customer_supply_periods where id=$1`, [id]))[0]
  const customerRow = async (id = customer) => (await q(`select status,moved_out_at::text moved_out_at from public.customers where id=$1`, [id]))[0]
  const lifecycleEvents = async () => q(`select event_type,effective_date::text effective_date,payload from public.customer_lifecycle_events where company_id=$1 order by event_type`, [company])
  const scenario = async (fn) => { await db.exec('begin'); try { return await fn() } finally { await db.exec('rollback') } }
  return { q, service, asRole, seed, close, closeV1, endSupply, expiry, receivedEnd, tasks, ofType, contractRow, periodRow, customerRow, lifecycleEvents, scenario }
}
