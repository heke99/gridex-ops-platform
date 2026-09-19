import {it,expect} from 'vitest'
import {preflightEdielPayload,preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import type {EdielMessageRow} from '@/lib/ediel/types'
const raw=(reason:string,dates:string[])=>"UNA:+.? 'UNB+UNOC:3+12345:ZZ+54321:ZZ+260919:1200+I++23-DDQ-PRODAT'"+[
 'UNH+M+PRODAT:D:97A:UN:E2SE6A','BGM+Z09+DOC+9+AB','DTM+137:202609191200:203','DTM+ZZZ:1:805','NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE','LIN+1++A:::89',...dates,'CCI++Z13',`CAV+${reason}`,'RFF+LI:CASE','RFF+Z05:TES','NAD+Z02+11111:160:SVK',`UNT+${13+dates.length}+M`,'UNZ+1+I'].join("'")+"'"
function check(body:string,row:boolean,mode:'parse'|'send'='parse'){
 const message:Partial<EdielMessageRow>={company_id:'tenant',direction:mode==='parse'?'inbound':'outbound',environment:'test',message_family:'PRODAT',message_code:'Z09',raw_payload:body,message_standard:'edifact',parsed_payload:{rulebookAllowInvalidSend:true}}
 return row?preflightEdielMessageRow(message as EdielMessageRow,mode):preflightEdielPayload({rawPayload:body,messageStandard:'edifact',mode})
}
const dateIssues=(result:ReturnType<typeof check>)=>result.issues.filter(i=>i.code.includes('DATE_EVENT')||/DTM\+(92|93)|Fält (210|211)/.test(i.description??''))
for(const row of [false,true]){
 for(const qualifier of ['92','93'])it(`p119 own nonD extra${qualifier} ignored in ${row?'row':'raw'} parse`,()=>expect(dateIssues(check(raw('Z27',[`DTM+${qualifier}:202610010000:203`]),row))).toEqual([]))
 for(const dates of [[],['DTM+92:202610010000:203','DTM+93:202611010000:203'],['DTM+ 92:202610010000:203'],['DTM+93:202602300000:203']])it(`ownD XOR/applicable syntax remains blocking in ${row?'row':'raw'} parse ${dates}`,()=>expect(dateIssues(check(raw('Z70',dates),row)).some(i=>i.severity==='error')).toBe(true))
 it(`outbound own nonD extra remains protected in ${row?'row':'raw'} send`,()=>expect(dateIssues(check(raw('Z27',['DTM+92:202610010000:203']),row,'send')).some(i=>i.code.includes('DATE_EVENT_FORBIDDEN'))).toBe(true))
}
