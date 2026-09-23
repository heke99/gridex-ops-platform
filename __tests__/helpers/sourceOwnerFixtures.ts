import {raw, common, line, characteristic, qty} from '../fixtures/prodat-register'
import {head, source} from '../fixtures/prodat-identity'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {EdielMessageRow} from '@/lib/ediel/types'
export const ownerId = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const OWNER = {source:ownerId(1),company:ownerId(2),customer:ownerId(3),point:ownerId(4),site:ownerId(5),grid:ownerId(6),switch:ownerId(7),supply:ownerId(8),actor:ownerId(9),external:'735123456789012345'}
/** Fixed synthetic wire. The real canonical engine must accept it, not a stub
 * of its output. Receiver-local reading facts are explicit fixture input. */
export function ownerSource():EdielMessageRow {
  const wire=raw([...head(),line('1',OWNER.external,undefined,'9'),...common('1','Synthetic'),qty('1000'),
    ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','D'),
    ['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],
    ['NAD','IT',[OWNER.external,'','9'],'','','Street','Town','','12345','SE'],
    ['NAD','Z02',['11111','160','SVK']]],'Z04').replace('+S+R+','+12345:14+54321:14+')
  return {...source(wire,'Z04'),id:OWNER.source,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,
    message_received_at:'2026-09-22T10:00:00Z',
    parsed_payload:{subtype:'L',start_date:'2026-10-01',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}},
    execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:OWNER.source,companyId:OWNER.company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(wire),sourceReceivedAt:'2026-09-22T10:00:00Z',capturedAt:'2026-09-22T10:00:00Z'}}} as EdielMessageRow
}
export function ownerRows():Record<string,Record<string,unknown>[]> {
  const tenant={company_id:OWNER.company,environment:'test',valid_from:'2026-01-01T00:00:00Z',valid_to:null}
  return {
    tenant_ediel_profiles:[{...tenant,id:ownerId(20),market:'electricity',is_enabled:true}],
    tenant_actor_identifiers:[{...tenant,id:ownerId(21),actor_id:OWNER.actor,identifier_type:'EdielId',identifier_value:'54321',qualifier:null,subaddress:null}],
    tenant_actor_roles:[{...tenant,id:ownerId(22),actor_id:OWNER.actor,role_code:'electricity_supplier'}],
    tenant_counterparty_relations:[],platform_actor_identifiers:[],
    metering_points:[{id:OWNER.point,company_id:OWNER.company,customer_id:OWNER.customer,meter_point_id:OWNER.external,site_id:OWNER.site,customer_site_id:OWNER.site,grid_owner_id:OWNER.grid}],
    customer_sites:[{id:OWNER.site,company_id:OWNER.company,customer_id:OWNER.customer,facility_id:OWNER.external,grid_owner_id:OWNER.grid}],
    grid_owners:[{id:OWNER.grid,name:'Synthetic network',ediel_id:'12345',is_active:true,lifecycle_status:'active',default_prodat_subaddress:null,default_utilts_subaddress:null,communication_email:null,email:null,environment:'test'}],
    supplier_switch_requests:[{id:OWNER.switch,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,inbound_z04_message_id:OWNER.source,status:'draft',confirmed_start_date:null}],
    customer_supply_periods:[{id:OWNER.supply,company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,source_message_id:OWNER.source,status:'draft',start_date:'2026-10-01'}],
  }
}
