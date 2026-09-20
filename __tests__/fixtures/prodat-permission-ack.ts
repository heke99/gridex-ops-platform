import {permissionObject} from './prodat-energy-product'
import {raw,characteristic,line,alphabets,type Parts} from './prodat-register'
import {head,source} from './prodat-identity'
export {alphabets,characteristic}
export function permissionAckObject(code='Z14',reason='S17',status:string|null='A74',end:string|null='B79',sequence='1',li='CASE:A+B?C'):Parts[]{
 if(['Z13','Z14'].includes(code)){
  const p=permissionObject(code,reason,'8716867000030',sequence,li),out:Parts[]=[]
  for(let i=0;i<p.length;i++){if(p[i][0]==='CCI'&&p[i][2]==='Z23'){if(status!==null)out.push(...characteristic('Z23',status));i++}else out.push(p[i])}
  return out
 }
 return [line(sequence,sequence==='1'?'735123456789012345':'735123456789012352',undefined,'9'),['DTM',['693','202609171200','203']],['DTM',['164','202610010000','203']],...characteristic('Z13',reason),...(code==='Z15'&&status!==null?characteristic('Z23',status):[]),...(end!==null?characteristic('Z25',end):[]),['RFF',['Z05','NET']],['RFF',['LI',li]],['RFF',['Z09','PERMISSION']],['NAD','UD',['001','','89'],'','Synthetic','','','','','SE']]
}
export function permissionAckMessage(code='Z14',reason='S17',status:string|null='A74',end:string|null='B79',alphabet:readonly string[]=alphabets[0],objects?:Parts[]){
 return {...source(raw([...head(),...(objects??permissionAckObject(code,reason,status,end))],code,alphabet).replace('23-DDQ-PRODAT','23-DGI-PRODAT'),code),company_id:'synthetic-company',application_reference:'23-DGI-PRODAT'}
}
