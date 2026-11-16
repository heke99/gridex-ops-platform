import type {SupabaseClient} from '@supabase/supabase-js'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {assessPriorPermissionFlow,priorPermissionWire,priorPermissionScope,type PriorScopeRecords,type PriorScopeRow} from './prodatPriorPermissionFlow'

const PAGE=50,MAX_PAGES=4
const columns='id,company_id,environment,direction,message_family,message_code,status,application_reference,sender_ediel_id,receiver_ediel_id,raw_payload,created_at,message_sent_at,message_received_at'
/** Only scoped metadata is read until historical legal/transport provenance is
 * verified. The raw-message query uses actual indexed ownership columns. */
export async function loadPriorPermissionFlow(message:EdielMessageRow,db:SupabaseClient){
 const wire=priorPermissionWire(message)
 if(!['Z14','Z15'].includes(wire.code))return assessPriorPermissionFlow(message,null,[])
 if(!message.company_id||!['test','production'].includes(message.environment)||!message.message_received_at||!Number.isFinite(Date.parse(message.message_received_at))||!wire.businessAt||!wire.sender||!wire.receiver||!wire.transportSender||!wire.transportReceiver||!message.created_at)return assessPriorPermissionFlow(message,null,[])
 const records:PriorScopeRecords={profiles:[],identifiers:[],roles:[],relations:[],actors:[]}
 try{
  const tables=[['profiles','tenant_ediel_profiles','id,company_id,environment,market,is_enabled,valid_from,valid_to'],['identifiers','tenant_actor_identifiers','id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from,valid_to'],['roles','tenant_actor_roles','id,company_id,environment,actor_id,role_code,valid_from,valid_to'],['relations','tenant_counterparty_relations','id,company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to']] as const
  for(const [key,table,select] of tables){
   const {data,error}=await db.from(table).select(select).eq('company_id',message.company_id).eq('environment',message.environment).limit(101)
   if(error||!data||data.length>100)return assessPriorPermissionFlow(message,null,[])
   records[key]=data as unknown as PriorScopeRow[]
  }
  const values=[wire.transportSender,wire.transportReceiver]
  const {data,error}=await db.from('platform_actor_identifiers').select('id,actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to').eq('identifier_type','EdielId').in('identifier_value',values).limit(101)
  if(error||!data||data.length>100)return assessPriorPermissionFlow(message,null,[])
  records.actors=data as unknown as PriorScopeRow[]
 }catch{return assessPriorPermissionFlow(message,null,[])}
 if(!priorPermissionScope(message,wire,records,message.message_received_at))return assessPriorPermissionFlow(message,records,[])
 const candidates:EdielMessageRow[]=[]
 const codes=wire.code==='Z14'?['Z13']:Array.from(new Set(wire.objects.map(o=>o.mode==='Z24'?'Z15':'Z18')))
 try{
  for(const code of codes){
   const same=code==='Z15'
   for(let page=0;page<MAX_PAGES;page++){
    const {data,error}=await db.from('ediel_messages').select(columns)
     .eq('company_id',message.company_id).eq('environment',message.environment)
     .eq('direction',same?'inbound':'outbound').eq('message_family','PRODAT').in('message_code',[code])
     .in('application_reference',['23-DGI-PRODAT','23-DDQ-PRODAT'])
     .eq('sender_ediel_id',same?wire.transportSender:wire.transportReceiver)
     .eq('receiver_ediel_id',same?wire.transportReceiver:wire.transportSender)
     .not('status','in','(cancelled,failed)').lte('created_at',message.created_at)
     .order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*PAGE,(page+1)*PAGE-1)
    if(error||!data)return assessPriorPermissionFlow(message,records,[],'history_unavailable')
    candidates.push(...data as unknown as EdielMessageRow[])
    if(data.length<PAGE)break
    if(page===MAX_PAGES-1)return assessPriorPermissionFlow(message,records,[],'search_incomplete')
   }
  }
 }catch{return assessPriorPermissionFlow(message,records,[],'history_unavailable')}
 return assessPriorPermissionFlow(message,records,candidates)
}
