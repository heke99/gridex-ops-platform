import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {assessPriorPermissionFlow,priorPermissionWire} from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {scopeRecords} from './prodat-prior-flow'
/** Field-consumer fixtures predate transport history. Supply explicit synthetic
 * envelope/owner/receipt records, retaining every original physical field. */
export function syntheticPriorContext(message:EdielMessageRow,matched=true){
 const t=tokenizeEdifact(message.raw_payload??''),e=t.una.dataElementSeparator,c=t.una.componentDataElementSeparator,z=t.una.segmentTerminator
 const unb=t.segments.find(s=>s.tag==='UNB')
 if(unb){const elements=Array.from({length:12},(_,i)=>segmentComposite(unb,i,t.una).join(c));elements[0]='UNB';elements[2]='12345'+c+'ZZ';elements[3]='54321'+c+'ZZ';elements[11]='1';message.raw_payload=message.raw_payload!.replace(unb.raw,elements.join(e))}
 message.company_id='00000000-0000-4000-8000-000000000010';message.environment='test';message.sender_ediel_id='12345';message.receiver_ediel_id='54321';message.created_at='2026-09-20T00:00:00Z';message.message_received_at='2026-09-20T00:00:00Z'
 const wire=priorPermissionWire(message),records=scopeRecords(),candidates:EdielMessageRow[]=[]
 if(matched){
  const codes=wire.code==='Z14'?['Z13']:wire.code==='Z15'?Array.from(new Set(wire.objects.map(o=>o.mode==='Z24'?'Z15':'Z18'))):[]
  for(const code of codes){
   let raw=message.raw_payload!.replace('BGM'+e+wire.code,'BGM'+e+code)
   const same=code==='Z15'
   if(!same)raw=raw.replaceAll(e+'12345'+c,e+'TEMP'+c).replaceAll(e+'54321'+c,e+'12345'+c).replaceAll(e+'TEMP'+c,e+'54321'+c)
   if(code==='Z13'||code==='Z18'){
    const tokens=tokenizeEdifact(raw),remove=new Set<number>()
    tokens.segments.forEach((s,i)=>{if(s.tag==='CCI'&&segmentComposite(s,2,tokens.una)[0]==='Z23'){remove.add(i);remove.add(i+1)}})
    raw=tokens.segments.filter((_,i)=>!remove.has(i)).map(s=>s.raw+z).join('');raw='UNA'+c+e+t.una.decimalMark+t.una.releaseCharacter+' '+z+raw
   }
   candidates.push({...message,id:'synthetic-'+code,message_code:code,direction:same?'inbound':'outbound',status:same?'received':'sent',sender_ediel_id:same?'12345':'54321',receiver_ediel_id:same?'54321':'12345',message_received_at:'2026-09-19T00:00:00Z',message_sent_at:'2026-09-19T00:00:00Z',raw_payload:raw})
  }
 }
 return assessPriorPermissionFlow(message,records,candidates)
}
