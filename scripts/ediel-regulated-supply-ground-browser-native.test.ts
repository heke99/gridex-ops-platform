import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createRegulatedSupplyGroundNativeFixture} from './helpers/ediel-regulated-supply-ground-native-fixture'
import {writeBrowserFixture} from './helpers/browserFixture'
it('real browser fixture retains actual signed scope and checks post-browser archive/review origins without claiming a legal issuer',async()=>{
 const path=process.env.GRIDEX_REGULATED_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_disposable_regulated_browser_fixture_required')
 if(process.env.GRIDEX_REGULATED_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;sourceHash:string;reviewerId:string;actorId:string}
  expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM gridex_regulated_supply.artifacts WHERE company_id=${literal(f.companyId)} AND source_hash=${literal(f.sourceHash)}),'grounds',(SELECT count(*) FROM gridex_received_sources.regulated_supply_ground_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_regulated_supply.origins o JOIN gridex_regulated_supply.artifacts a ON a.id=o.artifact_id JOIN gridex_regulated_supply.reviews r ON r.id=o.review_id WHERE o.company_id=${literal(f.companyId)} AND a.source_hash=${literal(f.sourceHash)} AND a.submitted_by=${literal(f.actorId)} AND r.reviewer_user_id=${literal(f.reviewerId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}))`)).toEqual({originals:1,grounds:1,origins:1,periods:0})
  return
 }
 const f=await createRegulatedSupplyGroundNativeFixture(),submission=f.signed()
 for(const id of [f.actorUserId,f.reviewer]){
  const changed=await supabaseService.auth.admin.updateUserById(id,{password});expect(changed.error).toBeNull()
  const db=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}}),signed=await db.auth.signInWithPassword({email:`${id}@example.invalid`,password});expect(signed.error).toBeNull()
  const current=await db.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:f.companyId});expect(current.error).toBeNull();expect(current.data).toMatchObject({authorized:true,selected_company_id:f.companyId})
 }
 writeBrowserFixture(path,{companyId:f.companyId,contractId:f.contractId,point:f.external,agreementId:f.agreement,actorId:f.actorUserId,actorEmail:`${f.actorUserId}@example.invalid`,reviewerId:f.reviewer,reviewerEmail:`${f.reviewer}@example.invalid`,sourceHash:f.sourceHash,sourceText:f.bytes.toString(),submission},{mode:0o600})
},120000)
