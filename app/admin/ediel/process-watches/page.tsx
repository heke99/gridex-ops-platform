import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { readEdielProcessNextActions } from '@/lib/ediel/operations/processNextAction'

export const dynamic='force-dynamic'
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export default async function EdielProcessWatchesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireAdminPageAccess(['communication.read'])
 const query={...await searchParams}
 if(query.sourceId==='')delete query.sourceId
 if(Object.keys(query).some(key=>!['environment','sourceId'].includes(key))
  ||query.environment!==undefined&&!['test','production'].includes(query.environment as string)
  ||Array.isArray(query.environment)||query.sourceId!==undefined&&(typeof query.sourceId!=='string'||!ID.test(query.sourceId)))notFound()
 const environment=query.environment==='production'?'production':'test'
 const scope=await getOperationalCompanyScope(context.userId)
 const membership=scope.memberships.find(row=>row.companyId===scope.companyId)
 const canRead=Boolean(scope.companyId&&context.companyId===scope.companyId&&membership?.status==='active'&&context.permissions.includes('communication.read'))
 const canReview=canRead&&isCompanyWritableInTenantWorkspace(membership?.companyStatus)&&context.permissions.includes('cases.write')
 let unavailable=!canRead
 let decisions:Awaited<ReturnType<typeof readEdielProcessNextActions>>=new Map()
 if(canRead&&scope.companyId){
  try{decisions=await readEdielProcessNextActions({companyId:scope.companyId,actorUserId:context.userId,environment,
   messageIds:typeof query.sourceId==='string'?[query.sourceId]:undefined,evaluatedAt:new Date().toISOString(),access:{canRead,canReview,canPrepare:false}})}
  catch{unavailable=true}
 }
 return <div className="min-h-screen bg-slate-50"><AdminHeader title="Ediel processbevakning" userEmail={context.email}/><main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
  <h1 className="text-2xl font-semibold">Processens nästa steg</h1>
  <p className="text-sm text-slate-600">Affärssvar och tekniska kvittenser bevakas separat. Motpartens mottagningstid är inte känd. Ingen automatisk omsändning.</p>
  <form method="get" className="flex flex-wrap gap-3"><label>Miljö<select aria-label="Miljö" name="environment" defaultValue={environment} className="ml-2 rounded border p-2"><option value="test">Test</option><option value="production">Produktion</option></select></label><label>Källmeddelandets ID<input aria-label="Källmeddelandets ID" name="sourceId" defaultValue={typeof query.sourceId==='string'?query.sourceId:''} className="ml-2 max-w-full rounded border p-2"/></label><button type="submit" className="rounded border bg-white px-4 py-2 focus-visible:outline focus-visible:outline-2">Läs källbeslut</button></form>
  {unavailable?<p role="status">Processbeslutet kunde inte hämtas för ditt aktuella bolag och dina behörigheter. Kontrollera åtkomsten innan fortsatt åtgärd.</p>:<>
   <p className="text-sm">{query.sourceId?'Exakt valt källmeddelande.':'Översikt med högst 100 bevakningar per källägare. Ange källmeddelandets ID för ett exakt beslut.'}</p>
   {!decisions.size?<p>Inget kvalificerat processbeslut hittades i detta urval.</p>:Array.from(decisions.values()).map(d=><article key={d.sourceMessageId} className="rounded-xl border bg-white p-4" aria-label="Processbeslut">
    <h2 className="break-all font-semibold"><Link href={`/admin/ediel/process-watches?environment=${environment}&sourceId=${encodeURIComponent(d.sourceMessageId)}`} className="underline focus-visible:outline">{d.sourceMessageId}</Link></h2><p className="mt-2">{d.summary}</p>
    <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-semibold">Väntar på</dt><dd>{d.waitingFor.join(', ')||'Inget automatiskt externt steg'}</dd></div><div><dt className="font-semibold">Ansvar</dt><dd>{d.responsibility==='counterparty'?'Motpartens svar; eget bolag bevakar':'Eget bolag granskar'}</dd></div>
     <div><dt className="font-semibold">Tidsgrund</dt><dd>{d.timeBasis.anchor==='z09_validity_day'?`Originalets giltighetsdag ${d.timeBasis.validityDay??'saknas'}, bevakningsdag ${d.timeBasis.dueDay??'saknas'}. Faktisk SMTP-acceptans ${d.timeBasis.actualAcceptedAt??'saknas'} prövas separat.`:`Faktisk SMTP-acceptans ${d.timeBasis.anchorAt??'saknas'} för egen uppföljning.`}</dd></div>
     <div><dt className="font-semibold">Affärsbevakning till</dt><dd>{d.timeBasis.businessDueAt??'Ingen numerisk tidsgräns i källbeslutet'}</dd></div><div><dt className="font-semibold">Teknisk bevakning till</dt><dd>{d.timeBasis.technicalDueAt??'Ingen aktiv teknisk tidsgräns'}</dd></div>
     <div><dt className="font-semibold">Blockerare</dt><dd>{d.blockers.length?'Källbeslutet kräver granskning':'Ingen aktuell blockerare i detta källbeslut'}</dd></div><div><dt className="font-semibold">Tillåtna åtgärder</dt><dd>{d.allowedActions.map(action=>action==='read_source'?'Läsa källbeslut':'Granska ärendet').join(', ')||'Aktuell läsbehörighet krävs'}</dd></div>
    </dl>
   </article>)}
  </>}
 </main></div>
}
