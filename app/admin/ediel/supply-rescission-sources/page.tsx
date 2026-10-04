import {requireAdminPageAccess} from '@/lib/admin/guards'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import SupplyRescissionWorkspace,{type RescissionChoice} from './workspace'
export const dynamic='force-dynamic'
export default async function SupplyRescissionSourcesPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const readPermissions=['communication.read','contracts.read','metering.read'],access=await requireAdminPageAccess({allOf:readPermissions})
 if(!access.companyId||!readPermissions.every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">Hävningsunderlag</h1><p>Välj ett bolag där du får läsa kommunikation, avtal och anläggningar.</p></main>
 const db=await createSupabaseServerClient(),companyId=access.companyId
 const [periods,packs]=await Promise.all([
  db.from('customer_supply_periods').select('id,metering_point_id,source_message_id,start_date').eq('company_id',companyId).in('status',['active','confirmed_by_grid_owner']).is('market_end_at',null).is('source_end_message_id',null).order('start_date',{ascending:false}).limit(100),
  db.from('ediel_rule_packs').select('id').eq('family','PRODAT').eq('market','electricity').eq('status','active').eq('guide_version','26.A').eq('guide_revision','3'),
 ])
 const pointIds=[...new Set((periods.data??[]).map(p=>p.metering_point_id).filter((id):id is string=>Boolean(id)))],sourceIds=[...new Set((periods.data??[]).map(p=>p.source_message_id).filter((id):id is string=>Boolean(id)))]
 const [points,sources]=await Promise.all([
  pointIds.length?db.from('metering_points').select('id,ediel_metering_point_id').eq('company_id',companyId).in('id',pointIds):Promise.resolve({data:[],error:null}),
  sourceIds.length?db.from('ediel_messages').select('id,environment').eq('company_id',companyId).in('id',sourceIds):Promise.resolve({data:[],error:null}),
 ])
 if(periods.error||packs.error||points.error||sources.error)return <main className="p-6"><h1 className="text-xl font-semibold">Hävningsunderlag</h1><p role="alert">Bolagets leveransperioder och aktuella källprofiler kunde inte läsas.</p></main>
 const choices:RescissionChoice[]=[]
 for(const p of periods.data??[]){const point=points.data?.find(mp=>mp.id===p.metering_point_id),source=sources.data?.find(m=>m.id===p.source_message_id);if(!point?.ediel_metering_point_id||!source||!['test','production'].includes(source.environment))continue
  for(const pack of packs.data??[])choices.push({periodId:p.id,rulePackId:pack.id,environment:source.environment as 'test'|'production',label:`${point.ediel_metering_point_id} · ${p.start_date} · ${source.environment==='production'?'produktion':'test'}`})
 }
 const params=await searchParams,writePermissions=['communication.write','contracts.read','metering.write']
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">Hävningsunderlag</h1><p className="mb-6">Arkivera ett rättsligt original för hävning av bolagets egen leverans. En annan behörig granskare måste styrka det innan en H-begäran kan köas. Leveransen avslutas först av ett matchat svar från nätägaren.</p><SupplyRescissionWorkspace choices={choices} initialArtifactId={params.artifactId??''} canArchive={writePermissions.every(p=>access.permissions.includes(p))} canReview={[...writePermissions,'ediel.supply_rescission.review'].every(p=>access.permissions.includes(p))} canQueue={writePermissions.every(p=>access.permissions.includes(p))}/></main>
}
