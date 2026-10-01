import {type SupabaseClient} from '@supabase/supabase-js'
import {NextRequest} from 'next/server'
import {afterEach,expect,it,vi} from 'vitest'
const current=vi.hoisted(()=>({client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!current.client)throw Error('actual_local_gotrue_client_required');return current.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:current.company})})}))
import {supabaseService} from '@/lib/supabase/service'
import {POST} from '@/app/api/ediel/invoice-file-retention/route'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedInvoiceFileRetentionNativeFixture} from './helpers/ediel-invoice-file-retention-native-fixture'
const http=(body:unknown)=>POST(new NextRequest('http://localhost/api/ediel/invoice-file-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))
afterEach(()=>{current.client=null;current.company=''})
it('actual signed PDF/Storage and GoTrue/current archived grants feed a server-owned exact source capture, while absent native billing authority remains held without policy or deletion effects',async()=>{
 const f=await seedInvoiceFileRetentionNativeFixture();current.client=f.writer.client;current.company=f.companyId
 const chosen={retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId}
 const captured=await http({action:'capture',...chosen});expect(captured.status,await captured.clone().text()).toBe(200);expect((await captured.json()).data).toMatchObject({sourceHash:f.sourceHash,byteLength:f.byteLength,authority:'none'})
 const held=await http({action:'basis',...chosen});expect(held.status).toBe(403)
 expect(sql(`SELECT jsonb_build_object('sources',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=${literal(f.companyId)}),'decisions',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_decisions WHERE company_id=${literal(f.companyId)}),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_tombstones WHERE company_id=${literal(f.companyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}))`)).toEqual({sources:1,decisions:0,tombstones:0,originals:0})
 current.client=f.readonly.client;expect((await http({action:'source',...chosen})).status).toBe(200);expect((await http({action:'capture',...chosen})).status).toBe(403)
 current.client=f.foreign.client;current.company=f.foreignCompanyId;expect((await http({action:'source',...chosen})).status).toBe(403)
 const bytes=await supabaseService.storage.from('billing-exports').download(f.path);expect(bytes.error).toBeNull();expect(Buffer.from(await bytes.data!.arrayBuffer())).toEqual(f.pdf)
 for(const role of ['anon','authenticated','service_role'])expect(sql(`SELECT to_jsonb(has_table_privilege(${literal(role)},'gridex_ediel_retention.invoice_file_sources','SELECT'))`)).toBe(false)
},240000)
it('current operative membership does not bypass an explicit retention-class DENY and hostile company/body selectors write no source rows',async()=>{
 const f=await seedInvoiceFileRetentionNativeFixture();current.client=f.writer.client;current.company=f.companyId;const chosen={retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId}
 expect((await http({action:'capture',...chosen,companyId:f.foreignCompanyId})).status).toBe(400)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.writer.id)},${literal(f.companyId)},'ediel.retention.invoice_copy_evidence','deny',true)`)
 expect((await http({action:'capture',...chosen})).status).toBe(403)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=${literal(f.companyId)}`)).toBe(0)
},240000)
