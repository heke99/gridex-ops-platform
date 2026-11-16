import {readQualifiedCustomerStructure} from './qualifiedCustomerStructure'
import {canonicalProdatMeasurementResolution} from '@/lib/ediel/rulebook/canonicalEdielFacade'
/** Requested periods are explicit calendar/instant bounds. The chosen source
 * supplies method/product/frequency independently; no current scalar selects
 * resolution and a D/W/M/Q/Y reporting frequency cannot become a meter method. */
export async function requireDataRequestStructure(input:{companyId:string;actorUserId:string;environment:'test'|'production';customerId:string|null;siteId:string|null;meteringPointId:string|null;periodStart:string|null;periodEnd:string|null;legalSupplier:string;legalNetwork:string}){
 if(!input.customerId||!input.siteId||!input.meteringPointId||!input.periodStart||!input.periodEnd)throw new Error('utilts_dated_structure_request_scope_required')
 const source=await readQualifiedCustomerStructure({...input,customerId:input.customerId,siteId:input.siteId,meteringPointId:input.meteringPointId,periodStart:input.periodStart,periodEnd:input.periodEnd})
 if(source.status!=='selected')throw new Error(`utilts_dated_structure_unavailable:${source.reason}`)
 // The actual service-selected source tuple is independent from transport IDs.
 if(source.legalSupplier!==input.legalSupplier||source.legalNetwork!==input.legalNetwork)throw new Error('utilts_dated_structure_legal_party_mismatch')
 const resolution=canonicalProdatMeasurementResolution(source.fields.measurementMethod)
 if(!resolution)throw new Error('utilts_dated_structure_resolution_unavailable')
 return {...source,resolution}
}
