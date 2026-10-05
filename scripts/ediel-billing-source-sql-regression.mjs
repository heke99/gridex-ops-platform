// Focused SQL compilation/source/atomic/immutable checks, not native replay.
// Inherited persisted-contract lookup and rule/legal basis are explicit fixture
// authorities; their production implementations require separate own evidence.
// DB-06 / AT-DB-06: exercise the actual protected billing input boundary. The
// seeded price/rule/supply ports do not certify production authority or custody.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', source = '22222222-2222-4222-8222-222222222222', value = '33333333-3333-4333-8333-333333333333', meter = '44444444-4444-4444-8444-444444444444', customer = '55555555-5555-4555-8555-555555555555', point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888', price = '99999999-9999-4999-8999-999999999999', priceVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let count = 0
const raw = "UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+260930:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0200:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735999260731000007::9'DTM+324:202607010000202608010000:719'DTM+354:1:802'M EA'".replace("M EA'", "MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:9007199254740993'UNT+12+1'UNZ+1+I'")
const observation = { ordinal: 0, sourceOrdinal: 0, quantity: '9007199254740993', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-07-31T22:00:00.000Z', unit: 'kWh', quality: '136', direction: 'consumption', productCode: null, registerCode: null }
const consumptionContract = { version: 2, observations: [observation], metering: { capability: 'write', customerId: customer, meteringPointId: point } }
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;create schema gridex_received_sources; create table gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);create schema gridex_ediel_source_rules;
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
 create table public.metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,value_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,is_current boolean,revision_status text,raw_payload jsonb,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz);
 create table public.normalized_metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,product_code text,register_code text,raw_payload jsonb,revision_status text,revision_number int,previous_value_id uuid,supply_period_id uuid,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz,updated_at timestamptz);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,status text,start_date date,end_date date);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,starts_at date,ends_at date);
 create table public.contract_price_snapshots(id uuid primary key,company_id uuid,contract_id uuid,price_plan_version_id uuid,snapshot_json jsonb,valid_from date,valid_to date);
 create table public.price_plan_versions(id uuid primary key,company_id uuid,status text,locked_at timestamptz,content_sha256 text);
 create table public.customers(id uuid primary key,company_id uuid);create table public.metering_points(id uuid primary key,company_id uuid);
 create table public.billing_underlays(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,supply_period_id uuid,contract_id uuid,pricing_snapshot_id uuid,price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,contract_price_snapshot_id uuid,billing_block_reason text,campaign_id uuid,price_area text,energy_direction text,settlement_type text,underlay_month int,underlay_year int,billing_period_start date,billing_period_end date,status text,readiness_status text,readiness_issues jsonb,total_kwh numeric,currency text,source_system text,source_meter_value_count int,missing_values_count int,payload jsonb,pricing_snapshot jsonb,received_at timestamptz,validated_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz);
 create unique index segment_unique on public.billing_underlays(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction);
 create table public.billing_underlay_items(id uuid primary key,billing_underlay_id uuid references public.billing_underlays(id),company_id uuid,source_normalized_metering_value_id uuid,quantity numeric,quantity_kwh numeric,unit text,product_code text,register_code text,period_start timestamptz,period_end timestamptz,created_at timestamptz,updated_at timestamptz);
 create table public.billing_underlay_events(company_id uuid,billing_underlay_id uuid,event_type text,message text,metadata jsonb,created_by uuid);
 create table public.fixture_contracts(company_id uuid,source_id uuid,tx text,contract jsonb);
 create function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) returns jsonb language sql as $$select contract from public.fixture_contracts where company_id=$1 and source_id=$2 and tx=$3$$;
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create table public.fixture_authorities(rule_available boolean,legal_available boolean);insert into public.fixture_authorities values(true,true);
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language plpgsql as $$begin if not(select rule_available from public.fixture_authorities) then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return '{"sourceHash":"fixture-original-only","version":"fixed-original"}';end$$;
 create function gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) returns jsonb language sql as $$select case when legal_available then jsonb_build_object('qualified',true,'periodId',$2,'marketStateVersion',1) else null end from public.fixture_authorities$$;
 create function public.gridex_create_billing_export_run(jsonb,jsonb default '[]') returns jsonb language sql as $$select $1$$;`)
const wireOld = fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
await db.exec(wireOld.slice(wireOld.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),wireOld.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
const decimal = fs.readFileSync(root+'/supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql','utf8')
await db.exec(decimal.slice(decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.canonical_decimal_v2'),decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_v1')))
const oldGate = fs.readFileSync(root+'/supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql','utf8')
await db.exec(oldGate.slice(oldGate.indexOf('create or replace function public.gridex_set_metering_billing_gate'),oldGate.indexOf('-- Every underlay segment')))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930175405_ediel_billing_qualified_exact_source_basis.sql','utf8'))
await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)',[source,company,'test','inbound','UTILTS','E66',raw,'validated'])
await db.query('insert into public.fixture_contracts values($1,$2,$3,$4)',[company,source,'OWN',JSON.stringify(consumptionContract)])
const rawPayload = JSON.stringify({consumptionContract, sourceOrdinal:0, edielMessageId:source})
await db.query(`insert into public.metering_values(id,company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,unit,direction,quality_code,source_ediel_message_id,source_transaction_reference,is_current,revision_status,raw_payload) values($1,$2,$3,$4,$5,$6,$7,'kWh','consumption','136',$8,'OWN',true,'current',$9)`,[meter,company,customer,point,observation.quantity,observation.periodStart,observation.periodEnd,source,rawPayload])
await db.query(`insert into public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,source_message_id,source_transaction_reference,quantity_kwh,period_start,period_end,unit,direction,quality_status,raw_payload,revision_status,revision_number,supply_period_id,billing_status,billing_gate_status) values($1,$2,$3,$4,$5,$6,'OWN',$7,$8,$9,'kWh','consumption','136',$10,'current',1,$11,'billable','eligible')`,[value,company,customer,point,meter,source,observation.quantity,observation.periodStart,observation.periodEnd,rawPayload,supply])
await db.exec(`insert into public.customers values('${customer}','${company}');insert into public.metering_points values('${point}','${company}');insert into public.customer_supply_periods values('${supply}','${company}','${customer}','${point}','${contract}','active','2026-07-01',null);insert into public.customer_contracts values('${contract}','${company}','${customer}','${point}','active','2026-07-01',null);insert into public.contract_price_snapshots values('${price}','${company}','${contract}','${priceVersion}','{"price":"original"}','2026-07-01',null);insert into public.price_plan_versions values('${priceVersion}','${company}','active',now(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`)
async function basis(){return(await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,value])).rows[0].b}
async function service(sql,args=[]){await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}}
async function rejects(fn,pattern){await assert.rejects(fn,pattern);count++}
for (const malformed of [raw.replace('202607010000202608010000','202602310000202603010000'),raw.replace('?+0200','?+0260')]) {
 const physical=(await db.query('select gridex_billing_source.observation_v1(gridex_utilts_binding.wire_tokens_v1($1),$2,0) b',[malformed,'OWN'])).rows[0].b;assert.equal(physical,null);count++
}
let b=await basis();assert.equal(b.qualified,true);assert.equal(b.quality,null);assert.equal(b.productCode,'8716867000030');assert.equal(b.registerCode,'REG');assert.equal(b.quantityKwh,observation.quantity);count++
let read=(await service('select public.gridex_read_billing_source_values_v1($1,$2) rows',[company,[value]])).rows[0].rows[0];assert.equal(read.quantity_kwh,observation.quantity);assert.equal(read.quality_status,null);assert.equal(read.product_code,'8716867000030');assert.equal((await db.query('select quality_status from public.normalized_metering_values')).rows[0].quality_status,'136');count++
await db.exec('update public.fixture_authorities set rule_available=false');assert.equal((await basis()).qualified,false);count++;await db.exec('update public.fixture_authorities set rule_available=true')
await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[raw.replace('23-DDQ-E66-T','23-DGI-E66-T'),source]);assert.equal((await basis()).qualified,false);count++;await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[raw,source])
await db.query('update public.normalized_metering_values set quantity_kwh=$1 where id=$2',['9007199254740992',value]);assert.equal((await basis()).qualified,false);count++;await db.query('update public.normalized_metering_values set quantity_kwh=$1 where id=$2',[observation.quantity,value])
await db.query('update public.normalized_metering_values set period_end=period_end+interval\'1 minute\' where id=$1',[value]);assert.equal((await basis()).qualified,false);count++;await db.query('update public.normalized_metering_values set period_end=$1 where id=$2',[observation.periodEnd,value])
const gate={billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer}
await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[raw.replace("QTY+136:9007199254740993'","QTY+136:9007199254740993'STS+8+56'"),source]);await rejects(()=>service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]),/qualified_final_source_required/);await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[raw,source])
await db.exec('update public.fixture_authorities set legal_available=false');await rejects(()=>service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]),/qualified_supply_source_required/);await db.exec('update public.fixture_authorities set legal_available=true')
await service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]);count++
const underlay={customer_id:customer,metering_point_id:point,supply_period_id:supply,contract_id:contract,pricing_snapshot_id:price,contract_price_snapshot_id:price,price_plan_version_id:priceVersion,pricing_snapshot:{price:'original'},underlay_year:2026,underlay_month:7,billing_period_start:observation.periodStart,billing_period_end:observation.periodEnd,energy_direction:'consumption',settlement_type:'invoice',total_kwh:observation.quantity,status:'validated',readiness_status:'ready'}
const items=[{source_normalized_metering_value_id:value,quantity:observation.quantity,quantity_kwh:observation.quantity,product_code:'8716867000030',register_code:'REG',unit:'kWh',period_start:observation.periodStart,period_end:observation.periodEnd}]
async function store(u=underlay,i=items){return(await service('select public.gridex_store_billing_underlay($1,$2,$3,null) id',[company,u,i])).rows[0].id}
async function noFinalizedEffects(){
 const totals=(await db.query(`select (select count(*) from public.billing_underlays) underlays,
  (select count(*) from public.billing_underlay_items) items,
  (select count(*) from gridex_billing_source.underlay_bindings) bindings,
  (select count(*) from gridex_billing_source.correction_journal) corrections`)).rows[0]
 assert.deepEqual(totals,{underlays:0,items:0,bindings:0,corrections:0})
}
// Cached individual eligibility cannot promote a forecast, aggregate or DGI
// original into a finalized invoice input, even with a retained write contract.
for (const [code,applicationReference,quantityType] of [
 ['S02','23-DDQ-S02-S','135'],['E31','23-DDQ-E31-T','136'],['E66','23-DGI-E66-T','136'],
]) {
 const original=raw.replace('23-DDQ-E66-T',applicationReference).replace('BGM+E66::260',`BGM+${code}::260`).replace('QTY+136:',`QTY+${quantityType}:`)
 await db.query('update public.ediel_messages set message_code=$1,raw_payload=$2 where id=$3',[code,original,source])
 assert.equal((await basis()).qualified,false)
 await rejects(()=>service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]),/qualified_final_source_required/)
 await rejects(()=>store(),/qualified_source_mismatch/)
 await noFinalizedEffects()
}
await db.query('update public.ediel_messages set message_code=$1,raw_payload=$2 where id=$3',['E66',raw,source])
// Every required dimension has a refusal contrast before the first final lock.
for (const original of [raw.replace('QTY+136:','QTY+135:'),raw.replace('8716867000030','8716867000047'),raw.replace("QTY+136:9007199254740993'","QTY+136:9007199254740993'STS+8+56'")]) {
 await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[original,source])
 await rejects(()=>store(),/qualified_source_mismatch/)
 await noFinalizedEffects()
}
await db.query('update public.ediel_messages set raw_payload=$1 where id=$2',[raw,source])
await db.query("update public.normalized_metering_values set revision_status='superseded' where id=$1",[value])
assert.equal((await basis()).qualified,false)
await rejects(()=>store(),/qualified_source_mismatch/)
await db.query("update public.normalized_metering_values set revision_status='current' where id=$1",[value])
await db.query('update public.metering_values set is_current=false where id=$1',[meter])
await rejects(()=>store(),/qualified_source_mismatch/)
await db.query('update public.metering_values set is_current=true where id=$1',[meter])
await rejects(()=>store(underlay,[{...items[0],product_code:'8716867000047'}]),/qualified_source_mismatch/)
await rejects(()=>store(underlay,[{...items[0],period_end:'2026-07-31T22:01:00.000Z'}]),/qualified_source_mismatch/)
await rejects(()=>store({...underlay,customer_id:point}),/supply_contract_price_basis_required/)
await db.query("update public.customer_supply_periods set end_date='2026-07-30' where id=$1",[supply])
await rejects(()=>store(),/supply_contract_price_basis_required/)
await db.query('update public.customer_supply_periods set end_date=null where id=$1',[supply])
await db.exec('update public.fixture_authorities set legal_available=false')
await rejects(()=>store(),/qualified_supply_source_required/)
await db.exec('update public.fixture_authorities set legal_available=true')
await rejects(()=>store({...underlay,price_plan_version_id:contract}),/supply_contract_price_basis_required/)
const originalPriceVersion=(await db.query('select * from public.price_plan_versions where id=$1',[priceVersion])).rows[0]
for (const update of ['locked_at=null','content_sha256=null',"status='draft'"]) {
 await db.exec(`update public.price_plan_versions set ${update}`)
 await rejects(()=>store(),/supply_contract_price_basis_required/)
 await db.query('update public.price_plan_versions set locked_at=$1,content_sha256=$2,status=$3 where id=$4',
  [originalPriceVersion.locked_at,originalPriceVersion.content_sha256,originalPriceVersion.status,priceVersion])
}
await rejects(()=>store({...underlay,pricing_snapshot:{price:'replacement'}}),/supply_contract_price_basis_required/)
await db.query("update public.contract_price_snapshots set valid_to='2026-07-30' where id=$1",[price])
await rejects(()=>store(),/supply_contract_price_basis_required/)
await db.query('update public.contract_price_snapshots set valid_to=null where id=$1',[price])
await noFinalizedEffects()
await rejects(()=>store({...underlay,total_kwh:'9007199254740992'}),/exact_total_mismatch/)
await rejects(()=>store({...underlay,energy_direction:'production'}),/qualified_source_mismatch/)
const id=await store();assert.equal(await store(),id);assert.equal((await db.query('select total_kwh::text from public.billing_underlays')).rows[0].total_kwh,observation.quantity);count++
const locked=(await db.query('select *,source_basis::text source_basis_text,exact_total_kwh::text exact_total from gridex_billing_source.underlay_bindings where underlay_id=$1',[id])).rows[0]
const lockedValue=locked.source_basis.values[0]
assert.equal(locked.company_id,company);assert.equal(locked.exact_total,observation.quantity)
assert.equal(locked.source_basis.values.length,1)
assert.equal(lockedValue.normalizedValueId,value);assert.equal(lockedValue.sourceMessageId,source)
assert.equal(lockedValue.quantityType,'136');assert.equal(lockedValue.quantityKwh,observation.quantity)
assert.equal(lockedValue.productCode,'8716867000030');assert.equal(lockedValue.registerCode,'REG')
assert.equal(lockedValue.quality,null);assert.equal(lockedValue.qualityEstablished,true)
assert.equal(lockedValue.revisionNumber,1);assert.equal(lockedValue.supplyPeriodId,supply)
assert.equal(lockedValue.observationOrdinal,0)
assert.equal(lockedValue.sourcePayloadHash,createHash('sha256').update(raw).digest('hex'))
const retainedContractText=(await db.query('select contract::text body from public.fixture_contracts')).rows[0].body
assert.equal(lockedValue.contractHash,createHash('sha256').update(retainedContractText).digest('hex'))
assert.deepEqual(locked.source_basis.supply,{qualified:true,periodId:supply,marketStateVersion:1})
assert.equal(locked.source_basis.contractId,contract);assert.equal(locked.source_basis.contractStatus,'active')
assert.equal(new Date(locked.source_basis.start).toISOString(),observation.periodStart)
assert.equal(new Date(locked.source_basis.end).toISOString(),observation.periodEnd)
assert.equal(locked.source_basis.price.id,price);assert.equal(locked.source_basis.price.contract_id,contract)
assert.equal(locked.source_basis.price.price_plan_version_id,priceVersion)
assert.deepEqual(locked.source_basis.price.snapshot_json,{price:'original'})
assert.equal(locked.source_basis.priceVersionHash,originalPriceVersion.content_sha256)
assert.equal(locked.source_basis_hash,createHash('sha256').update(locked.source_basis_text).digest('hex'))
assert.ok(Number.isFinite(new Date(locked.finalized_at).getTime()));count++
async function finalizedSnapshot(){return(await db.query(`select jsonb_build_object(
 'underlay',(select to_jsonb(u) from public.billing_underlays u where id=$1),
 'items',(select jsonb_agg(to_jsonb(i) order by id) from public.billing_underlay_items i where billing_underlay_id=$1),
 'binding',(select to_jsonb(b) from gridex_billing_source.underlay_bindings b where underlay_id=$1)) original`,[id])).rows[0].original}
const lockedOriginal=await finalizedSnapshot()
await rejects(()=>db.query('update public.billing_underlays set total_kwh=1 where id=$1',[id]),/finalized_underlay_immutable/)
await rejects(()=>db.query('update public.billing_underlays set pricing_snapshot=$1 where id=$2',[{price:'replacement'},id]),/finalized_underlay_immutable/)
await rejects(()=>db.query('delete from public.billing_underlay_items where billing_underlay_id=$1',[id]),/finalized_items_immutable/)
await rejects(()=>db.query('update gridex_billing_source.underlay_bindings set exact_total_kwh=1'),/immutable/)
let proof=(await service('select public.gridex_read_billing_underlay_source_basis_v1($1,$2) p',[company,[id]])).rows[0].p[0];assert.equal(proof.qualified,true);assert.equal(proof.correctionRequired,false);count++
await db.exec('update public.fixture_authorities set legal_available=false');assert.equal((await service('select public.gridex_read_billing_underlay_source_basis_v1($1,$2) p',[company,[id]])).rows[0].p[0].qualified,false);count++;await db.exec('update public.fixture_authorities set legal_available=true')
await db.query(`insert into public.normalized_metering_values(id,company_id,source_message_id,previous_value_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,$2,$3)`,[company,source,meter]);proof=(await service('select public.gridex_read_billing_underlay_source_basis_v1($1,$2) p',[company,[id]])).rows[0].p[0];assert.equal(proof.correctionRequired,true);assert.equal((await db.query('select count(*) c from gridex_billing_source.correction_journal')).rows[0].c,1);count++
const newSource='cccccccc-cccc-4ccc-8ccc-cccccccccccc',newValue='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)',[newSource,company,'test','inbound','UTILTS','E66',raw.replace('BGM+E66::260+D+9','BGM+E66::260+NEW-DATA+9'),'validated'])
await db.query('insert into public.normalized_metering_values(id,company_id,source_message_id,previous_value_id) values($1,$2,$3,$4)',[newValue,company,newSource,value])
const journals=(await db.query('select * from gridex_billing_source.correction_journal order by new_normalized_value_id')).rows
assert.equal(journals.length,2)
for (const journal of journals) {
 assert.equal(journal.company_id,company);assert.equal(journal.underlay_id,id)
 assert.equal(journal.previous_normalized_value_id,value);assert.equal(journal.old_source_basis_hash,locked.source_basis_hash)
 assert.equal(journal.new_source_message_id,journal.new_normalized_value_id===newValue?newSource:source)
 assert.ok(Number.isFinite(new Date(journal.created_at).getTime()))
}
assert.deepEqual(journals.map(j=>j.new_normalized_value_id),['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',newValue])
assert.deepEqual(await finalizedSnapshot(),lockedOriginal);count++
await rejects(()=>db.exec('update gridex_billing_source.correction_journal set old_source_basis_hash=repeat(\'0\',64)'),/immutable/)
await rejects(()=>db.exec('delete from gridex_billing_source.correction_journal'),/immutable/)
proof=(await service('select public.gridex_read_billing_underlay_source_basis_v1($1,$2) p',[company,[id]])).rows[0].p[0]
assert.equal(proof.correctionRequired,true);assert.equal(proof.sourceBasisHash,locked.source_basis_hash)
assert.deepEqual(await finalizedSnapshot(),lockedOriginal);count++
await rejects(()=>service('select public.gridex_create_billing_export_run($1,$2)',[{company_id:company},[{billing_underlay_id:id,status:'ready'}]]),/finalized_source_basis_required/)
await db.exec('set role authenticated');try{await rejects(()=>db.query('select public.gridex_read_billing_source_values_v1($1,$2)',[company,[value]]),/permission denied/)}finally{await db.exec('reset role')}
console.log(`Focused PostgreSQL billing source/decimal/scope/finalization/correction/ACL checks: ${count} PASS`)
} finally { await db.close() }
