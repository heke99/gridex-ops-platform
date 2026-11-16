'use server'
import {revalidatePath} from 'next/cache'
import {requireCompanyScopedActionAccess} from '@/lib/admin/guards'
import {requireCompanyOperationalForWrites} from '@/lib/tenant/governance'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {prepareAndQueueMeteringMethodChangeZ09} from '@/lib/ediel/flows/prodatMeteringMethodChange'

/** Select an existing source-qualified agreement event. No method, contract
 * fact, actor, date, legal role or approval supplied by this form is accepted. */
export async function prepareMeteringMethodChangeAction(form:FormData){
 const one=(key:string)=>form.getAll(key).length===1?form.get(key):null
 const companyId=one('companyId'),eventId=one('eventId'),routeId=one('routeId')
 if(!isEvidenceUuid(companyId)||!isEvidenceUuid(eventId)||form.getAll('routeId').length>1||routeId!==null&&routeId!==''&&!isEvidenceUuid(routeId))throw new Error('metering_method_change_source_selector_invalid')
 const actor=await requireCompanyScopedActionAccess(companyId,{allOf:['communication.write']})
 await requireCompanyOperationalForWrites(companyId)
 const result=await prepareAndQueueMeteringMethodChangeZ09({companyId,eventId,actorUserId:actor.userId,preferredRouteId:typeof routeId==='string'&&routeId!==''?routeId:null})
 revalidatePath('/admin/ediel')
 return result.status==='held'?{status:'held' as const,missing:result.missing}:{status:result.status,messageId:result.message.id}
}
