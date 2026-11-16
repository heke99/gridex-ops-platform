import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import RequestedCustomerChangeWorkspace from './workspace'
import {supabaseService} from '@/lib/supabase/service'
export const dynamic='force-dynamic'
export default async function RequestedCustomerChangesPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','customers.read','contracts.read']})
 if(!access.companyId||!['communication.read','customers.read','contracts.read'].every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Begärd kundändring</h1><p>Välj ett bolag där du får läsa kommunikation, kunder och avtal.</p></main>
 const db=await createSupabaseServerClient(),company=access.companyId
 const[periods,agreements]=await Promise.all([db.from('customer_supply_periods').select('id,customer_contract_id,contract_id,start_date,end_date').eq('company_id',company).order('start_date',{ascending:false}).limit(100),supabaseService.from('tenant_bilateral_agreements').select('id,source_reference,environment').eq('company_id',company).eq('capability_code','prodat_z09e_requested_customer_change').eq('is_enabled',true).order('valid_from',{ascending:false}).limit(100)])
 if(periods.error||agreements.error)return <main className="p-6"><h1 className="text-xl font-semibold">Begärd kundändring</h1><p role="alert">Bolagets avtal och leveranser kunde inte läsas med aktuell behörighet.</p></main>
 const params=await searchParams,write=['communication.write','customers.write','contracts.write'].every(p=>access.permissions.includes(p))
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Begärd kundändring</h1><p className="mb-6">Arkivera originalet som ger rätt att begära den överenskomna kundändringen. En annan behörig granskare måste granska originalet och utfärdarens aktuella mandat innan begäran kan köläggas.</p><RequestedCustomerChangeWorkspace periods={(periods.data??[]).flatMap(p=>{const contractId=p.customer_contract_id??p.contract_id;return contractId?[{id:p.id,contractId,label:`${p.start_date} · ${p.end_date??'pågående'} · ${p.id}`}]:[]})} agreements={(agreements.data??[]).map(a=>({id:a.id,label:`${a.source_reference} · ${a.environment}`}))} initialArtifactId={params.artifactId??''} canArchive={write} canReview={write&&access.permissions.includes('ediel.source.review')} canQueue={write}/></main>
}
