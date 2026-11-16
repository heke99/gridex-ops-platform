import {readRequestedChangeSource} from '@/lib/ediel/production/requestedChangeSource'
import {prepareAndQueueProdatRequestedChange} from './prodatRequestedChange'
/** Nondeath E34, bankruptcy and generic caller assertions never become death.
 * Z06E bilateral nondeath needs its own exact authorized received source. */
export async function prepareAndQueueProdatLifeEvent(input:{companyId:string;eventId:string;actorUserId:string;preferredRouteId?:string|null}){
 const b=await readRequestedChangeSource(input);if(b.status==='held')return b
 if(b.variant!=='E'||b.eventKind!=='death')return {status:'held' as const,missing:['source_defined_z09e_death_event_required']}
 return prepareAndQueueProdatRequestedChange(input)
}
