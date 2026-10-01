import Link from 'next/link'
import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import BilateralCustomerWorkspace from './workspace'
export const dynamic='force-dynamic'
export default async function BilateralCustomerPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','customers.read','contracts.read']})
 if(!access.companyId||!['communication.read','customers.read','contracts.read'].every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Bilateralt kundunderlag</h1><p>Välj ett bolag där du får läsa kommunikation, kunder och avtal.</p></main>
 const db=await createSupabaseServerClient(),companyId=access.companyId
 const [messages,periods,agreements]=await Promise.all([
 db.from('ediel_messages').select('id,message_code,external_reference,created_at').eq('company_id',companyId).eq('direction','inbound').eq('message_family','PRODAT').eq('message_code','Z06').order('created_at',{ascending:false}).limit(100),
 db.from('customer_supply_periods').select('id,customer_contract_id,contract_id,start_date,end_date').eq('company_id',companyId).order('start_date',{ascending:false}).limit(100),
 db.from('tenant_bilateral_agreements').select('id,source_reference,environment').eq('company_id',companyId).eq('is_enabled',true).order('valid_from',{ascending:false}).limit(100)])
 if(messages.error||periods.error||agreements.error)return <main className="p-6"><h1 className="text-xl font-semibold">Bilateralt kundunderlag</h1><p role="alert">Bolagets källor kunde inte läsas med aktuell behörighet.</p></main>
 const params=await searchParams,write=['communication.write','customers.write','contracts.write'].every(p=>access.permissions.includes(p))
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Bilateralt kundunderlag</h1><p className="mb-6">Arkivera originalavtalet för en mottagen kundändring. En annan behörig granskare måste pröva originalet och den autentiska utfärdarens behörighet innan kundversionen kan tillämpas.</p><BilateralCustomerWorkspace messages={(messages.data??[]).map(m=>({id:m.id,label:`${m.message_code} · ${m.external_reference??m.id} · ${m.created_at}`}))} periods={(periods.data??[]).flatMap(p=>{const contractId=p.customer_contract_id??p.contract_id;return contractId?[{id:p.id,contractId,label:`${p.start_date} · ${p.end_date??'pågående'} · ${p.id}`}]:[]})} agreements={(agreements.data??[]).map(a=>({id:a.id,label:`${a.source_reference} · ${a.environment}`}))} initialArtifactId={params.artifactId??''} canArchive={write} canReview={write&&access.permissions.includes('ediel.source.review')} canApply={write}/><p className="mt-6"><Link className="underline" href="/admin/ediel/requested-changes">Ändringsunderlag för dödsfall och mätning</Link> · <Link className="underline" href="/admin/ediel/regulated-supply">Reglerad leveransgrund</Link></p></main>
}
