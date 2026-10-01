import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {type SupabaseClient} from '@supabase/supabase-js'
import {NextRequest} from 'next/server'
import {expect,it,vi} from 'vitest'
const current=vi.hoisted(()=>({client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!current.client)throw Error('native_gotrue_required');return current.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:current.company})})}))
import {supabaseService} from '@/lib/supabase/service'
import {POST} from '@/app/api/ediel/invoice-file-retention/route'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedInvoiceFileRetentionNativeFixture} from './helpers/ediel-invoice-file-retention-native-fixture'
type Fixture={companyId:string;actorId:string;actorEmail:string;readonlyEmail:string;foreignCompanyId:string;foreignEmail:string;retentionClass:'customer_invoice_document_pdf_bytes';targetId:string;sourceId:string;sourceHash:string;byteLength:number;storagePath:string;contractHash:string}
it('actual signed-PDF source capture pre/browser/post retains exact bytes/hash with current archived actors and never invents qualified billing, legal approval or deletion',async()=>{
 const path=process.env.GRIDEX_INVOICE_FILE_RETENTION_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('invoice_file_local_disposable_browser_only')
 if(process.env.GRIDEX_INVOICE_FILE_RETENTION_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as Fixture
  expect(sql(`SELECT jsonb_build_object('sources',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=${literal(f.companyId)} AND id=${literal(f.sourceId)} AND captured_by=${literal(f.actorId)} AND source_hash=${literal(f.sourceHash)}),'decisions',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_decisions WHERE company_id=${literal(f.companyId)}),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_tombstones WHERE company_id=${literal(f.companyId)}),'events',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_events e JOIN gridex_ediel_retention.invoice_file_sources s ON s.id=e.source_id WHERE s.company_id=${literal(f.companyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}))`)).toEqual({sources:1,decisions:0,tombstones:0,events:0,originals:0})
  const read=await supabaseService.storage.from('billing-exports').download(f.storagePath);expect(read.error).toBeNull();const bytes=Buffer.from(await read.data!.arrayBuffer());expect(bytes.length).toBe(f.byteLength);expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sourceHash);expect(f.contractHash).toBe(f.sourceHash)
  return
 }
 const f=await seedInvoiceFileRetentionNativeFixture(password);current.company=f.companyId;current.client=f.writer.client
 const response=await POST(new NextRequest('http://localhost/api/ediel/invoice-file-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'capture',retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId})}));expect(response.status,await response.clone().text()).toBe(200);const source=(await response.json()).data
 for(const actor of [f.writer,f.readonly,f.foreign]){const r=await actor.client.rpc('ediel_current_retention_companies_v1',{});expect(r.error).toBeNull();expect(r.data.map((row:{companyId:string})=>row.companyId)).toEqual([actor===f.foreign?f.foreignCompanyId:f.companyId])}
 writeFileSync(path,JSON.stringify({companyId:f.companyId,actorId:f.writer.id,actorEmail:f.writer.email,readonlyEmail:f.readonly.email,foreignCompanyId:f.foreignCompanyId,foreignEmail:f.foreign.email,retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId,sourceId:source.sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,storagePath:f.path,contractHash:f.documentSha256} satisfies Fixture),{mode:0o600})
},240000)
