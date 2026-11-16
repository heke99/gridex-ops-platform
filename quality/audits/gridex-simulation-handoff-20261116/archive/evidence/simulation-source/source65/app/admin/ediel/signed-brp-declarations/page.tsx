import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import SignedBrpWorkspace from './workspace'
export const dynamic='force-dynamic'
export default async function SignedBrpPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const rights=['communication.read','customers.read','contracts.read'],access=await requireAdminPageAccess({allOf:rights})
 if(!access.companyId||!rights.every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">BRP i undertecknat avtal</h1><p>Välj ett bolag där du får läsa kommunikation, kunder och avtal.</p></main>
 const db=await createSupabaseServerClient(),contracts=await db.from('customer_contracts').select('id,contract_number,signed_at').eq('company_id',access.companyId).eq('status','signed').not('signed_at','is',null).order('signed_at',{ascending:false}).limit(100)
 if(contracts.error)return <main className="p-6"><h1 className="text-xl font-semibold">BRP i undertecknat avtal</h1><p role="alert">Bolagets undertecknade avtal kunde inte läsas med aktuell behörighet.</p></main>
 const params=await searchParams,write=['communication.write','customers.write','contracts.write'].every(p=>access.permissions.includes(p))
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">BRP i undertecknat avtal</h1><p className="mb-6">Arkivera det undertecknade avtalet och originalet som uttryckligen anger samma balansansvariga part. En annan behörig granskare måste pröva originalen och utfärdarens aktuella mandat innan uppgiften får användas.</p><SignedBrpWorkspace contracts={(contracts.data??[]).map(c=>({id:c.id,label:`${c.contract_number??c.id} · ${c.signed_at}`}))} initialArtifactId={params.artifactId??''} canArchive={write} canReview={write&&access.permissions.includes('ediel.source.review')}/></main>
}
