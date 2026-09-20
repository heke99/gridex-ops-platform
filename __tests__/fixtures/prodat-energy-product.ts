import {raw,characteristic,line,type Parts,alphabets} from './prodat-register'
import {head,source} from './prodat-identity'
// Independent synthetic fixtures following original P26.A r3 pp137–138.
// Z13 and Z14N deliberately omit object209; all national expectations are literals.
export function permissionObject(code='Z14', reason='S17', energy:string|null='8716867000030', sequence='1', li='CASE:A+B?C'):Parts[]{
 const negative=reason==='Z96'
 return [code==='Z13'||negative?['LIN',sequence]:line(sequence,'735123456789012345',undefined,'9'),
 ...(!negative?[['DTM',['90','202610010000','203']] as Parts,...(reason==='S18'?[['DTM',['91','202611010000','203']] as Parts]:[]),
 ...(code==='Z14'?[['DTM',['354','15','806']] as Parts,['DTM',['693','202609171200','203']] as Parts]:[]),
 ...characteristic('Z04',code==='Z13'?'Z03':'Z04'),...characteristic('Z22','E19'),...characteristic('Z12','D',3),...characteristic('Z24','B72')]:[]),
 ...characteristic('Z13',reason),...(energy===null?[]:characteristic('Z14',energy,4)),
 ...(code==='Z14'?characteristic('Z23',negative?'A76':'A74'):[]),
 ...(code==='Z14'&&!negative?[['RFF',['Z05','NET']] as Parts,['RFF',['Z09','PERMISSION']] as Parts]:[]),
 ['RFF',['LI',li]],...(code==='Z13'?[['RFF',['ANJ','AGREEMENT']] as Parts]:[]),
 ...(code==='Z14'&&!negative?[['NAD','IT',['735123456789012345','','9'],'','','Street','City','','12345','SE'] as Parts]:[]),
 ...(!negative?[['NAD','UD',['001','','89'],'','Synthetic','','','','','SE'] as Parts]:[])]
}
export function permissionWire(code='Z14',reason='S17',energy:string|null='8716867000030',alphabet:readonly string[]=alphabets[0],body?:Parts[]){
 return raw([...head(),...(body??permissionObject(code,reason,energy))],code,alphabet).replace('23-DDQ-PRODAT','23-DGI-PRODAT')
}
export function permissionMessage(code='Z14',reason='S17',energy:string|null='8716867000030'){
 return {...source(permissionWire(code,reason,energy),code),application_reference:'23-DGI-PRODAT'}
}
