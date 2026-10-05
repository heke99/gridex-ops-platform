// Independent synthetic source snapshots. No persisted adapter or live authority.
export function identity(code='Z04',reason='Z22',kind:'TIM'|'SCH'|'unknown'='TIM',seriesId='ACTUAL-TIM-SERIES'){
 const source={reference:'reporting-source-A',revision:'source-r2'}
 return {source:{kind:'caller_selection' as const,reference:'selected-reporting-snapshot'},objects:[{
  objectKey:'OBJECT-A',installation:{id:'A',agency:'89'},lineItemReference:'EVENT-A',process:{code,reason},
  source,event:code==='Z10'||code==='Z06'&&reason!=='E34'?{key:'EVENT-A',revision:'r1'}:null,
  assessment:kind==='unknown'?{kind}:{kind,...(kind==='TIM'?{seriesId}:{}),evidence:{sourceReference:'reporting-source-A',sourceRevision:'source-r2'}} as {kind:'TIM'|'SCH'|'unknown';seriesId?:string;evidence?:{sourceReference:string;sourceRevision:string}},
 }]}
}
