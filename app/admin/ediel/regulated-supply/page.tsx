import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import RegulatedSupplyWorkspace,{type GroundChoice} from './workspace'
export const dynamic='force-dynamic'
export default async function RegulatedSupplyPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','contracts.read','metering.read']})
 const read=['communication.read','contracts.read','metering.read']
 if(!access.companyId||!read.every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Rättsgrund för särskild leverans</h1><p>Välj ett bolag där du har behörighet att läsa kommunikation, avtal och anläggningar.</p></main>
 const db=await createSupabaseServerClient(),companyId=access.companyId
 const [contracts,points,periods,agreements]=await Promise.all([
  db.from('customer_contracts').select('id,customer_id,metering_point_id,contract_number,status').eq('company_id',companyId).in('status',['signed','active']).limit(200),
  db.from('metering_points').select('id,customer_id,ediel_metering_point_id,product_direction').eq('company_id',companyId).limit(200),
  db.from('customer_supply_periods').select('id,customer_id,metering_point_id,start_date,end_date').eq('company_id',companyId).in('status',['active','confirmed_by_grid_owner']).limit(200),
  db.from('tenant_bilateral_agreements').select('id,environment,capability_code,source_reference').eq('company_id',companyId).eq('is_enabled',true).in('capability_code',['PRODAT:Z04:A','PRODAT:Z04:D']).limit(100),
 ])
 if(contracts.error||points.error||agreements.error||periods.error)return <main className="p-6"><h1 className="text-xl font-semibold">Rättsgrund för särskild leverans</h1><p role="alert">Bolagets avtal och anläggningar kunde inte läsas med aktuell behörighet.</p></main>
 const choices:GroundChoice[]=[]
 for(const c of contracts.data??[]){const point=points.data?.find(p=>p.id===c.metering_point_id&&p.customer_id===c.customer_id)
  if(!point?.ediel_metering_point_id||(contracts.data??[]).filter(other=>other.metering_point_id===point.id&&other.customer_id===c.customer_id).length!==1||(points.data??[]).filter(other=>other.ediel_metering_point_id===point.ediel_metering_point_id).length!==1)continue
  choices.push({customerId:c.customer_id,contractId:c.id,pointId:point.id,point:point.ediel_metering_point_id,direction:point.product_direction??'',label:`Avtal ${c.contract_number??'utan nummer'} · ${point.ediel_metering_point_id}`})
 }
 const consumption=(periods.data??[]).flatMap(p=>{const point=points.data?.find(mp=>mp.id===p.metering_point_id&&mp.customer_id===p.customer_id&&mp.product_direction==='consumption');return point?.ediel_metering_point_id&&p.customer_id?[{id:p.id,customerId:p.customer_id,label:`${point.ediel_metering_point_id} · ${p.start_date}${p.end_date?'–'+p.end_date:''}`}]:[]})
 const params=await searchParams,write=['communication.write','contracts.read','metering.write']
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Rättsgrund för särskild leverans</h1><p className="mb-6">Arkivera originalet för anvisad leverans eller mottagningsplikt. En annan behörig granskare prövar utfärdarens intyg och bolagets aktuella mandat. En godkänd grund registrerar ingen leverans; nätägarens kvalificerade meddelande prövas separat.</p>
  <RegulatedSupplyWorkspace choices={choices} consumption={consumption} agreements={agreements.data??[]} initialArtifactId={params.artifactId??''} canArchive={write.every(p=>access.permissions.includes(p))} canReview={[...write,'ediel.regulated_supply.review'].every(p=>access.permissions.includes(p))}/>
 </main>
}
