import type {DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import {line,characteristic,raw,type Parts} from './prodat-register'
export function deathSelection(value:'death'|'not_death'='death',code:'Z05'|'Z06'='Z06'):DeathSelection{
 const ref=(key:string)=>({key,eventKey:'event-A',revision:'2',reference:`independent:${key}`})
 return {source:{kind:'caller_selection',reference:'independent synthetic source'},objects:[{objectKey:'object-A',installation:{id:'A',agency:'89'},customer:{kind:'domain_customer',key:'customer-A',revision:'1',id:'CUSTOMER-A',qualifier:'',agency:'89'},legalSupplier:{id:'SUPPLIER',qualifier:'',agency:'9'},legalGridOwner:{id:'GRID',qualifier:'',agency:'9'},process:code==='Z05'?{code,reason:'Z23'}:{code,reason:'E34'},event:ref('event-A'),assessment:{kind:'known',value,evidence:ref('assessment-A')},lineItemReference:'LI-A'}]}
}
export function deathBody(reason='E34',status:Parts[]=[] ,id='A',seq='1'):Parts[]{return [line(seq,id),...characteristic('Z13',reason),...status,['RFF',['LI',`LI-${id}`]],['NAD','UD',[`CUSTOMER-${id}`,'','89'],'','Synthetic']]}
export const deathRaw=(code='Z06',body=deathBody(),alphabet?:readonly string[])=>raw([['NAD','FR',['GRID','','9']],['NAD','DO',['SUPPLIER','','9']],...body],code,alphabet)
