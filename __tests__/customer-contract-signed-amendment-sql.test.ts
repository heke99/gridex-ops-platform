import fs from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterEach,afterAll,expect,it} from 'vitest'
const schema=fs.readFileSync('supabase/schema.sql','utf8')
const migration='supabase/migrations/20261102212140_signed_customer_contract_amendment.sql'
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let db:PGlite
let effective:string
function actualTable(name:string) {
 const text=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
 if(!text) throw new Error('actual table missing: '+name)
 return text
}
function actualFunction(name:string) {
 const start=schema.indexOf(`CREATE FUNCTION public.${name}(`)
 if(start<0) throw new Error('actual function missing: '+name)
 const rest=schema.slice(start),tag=/AS (\$[^$]*\$)/.exec(rest)!
 return rest.slice(0,rest.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';'
}
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
 create table test_permissions(company_id uuid,actor_id uuid,permission text,denied boolean default false);
 create function public.gridex_actor_has_company_permission(a uuid,c uuid,p text) returns boolean language sql as $$
 select exists(select from public.test_permissions where company_id=c and actor_id=a and permission=p and not denied)
 and not exists(select from public.test_permissions where actor_id=a and permission=p and denied)$$;
 create function public.gridex_get_user_permissions_in_company(a uuid,c uuid) returns text[] language sql as $$
 select array_agg(permission) from public.test_permissions where company_id=c and actor_id=a and not denied$$;
 create function public.canonical_json_sha256(value jsonb) returns text language sql immutable strict as $$select encode(sha256(convert_to(value::text,'utf8')),'hex')$$;`)
 for(const name of ['gridex_normalize_org_number','gridex_normalize_personal_number','gridex_normalize_email','gridex_normalize_phone','gridex_normalize_facility_id','gridex_normalize_metering_point_id','gridex_new_public_resource_reference','gridex_new_external_tenant_reference']) await db.exec(actualFunction(name))
 for(const name of ['companies','customers','customer_sites','metering_points','company_memberships','customer_contracts','contract_price_snapshots','customer_contract_signature_requests','billing_underlays','customer_supply_periods','customer_contract_evidence','customer_operation_jobs','supplier_switch_requests']) {
  await db.exec(actualTable(name));await db.exec(`alter table public.${name} add primary key(id)`)
 }
 await db.exec(`create schema gridex_billing_source;create table gridex_billing_source.underlay_bindings(underlay_id uuid primary key);
 create table physical_source_sentinel(id uuid primary key,payload jsonb);
 create schema gridex_received_sources;create table public.test_supply_qualification(ok boolean);
 create schema gridex_bilateral_prodat;create schema gridex_regulated_supply;
 create table public.test_graph_lock_order(stage text);
 create function gridex_bilateral_prodat.lock_supply_v1() returns void language plpgsql as $$begin
 insert into public.test_graph_lock_order values('supply_graph');end$$;
 create function gridex_regulated_supply.lock_graph_v1() returns void language plpgsql as $$begin
 insert into public.test_graph_lock_order values('regulated_graph');end$$;
 -- Declared finite physical-source authority port. No original regulated
 -- source/ground or complete native qualification is claimed by these controls.
 create function gridex_received_sources.billing_supply_basis_v1(c uuid,p uuid,s timestamptz,e timestamptz) returns jsonb
 language sql as $$select case when (select ok from public.test_supply_qualification) then jsonb_build_object(
 'qualified',true,'periodId',sp.id,'companyId',sp.company_id,'customerId',sp.customer_id,'meteringPointId',sp.metering_point_id,'sourceSHA256',repeat('c',64)) end
 from public.customer_supply_periods sp where sp.id=p and sp.company_id=c$$;`)
 await db.exec(fs.readFileSync(migration,'utf8').split('-- BEGIN GUARDED EXISTING NATIVE COUPLING')[0]+'\ncommit;')
},30000)
afterAll(async()=>{if(db) await db.close()})
beforeEach(async()=>{
 await db.exec(`begin;set test.role='service_role';
 insert into companies(id,name,is_active,status,lifecycle_status) values('${id(1)}','Synthetic',true,'active','active');
 insert into customers(id,company_id,status) values('${id(2)}','${id(1)}','active');
 insert into customer_sites(id,company_id,customer_id) values('${id(3)}','${id(1)}','${id(2)}');
 insert into metering_points(id,company_id,site_id) values('${id(4)}','${id(1)}','${id(3)}');
 insert into company_memberships(id,company_id,user_id,status,is_active) values('${id(8)}','${id(1)}','${id(7)}','active',true);
 insert into test_permissions select '${id(1)}','${id(7)}',p,false from unnest(array['contracts.write','contracts.create']) p;
 insert into physical_source_sentinel values('${id(50)}','{"supplyContract":"original","ground":"archived"}');`)
 effective=(await db.query<{effective_day:string}>(`select to_char(date_trunc('month',clock_timestamp() at time zone 'Europe/Stockholm')+interval '1 month','YYYY-MM-DD') as effective_day`)).rows[0].effective_day
 await db.exec('insert into test_supply_qualification values(true)')
 for(const [contract,status,snapshot] of [[id(5),'signed',id(15)],[id(6),'draft',id(16)]] as const) {
  await db.query(`insert into customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status,signed_at,locked_at,starts_at,contract_type,energy_direction,binding_months,notice_months,monthly_fee_sek,vat_rate,contract_price_snapshot_id,price_plan_version_id,contract_offer_id,price_snapshot,signature_snapshot,signature_snapshot_sha256)
   values($1,$2,$3,$4,$4,$5,$6,case when $6='signed' then clock_timestamp() end,case when $6='signed' then clock_timestamp() end,$7::timestamptz,'variable_monthly','consumption',null,1,39,0.25,$8,$9,$10,'{"terms":"canonical"}',case when $6='signed' then '{"accepted":"old"}'::jsonb else '{}'::jsonb end,case when $6='signed' then public.canonical_json_sha256('{"accepted":"old"}') end)`,
   [contract,id(1),id(2),id(3),id(4),status,status==='signed'?'2026-01-01':effective,snapshot,id(20),id(21)])
  await db.query(`insert into contract_price_snapshots(id,company_id,customer_id,contract_id,price_plan_version_id,snapshot_json,snapshot_hash,snapshot_quality,valid_from)
   values($1,$2,$3,$4,$5,'{"terms":"canonical"}',public.canonical_json_sha256('{"terms":"canonical"}'),'canonical',$6::date)`,[snapshot,id(1),id(2),contract,id(20),status==='signed'?'2026-01-01':effective])
 }
})
afterEach(async()=>{await db.exec('rollback')})
async function propose(patch:{company?:string;actor?:string;request?:string;successor?:string;date?:string;reason?:string;ack?:boolean}={}) {
 return (await db.query<{result:Record<string,unknown>}>(`select public.gridex_propose_signed_contract_amendment_v1($1,$2,$3,$4,$5::date,$6,$7,$8,$9) result`,
  [patch.company??id(1),id(2),id(5),patch.successor??id(6),patch.date??effective,patch.actor??id(7),patch.request??id(9),patch.reason??'Kundens nya avtal',patch.ack??true])).rows[0].result
}
async function refused(action:()=>Promise<unknown>,code='23514') {
 await db.exec('savepoint refusal');await expect(action()).rejects.toMatchObject({code});await db.exec('rollback to savepoint refusal')
}
it('records only a proposed immutable change and preserves predecessor, snapshot and physical source bytes',async()=>{
 const before=await db.query(`select to_jsonb(c) contract from customer_contracts c where id='${id(5)}'`)
 const oldPrice=await db.query(`select to_jsonb(c) snapshot from contract_price_snapshots c where id='${id(15)}'`)
 const physical=await db.query('select * from physical_source_sentinel')
 expect(await propose()).toMatchObject({state:'PROPOSED_NOT_ACCEPTED',predecessorContractId:id(5),successorContractId:id(6),effectiveFrom:effective})
 expect(await db.query(`select to_jsonb(c) contract from customer_contracts c where id='${id(5)}'`)).toEqual(before)
 expect(await db.query(`select to_jsonb(c) snapshot from contract_price_snapshots c where id='${id(15)}'`)).toEqual(oldPrice)
 expect(await db.query('select * from physical_source_sentinel')).toEqual(physical)
 expect((await db.query(`select status,signed_at from customer_contracts where id='${id(6)}'`)).rows).toEqual([{status:'draft',signed_at:null}])
})
it('replays only the exact command after current local permission checks',async()=>{
 const first=await propose();expect(await propose()).toEqual(first)
 await refused(()=>propose({reason:'Changed command'}),'22023')
 await db.exec(`update test_permissions set denied=true where permission='contracts.write'`)
 await refused(()=>propose(),'42501')
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:1}])
})
it('does not treat a platform-style permission port as active tenant membership',async()=>{
 await db.exec('delete from company_memberships')
 await refused(()=>propose(),'42501')
})
it.each(['anon','authenticated'])('rejects non-server role %s',async role=>{
 await db.exec(`set test.role='${role}'`);await refused(()=>propose(),'42501')
})
it('rejects wrong tenant, same version, missing acknowledgement and stale or non-boundary dates',async()=>{
 await refused(()=>propose({company:id(99)}),'42501')
 await refused(()=>propose({successor:id(5)}))
 await refused(()=>propose({ack:false}),'22023')
 await refused(()=>propose({date:'2020-01-01'}))
 await refused(()=>propose({date:effective.slice(0,8)+'02'}))
})
it('refuses locked billing overlap, one-off fees or changed immutable CPS hash',async()=>{
 await db.exec(`insert into billing_underlays(id,company_id,customer_id,metering_point_id,contract_id,billing_period_start,billing_period_end) values('${id(40)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','${effective}','${effective}'::date+interval '1 month');insert into gridex_billing_source.underlay_bindings values('${id(40)}')`)
 await refused(()=>propose());await db.exec('delete from gridex_billing_source.underlay_bindings;delete from billing_underlays')
 await db.exec(`update customer_contracts set start_fee_sek=99 where id='${id(6)}'`)
 await refused(()=>propose());await db.exec(`update customer_contracts set start_fee_sek=0 where id='${id(6)}'`)
 await db.exec(`update contract_price_snapshots set snapshot_hash='${'f'.repeat(64)}' where id='${id(16)}'`)
 await refused(()=>propose())
})
it('never enables signing, imported signing or active status before full acceptance integration',async()=>{
 await propose()
 for(const assignment of ["status='signed'","status='active'","signed_at=clock_timestamp()","status='signed',signature_snapshot='{}',signature_snapshot_sha256='"+'a'.repeat(64)+"'"]) {
  await refused(()=>db.exec(`update customer_contracts set ${assignment} where id='${id(6)}'`),'55000')
 }
})
it('preserves the proposal against update, delete and truncate',async()=>{
 await propose()
 for(const sql of ['update gridex_contract_amendment.proposals set reason=\'changed\'','delete from gridex_contract_amendment.proposals','truncate gridex_contract_amendment.proposals cascade']) await refused(()=>db.exec(sql),'55000')
})

it('refuses forks and stale material without rewriting the first proposal',async()=>{
 const first=await propose()
 await refused(()=>propose({request:id(10)}),'23514')
 await refused(()=>db.exec(`update customer_contracts set monthly_fee_sek=49 where id='${id(6)}'`),'55000')
 expect(await propose()).toEqual(first)
 await db.exec(`update contract_price_snapshots set snapshot_json='{"changed":"later"}' where id='${id(16)}'`)
 await refused(()=>propose())
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:1}])
})
it('never grants direct proposal access or public execution authority',async()=>{
 const signature='public.gridex_propose_signed_contract_amendment_v1(uuid,uuid,uuid,uuid,date,uuid,uuid,text,boolean)'
 for(const role of ['anon','authenticated']) {
  expect((await db.query<{allowed:boolean}>(`select has_function_privilege($1,$2,'execute') allowed`,[role,signature])).rows[0].allowed).toBe(false)
 }
 expect((await db.query<{allowed:boolean}>(`select has_table_privilege('service_role','gridex_contract_amendment.proposals','select,insert,update,delete,truncate') allowed`)).rows[0].allowed).toBe(false)
 expect((await db.query<{allowed:boolean}>(`select has_function_privilege('service_role',$1,'execute') allowed`,[signature])).rows[0].allowed).toBe(true)
})
it('the proposal guard does not author an ordinary non-amendment signature',async()=>{
 await db.exec(`update customer_contracts set monthly_fee_sek=41 where id='${id(6)}'`)
 expect((await db.query(`select monthly_fee_sek::text amount from customer_contracts where id='${id(6)}'`)).rows).toEqual([{amount:'41'}])
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:0}])
})

async function physicalPeriod() {
 await db.exec(`insert into customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,start_date,status)
 values('${id(60)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','2026-01-01','active')`)
}
async function segments(company=id(1)) {
 return (await db.query<{result:Record<string,unknown>}>(`select public.gridex_read_contract_commercial_segments_v1($1,$2,$3::date::timestamp at time zone 'Europe/Stockholm',($3::date+interval '1 month') at time zone 'Europe/Stockholm') result`,[company,id(60),effective])).rows[0].result
}
it('unaccepted proposals never replace the physical commercial root',async()=>{
 await physicalPeriod();await propose()
 const before=await db.query('select to_jsonb(p) row from customer_supply_periods p')
 const result=await segments()
 expect(result).toMatchObject({schema:'gridex-contract-commercial-segments-v1',physicalContractId:id(5),supplyPeriodId:id(60),companyId:id(1),customerId:id(2),meteringPointId:id(4),segments:[{contractId:id(5),priceSnapshotId:null,acceptanceSHA256:null}]})
 expect(result.assignmentSHA256).toMatch(/^[0-9a-f]{64}$/)
 expect(await db.query('select to_jsonb(p) row from customer_supply_periods p')).toEqual(before)
})
it('commercial reads require the actual qualified physical source port and exact tenant',async()=>{
 await physicalPeriod()
 await db.exec('update test_supply_qualification set ok=false')
 await refused(()=>segments())
 await db.exec('update test_supply_qualification set ok=true')
 await refused(()=>segments(id(99)))
})
it('commercial RPC remains service-only and never manufactures an acceptance',async()=>{
 await physicalPeriod();await segments()
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
 await db.exec("set test.role='authenticated'")
 await refused(()=>segments(),'42501')
})

/** Declared historical acceptance input port for READ-ONLY resolver controls.
 * Runs as the isolated component DB owner. It is not a product signing command,
 * genuine customer acceptance, native source proof or whole scenario PASS. */
async function acceptedModel(corrupt=false) {
 await db.exec('savepoint accepted_model')
 await propose()
 const proposal=(await db.query<{p:Record<string,unknown>}>('select to_jsonb(p) p from gridex_contract_amendment.proposals p')).rows[0].p
 const context=(await db.query<{context:Record<string,unknown>}>(`select gridex_contract_amendment.context_v1('${id(9)}') context`)).rows[0].context
 await db.exec('rollback to savepoint accepted_model')
 await db.query(`update customer_contracts set status='signed',signed_at=clock_timestamp(),locked_at=clock_timestamp(),
 signature_snapshot=jsonb_build_object('schema','gridex_online_contract_signature_v2','amendment_context',$1::jsonb) where id=$2`,[JSON.stringify(context),id(6)])
 await db.exec(`update customer_contracts set signature_snapshot_sha256=public.canonical_json_sha256(signature_snapshot) where id='${id(6)}'`)
 await db.query(`insert into gridex_contract_amendment.proposals select * from jsonb_populate_record(null::gridex_contract_amendment.proposals,$1::jsonb)`,[JSON.stringify(proposal)])
 await db.query(`insert into gridex_contract_amendment.acceptances(proposal_id,signature_snapshot,signature_sha256,accepted_at,acceptance_context,acceptance_sha256)
 select $1,c.signature_snapshot,case when $3 then repeat('f',64) else c.signature_snapshot_sha256 end,c.signed_at,$2::jsonb,
 public.canonical_json_sha256(jsonb_build_object('context',$2::jsonb,'signatureSHA256',c.signature_snapshot_sha256,'acceptedAt',c.signed_at)) from customer_contracts c where c.id=$4`,[id(9),JSON.stringify(context),corrupt,id(6)])
}
it('selects the exact accepted commercial version while preserving the same original physical period',async()=>{
 await physicalPeriod();await acceptedModel()
 const physical=await db.query('select to_jsonb(p) row from customer_supply_periods p')
 const result=await segments()
 expect(result).toMatchObject({physicalContractId:id(5),supplyPeriodId:id(60),segments:[{contractId:id(6),priceSnapshotId:id(16)}]})
 expect((result.segments as Array<Record<string,unknown>>)[0].acceptanceSHA256).toMatch(/^[0-9a-f]{64}$/)
 expect(await db.query('select to_jsonb(p) row from customer_supply_periods p')).toEqual(physical)
})
it('binds the relevant accepted prefix but excludes a boundary at exclusive end from the historical assignment hash',async()=>{
 await physicalPeriod()
 const query=`select public.gridex_read_contract_commercial_segments_v1($1,$2,($3::date-interval '1 month') at time zone 'Europe/Stockholm',$3::date::timestamp at time zone 'Europe/Stockholm') result`
 const before=(await db.query<{result:Record<string,unknown>}>(query,[id(1),id(60),effective])).rows[0].result
 await acceptedModel()
 const after=(await db.query<{result:Record<string,unknown>}>(query,[id(1),id(60),effective])).rows[0].result
 expect(after).toEqual(before)
})
it('refuses a corrupt accepted input instead of falling back to the root contract',async()=>{
 await physicalPeriod();await acceptedModel(true)
 await refused(()=>segments())
})

it('takes native source graph locks before source qualification instead of introducing a row-to-graph inversion',async()=>{
 await physicalPeriod();await segments()
 expect((await db.query('select stage from test_graph_lock_order')).rows).toEqual([{stage:'supply_graph'},{stage:'regulated_graph'}])
})

async function replacementDraft() {
 await db.exec(`insert into customer_contracts select * from jsonb_populate_record(null::customer_contracts,
 (select to_jsonb(c)||jsonb_build_object('id','${id(66)}','status','draft','contract_price_snapshot_id','${id(166)}','customer_contract_reference','new-replacement') from customer_contracts c where id='${id(6)}'));
 insert into contract_price_snapshots select * from jsonb_populate_record(null::contract_price_snapshots,
 (select to_jsonb(p)||jsonb_build_object('id','${id(166)}','contract_id','${id(66)}') from contract_price_snapshots p where id='${id(16)}'))`)
}
it('permits a fresh proposal after an actually unsigned cancelled proposal while preserving its immutable original',async()=>{
 await propose()
 await db.exec(`update customer_contracts set status='cancelled' where id='${id(6)}'`)
 await replacementDraft()
 expect(await propose({successor:id(66),request:id(10)})).toMatchObject({state:'PROPOSED_NOT_ACCEPTED',successorContractId:id(66)})
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:2}])
})
it('refuses a replacement while the first unsigned proposal is still genuinely active',async()=>{
 await propose();await replacementDraft()
 await refused(()=>propose({successor:id(66),request:id(10)}))
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:1}])
})

async function commercialBinding(contract=id(5),snapshot=id(15),startOffset='0 month',endOffset='1 month') {
 return (await db.query<{binding:Record<string,unknown>|null}>(`select gridex_contract_amendment.commercial_binding_v1($1,$2,($3::date+$6::interval) at time zone 'Europe/Stockholm',($3::date+$7::interval) at time zone 'Europe/Stockholm',$4,$5) binding`,[id(1),id(60),effective,contract,snapshot,startOffset,endOffset])).rows[0].binding
}
it('native consumers preserve the legacy source hash shape but reject a stale root or wrong successor CPS after acceptance',async()=>{
 await physicalPeriod()
 expect(await commercialBinding()).toBeNull()
 await acceptedModel()
 await refused(()=>commercialBinding())
 await refused(()=>commercialBinding(id(6),id(15)))
 expect(await commercialBinding(id(6),id(16))).toMatchObject({physicalContractId:id(5),segments:[{contractId:id(6),priceSnapshotId:id(16)}]})
})
it('native commercial binding keeps the historical pre-boundary root and refuses a multi-version interval without inventing allocation',async()=>{
 await physicalPeriod();await acceptedModel()
 expect(await commercialBinding(id(5),id(15),'-1 month','0 month')).toBeNull()
 await refused(()=>commercialBinding(id(6),id(16),'-1 month','1 month'))
})

async function meteringChoice(onDate=effective) {
 return (await db.query<{result:Record<string,unknown>}>(`select public.gridex_read_contract_amendment_choices_v1($1,array[$2::uuid],$3::date) result`,[id(1),id(4),onDate])).rows[0].result
}
it('metering requirements exclude registered unsigned amendments from current terms',async()=>{
 await propose()
 expect(await meteringChoice()).toMatchObject({excludedAmendmentContractIds:[id(6)],choices:[]})

})
it('metering requirement choice preserves the root before the future boundary and loads exact accepted CPS on the boundary',async()=>{
 await acceptedModel()
 expect(await meteringChoice('2026-01-01')).toMatchObject({choices:[{meteringPointId:id(4),rootContractId:id(5),contractId:id(5),priceSnapshotId:null,priceSHA256:null}]})
 expect(await meteringChoice()).toMatchObject({choices:[{meteringPointId:id(4),rootContractId:id(5),contractId:id(6),priceSnapshotId:id(16)}]})
 await refused(()=>meteringChoice('infinity'))
})

it('atomically revokes every unused pre-amendment link so an old plain link cannot accept different context',async()=>{
 await db.exec(`insert into customer_contract_signature_requests(id,company_id,customer_id,customer_contract_id,token_hash,recipient_email,expires_at) values('${id(30)}','${id(1)}','${id(2)}','${id(6)}','${'a'.repeat(64)}','test@example.invalid',now()+interval '1 day')`)
 await propose()
 expect((await db.query('select revoked_at is not null revoked,used_at is null unused from customer_contract_signature_requests')).rows).toEqual([{revoked:true,unused:true}])
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
})

it('the amendment-choice read rejects missing or foreign point scope and remains service-only',async()=>{
 await refused(()=>db.query(`select public.gridex_read_contract_amendment_choices_v1($1,array[$2::uuid,$3::uuid],$4::date)`,[id(1),id(4),id(99),effective]))
 await db.exec("set test.role='authenticated'")
 await refused(()=>meteringChoice(),'42501')
})
it('preserves a qualified unamended production root without inventing a consumption amendment policy',async()=>{
 await physicalPeriod();await db.exec(`update customer_contracts set energy_direction='production' where id='${id(5)}'`)
 expect(await commercialBinding()).toBeNull()
})
