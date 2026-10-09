import {it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,rpc:vi.fn(async()=>({data:null,error:null})),queries:[] as string[]}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:m.rpc,from:(table:string)=>{m.queries.push(table);let cap=Infinity;const b:any={select:()=>b,eq:()=>b,in:()=>b,or:()=>b,neq:()=>b,order:()=>b,limit:(n:number)=>{cap=n;return b},then:(f:any)=>f({data:(table==='metering_values'?m.rows:[]).slice(0,cap),error:null})};return b}}}))
import {listPortalMeteringValues,summarizeConsumptionByMonth} from '@/lib/customer-portal/db'
import * as api from '@/lib/customer-portal/apiData'
it('monthly card totals silently sum250 or500 from744 complete hourly readings',async()=>{
 m.rows=Array.from({length:744},(_,i)=>({id:String(i),value_kwh:1,period_start:new Date(Date.UTC(2026,7,1)+i*3600000).toISOString()}));
 const ctx={companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customerIds:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']} as any;
 const dashboard=summarizeConsumptionByMonth(await listPortalMeteringValues(ctx,{limit:250}));
 const consumption=summarizeConsumptionByMonth(await listPortalMeteringValues(ctx,{limit:500}));
 expect(dashboard[0].totalKwh).toBe(250);expect(consumption[0].totalKwh).toBe(500);expect(m.rows.reduce((n,r)=>n+Number(r.value_kwh),0)).toBe(744)
})
it('full bundle section plan performs11 identical retention RPCs and13 read queries',async()=>{
 m.rpc.mockClear();m.queries=[];const ctx={companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',externalCustomerId:null,customerNumber:null,provider:'synthetic'};const route='/api/v1/customer/portal-bundle';
 await Promise.all([api.listPortalContracts(ctx,route),api.listPortalSites(ctx,route),api.listPortalInvoices(ctx,route),api.listPortalMeteringValues(ctx,route),api.listPortalDocuments(ctx,route),api.listPortalLegalAcceptances(ctx,route),api.listPortalPowersOfAttorney(ctx,route),api.listPortalNotifications(ctx,route),api.listPortalEvents(ctx,route),api.listPortalWebsiteApplications(ctx,route)]);
 await api.listPortalMeteringPoints(ctx,[],route);
 expect(m.rpc).toHaveBeenCalledTimes(11);expect(m.rpc.mock.calls.every(([name])=>name==='ediel_require_portal_retention_access_v1')).toBe(true);expect(m.queries).toHaveLength(13);expect(m.queries).not.toContain('customer_portal_api_access_logs');
})

it('bundle with invoices and core only uses7 retention RPCs and7 reads',async()=>{
 m.rpc.mockClear();m.queries=[];const ctx={companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',externalCustomerId:null,customerNumber:null,provider:'synthetic'};const route='/api/v1/customer/portal-bundle';
 await Promise.all([api.listPortalContracts(ctx,route),api.listPortalSites(ctx,route),api.listPortalInvoices(ctx,route),api.listPortalLegalAcceptances(ctx,route),api.listPortalPowersOfAttorney(ctx,route),api.listPortalWebsiteApplications(ctx,route)]);
 await api.listPortalMeteringPoints(ctx,[],route);
 expect(m.rpc).toHaveBeenCalledTimes(7);expect(m.queries).toHaveLength(7);
})
