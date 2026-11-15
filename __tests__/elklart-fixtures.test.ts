import { describe, expect, it, vi } from 'vitest'
import { assertLocalFixtureTarget, invokeCanonical, prepareCatalogue, provisionWebsiteClient, demoOfferCommand } from '../scripts/demo/elklart-fixtures.mjs'
const tenant={companyId:'11111111-1111-4111-8111-111111111111',actorUserId:'22222222-2222-4222-8222-222222222222'}
describe('isolated prepared catalogue',()=>{
  it('rejects hosted, wrong-port, and ambiguous tenant targets before requests',()=>{
    expect(()=>assertLocalFixtureTarget({API_URL:'http://127.0.0.1:54321',SERVICE_ROLE_KEY:'test'},tenant)).not.toThrow()
    for(const url of ['https://production.supabase.co','http://127.0.0.1:55321','http://127.0.0.1:54321@evil.invalid']) expect(()=>assertLocalFixtureTarget({API_URL:url,SERVICE_ROLE_KEY:'test'},tenant)).toThrow()
    expect(()=>assertLocalFixtureTarget({API_URL:'http://localhost:54321',SERVICE_ROLE_KEY:'test'},{...tenant,companyId:'foreign'})).toThrow()
  })
  it('fails closed on canonical business rejections',async()=>{
    await expect(invokeCanonical({rpc:async()=>({data:{ok:false,code:'not_ready'}})},'publish',{})).rejects.toThrow('not_ready')
  })
  it('persists one-time credentials and reuses them without rotating',async()=>{
    const client={rpc:vi.fn<(name:string,args:Record<string,unknown>)=>Promise<{data:{client_created:boolean}}>>().mockResolvedValue({data:{client_created:true}})},persist=vi.fn()
    const first=await provisionWebsiteClient(client,tenant,null,persist)
    expect(persist).toHaveBeenCalledWith(first)
    expect(first.companyId).toBe(tenant.companyId)
    expect(first.apiKey.slice(0,12)).toMatch(/^gdxp_[0-9a-f]{7}$/)
    expect(client.rpc.mock.calls[0][1].p_secret_hash).not.toBe(first.apiKey)
    expect(client.rpc.mock.calls[0][1].p_environment).toBe('development')
    expect(await provisionWebsiteClient(client,tenant,first,persist)).toBe(first)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    await expect(provisionWebsiteClient(client,{...tenant,companyId:'foreign'},first,persist)).rejects.toThrow('mismatch')
  })
  it('does not save an unusable token when canonical provisioning finds an existing client',async()=>{
    const persist=vi.fn()
    await expect(provisionWebsiteClient({rpc:async()=>({data:{client_created:false}})},tenant,null,persist)).rejects.toThrow('original private credential')
    expect(persist).not.toHaveBeenCalled()
  })
  it('calls canonical publication and never creates a customer or changes a delivery state',async()=>{
    const rpc=vi.fn<(name:string,args:Record<string,unknown>)=>Promise<{data:{ok:boolean,offer?:{id:string}}}>>(async(name)=>({data:name==='gridex_upsert_internal_contract_offer_v3'?{ok:true,offer:{id:'offer-1'}}:{ok:true}}))
    const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null}),single:async()=>({data:{id:'assignment-1',contract_product_version_id:'version-1'}})}
    await prepareCatalogue({rpc,from:()=>query},tenant)
    expect(rpc.mock.calls.map(([name])=>name).indexOf('gridex_publish_internal_contract_version')).toBeLessThan(rpc.mock.calls.map(([name])=>name).indexOf('gridex_publish_contract_channel'))
    expect(rpc.mock.calls.filter(([name])=>name==='gridex_publish_contract_channel').map(([,args])=>args.p_channel)).toEqual(['internal','website','api'])
    expect(rpc.mock.calls.some(([name])=>/onboard|move_out|customer_application|delivery/.test(name))).toBe(false)
    expect(demoOfferCommand(tenant.companyId,tenant.actorUserId).p_payload.lifecycle_status).toBe('draft')
  })
})

describe('repository reference catalogue extraction',()=>{
  it('extracts only literal immutable classifications and rejects executable expressions',async()=>{
    const {extractLiteralCatalogInsert}=await import('../scripts/demo/elklart-fixtures.mjs')
    const table='gridex_ediel_retention.record_class_catalog'
    const literal="INSERT INTO "+table+" VALUES ('class','table','permission','operation','{\"note\":\"semi;colon\"}'::jsonb); SELECT dangerous();"
    expect(extractLiteralCatalogInsert(literal,table).statement).not.toContain('dangerous')
    expect(()=>extractLiteralCatalogInsert('INSERT INTO '+table+" VALUES ('class',dangerous());",table)).toThrow('Nonliteral')
    expect(()=>extractLiteralCatalogInsert('INSERT INTO public.customers VALUES (1);','public.customers')).toThrow('allowlisted')
  })
  it('builds guarded exact catalogue inserts with provenance and no retention authority',async()=>{
    const {buildReferenceCatalogSql}=await import('../scripts/demo/elklart-fixtures.mjs')
    const path=await import('node:path')
    const result=buildReferenceCatalogSql(path.resolve('.'))
    expect(result.sql).toContain("'portal_domain_event_history','domain_events'")
    expect(result.sql).toContain("current_setting('elklart.runtime_project',true)")
    expect(result.sql).toContain('elklart_reference_catalog_mismatch')
    expect(result.sql).not.toMatch(/INSERT INTO .*\.(?:record_decisions|issuers|customers|user_roles)/i)
    expect(result.provenance).toHaveLength(2)
    for(const item of result.provenance) {expect(item.source_sha256).toMatch(/^[a-f0-9]{64}$/);expect(item.statement_sha256).toMatch(/^[a-f0-9]{64}$/)}
  })
})

 it('derives legal master names and rule requirements from exact repository literals',async()=>{
    const {buildLegalMasterReferenceSql}=await import('../scripts/demo/elklart-fixtures.mjs')
    const path=await import('node:path')
    const result=buildLegalMasterReferenceSql(path.resolve('.'))
    expect(result.sql).toContain("'general_consumer_terms'")
    expect(result.sql).toContain("'private','fixed','all'")
    expect(result.sql).toContain('INSERT INTO public.legal_templates')
    expect(result.sql).not.toMatch(/INSERT INTO public.legal_template_versions/i)
    expect(result.provenance).toHaveLength(4)
    expect(result.provenance.every(item=>/^[a-f0-9]{64}$/.test(item.source_sha256))).toBe(true)
  })

it('permits only controlled loopback EDIEL adapter destinations',async()=>{
 const {assertLocalAdapterUrl}=await import('../scripts/demo/elklart-fixtures.mjs')
 expect(assertLocalAdapterUrl('http://127.0.0.1:3002/ediel')).toBe('http://127.0.0.1:3002/ediel')
 for(const url of ['https://real-grid-owner.example/ediel','https://127.0.0.1.evil.invalid/ediel','http://name:password@127.0.0.1:3002/ediel']) expect(()=>assertLocalAdapterUrl(url)).toThrow()
})
