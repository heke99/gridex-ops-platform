import {raw,line,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {tokenizeEdifact,segmentSourceSpan} from '@/lib/ediel/core/edifactTokenizer'
/** Fixed original-field oracle, independent of the E renderer under test.
 * First register owns UD/IV/date/LI; a later same-object register adds no party. */
export function bilateralCustomerNativeWire(input:{sender:string;receiver:string;point:string;customerIdentity:string;reference:string;name?:string;repeatRegister?:boolean;invoicee?:boolean;marketMinute?:string}){
 const body:Parts[]=[['NAD','FR',[input.sender,'160','SVK'],'','','','','','','SE'],['NAD','DO',[input.receiver,'160','SVK'],'','','','','','','SE'],
 line('1',input.point,input.repeatRegister?'1':undefined,'9'),['DTM',['157',input.marketMinute??'202610050000','203']],...characteristic('Z13','E34'),...characteristic('Z12','D',3),['RFF',['Z05','TES']],['RFF',['LI',input.reference]],
 ['NAD','UD',[input.customerIdentity,'SE2','260'],'',input.name??'SYNTHETIC DATED CUSTOMER','TEST ROAD 1','TEST','','12345','SE'],
 ['NAD','IT',[input.point,'','9'],'','','BASELINE INSTALLATION ROAD','TEST','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
  ...(input.invoicee?[['NAD','IV',[input.customerIdentity,'SE2','260'],'','SYNTHETIC INVOICEE','OTHER ROAD 2','TEST','','54321','SE'] as Parts]:[]),
 ...(input.repeatRegister?[line('2',input.point,'2','9'),...characteristic('Z13','E34')]:[])]
 let wire=raw(body,'Z06').replace('+S+R+',`+${input.sender}:14+${input.receiver}:14+`)
 const parsed=tokenizeEdifact(wire),header=parsed.segments.find(segment=>segment.tag==='UNB')!,span=segmentSourceSpan(header)!,parts=header.raw.split(parsed.una.dataElementSeparator)
 while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1'
 wire=wire.slice(0,span.startOffset)+parts.join(parsed.una.dataElementSeparator)+wire.slice(span.endOffset)
 return wire
}
