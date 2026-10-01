import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {supabaseService} from '@/lib/supabase/service'
import BilateralProdatWorkspace from './workspace'
export const dynamic='force-dynamic'
export default async function BilateralProdatPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','contracts.read','metering.read']}),read=['communication.read','contracts.read','metering.read']
 if(!access.companyId||!read.every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Bilateralt PRODAT-förfarande</h1><p>Välj ett bolag där du har behörighet att läsa kommunikation, avtal och anläggningar.</p></main>
 const db=await createSupabaseServerClient(),companyId=access.companyId
 const [points,agreements,packs]=await Promise.all([
  db.from('metering_points').select('grid_area_code').eq('company_id',companyId).limit(1000),
  db.from('tenant_bilateral_agreements').select('id,environment,capability_code,source_reference').eq('company_id',companyId).eq('is_enabled',true).in('capability_code',['PRODAT:BILATERAL:normal_start_h','PRODAT:BILATERAL:own_end_h','PRODAT:BILATERAL:closure_request_lk']).limit(100),
  // Shared public catalog metadata after the actual server company/read guard.
  // Selection grants no source or bilateral authority; native scope rechecks it.
  supabaseService.from('ediel_rule_packs').select('id,guide_version,guide_revision').eq('family','PRODAT').eq('market','electricity').in('status',['active','transition']).eq('guide_version','26.A').eq('guide_revision','3').limit(20),
 ])
 if(points.error||agreements.error||packs.error)return <main className="p-6"><h1 className="text-xl font-semibold">Bilateralt PRODAT-förfarande</h1><p role="alert">Bolagets överenskommelser, nätområden och valda anvisning kunde inte läsas med aktuell behörighet.</p></main>
 const params=await searchParams,write=['communication.write','contracts.read','metering.write'],gridAreas=[...new Set((points.data??[]).flatMap(p=>p.grid_area_code?[p.grid_area_code]:[]))].sort()
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Bilateralt PRODAT-förfarande</h1><p className="mb-6">Arkivera den överenskomna profilens original. En annan behörig granskare prövar utfärdarintyg, förfarande, parter och giltighet. En godkänd profil registrerar ingen leverans och godkänner inget enskilt meddelande.</p>
  <BilateralProdatWorkspace choices={(packs.data??[]).map(p=>({rulePackId:p.id,label:`PRODAT ${p.guide_version}, revision ${p.guide_revision}`}))} agreements={agreements.data??[]} gridAreas={gridAreas} initialArtifactId={params.artifactId??''} canArchive={write.every(p=>access.permissions.includes(p))} canReview={[...write,'ediel.bilateral_profile.review'].every(p=>access.permissions.includes(p))}/>
 </main>
}
