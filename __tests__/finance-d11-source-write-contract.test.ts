// reality-defects: D11-G1
// D11-G1 / owner decision 33 (migration 20261026120000): an invoiced break fee is credited, fully or partially, through
// the existing invoice engine: gridex_request_break_fee_credit_v1 creates the adjustment case, a credit underlay and the
// credit row; the credit invoice is the normal customer_invoices row of that underlay, refused twice or for another
// amount, stamped with the original invoice and fee line; the charge's cumulative credit never exceeds its debit. The
// invoice readiness basis (pre-image = the body after 20261025120000) qualifies a credit underlay only through its own
// credit row. Embedded PostgreSQL with minimal tables and stubs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const slice1 = read('supabase/migrations/20261025110000_d11_break_fee_charges.sql')
const slice2 = read('supabase/migrations/20261025120000_d11_break_fee_underlay_invoice.sql')
const g1 = read('supabase/migrations/20261026120000_d11g1_break_fee_credit.sql')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', ACTOR = '33333333-3333-4333-8333-333333333333'
const CT = '44444444-4444-4444-8444-444444444444', TASK = '55555555-5555-4555-8555-555555555555', SNAP = '66666666-6666-4666-8666-666666666666'
const MP = '77777777-7777-4777-8777-777777777777'

function basisPreImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(')
  const body = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))![2]
  expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe('496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7')
  return body
}

let db: PGlite
async function setup(withG1 = true) {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create schema gridex_billing_source; create schema gridex_utilts_binding;
    create function auth.role() returns text language sql as $$ select 'service_role' $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.companies(id uuid primary key);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, contract_type text, fixed_price_ore_per_kwh numeric,
      binding_months int, contract_version text, terms_version text, signed_version text, snapshot_hash text, signature_snapshot_sha256 text,
      site_id uuid, customer_site_id uuid, metering_point_id uuid);
    create table public.customer_operation_tasks(id uuid primary key, company_id uuid, customer_id uuid, task_type text, status text, metadata jsonb,
      resolved_at timestamptz, updated_at timestamptz, updated_by uuid);
    create table public.contract_price_snapshots(id uuid primary key, company_id uuid, contract_id uuid, valid_from date, valid_to date, snapshot_json jsonb);
    create table public.billing_underlays(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, site_id uuid, customer_site_id uuid,
      metering_point_id uuid, contract_id uuid, customer_contract_id uuid, contract_price_snapshot_id uuid, pricing_snapshot_id uuid, underlay_year int,
      underlay_month int, billing_period_start date, billing_period_end date, status text, readiness_status text, total_kwh numeric, currency text,
      source_system text, energy_direction text, settlement_type text, payload jsonb, metadata jsonb, created_by uuid, updated_by uuid);
    create unique index billing_underlays_company_segment_uidx on public.billing_underlays(company_id, customer_id, metering_point_id, underlay_year,
      underlay_month, billing_period_start, billing_period_end, energy_direction);
    create table public.customer_invoices(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, billing_underlay_id uuid,
      amount_ex_vat numeric, vat_amount numeric, amount_inc_vat numeric, metadata jsonb not null default '{}');
    create table public.billing_adjustment_cases(id uuid primary key default gen_random_uuid(), company_id uuid not null, original_billing_underlay_id uuid not null,
      corrected_billing_underlay_id uuid, original_invoice_id uuid, credit_invoice_id uuid, reason text not null, status text not null default 'detected',
      difference_minor_units bigint, currency character(3) not null, approval_required boolean not null default true, approved_by uuid, approved_at timestamptz,
      metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.contract_charge_ledger(id uuid primary key default gen_random_uuid(), company_id uuid, customer_contract_id uuid, component_key text,
      event_key text, pricing_run_id uuid, amount_ex_vat numeric, unique (customer_contract_id, component_key, event_key));
    create table gridex_billing_source.underlay_bindings(underlay_id uuid, company_id uuid, source_basis_hash text);
    create table gridex_billing_source.correction_journal(underlay_id uuid);
    create function gridex_billing_source.require_underlay_v1(c uuid, u uuid) returns void language plpgsql as $$
      begin raise exception using errcode='23514', message='no metering source'; end $$;
    create function gridex_utilts_binding.canonical_decimal_v2(v text) returns text language sql as $$ select v $$;
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select a = '${ACTOR}'::uuid and c = '${C}'::uuid $$;
    create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select true $$;
    insert into public.companies values ('${C}'), ('${OTHER}');
    insert into public.customer_contracts values ('${CT}','${C}','${CU}','fixed',120,12,'v3','t2','s1','h','sig',null,null,'${MP}');
    insert into public.customer_operation_tasks(id,company_id,customer_id,task_type,status,metadata) values ('${TASK}','${C}','${CU}','break_fee_review','open',
      '{"contract_id":"${CT}","binding_ends_at":"2027-09-01","supply_end_date":"2026-10-23"}');
    insert into public.contract_price_snapshots values ('${SNAP}','${C}','${CT}','2026-09-01',null,'{"price_area":"SE3"}');
  `)
  await db.exec(`CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(p_company_id uuid, p_underlay_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $pre$${basisPreImage()}$pre$;`)
  await db.exec(slice1)
  await db.exec(slice2)
  if (withG1) await db.exec(g1)
}

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
/** An approved 300 SEK fee, underlaid, locked (one ledger event) and invoiced through its own underlay. */
async function invoicedCharge() {
  const charge = (await q<{ r: { chargeId: string } }>(`select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r`, [C, TASK, JSON.stringify({
    customer_category: 'consumer', category_basis: { type: 'private' }, amount_ex_vat: 300, loss_basis: { source: 'x' },
    calculation: { components: ['price_difference'], fixed_price_ore_per_kwh: 120, replacement_price_ore_per_kwh: 90, remaining_expected_kwh: 1500 },
    vat_classification: { code: 'etc', vat_rate: 0.25, account: '3990', verified_by: 'a', verified_at: '2026-10-25', source: 's' } }), ACTOR]))[0].r.chargeId
  const underlay = (await q<{ r: { billingUnderlayId: string } }>('select public.gridex_underlay_break_fee_v1($1,$2,$3) r', [C, charge, ACTOR]))[0].r.billingUnderlayId
  await q(`insert into public.contract_charge_ledger(company_id,customer_contract_id,component_key,event_key,amount_ex_vat) values ($1,$2,'break_fee',$3,300)`, [C, CT, charge])
  const invoice = (await q<{ id: string }>(`insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat,vat_amount,amount_inc_vat)
    values ($1,$2,$3,300,75,375) returning id`, [C, CU, underlay]))[0].id
  return { charge, underlay, invoice }
}
const request = async (charge: string, input: Record<string, unknown>, actor = ACTOR, company = C) =>
  (await q<{ r: { creditId: string; billingUnderlayId: string; adjustmentCaseId: string; amountExVat: number } }>(
    'select public.gridex_request_break_fee_credit_v1($1,$2,$3,$4) r', [company, charge, JSON.stringify(input), actor]))[0].r
const creditInvoice = (underlay: string, exVat: number) => q<{ id: string; metadata: Record<string, unknown> }>(
  `insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat,vat_amount,amount_inc_vat)
   values ($1,$2,$3,$4,$5,$6) returning id, metadata`, [C, CU, underlay, exVat, exVat * 0.25, exVat * 1.25])
const charge = async (id: string) => (await q('select status, credited_amount_ex_vat::float8 credited, credit_invoice_id from public.break_fee_charges where id=$1', [id]))[0]
const basis = async (u: string) => {
  await db.exec('set role service_role')
  try { return (await q<{ r: Array<{ qualified: boolean }> }>("select public.gridex_read_billing_underlay_source_basis_v1($1, array[$2]::uuid[]) r", [C, u]))[0].r[0] }
  finally { await db.exec('reset role') }
}


// Full source write boundary is real. Terminal legacy graph creator below is an explicit
// recording double: this suite tests source eligibility/transaction rollback, not the full invoice graph.
function actualDefinition(name: string) {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (start < 0) throw Error('actual_function_missing:' + name)
  const tail = schema.slice(start)
  const body = /AS (\$[^$]*\$)[\s\S]*?\1;/.exec(tail)
  if (!body) throw Error('actual_definition_unterminated')
  return tail.slice(0, body.index + body[0].length)
}
const forwardPath = 'supabase/migrations/20261029140000_finance_d11_export_source_qualification.sql'
const forward = () => existsSync(path.join(root, forwardPath)) ? read(forwardPath) : null
async function installBoundary() {
  await db.exec(`
    alter table public.billing_underlays add column supply_period_id uuid;
    alter table gridex_billing_source.underlay_bindings add column exact_total_kwh numeric;
    alter table gridex_billing_source.underlay_bindings add column source_basis jsonb;
    create schema gridex_received_sources;
    create table public.source_boundary_calls(kind text, underlay_id uuid);
    create function public.ediel_require_invoice_source_copies_available_v1(c uuid,u uuid) returns void language plpgsql as $$
    begin
      if current_setting('finance_test.retention_denied',true)='yes' then raise exception 'retention_copy_unavailable' using errcode='23514'; end if;
      insert into public.source_boundary_calls values('retention',u);
    end $$;
    create function gridex_received_sources.billing_supply_basis_v1(c uuid,s uuid,a timestamptz,z timestamptz) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function gridex_billing_source.gridex_create_billing_export_run_before_source_v2(p_run jsonb,p_items jsonb) returns jsonb language plpgsql as $$
    begin insert into public.source_boundary_calls values('legacy',null);return jsonb_build_object('created',true);end $$;
    drop function gridex_billing_source.require_underlay_v1(uuid,uuid);
  `)
  await db.exec(actualDefinition('gridex_billing_source.require_underlay_v1'))
  await db.exec(actualDefinition('public.gridex_create_billing_export_run'))
  // Baseline grants are from the actual historical wrapper migration.
  await db.exec(`revoke all on function public.gridex_create_billing_export_run(jsonb,jsonb) from public,anon,authenticated;
    grant execute on function public.gridex_create_billing_export_run(jsonb,jsonb) to service_role;`)
  const sql = forward()
  if (sql) await db.exec(sql)
}
async function exportReady(underlays: string[], company = C, role = 'service_role') {
  await db.exec('set role ' + role)
  try { return (await q<{ r: unknown }>('select public.gridex_create_billing_export_run($1,$2) r', [JSON.stringify({company_id:company}),JSON.stringify(underlays.map(id=>({status:'ready',billing_underlay_id:id})))]))[0].r }
  finally { await db.exec('reset role') }
}
async function feeUnderlay() {
  const approval = (await q<{r:{chargeId:string}}>('select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r',[C,TASK,JSON.stringify({customer_category:'consumer',category_basis:{type:'private'},amount_ex_vat:300,loss_basis:{source:'synthetic'},calculation:{components:['price_difference'],fixed_price_ore_per_kwh:120,replacement_price_ore_per_kwh:90,remaining_expected_kwh:1500},vat_classification:{code:'synthetic',vat_rate:0.25,account:'3990',verified_by:'synthetic',verified_at:'2026-10-29',source:'synthetic'}}),ACTOR]))[0].r
  const u=(await q<{r:{billingUnderlayId:string}}>('select public.gridex_underlay_break_fee_v1($1,$2,$3) r',[C,approval.chargeId,ACTOR]))[0].r
  return {charge:approval.chargeId,underlay:u.billingUnderlayId}
}
afterEach(async()=>{await db?.close()})
describe('D11 actual native source-write contract',()=>{
  beforeEach(async()=>{await setup();await installBoundary()})
  it('a native approved event fee qualifies at the actual write boundary without fabricated metering',async()=>{
    const f=await feeUnderlay();expect((await basis(f.underlay)).qualified).toBe(true)
    expect(await exportReady([f.underlay])).toEqual({created:true})
    expect((await q("select count(*)::int n from public.source_boundary_calls where kind='retention'"))[0].n).toBe(1)
    expect((await q('select count(*)::int n from gridex_billing_source.underlay_bindings'))[0].n).toBe(0)
  })
  it('a native credit bound to its original invoice qualifies at the same write boundary',async()=>{
    const f=await invoicedCharge();const cr=await request(f.charge,{reason:'synthetic reversal'})
    expect((await basis(cr.billingUnderlayId)).qualified).toBe(true)
    expect(await exportReady([cr.billingUnderlayId])).toEqual({created:true})
    expect((await q("select count(*)::int n from public.source_boundary_calls where kind='retention'"))[0].n).toBe(1)
  })
  it('normal metered underlays still fail when finalized physical basis is absent',async()=>{
    const u=(await q<{id:string}>("insert into public.billing_underlays(company_id,customer_id,payload,total_kwh) values($1,$2,'{}',1) returning id",[C,CU]))[0].id
    await expect(exportReady([u])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('a forged event payload does not qualify without a native bound charge',async()=>{
    const u=(await q<{id:string}>("insert into public.billing_underlays(company_id,customer_id,payload,total_kwh) values($1,$2,$3,0) returning id",[C,CU,JSON.stringify({charge_kind:'break_fee',break_fee_charge_id:TASK})]))[0].id
    await expect(exportReady([u])).rejects.toThrow()
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('foreign tenant and missing charge fail without a legacy graph write',async()=>{
    const f=await feeUnderlay();await expect(exportReady([f.underlay],OTHER)).rejects.toThrow()
    expect((await q("select count(*)::int n from public.source_boundary_calls where kind='legacy'"))[0].n).toBe(0)
  })
  it('event qualification cannot bypass actual retention source-copy availability',async()=>{
    const f=await feeUnderlay();await db.exec("set finance_test.retention_denied='yes'")
    await expect(exportReady([f.underlay])).rejects.toThrow('retention_copy_unavailable')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('application callers cannot invoke the native write wrapper',async()=>{
    const f=await feeUnderlay();await expect(exportReady([f.underlay],C,'authenticated')).rejects.toThrow(/permission denied|service_role_required/)
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('a mixed batch with an invalid meter underlay rolls back earlier event qualification',async()=>{
    const f=await feeUnderlay();const u=(await q<{id:string}>("insert into public.billing_underlays(company_id,customer_id,payload,total_kwh) values($1,$2,'{}',1) returning id",[C,CU]))[0].id
    await expect(exportReady([f.underlay,u])).rejects.toThrow()
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('full native credit lifecycle retains the original debit proof and both immutable invoice rows',async()=>{
    const f=await invoicedCharge();const original=(await q('select * from public.customer_invoices where id=$1',[f.invoice]))[0]
    const cr=await request(f.charge,{reason:'full native reversal'});await creditInvoice(cr.billingUnderlayId,-300)
    expect(await charge(f.charge)).toMatchObject({status:'credited',credited:300})
    expect((await basis(f.underlay)).qualified).toBe(true)
    expect(await exportReady([f.underlay,cr.billingUnderlayId])).toEqual({created:true})
    expect((await q('select * from public.customer_invoices where id=$1',[f.invoice]))[0]).toEqual(original)
    expect((await q("select count(*)::int n from public.source_boundary_calls where kind='retention'"))[0].n).toBe(2)
  })
  it('partial native credit lifecycle retains original debit qualification',async()=>{
    const f=await invoicedCharge();const cr=await request(f.charge,{amount_ex_vat:100,reason:'partial native reversal'});await creditInvoice(cr.billingUnderlayId,-100)
    expect(await charge(f.charge)).toMatchObject({status:'partially_credited',credited:100})
    expect((await basis(f.underlay)).qualified).toBe(true)
    expect(await exportReady([f.underlay,cr.billingUnderlayId])).toEqual({created:true})
  })
  it.each([
    ["total_kwh=1"], ["source_system='normalized_metering_values'"],
    ["energy_direction='production'"], ["settlement_type='credit_invoice'"]
  ])('event fee cannot qualify with an invalid event shape: %s',async(patch)=>{
    const f=await feeUnderlay();await db.exec('update public.billing_underlays set '+patch+" where id='"+f.underlay+"'")
    await expect(exportReady([f.underlay])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('canceled native fee and payload of another underlay do not qualify',async()=>{
    const f=await feeUnderlay();await q("update public.break_fee_charges set status='cancelled' where id=$1",[f.charge])
    await expect(exportReady([f.underlay])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('candidate rerun preserves all function metadata and the private physical guard',async()=>{
    const before=await q("select oid, to_jsonb(p)-'prosrc' metadata, prosrc from pg_proc p where oid in ('public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure,'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure,'gridex_billing_source.require_underlay_v1(uuid,uuid)'::regprocedure) order by oid")
    expect(forward()).not.toBeNull();await db.exec(forward()!)
    const after=await q("select oid, to_jsonb(p)-'prosrc' metadata, prosrc from pg_proc p where oid in ('public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure,'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure,'gridex_billing_source.require_underlay_v1(uuid,uuid)'::regprocedure) order by oid")
    expect(after).toEqual(before)
    const actual=actualDefinition('gridex_billing_source.require_underlay_v1');const original=/AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(actual)![2]
    expect((await q<{prosrc:string}>("select prosrc from pg_proc where oid='gridex_billing_source.require_underlay_v1(uuid,uuid)'::regprocedure"))[0].prosrc).toBe(original)
  })
  it('the migration rejects a genuine application-role session before modifying source',async()=>{
    await db.exec('set role authenticated')
    expect((await q<{u:string,s:string}>('select current_user u,session_user s'))[0]).toMatchObject({u:'authenticated'})
    try{await expect(db.exec(forward()!)).rejects.toThrow('finance_d11_owner_session_required')}
    finally{await db.exec('rollback;reset role')}
    const f=await feeUnderlay();expect(await exportReady([f.underlay])).toEqual({created:true})
  })

  it.each([
    ["customer_id='99999999-9999-4999-8999-999999999999'"],
    ["contract_id='99999999-9999-4999-8999-999999999999'"],
    ["customer_contract_id='99999999-9999-4999-8999-999999999999'"],
    ["currency='EUR'"]
  ])('debit event requires its native customer/contract/currency: %s',async(patch)=>{
    const f=await feeUnderlay();await db.exec('update public.billing_underlays set '+patch+" where id='"+f.underlay+"'")
    await expect(exportReady([f.underlay])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it.each(['original_invoice_id','original_billing_underlay_id','adjustment_case_id','break_fee_charge_id','break_fee_credit_id'])('credit payload requires its exact native predecessor proof: %s',async(key)=>{
    const f=await invoicedCharge();const cr=await request(f.charge,{reason:'native predecessor proof'})
    await q("update public.billing_underlays set payload=jsonb_set(payload,array[$2]::text[],to_jsonb($3::text)) where id=$1",[cr.billingUnderlayId,key,OTHER])
    await expect(exportReady([cr.billingUnderlayId])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })
  it('credit native adjustment relationship cannot point to another predecessor underlay',async()=>{
    const f=await invoicedCharge();const cr=await request(f.charge,{reason:'native adjustment proof'})
    await q('update public.billing_adjustment_cases set corrected_billing_underlay_id=$2 where id=$1',[cr.adjustmentCaseId,f.underlay])
    await expect(exportReady([cr.billingUnderlayId])).rejects.toThrow('billing_finalized_source_basis_required')
    expect((await q('select count(*)::int n from public.source_boundary_calls'))[0].n).toBe(0)
  })

})
