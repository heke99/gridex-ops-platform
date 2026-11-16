import {requireAdminPageAccess} from '@/lib/admin/guards'
import {readFreshEdielBusinessIncidentAccess,readFreshEdielBusinessIncident,type FreshEdielBusinessIncident} from '@/lib/ediel/incidents/freshBusinessIncident'
import BusinessIncidentWorkspace from './workspace'
export const dynamic='force-dynamic'
export default async function BusinessIncidentsPage({searchParams}:{searchParams:Promise<{incidentId?:string}>}){
 const guard=await requireAdminPageAccess({allOf:['communication.read']})
 if(!guard.companyId)return <main className="p-6"><h1 className="text-2xl font-semibold">Affärsincidenter efter kvittens</h1><p>Välj ett bolag där du har behörighet att läsa kommunikation.</p></main>
 let access:Awaited<ReturnType<typeof readFreshEdielBusinessIncidentAccess>>|null=null
 try{access=await readFreshEdielBusinessIncidentAccess({companyId:guard.companyId,actorUserId:guard.userId})}catch{}
 if(!access)return <main className="p-6"><h1 className="text-2xl font-semibold">Affärsincidenter efter kvittens</h1><p role="alert">Incidenterna är inte tillgängliga med aktuell bolagsbehörighet.</p></main>
 const params=await searchParams
 let initialReceipt:FreshEdielBusinessIncident|null=null,initialError=''
  if(params.incidentId)try{initialReceipt=await readFreshEdielBusinessIncident({companyId:guard.companyId,actorUserId:guard.userId,incidentId:params.incidentId})}catch{initialError='Incidenten är inte tillgänglig med aktuell behörighet och källauktoritet.'}
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6"><h1 className="text-2xl font-semibold">Affärsincidenter efter kvittens</h1><p>En ny observation granskas separat. Originalets kvittens bevaras. Kontakt och rättelse väntar på en separat granskning.</p><BusinessIncidentWorkspace canReport={access.canReport} initialReceipt={initialReceipt} initialIncidentId={params.incidentId??''} initialError={initialError}/></main>
}
