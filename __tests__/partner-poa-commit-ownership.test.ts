/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F18, F26, F37 (permanent regression from evidence/partner-completion-cleanup.probe.ts)
import {it,expect,vi,beforeEach} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,files:new Map<string,Uint8Array>(),uploads:0,ledger:null as null|Record<string,unknown>,poaInsertError:null as null|Record<string,unknown>,removed:[] as string[],sequence:[] as string[],failComplete:true}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:vi.fn(async()=>({ok:true,client:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',metadata:{partner_default_offer_reference:'offer-synthetic'}}})),logIntegrationApiRequest:vi.fn(async()=>{})}))
vi.mock('@/lib/integrations/publicWebhookTransport',()=>({assertPublicWebhookTarget:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>{let insert:any=null,patch:any=null;const b:any={select:()=>b,eq:()=>b,insert:(x:any)=>{insert=x;return b},update:(x:any)=>{patch=x;return b},single:()=>b.maybeSingle(),maybeSingle:async()=>{
  if(table==='customers')return{data:{id:'customer-db',customer_reference:'customer-reference',customer_type:'private',first_name:'Synthetic',last_name:'Person',identity_number:'199001011234'},error:null};
  if(table==='customer_sites')return{data:{id:'site-db',customer_id:'customer-db',facility_reference:'site-reference'},error:null};
  if(table==='powers_of_attorney'&&insert&&m.poaInsertError){m.sequence.push('business_rejected');return{data:null,error:m.poaInsertError}}
  if(table==='powers_of_attorney'&&insert){m.rows.push(insert);m.sequence.push('business_committed');return{data:{power_of_attorney_reference:'poa-synthetic'},error:null}}
  if(table==='customer_portal_write_idempotency'&&insert){if(m.ledger)return{data:null,error:{code:'23505'}};m.ledger={...insert,id:'idempotent-row'};return{data:{id:'idempotent-row'},error:null}}
  if(table==='customer_portal_write_idempotency'&&!patch&&m.ledger?.status==='completed')return{data:m.ledger,error:null};
  if(table==='customer_portal_write_idempotency'&&patch?.status==='completed'){m.sequence.push('completion');if(!m.failComplete&&m.ledger)Object.assign(m.ledger,patch);return m.failComplete?{data:null,error:{code:'08006',message:'synthetic completion outage'}}:{data:{id:'idempotent-row'},error:null}}
  return{data:{id:'idempotent-row',status:'processing'},error:null}},then:(f:any)=>f({data:null,error:null})};return b},
 rpc:async(name:string,args:any)=>{if(name==='gridex_create_partner_contract_v1'){m.rows.push({document_path:args.p_payload.power_of_attorney.document_path});m.sequence.push('business_committed');return{data:{contract_reference:'contract-synthetic',customer:{customer_reference:'customer-reference'},site:{site_reference:'site-reference'},power_of_attorney:{power_of_attorney_reference:'poa-synthetic'}},error:null}}return{data:null,error:null}},
 storage:{from:()=>({upload:async(path:string,bytes:Uint8Array)=>{m.uploads++;m.sequence.push('upload');m.files.set(path,bytes);return{error:null}},remove:async(paths:string[])=>{paths.forEach(p=>{m.removed.push(p);m.files.delete(p)});m.sequence.push('delete_file');return{error:null}}})}
}}))
import {minimalPdf} from './helpers/minimalPdf'
import {handleSimplePartnerApi} from '@/lib/partner-api/simple'
beforeEach(()=>{m.rows=[];m.files.clear();m.removed=[];m.sequence=[];m.failComplete=true;m.uploads=0;m.poaInsertError=null;m.ledger=null;vi.spyOn(console,'error').mockImplementation(()=>{})})
const file={poa_type:'WEB',transaction_type:'SWITCH',file_base64:minimalPdf().toString('base64'),file_extension:'pdf'}
function req(path:string,body:any){return new NextRequest('https://example.invalid/api/partner/v1/'+path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic-key-0001'},body:JSON.stringify(body)})}
const poaPath=['customer','customer-reference','site','site-reference','powerofattorney']
it('F18: POA handler keeps the PDF linked by a committed row when completion fails',async()=>{
 const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',poaPath)
 expect(r?.status).toBe(503)
 expect(m.rows).toHaveLength(1);const path=String(m.rows[0].document_path)
 expect(m.removed).toHaveLength(0);expect(m.files.has(path)).toBe(true)
 expect(m.sequence).toEqual(['upload','business_committed','completion','completion'])
})
it('F18: contract handler keeps the PDF after its committed native RPC when completion fails',async()=>{
 const r=await handleSimplePartnerApi(req('contract',{customer:{customer_type:'PRIVATE',soc_id:'199001011234',first_name:'Synthetic',last_name:'Person',email:'synthetic@example.invalid'},site:{address:'Synthetic address',zip_code:'12345',city:'Synthetic city'},power_of_attorney:file}),'POST',['contract'])
 expect(r?.status).toBe(503)
 expect(m.rows).toHaveLength(1);const path=String(m.rows[0].document_path)
 expect(m.removed).toHaveLength(0);expect(m.files.has(path)).toBe(true)
})
it('removes the owned upload when the database definitively rejects the POA insert',async()=>{
 m.failComplete=false;m.poaInsertError={code:'23514',message:'synthetic check violation'}
 const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',poaPath)
 expect(r?.status).not.toBe(201);expect(m.uploads).toBe(1);expect(m.removed).toHaveLength(1);expect(m.files.size).toBe(0)
})
it('successful completion retains the linked document',async()=>{
 m.failComplete=false;const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',poaPath);expect(r?.status).toBe(201);expect(m.files.has(String(m.rows[0].document_path))).toBe(true);expect(m.removed).toHaveLength(0)
})
it('F37: completed replay performs no upload or remove and no second mutation',async()=>{
 m.failComplete=false
 const first=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',poaPath)
 expect(first?.status).toBe(201)
 const replay=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',poaPath)
 expect(replay?.status).toBe(201)
 expect(m.uploads).toBe(1);expect(m.removed).toHaveLength(0);expect(m.rows).toHaveLength(1)
})
it('F26: five-byte %PDF- prefix is rejected before any upload or POA write',async()=>{
 m.failComplete=false;const broken={...file,file_base64:Buffer.from('%PDF-').toString('base64')}
 const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',broken),'POST',poaPath)
 expect(r?.status).toBe(422);expect(m.uploads).toBe(0);expect(m.rows).toHaveLength(0)
})
