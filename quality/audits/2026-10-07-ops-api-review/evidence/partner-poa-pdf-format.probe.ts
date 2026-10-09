import {it,expect,vi,beforeEach} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,files:new Map<string,Uint8Array>(),removed:[] as string[],sequence:[] as string[],failComplete:true}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:vi.fn(async()=>({ok:true,client:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',metadata:{partner_default_offer_reference:'offer-synthetic'}}})),logIntegrationApiRequest:vi.fn(async()=>{})}))
vi.mock('@/lib/integrations/publicWebhookTransport',()=>({assertPublicWebhookTarget:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>{let insert:any=null,patch:any=null;const b:any={select:()=>b,eq:()=>b,insert:(x:any)=>{insert=x;return b},update:(x:any)=>{patch=x;return b},single:()=>b.maybeSingle(),maybeSingle:async()=>{
  if(table==='customers')return{data:{id:'customer-db',customer_reference:'customer-reference',customer_type:'private',first_name:'Synthetic',last_name:'Person',identity_number:'199001011234'},error:null};
  if(table==='customer_sites')return{data:{id:'site-db',customer_id:'customer-db',facility_reference:'site-reference'},error:null};
  if(table==='powers_of_attorney'&&insert){m.rows.push(insert);m.sequence.push('business_committed');return{data:{power_of_attorney_reference:'poa-synthetic'},error:null}}
  if(table==='customer_portal_write_idempotency'&&insert)return{data:{id:'idempotent-row'},error:null};
  if(table==='customer_portal_write_idempotency'&&patch?.status==='completed'){m.sequence.push('completion');return m.failComplete?{data:null,error:{code:'08006',message:'synthetic completion outage'}}:{data:{id:'idempotent-row'},error:null}}
  return{data:{id:'idempotent-row'},error:null}},then:(f:any)=>f({data:null,error:null})};return b},
 rpc:async(name:string,args:any)=>{if(name==='gridex_create_partner_contract_v1'){m.rows.push({document_path:args.p_payload.power_of_attorney.document_path});m.sequence.push('business_committed');return{data:{contract_reference:'contract-synthetic',customer:{customer_reference:'customer-reference'},site:{site_reference:'site-reference'},power_of_attorney:{power_of_attorney_reference:'poa-synthetic'}},error:null}}return{data:null,error:null}},
 storage:{from:()=>({upload:async(path:string,bytes:Uint8Array)=>{m.files.set(path,bytes);return{error:null}},remove:async(paths:string[])=>{paths.forEach(p=>{m.removed.push(p);m.files.delete(p)});m.sequence.push('delete_file');return{error:null}}})}
}}))
import {handleSimplePartnerApi} from '@/lib/partner-api/simple'
beforeEach(()=>{m.rows=[];m.files.clear();m.removed=[];m.sequence=[];m.failComplete=true;vi.spyOn(console,'error').mockImplementation(()=>{})})
const file={poa_type:'WEB',transaction_type:'SWITCH',file_base64:Buffer.from('%PDF-1.7\nSynthetic\n%%EOF\n').toString('base64'),file_extension:'pdf'}
function req(path:string,body:any){return new NextRequest('https://example.invalid/api/partner/v1/'+path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic-key-0001'},body:JSON.stringify(body)})}
it('real POA handler deletes the PDF already linked by a committed row when completion fails',async()=>{
 const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',['customer','customer-reference','site','site-reference','powerofattorney']);expect(r?.status).toBe(500);expect(m.rows).toHaveLength(1);const path=String(m.rows[0].document_path);expect(m.removed).toContain(path);expect(m.files.has(path)).toBe(false);expect(m.sequence).toEqual(['business_committed','completion','delete_file'])
})
it('real contract handler deletes the PDF after its successful native RPC when completion fails',async()=>{
 const r=await handleSimplePartnerApi(req('contract',{customer:{customer_type:'PRIVATE',soc_id:'199001011234',first_name:'Synthetic',last_name:'Person',email:'synthetic@example.invalid'},site:{address:'Synthetic address',zip_code:'12345',city:'Synthetic city'},power_of_attorney:file}),'POST',['contract']);expect(r?.status).toBe(500);expect(m.rows).toHaveLength(1);const path=String(m.rows[0].document_path);expect(m.removed).toContain(path);expect(m.files.has(path)).toBe(false);expect(m.sequence).toEqual(['business_committed','completion','delete_file'])
})
it('successful completion retains the linked document',async()=>{
 m.failComplete=false;const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',file),'POST',['customer','customer-reference','site','site-reference','powerofattorney']);expect(r?.status).toBe(201);expect(m.files.has(String(m.rows[0].document_path))).toBe(true);expect(m.removed).toHaveLength(0)
})

it('five-byte non-document is accepted and saved as signed POA PDF by real handler',async()=>{m.failComplete=false;const broken={...file,file_base64:Buffer.from('%PDF-').toString('base64')};const r=await handleSimplePartnerApi(req('customer/customer-reference/site/site-reference/powerofattorney',broken),'POST',['customer','customer-reference','site','site-reference','powerofattorney']);expect(r?.status).toBe(201);expect(m.rows[0].status).toBe('signed');expect(Buffer.from(m.files.get(String(m.rows[0].document_path))!).toString()).toBe('%PDF-')})
