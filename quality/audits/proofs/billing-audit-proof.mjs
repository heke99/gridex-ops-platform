import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const root=process.cwd();
async function load(relative,mocks={}) {
 const cache=new Map();
 async function moduleFor(id){
  if(cache.has(id)) return cache.get(id);
  if(mocks[id]){const obj=mocks[id];const m=new vm.SyntheticModule(Object.keys(obj),function(){for(const [k,v] of Object.entries(obj))this.setExport(k,v)});cache.set(id,m);return m;}
  if(id.startsWith('node:')){const obj=await import(id);const m=new vm.SyntheticModule(Object.keys(obj),function(){for(const [k,v] of Object.entries(obj))this.setExport(k,v)});cache.set(id,m);return m;}
  const abs=id.startsWith('@/')?path.join(root,id.slice(2)+'.ts'):path.resolve(root,id);
  const m=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(abs,'utf8')),{identifier:abs});cache.set(id,m);
  await m.link(moduleFor);return m;
 }
 const m=await moduleFor(relative);await m.evaluate();return m.namespace;
}
function chain(run){let op='select',payload;const filters={};const query={};for(const method of ['select','eq','in','lt','lte','gt','gte','order','limit','not','is','or','range','update','upsert','insert'])query[method]=(...a)=>{if(['update','upsert','insert'].includes(method)){op=method;payload=a[0];}if(method==='eq')filters[a[0]]=a[1];return query;};query.maybeSingle=query.single=()=>query;query.then=(a,b)=>Promise.resolve().then(()=>run({op,payload,filters})).then(a,b);return query;}
(async()=>{
 const {evaluateBillingGate}=await load('lib/billing/billingGate.ts');
 const v={id:'v',company_id:'c',customer_id:'cu',metering_point_id:'mp',period_start:'2026-06-01T00:00:00+02:00',period_end:'2026-06-01T00:15:00+02:00',quantity_kwh:1,unit:'kWh',direction:'consumption',source_metering_value_id:'raw',source_message_id:'msg',revision_status:'current',quality_status:'measured'};
 const supply={id:'s',company_id:'c',customer_id:'cu',metering_point_id:'mp',status:'active',start_date:'2026-01-01'};
 const contract={id:'ct',company_id:'c',customer_id:'cu',metering_point_id:'mp',status:'active',starts_at:'2026-01-01'};
 const gate=evaluateBillingGate({normalizedValue:v,supplyPeriod:supply,contract,sourceMessage:null});
 assert.equal(gate.eligible,true);
 console.log('PROOF gate: known source_message_id with null sourceMessage => eligible, reasons=0');
 const start=Date.parse('2026-06-01T00:00:00Z');const count=2880;
 const items=Array.from({length:count},(_,i)=>({id:`i${i}`,period_start:new Date(start+i*900000).toISOString(),period_end:new Date(start+(i+1)*900000).toISOString(),quantity_kwh:1,unit:'kWh',status:'ready_for_pricing'}));
 const prices=items.map((x,i)=>({id:`p${i}`,source:'test',time_start:x.period_start,time_end:x.period_end,resolution:'quarter_hour',sek_per_kwh:i<1000?1:2}));
 const intervalDB={from:table=>chain(()=>({error:null,data:(table==='billing_underlay_items'?items:prices).slice(0,1000)}))};
 const interval=await load('lib/pricing/intervalPricing.ts',{'@/lib/supabase/service':{supabaseService:intervalDB},'@/lib/pricing/marketPriceSources':{loadMarketPriceSourcePolicies:async()=>[{sourceKey:'test',priority:1,supportedResolutions:['quarterly']}]}});
 const ip=await interval.resolveIntervalSpotPricing({companyId:'c',billingUnderlayId:'u',priceArea:'SE3',periodStart:items[0].period_start,periodEnd:items.at(-1).period_end,requiredResolution:'quarterly',spotWeightPercent:100});
 assert.deepEqual(ip.errors,[]);assert.equal(ip.evidence.length,1000);assert.equal(ip.weightedAverageSekPerKwh,1);
 const {calculateBasePrice}=await load('lib/pricing/basePriceCalculator.ts');
 const base=calculateBasePrice({underlay:{quantityKwh:count},components:[{sourceType:'spot',weightPercent:100}],sourceValues:{spotSekPerKwh:ip.weightedAverageSekPerKwh}});
 console.log(`PROOF interval pagination: actual ${count} intervals, evidence ${ip.evidence.length}, no errors, calculated ${base.lines[0].amountExVat} SEK vs complete ${1000+(count-1000)*2} SEK`);
 const u={id:'u',company_id:'c',customer_id:'cu',metering_point_id:'mp',contract_id:'ct',contract_price_snapshot_id:'snap',underlay_year:2026,underlay_month:6,billing_period_start:'2026-06-01',billing_period_end:'2026-07-01',price_area:'SE3',total_kwh:20,status:'pending',readiness_status:'blocked',missing_values_count:0,readiness_issues:[{code:'overlapping_intervals'}],energy_direction:'consumption',settlement_type:'invoice'};
 const snap={id:'snap',contract_id:'ct',snapshot_json:{pricing_model:'fixed',vat_rate:0.25},base_price_components_snapshot:[{source_type:'fixed',weight_percent:100,fixed_price_sek_per_kwh:1}],price_components_snapshot:[]};let persisted;
 const db={from:table=>chain(()=>({error:null,data:table==='billing_underlays'?u:table==='customer_contracts'?contract:table==='contract_price_snapshots'?snap:[]})),rpc:async(name,args)=>{persisted={name,args};return {data:'run',error:null}}};
 const engine=await load('lib/pricing/engine.ts',{'@/lib/supabase/service':{supabaseService:db},'@/lib/billing/invoiceReadiness':{assertBillingPeriodOpen:async()=>{}},'@/lib/pricing/spot/spotImportScheduler':{ensureSpotPricesForBillingMonth:async()=>{throw Error('UNEXPECTED IMPORT')}},'@/lib/pricing/marketPriceSources':{loadMarketPriceSourcePolicies:async()=>[],policySupports:()=>true,selectMarketPriceRow:()=>null,selectMarketPricePreviewRow:()=>null}});
 const calculated=await engine.calculatePricingPreviewForUnderlay({companyId:'c',billingUnderlayId:'u',persist:true});
 assert.equal(calculated.status,'success');assert.equal(persisted.name,'gridex_persist_pricing_run');assert.equal(persisted.args.p_result.status,'success');
 console.log('PROOF blocked-underlay: pending/blocked overlap issue with positive quantity => success RPC payload, errors=0');
 // Two claimed events are distinct, but refer to the same export item. Both read the initial state.
 let state={id:'item',company_id:'c',provider:'capway_aptic',environment:'test',provider_invoice_guid:'guid',provider_status:'unpaid',status:'sent',customer_id:'cu',customer_contract_id:'ct',billing_underlay_id:'u',amount_inc_vat:100,currency:'SEK'};
 let portal;let claims=0;let reads=0;let allowReads;const bothRead=new Promise(r=>allowReads=r);let paidDone;const paidProcessed=new Promise(r=>paidDone=r);
 const events=['invoice.paid','invoice.overdue'].map((event_type,i)=>({id:`e${i}`,company_id:'c',provider:'capway_aptic',environment:'test',provider_invoice_guid:'guid',matched_invoice_export_item_id:'item',event_type,payload:{amount_inc_vat:100,currency:'SEK'}}));
 const providerDB={rpc:async()=>({data:[events[claims++]],error:null}),from:table=>chain(async({op,payload,filters})=>{
   if(table==='invoice_export_items'&&op==='select'){const before={...state};reads++;if(reads===2)allowReads();await bothRead;return {data:before,error:null};}
   if(table==='invoice_export_items'&&op==='update'){if(payload.provider_status==='overdue')await paidProcessed;state={...state,...payload};return {data:{id:'item'},error:null};}
   if(table==='customer_invoices'){portal=payload;return {data:{id:'inv'},error:null};}
   if(table==='invoice_provider_events'){if(filters.id==='e0'&&payload.status==='processed')paidDone();return {data:{id:filters.id},error:null};}
   throw Error('Unexpected '+table);
 })};
 const processor=await load('lib/billing/providerEventProcessor.ts',{'@/lib/supabase/service':{supabaseService:providerDB},'@/lib/platform/schemaReadiness':{assertPlatformSchemaReady:async()=>{}},'@/lib/events/domainEvents':{emitDomainEvent:async()=>null}});
 const outcomes=await Promise.all([processor.processPendingInvoiceProviderEvents({companyId:'c',limit:1}),processor.processPendingInvoiceProviderEvents({companyId:'c',limit:1})]);
 assert.equal(outcomes[0].processed,1);assert.equal(outcomes[1].processed,1);assert.equal(state.provider_status,'overdue');assert.equal(portal.status,'overdue');
 console.log('PROOF concurrent invoice events: paid commits then stale overdue commits; both processed, final item/portal overdue');
})().catch(e=>{console.error(e);process.exitCode=1});
