import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import RequestedChangeWorkspace,{type SourceChoice} from './workspace'

export const dynamic='force-dynamic'
export default async function RequestedChangesPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','customers.read']})
 if(!access.companyId||!['communication.read','customers.read'].every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Ändringsunderlag</h1><p>Välj ett bolag där du har behörighet att läsa kommunikation och kunder.</p></main>
 const db=await createSupabaseServerClient(),companyId=access.companyId
 // Current authenticated RLS and explicit selected-company scope both apply.
 const [periods,customers,points]=await Promise.all([
  db.from('customer_supply_periods').select('id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,end_date').eq('company_id',companyId).order('start_date',{ascending:false}).limit(100),
  db.from('customers').select('id,customer_reference,full_name,name,first_name,last_name,personal_number,org_number,billing_street,billing_city,billing_postal_code,billing_country').eq('company_id',companyId).limit(100),
  db.from('metering_points').select('id,ediel_metering_point_id').eq('company_id',companyId).limit(100),
 ])
 if(periods.error||customers.error||points.error)return <main className="p-6"><h1 className="text-xl font-semibold">Ändringsunderlag</h1><p role="alert">Bolagets underlag kunde inte läsas. Försök igen när behörighet och anslutning har kontrollerats.</p></main>
 const choices:SourceChoice[]=[]
 for(const p of periods.data??[]){
  const c=customers.data?.find(c=>c.id===p.customer_id),mp=points.data?.find(mp=>mp.id===p.metering_point_id),contractId=p.customer_contract_id??p.contract_id
  if(!c||!mp?.ediel_metering_point_id||!contractId)continue
  choices.push({periodId:p.id,contractId,point:mp.ediel_metering_point_id,label:`${c.customer_reference} · ${c.full_name??c.name??[c.first_name,c.last_name].filter(Boolean).join(' ')} · ${mp.ediel_metering_point_id} · ${p.start_date}`,
   customer:{id:c.personal_number??c.org_number??'',qualifier:c.personal_number?'SE1':c.org_number?'SE2':'',name:c.full_name??c.name??[c.first_name,c.last_name].filter(Boolean).join(' '),street:c.billing_street??'',city:c.billing_city??'',postalCode:c.billing_postal_code??'',country:c.billing_country??'SE'}})
 }
 const params=await searchParams
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Ändringsunderlag</h1><p className="mb-6">Arkivera originalunderlaget för dödsfall eller avtalad mätning. En annan behörig granskare måste pröva underlaget innan en ändringsbegäran kan köas.</p>
  <RequestedChangeWorkspace choices={choices} initialArtifactId={params.artifactId??''} canArchive={['communication.write','customers.write'].every(p=>access.permissions.includes(p))} canReview={['communication.write','customers.write','ediel.source.review'].every(p=>access.permissions.includes(p))} canQueue={access.permissions.includes('communication.write')}/>
 </main>
}
