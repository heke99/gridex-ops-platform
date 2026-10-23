// reality-defects: H3d (B2 + D7 fixture: the move-out fee review and the lifecycle close's final-invoice task, PGlite)
// The real bodies of the three move-out writers are installed from supabase/schema.sql (identical to the installed world
// database bodies before 20261023202000): gridex_close_customer_lifecycle_v1, gridex_end_customer_supply_v1 and the
// received-end trigger gridex_supply_end_followup_v1 (trg_supply_end_followup). Declared fixture port: the contract
// event recorder writes exactly the 'terminated'/'cancelled' fields of gridex_record_customer_contract_event_v1 (status,
// ended_at from ended_at/ends_at, ends_at, termination_notice_date, termination_reason). Synthetic ids only.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
export const MIGRATION_PATH = root + '/supabase/migrations/20261023202000_move_out_fee_review_and_final_invoice.sql'
export const ids = {
  company: '11111111-1111-4111-8111-111111111111', other: '12121212-1212-4212-8212-121212121212', actor: 'abababab-abab-4bab-8bab-abababababab',
  customer: '55555555-5555-4555-8555-555555555555', site: '44444444-4444-4444-8444-444444444444', point: '66666666-6666-4666-8666-666666666666',
  supply: '77777777-7777-4777-8777-777777777777', contract: '88888888-8888-4888-8888-888888888888',
  otherCustomer: '56565656-5656-4656-8656-565656565656', otherSite: '45454545-4545-4545-8545-454545454545', otherPoint: '67676767-6767-4767-8767-676767676767',
  otherSupply: '78787878-7878-4878-8878-787878787878', otherContract: '89898989-8989-4989-8989-898989898989',
}
export const WRITERS = ['public.gridex_close_customer_lifecycle_v1', 'public.gridex_end_customer_supply_v1', 'public.gridex_supply_end_followup_v1']
export const SIGNATURES = {
  close: 'public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean)',
  end: 'public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)',
  followup: 'public.gridex_supply_end_followup_v1()',
}

function definition(schema, name) {
  const start = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (start < 0) throw Error('source_function_missing:' + name)
  const marker = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  const end = schema.indexOf(marker[1] + ';', start + marker.index + marker[0].length)
  return schema.slice(start, end + marker[1].length + 1)
}

/**
 * A PGlite database with the shipped writers installed; applyMigration installs 20261023202000 on top.
 * The base world (tenant A and tenant B) is committed; every scenario runs in its own rolled-back transaction.
 */
export async function createFeeReviewDb({ PGlite, applyMigration }) {
  const db = new PGlite()
  const schema = fs.readFileSync(root + '/supabase/schema.sql', 'utf8')
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','service_role')$$;
 create table public.companies(id uuid primary key);
 create table public.customers(id uuid primary key,company_id uuid,customer_type text,status text,moved_out_at date,lifecycle_closed_at timestamptz,lifecycle_closed_by uuid,lifecycle_status_reason text,updated_at timestamptz);
 create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,status text,move_out_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,status text,end_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,starts_at date,actual_start_at date,confirmed_start_at date,expected_start_at date,
  binding_months int,ends_at date,termination_reason text,termination_notice_date date,ended_at timestamptz);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,end_date date,
  actual_start_date date,actual_end_date date,status text,source_message_id uuid,metadata jsonb default '{}',updated_at timestamptz,market_start_at timestamptz,market_end_at timestamptz);
 create table public.supplier_switch_requests(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,status text,failed_at timestamptz,failure_reason text,updated_by uuid);
 create table public.customer_operation_tasks(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,task_type text,status text,priority text,
  title text,description text,metadata jsonb,created_by uuid,updated_by uuid,resolved_at timestamptz,created_at timestamptz default clock_timestamp());
 create table public.customer_internal_notes(company_id uuid,customer_id uuid,body text,created_by uuid,updated_by uuid);
 create table public.customer_lifecycle_events(company_id uuid,customer_id uuid,event_type text,event_status text,effective_date date,reason text,payload jsonb,created_by uuid);
 create function public.gridex_record_customer_contract_event_v1(p_company_id uuid,p_customer_contract_id uuid,p_customer_id uuid,p_event_type text,p_happened_at timestamptz default now(),p_note text default null,p_metadata jsonb default '{}',p_actor_user_id uuid default null,p_derived_ends_at timestamptz default null,p_idempotency_key text default null)
  returns jsonb language plpgsql as $$begin update public.customer_contracts set status=case when p_event_type='terminated' then 'terminated' else 'cancelled' end,
   ended_at=coalesce(nullif(p_metadata->>'ended_at','')::timestamptz,nullif(p_metadata->>'ends_at','')::timestamptz,ended_at),
   ends_at=coalesce(nullif(p_metadata->>'ends_at','')::date,ends_at),
   termination_notice_date=coalesce(nullif(p_metadata->>'termination_notice_date','')::timestamptz::date,termination_notice_date),
   termination_reason=coalesce(nullif(p_metadata->>'termination_reason',''),termination_reason)
   where id=p_customer_contract_id and company_id=p_company_id and customer_id=p_customer_id;return '{}'::jsonb;end$$;`)
  for (const name of WRITERS) await db.exec(definition(schema, name))
  await db.exec(`create trigger trg_supply_end_followup after update of end_date, actual_end_date, status on public.customer_supply_periods for each row execute function public.gridex_supply_end_followup_v1();
 revoke all on function ${SIGNATURES.close} from public;grant execute on function ${SIGNATURES.close} to service_role;
 revoke all on function ${SIGNATURES.end} from public;grant execute on function ${SIGNATURES.end} to service_role;
 revoke all on function ${SIGNATURES.followup} from public;grant execute on function ${SIGNATURES.followup} to service_role;`)
  const shipped = {}
  for (const signature of Object.values(SIGNATURES)) shipped[signature] = (await db.query(`select prosrc from pg_proc where oid=$1::regprocedure`, [signature])).rows[0].prosrc
  const meta = async () => (await db.query(`select p.oid::regprocedure::text sig,to_jsonb(p)-'prosrc' m from pg_proc p where p.oid = any($1::regprocedure[]) order by 1`, [Object.values(SIGNATURES)])).rows
  const metaBefore = await meta()
  if (applyMigration) await db.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'))
  return { db, shipped, metaBefore, meta, ...helpers(db) }
}

function helpers(db) {
  const { company, other, actor, customer, site, point, supply, contract } = ids
  const q = async (sql, args) => (await db.query(sql, args)).rows
  // set local: the role ends with the scenario's transaction (or its savepoint) also when the call fails.
  const service = async (sql, args) => { await db.exec('set local role service_role'); try { return (await db.query(sql, args)).rows[0]?.r } finally { await db.exec('reset role').catch(() => undefined) } }
  /** One customer of tenant A with a contract, a site, a metering point and a supply period; tenant B mirrors it. */
  const seed = async ({ customerType = 'private', binding = 12, startsAt = '2026-08-01', supplyStart = '2026-09-01', contractExtra = {}, periodExtra = {} } = {}) => {
    await q(`insert into public.companies values($1),($2) on conflict do nothing`, [company, other])
    for (const [c, cu, s, p, sp, ct] of [[company, customer, site, point, supply, contract], [other, ids.otherCustomer, ids.otherSite, ids.otherPoint, ids.otherSupply, ids.otherContract]]) {
      await q(`insert into public.customers(id,company_id,customer_type,status) values($1,$2,$3,'active')`, [cu, c, customerType])
      await q(`insert into public.customer_sites(id,company_id,customer_id,status) values($1,$2,$3,'active')`, [s, c, cu])
      await q(`insert into public.metering_points(id,company_id,customer_id,site_id,status) values($1,$2,$3,$4,'active')`, [p, c, cu, s])
      const contractRow = { status: 'active', starts_at: startsAt, binding_months: binding, ...contractExtra }
      await q(`insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,starts_at,actual_start_at,confirmed_start_at,expected_start_at,binding_months)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ct, c, cu, p, contractRow.status, contractRow.starts_at, contractRow.actual_start_at ?? null, contractRow.confirmed_start_at ?? null, contractRow.expected_start_at ?? null, contractRow.binding_months])
      const periodRow = { status: 'active', start_date: supplyStart, ...periodExtra }
      await q(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,actual_start_date,status,metadata,market_start_at)
        values($1,$2,$3,$4,$5,$5,$6,$7,$8,'{}',$9)`, [sp, c, cu, p, ct, periodRow.start_date, periodRow.actual_start_date ?? null, periodRow.status, periodRow.market_start_at ?? null])
    }
  }
  const close = (date, mode = 'move_out', c = company, cu = customer) => service(`select public.gridex_close_customer_lifecycle_v1($1,$2,$3,$4,$5,$6,$7,false) r`, [c, cu, actor, mode, date, 'Kunden meddelade flytt per telefon.', 'Syntetisk anteckning.'])
  const endSupply = (date, reason = 'move_out') => service(`select public.gridex_end_customer_supply_v1($1,$2,$3,$4,$5) r`, [company, customer, point, date, reason])
  /** A received grid-owner end (Z05 L/LK applied by the source flow): the period gets the market end and its status. */
  const receivedEnd = async (endDate, status = 'ended', id = supply) => q(`update public.customer_supply_periods set end_date=$2,actual_end_date=case when $3='ended' then $2::date end,status=$3,
    market_end_at=($2::date)::timestamp at time zone 'Europe/Stockholm',updated_at=now() where id=$1`, [id, endDate, status])
  const tasks = async (c = company) => q(`select task_type,status,metering_point_id,title,metadata from public.customer_operation_tasks where company_id=$1 order by task_type,created_at`, [c])
  const reviews = async (c = company) => (await tasks(c)).filter(t => t.task_type === 'break_fee_review')
  const finalInvoices = async (c = company) => (await tasks(c)).filter(t => t.task_type === 'final_invoice_pending')
  const contractRow = async () => (await q(`select status,termination_reason,ends_at::text ends_at from public.customer_contracts where id=$1`, [contract]))[0]
  const scenario = async (fn) => { await db.exec('begin'); try { return await fn() } finally { await db.exec('rollback') } }
  return { q, service, seed, close, endSupply, receivedEnd, tasks, reviews, finalInvoices, contractRow, scenario }
}
