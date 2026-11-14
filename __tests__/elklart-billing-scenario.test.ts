import {expect,it,vi} from 'vitest'
import {assertBillingTarget,assertDemoCapwayConnection,demoCapwayConfigPatch,bindPreparedCapwayConfig,buildProviderCatalogSql} from '../scripts/demo/elklart-billing-scenario.mjs'
import path from 'node:path'
const tenant={companyId:'11111111-1111-4111-8111-111111111111'}
it('rejects hosted and different local billing environments',()=>{
 expect(()=>assertBillingTarget({API_URL:'http://127.0.0.1:54321',SERVICE_ROLE_KEY:'private'},tenant)).not.toThrow()
 for(const API_URL of ['https://production.supabase.co','http://127.0.0.1:55321']) expect(()=>assertBillingTarget({API_URL,SERVICE_ROLE_KEY:'private'},tenant)).toThrow()
})
it('changes only prepared configuration, without manufacturing test success',()=>{
 const patch=demoCapwayConfigPatch({settings:{default_service:'Invoicing'}})
 expect(patch.settings.default_service).toBe('Invoicing')
 expect(patch.settings.auth_mode).toBe('apikey')
 expect(patch.secret_reference.api_key_env).toBe('ELKLART_CAPWAY_API_KEY')
 expect(Object.keys(patch)).toEqual(['settings','secret_reference'])
 expect(patch).not.toHaveProperty('status')
 expect(patch).not.toHaveProperty('last_test_result')
})
it('refuses provider test before exact local API-key configuration',()=>{
 const config={provider:'capway_aptic',environment:'test',...demoCapwayConfigPatch()}
 expect(()=>assertDemoCapwayConnection(config)).not.toThrow()
 expect(()=>assertDemoCapwayConnection({...config,environment:'production'})).toThrow()
 expect(()=>assertDemoCapwayConnection({...config,settings:{...config.settings,base_url:'https://real-provider.example'}})).toThrow()
 expect(()=>assertDemoCapwayConnection({...config,settings:{...config.settings,auth_mode:'oauth2'}})).toThrow()
})
it('scopes configuration updates to exact tenant, connection, provider and TEST',async()=>{
 const calls:unknown[][]=[]
 const query={eq:(...args:unknown[])=>{calls.push(args);return query},then:(resolve:(value:unknown)=>void)=>resolve({error:null})}
 const update=vi.fn<(patch:Record<string,unknown>)=>typeof query>(()=>query)
 const result=await bindPreparedCapwayConfig({from:()=>({update})},tenant,{id:'connection-1',provider:'capway_aptic',environment:'test'})
 expect(calls).toEqual([['company_id',tenant.companyId],['id','connection-1'],['provider','capway_aptic'],['environment','test']])
 expect(update.mock.calls[0][0]).not.toHaveProperty('status')
 expect(result.settings.base_url).toBe('http://127.0.0.1:38480')
})
it('derives only provider catalogue constants with source hashes and database guard',()=>{
 const result=buildProviderCatalogSql(path.resolve('.'))
 expect(result.sql).toContain("('capway_aptic', 'Capway', true, NULL, 10)")
 expect(result.sql).toContain("current_setting('elklart.runtime_project',true)")
 expect(result.sql).not.toContain('billing_provider_connections')
 expect(result.provenance.source_sha256).toMatch(/^[0-9a-f]{64}$/)
 expect(result.provenance.statement_sha256).toMatch(/^[0-9a-f]{64}$/)
})

it('refuses whole-month billing side effects outside the explicit fictional customer allowlist',async()=>{
 const {assertAllowedInvoiceScope}=await import('../scripts/demo/elklart-billing-scenario.mjs')
 const allowed='22222222-2222-4222-8222-222222222222'
 expect(()=>assertAllowedInvoiceScope([{company_id:tenant.companyId,customer_id:allowed}],tenant.companyId,[allowed])).not.toThrow()
 expect(()=>assertAllowedInvoiceScope([{company_id:'foreign',customer_id:allowed}],tenant.companyId,[allowed])).toThrow('outside')
 expect(()=>assertAllowedInvoiceScope([{company_id:tenant.companyId,customer_id:'foreign'}],tenant.companyId,[allowed])).toThrow('outside')
 expect(()=>assertAllowedInvoiceScope([],tenant.companyId,[])).toThrow('allowlist')
})

it('fails closed before provider/browser access when PostgREST hides a foreign customer beyond its 1000-row cap',async()=>{
 const {runInvoiceScenarioThroughUi}=await import('../scripts/demo/elklart-billing-scenario.mjs')
 const allowed='22222222-2222-4222-8222-222222222222'
 const allPeriods=Array.from({length:1001},(_,index)=>({id:String(index),company_id:tenant.companyId,customer_id:index===1000?'33333333-3333-4333-8333-333333333333':allowed}))
 const selections:Array<{table:string;columns:string;options:unknown}>=[]
 type ScopeQuery={select(columns:string,options:unknown):ScopeQuery;then(resolve:(value:unknown)=>void):void}&Record<'eq'|'in'|'lt'|'gt'|'not'|'or'|'limit',(...values:unknown[])=>ScopeQuery>
 const from=vi.fn((table:string)=>{
  const result=table==='customer_supply_periods'?{data:allPeriods.slice(0,1000),count:allPeriods.length}:table==='billing_underlays'?{data:[],count:0}:{data:[{id:'meter-1'}]}
  const chain=():ScopeQuery=>query
  const query:ScopeQuery={select:(columns,options)=>{selections.push({table,columns,options});return query},then:resolve=>resolve(result),eq:chain,in:chain,lt:chain,gt:chain,not:chain,or:chain,limit:chain}
  return query
 })
 await expect(runInvoiceScenarioThroughUi({from},tenant,{billingMonth:'2026-10',allowedCustomerIds:[allowed],approveAndSend:true})).rejects.toThrow(/Incomplete delivery period scope/)
 expect(from.mock.calls.map(([table])=>table)).toEqual(['customer_supply_periods','billing_underlays','normalized_metering_values'])
 expect(selections.filter(item=>item.table!=='normalized_metering_values').every(item=>(item.options as {count:string}).count==='exact')).toBe(true)
})
it('requires trustworthy exact counts for both bounded scope reads',async()=>{
 const {assertCompleteInvoiceScopeRead}=await import('../scripts/demo/elklart-billing-scenario.mjs')
 expect(()=>assertCompleteInvoiceScopeRead({data:[{id:'one'}],count:1},'underlay')).not.toThrow()
 for(const count of [undefined,null,2,0,-1,1.5]) expect(()=>assertCompleteInvoiceScopeRead({data:[{id:'one'}],count},'underlay')).toThrow('Incomplete')
 expect(()=>assertCompleteInvoiceScopeRead({data:Array.from({length:1001}),count:1001},'underlay')).toThrow('Incomplete')
})
