'use server'

import {revalidatePath} from 'next/cache'
import {requireCompanyScopedActionAccess} from '@/lib/admin/guards'
import {requireCompanyOperationalForWrites} from '@/lib/tenant/governance'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {reviewReceivedClosureSource} from '@/lib/ediel/sources/reviewReceivedClosureSource'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'

/** Accepts identities and an explicit review statement, never approval facts,
 * actors, expected inventory, effective dates or a client-selected readset. */
export async function reviewReceivedStructureAction(form:FormData):Promise<{accepted:boolean;message:string;assessmentId?:string}>{
  const one=(key:string)=>form.getAll(key).length===1?form.get(key):null
  const companyId=one('companyId'),sourceMessageId=one('sourceMessageId'),environment=one('environment')
  const replacement=one('replacesSourceMessageId'),confirmed=one('confirmedOriginal')==='on'
  if(!isEvidenceUuid(companyId)||!isEvidenceUuid(sourceMessageId)||!['test','production'].includes(String(environment))
    ||!confirmed||form.getAll('replacesSourceMessageId').length>1||replacement!==null&&replacement!==''&&!isEvidenceUuid(replacement)){
    return {accepted:false,message:'Bekräfta granskningen och kontrollera meddelandets identitet.'}
  }
  // Authentication and the selected company's write scope precede every write.
  const context=await requireCompanyScopedActionAccess(companyId,{anyOf:['communication.write','ediel_testing.write']})
  await requireCompanyOperationalForWrites(companyId)
  const result=await reviewReceivedStructuralSource({companyId,sourceMessageId,environment:environment as 'test'|'production',
    reviewerUserId:context.userId,confirmedOriginal:true,replacesSourceMessageId:typeof replacement==='string'&&replacement!==''?replacement:null})
  revalidatePath(`/admin/ediel/messages/${sourceMessageId}`)
  if(result.status==='recorded'&&result.sourceDisposition==='accepted')return {accepted:true,assessmentId:result.assessmentId,
    message:'Hela källmeddelandet har fått ett spårbart godkännande. Giltighet och eventuella konflikter prövas separat vid varje mätvärdeskontroll.'}
  return {accepted:false,message:'Fullständigt godkännande kunde inte fastställas. Kontrollera källvalidering, partsbehörighet, leveransperiod och eventuell ersättningsreferens. Ingen marknadskvittens har skickats.'}
}

/** Explicit original Z05L/LK review, independently authorized; no operational
 * date updates and no cancellation/replacement approval in this bounded path. */
export async function reviewReceivedClosureAction(form:FormData):Promise<{accepted:boolean;message:string;assessmentId?:string}>{
  const one=(key:string)=>form.getAll(key).length===1?form.get(key):null
  const companyId=one('companyId'),sourceMessageId=one('sourceMessageId'),environment=one('environment')
  if(!isEvidenceUuid(companyId)||!isEvidenceUuid(sourceMessageId)||(environment!=='test'&&environment!=='production')
    ||one('confirmedOriginal')!=='on'||form.has('replacesSourceMessageId')){
    return {accepted:false,message:'Bekräfta granskningen och kontrollera meddelandets identitet.'}
  }
  const context=await requireCompanyScopedActionAccess(companyId,{anyOf:['communication.write','ediel_testing.write']})
  await requireCompanyOperationalForWrites(companyId)
  const result=await reviewReceivedClosureSource({companyId,sourceMessageId,environment,reviewerUserId:context.userId,confirmedOriginal:true})
  revalidatePath(`/admin/ediel/messages/${sourceMessageId}`)
  if(result.status==='recorded'&&result.sourceDisposition==='accepted')return {accepted:true,assessmentId:result.assessmentId,
    message:'Originalets leveransavslut har godkänts som slutgräns för strukturkontrollen. Giltighet och eventuella konflikter prövas vid varje mätvärdeskontroll.'}
  return {accepted:false,message:'Avslutet kunde inte godkännas. Kontrollera original, parter, tidigare granskad leveransperiod och registrerat avslut. Återtaganden och ersättningar kräver separat utredning. Ingen marknadskvittens har skickats.'}
}
