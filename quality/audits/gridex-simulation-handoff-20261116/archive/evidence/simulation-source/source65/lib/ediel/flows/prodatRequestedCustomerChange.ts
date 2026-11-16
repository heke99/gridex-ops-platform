import {readRequestedCustomerChangeQueueSource,type RequestedCustomerChangeScope} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {prepareAndQueueCustomerLifeEventZ09} from './prodatCustomerLifeEvent'
/** Opaque artifact selectors only; the existing gateway additionally rechecks
 * its current native event source, route, intent and atomic original binding. */
export async function prepareAndQueueRequestedCustomerChange(input:RequestedCustomerChangeScope&{preferredRouteId?:string|null}){const source=await readRequestedCustomerChangeQueueSource(input);if(source.status==='held')return source;return prepareAndQueueCustomerLifeEventZ09({companyId:input.companyId,actorUserId:input.actorUserId,eventId:source.eventId,preferredRouteId:input.preferredRouteId})}
