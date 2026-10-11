import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
type PriceSummaryFixture = { provider_fetched_at: string; status: string }
type PriceIntervalFixture = { source: string; price_area: string; time_start: string; time_end: string; sek_per_kwh: number; resolution: string }
type PricingQueryResult = { error: null; data: PriceSummaryFixture | PriceIntervalFixture[] | { offer_reference: string; customer_type: string }[] | null }
type PricingQuery = PromiseLike<PricingQueryResult> & {
 table: string; filters: Record<string, unknown>
 select: () => PricingQuery; order: () => PricingQuery; limit: () => PricingQuery; maybeSingle: () => PricingQuery; in: () => PricingQuery
 eq: (key: string, value: unknown) => PricingQuery; lte: (key: string, value: string) => PricingQuery; gt: (key: string, value: string) => PricingQuery
}
import {it,expect,vi,beforeEach} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({queries:[] as PricingQuery[],summary:{provider_fetched_at:'2026-10-25T01:00:00Z',status:'verified'} as PriceSummaryFixture | null,intervals:[{source:'elprisetjustnu',price_area:'SE3',time_start:'2026-10-25T01:00:00Z',time_end:'2026-10-25T01:15:00Z',sek_per_kwh:-0.25,resolution:'quarter_hour'},{source:'elprisetjustnu',price_area:'SE3',time_start:'2026-10-25T01:15:00Z',time_end:'2026-10-25T01:30:00Z',sek_per_kwh:0.5,resolution:'quarter_hour'}]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
 const q={table,filters:{}} as PricingQuery;m.queries.push(q)
 q.select=()=>q;q.order=()=>q;q.limit=()=>q;q.maybeSingle=()=>q
 q.eq=(k:string,v:unknown)=>{q.filters[k]=v;return q};q.in=()=>q
 q.lte=(k:string,v:string)=>{q.filters[k+'lte']=v;return q};q.gt=(k:string,v:string)=>{q.filters[k+'gt']=v;return q}
 q.then=(a,b)=>Promise.resolve({error:null,data:table==='spot_price_daily_summaries'?m.summary:table==='spot_price_intervals'?m.intervals.filter(r=>Date.parse(r.time_start)<=Date.parse(q.filters.time_startlte as string)&&Date.parse(r.time_end)>Date.parse(q.filters.time_endgt as string)):table==='canonical_public_contract_diagnostics_v'?[{offer_reference:'api-only',customer_type:'private'}]:[]}).then(a,b)
 return q
}}}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:async()=>({ok:true,client:{id:'client',company_id:'company',scopes:['website_market_prices.read','website_quotes.write'],metadata:{}},rateLimit:{limit:100,remaining:99,resetAt:null}}),logIntegrationApiRequest:vi.fn(async()=>undefined),currentIntegrationApiResponseContext:()=>null,integrationCredential:()=>null}))
vi.mock('@/lib/energy/resolutionBinding',async(orig)=>({...await orig<typeof import('@/lib/energy/resolutionBinding')>(),loadPricingEnergyResolution:async()=>({id:'11111111-1111-4111-8111-111111111111',priceArea:'SE3'}),loadQuoteEnergyResolution:async()=>({id:'11111111-1111-4111-8111-111111111111',priceArea:'SE3',gridAreaCode:null})}))
vi.mock('@/lib/energy/resolver',()=>({resolveEnergyContext:async()=>({resolutionId:'11111111-1111-4111-8111-111111111111',priceArea:'SE3',priceAreaAssurance:{status:'verified',confidence:1},warnings:[],sourceChain:[],confidence:1})}))
vi.mock('@/lib/pricing/marketPriceSources',async(orig)=>({...await orig<typeof import('@/lib/pricing/marketPriceSources')>(),loadMarketPriceSourcePolicies:async()=>[{sourceKey:'elprisetjustnu',priority:1,maxAgeMinutes:180,supportedResolutions:['quarterly','hourly'],priceAreas:['SE3']}]}))
vi.mock('@/lib/legal/publicLegalDocuments',async(orig)=>({...await orig<typeof import('@/lib/legal/publicLegalDocuments')>(),loadCompanySlugById:async()=> 'tenant'}))
vi.mock('@/lib/website/publicContracts.part-3',async(orig)=>({...await orig<typeof import('@/lib/website/publicContracts.part-3')>(),listPublicContractOffers:async()=>[]}))
vi.mock('@/lib/partner-api/simple',()=>({handleSimplePartnerApi:vi.fn()}))
import {loadCurrentMarketPrice} from '@/lib/pricing/spot/currentMarketPrice'
import {handleBusinessPartnerApi} from '@/lib/partner-api/business'
import {POST as websiteCurrent} from '@/app/api/v1/website/market-price/current/route'
beforeEach(()=>{m.queries=[];m.summary={provider_fetched_at:'2026-10-25T01:00:00Z',status:'verified'};vi.useRealTimers()})
const input={client:{company_id:'company'} as IntegrationApiClient,resolutionId:'11111111-1111-4111-8111-111111111111',now:new Date('2026-10-25T01:15:00Z')}
it('DST Stockholmday and exactquarterboundary choose nextinterval with correct exVATunit',async()=>{
 const r=await loadCurrentMarketPrice(input)
 expect(r).toMatchObject({time_start:'2026-10-25T01:15:00Z',selected_resolution:'quarterly',price_sek_per_kwh:0.5,price_ore_per_kwh:50,includes_vat:false,includes_supplier_fees:false,includes_grid_fees:false,next_update_at:'2026-10-25T01:30:00Z'})
 expect(m.queries.find(q=>q.table==='spot_price_daily_summaries')!.filters.price_date).toBe('2026-10-25')
})
it('negative spotprices preserved without VAT or fees',async()=>{
 const r=await loadCurrentMarketPrice({...input,now:new Date('2026-10-25T01:05:00Z')})
 expect(r.price_ex_vat_sek_per_kwh).toBe(-0.25);expect(r.price_ex_vat_ore_per_kwh).toBe(-25)
})
it('stale provider evidence rejects at maxage boundary',async()=>{
 m.summary!.provider_fetched_at='2026-10-24T22:15:00Z'
 await expect(loadCurrentMarketPrice(input)).rejects.toMatchObject({code:'market_price_stale',status:409})
})
it('mismatch and missing verifiedsummary failclosed',async()=>{
 await expect(loadCurrentMarketPrice({...input,assertedPriceArea:'SE4'})).rejects.toMatchObject({status:409,code:'price_area_mismatch'})
 m.summary=null;await expect(loadCurrentMarketPrice(input)).rejects.toMatchObject({status:503,code:'current_market_price_unavailable'})
})
it('website actualhandler shares verified interval and units',async()=>{
 vi.useFakeTimers();vi.setSystemTime(input.now)
 const r=await websiteCurrent(new NextRequest('https://example.test/api/v1/website/market-price/current',{method:'POST',body:JSON.stringify({resolution_id:input.resolutionId})}))
 expect(r.status).toBe(200);expect((await r.json()).data.price_ore_per_kwh).toBe(50)
})
it('partner API-only offer chosen then real quote/resolver return404 via websitechannel',async()=>{
 const r=await handleBusinessPartnerApi(new NextRequest('https://example.test/api/partner/v1/price',{method:'POST',body:JSON.stringify({postal_code:'12345',annual_consumption_kwh:12000,customer_type:'private'})}),'POST',['price'])
 expect(r!.status).toBe(404);expect((await r!.json()).error.code).toBe('offer_not_found')
 expect(m.queries.find(q=>q.table==='canonical_public_contract_diagnostics_v')!.filters.channel).toBe('api')
 expect(m.queries.find(q=>q.table==='canonical_public_contract_delivery_readiness_v')!.filters).toMatchObject({channel:'website',offer_reference:'api-only'})
})
it('partner current actualhandler returns same exVAT interval',async()=>{
 vi.useFakeTimers();vi.setSystemTime(input.now)
 const r=await handleBusinessPartnerApi(new NextRequest('https://example.test/api/partner/v1/price/current?postal_code=12345'),'GET',['price','current'])
 expect(r!.status).toBe(200)
 expect((await r!.json()).market_price).toMatchObject({price_sek_per_kwh_ex_vat:0.5,price_ore_per_kwh_ex_vat:50,includes_vat:false,valid_from:'2026-10-25T01:15:00Z'})
})

import {fetchElprisetJustNuDay} from '@/lib/pricing/spot/elprisetJustNuClient'
it('provider loader preserves SEKperKWh and DST offsetinterval exactly',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify([{SEK_per_kWh:-0.25,time_start:'2026-10-25T02:00:00+02:00',time_end:'2026-10-25T02:15:00+02:00'},{SEK_per_kWh:0.5,time_start:'2026-10-25T02:00:00+01:00',time_end:'2026-10-25T02:15:00+01:00'}]),{headers:{'content-type':'application/json'}}))
 const intervals=await fetchElprisetJustNuDay({date:'2026-10-25',priceArea:'SE3',fetchImpl:fetcher})
 expect(fetcher.mock.calls[0][0]).toBe('https://www.elprisetjustnu.se/api/v1/prices/2026/10-25_SE3.json')
 expect(intervals.map(r=>[r.timeStart,r.sekPerKwh,r.resolution])).toEqual([['2026-10-25T00:00:00.000Z',-0.25,'quarter_hour'],['2026-10-25T01:00:00.000Z',0.5,'quarter_hour']])
})
