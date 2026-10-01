import {canonicalProdatProfileForMessage,canonicalUtiltsProfileForMessage} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type {CanonicalRouteRequestType} from '@/lib/ediel/core/routeRegistry'
/** Translate the actual canonical process into the existing configured-route
 * vocabulary. This chooses no guide, entitlement or fallback route. */
export function tgtCanonicalDraftRouteRequest(input:{messageFamily:string;messageCode:string}):CanonicalRouteRequestType{
 if(input.messageFamily==='PRODAT'){
  const profile=canonicalProdatProfileForMessage(input.messageCode)
  if(!profile)throw Error('ediel_tgt_canonical_route_process_unavailable')
  switch(profile.processGroup){
   case 'customer_masterdata':case 'masterdata':case 'metering':return 'customer_masterdata'
   case 'supplier_switch':case 'delivery_contract':return 'supplier_switch'
   case 'metering_access':return 'metering_access'
  }
 }
 if(input.messageFamily==='UTILTS'){
  const profile=canonicalUtiltsProfileForMessage(input.messageCode)
  if(!profile)throw Error('ediel_tgt_canonical_route_process_unavailable')
  return profile.scope==='error'?'ediel_ack':profile.scope==='grid_area'?'billing_underlay':'meter_values'
 }
 if(['CONTRL','APERAK','UTILTS_ERR'].includes(input.messageFamily))return 'ediel_ack'
 throw Error('ediel_tgt_canonical_route_process_unavailable')
}
