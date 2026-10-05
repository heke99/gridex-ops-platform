import {it,expect} from 'vitest'
import {evaluateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
import {copyProdatRegisterFacts,resolveProdatRegisterConditionFacts,createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {payload,selection,alphabets,input} from './fixtures/prodat-gas'
import {raw,line,characteristic,type Parts} from './fixtures/prodat-register'
import {identity} from './fixtures/prodat-gas-identity'
const codes=(result:ReturnType<typeof evaluateProdatGasApplicability>)=>result.issues.filter(i=>i.blocking&&i.fieldPath==='RFF+Z06').map(i=>i.code)
const facts=(reporting:unknown,changed?:boolean,code='Z04',reason='Z22')=>{
 const gasSerialChange=code==='Z10'?selection(changed,'Z10'):code==='Z06'&&reason!=='E34'?selection(changed):undefined
 if(gasSerialChange&&code==='Z06')gasSerialChange.objects[0].process.reason=reason as 'E64'|'E32'
 return {gasReportingIdentity:reporting,gasSerialChange} as never
}
const check=(value:string|null,reporting:unknown,code='Z04',reason='Z22',changed?:boolean,direction:'inbound'|'outbound'='outbound',alphabet:readonly string[]=alphabets[0])=>evaluateProdatGasApplicability({...input(payload(code,reason,value===null?[]:[['RFF',['Z06',value]]],'gas',alphabet),code),fields:['240'],direction,facts:facts(reporting,changed,code,reason)})
for(const [code,reason] of [['Z04','Z22'],['Z06','E64'],['Z06','E32'],['Z10','E58']]){
 it(`${code}/${reason} TIM actual reporting ID rejects installation substitution and unrelated series`,()=>{
  expect(codes(check('ACTUAL-TIM-SERIES',identity(code,reason),code,reason,true))).toEqual([])
  for(const wrong of ['A','UNRELATED-SERIES'])expect(codes(check(wrong,identity(code,reason),code,reason,true))).toEqual(['PRODAT_GAS_240_IDENTITY_MISMATCH'])
 })
 it(`${code}/${reason} SCH requires exact own installation; TIM may independently equal it`,()=>{
  expect(codes(check('A',identity(code,reason,'SCH'),code,reason,true))).toEqual([])
  expect(codes(check('B',identity(code,reason,'SCH'),code,reason,true))).toEqual(['PRODAT_GAS_240_IDENTITY_MISMATCH'])
  expect(codes(check('A',identity(code,reason,'TIM','A'),code,reason,true))).toEqual([])
 })
 it(`${code}/${reason} required omission stays missing while absent/unknown authority blocks supplied value`,()=>{
  expect(codes(check(null,undefined,code,reason,true))).toEqual(['PRODAT_GAS_240_REQUIRED'])
  for(const source of [undefined,null,identity(code,reason,'unknown')])expect(codes(check('A',source,code,reason,true))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
 })
}
for(const [code,reason] of [['Z06','E64'],['Z06','E32'],['Z10','E58']])it(`${code}/${reason} causal false omission needs no identity; supplied optional still compares; unknown never becomes required`,()=>{
 expect(codes(check(null,{malformed:true},code,reason,false))).toEqual([])
 expect(check(null,undefined,code,reason,false).requirements.get('240')).toBe('optional')
 expect(codes(check('WRONG',identity(code,reason),code,reason,false))).toEqual(['PRODAT_GAS_240_IDENTITY_MISMATCH'])
 expect(codes(check('ACTUAL-TIM-SERIES',identity(code,reason),code,reason,undefined))).toEqual(['PRODAT_GAS_240_UNDETERMINED'])
})
it('specific Z06E remains optional without causal event but supplied value needs authority',()=>{
 expect(codes(check(null,undefined,'Z06','E34'))).toEqual([])
 expect(codes(check('ACTUAL-TIM-SERIES',identity('Z06','E34'),'Z06','E34'))).toEqual([])
 expect(codes(check('A',identity('Z06','E34'),'Z06','E34'))).toEqual(['PRODAT_GAS_240_IDENTITY_MISMATCH'])
})
for(const dimension of ['id','agency','li','code','reason','eventKey','eventRevision','sourceReference','sourceRevision'] as const)it(`independent ${dimension} mismatch cannot qualify outgoing identity`,()=>{
 const selected=identity('Z06','E64'),object=selected.objects[0]
 if(dimension==='id')object.installation.id='B'
 if(dimension==='agency')object.installation.agency='9'
 if(dimension==='li')object.lineItemReference='OTHER'
 if(dimension==='code')object.process.code='Z10'
 if(dimension==='reason')object.process.reason='E32'
 if(dimension==='eventKey')object.event!.key='OTHER'
 if(dimension==='eventRevision')object.event!.revision='r0'
 if(dimension==='sourceReference')object.assessment.evidence!.sourceReference='OTHER'
 if(dimension==='sourceRevision')object.assessment.evidence!.sourceRevision='source-r1'
 expect(codes(check('ACTUAL-TIM-SERIES',selected,'Z06','E64',true))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
})
it('strict selector copy rejects malformed, duplicate, stale and invented value shapes',()=>{
 const duplicate=identity();duplicate.objects.push(structuredClone(duplicate.objects[0]))
 const stale=identity();stale.objects[0].assessment.evidence!.sourceRevision='old'
 const bads:unknown[]=[{}, {...identity(),extra:1},{...identity(),objects:[]},{...identity(),objects:[null]},duplicate,stale]
 for(const kind of ['known','tim','MSCONS-TIM']){const bad=identity();Reflect.set(bad.objects[0].assessment,'kind',kind);bads.push(bad)}
 for(const key of ['seriesId','evidence']){const bad=identity();Reflect.deleteProperty(bad.objects[0].assessment,key);bads.push(bad)}
 const sch=identity('Z04','Z22','SCH');Reflect.set(sch.objects[0].assessment,'seriesId','A');bads.push(sch)
 const unknown=identity('Z04','Z22','unknown');Reflect.set(unknown.objects[0].assessment,'seriesId','A');bads.push(unknown)
 for(const bad of bads){
  expect(()=>copyProdatRegisterFacts({gasReportingIdentity:bad})).toThrow('prodat_register_evidence_gas_reporting_identity_invalid')
  expect(codes(check('A',bad))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
 }
})
it('identity copies and clears, and body-bound serialization cannot confer persisted authority',()=>{
 const selected=identity(),copy=copyProdatRegisterFacts({gasReportingIdentity:selected}) as unknown as {gasReportingIdentity:ReturnType<typeof identity>}
 selected.objects[0].source.revision='mutation'
 expect(copy.gasReportingIdentity).toMatchObject({objects:[{source:{revision:'source-r2'}}]})
 for(const current of [{},{gasReportingIdentity:undefined},{gasReportingIdentity:null}]){
  const result=resolveProdatRegisterConditionFacts({gasReportingIdentity:identity()} as never,{dependentConditionFacts:current}) as unknown as {gasReportingIdentity:unknown}
  expect(result.gasReportingIdentity).toBe(Object.hasOwn(current,'gasReportingIdentity')?null:undefined)
 }
 const wire=input(payload('Z04','Z22',[['RFF',['Z06','ACTUAL-TIM-SERIES']]],'gas'))
 const evidence=createProdatRegisterEvidence({...wire,facts:{gasReportingIdentity:identity()} as never})
 expect(()=>readProdatRegisterEvidence({...wire,parsedPayload:{prodatEngine:{registerEvidence:JSON.parse(JSON.stringify(evidence))}}})).toThrow('prodat_register_evidence_invalid')
})
for(const alphabet of alphabets)it(`decoded exact value and restrictions under ${alphabet}`,()=>{
 const value='X'.repeat(31)+alphabet.join('')
 expect(codes(check(value,identity('Z04','Z22','TIM',value),'Z04','Z22',undefined,'outbound',alphabet))).toEqual([])
 expect(codes(check(value+'X',identity('Z04','Z22','TIM',value+'X'),'Z04','Z22',undefined,'outbound',alphabet))).toContain('PRODAT_GAS_240_VALUE_INVALID')
 for(const value of ['ÅBC','Ö','ä',''])expect(codes(check(value,identity('Z04','Z22','TIM',value)))).toContain('PRODAT_GAS_240_VALUE_INVALID')
 const wrong=value.slice(0,-1)+'Y'
 expect(codes(check(wrong,identity('Z04','Z22','TIM',value),'Z04','Z22',undefined,'outbound',alphabet))).toEqual(['PRODAT_GAS_240_IDENTITY_MISMATCH'])
})
it('incoming gray240 never consults new identity even malformed supplied content',()=>{
 for(const source of [identity(),{malformed:true},null])for(const value of ['WRONG','Å'.repeat(36),null])expect(codes(check(value,source,'Z04','Z22',undefined,'inbound'))).toEqual([])
})
it('electricity X excludes malformed extra before identity lookup',()=>{
 const result=evaluateProdatGasApplicability({...input(payload('Z04','Z22',[['RFF',['Z06','Å']]])),fields:['240'],facts:facts({malformed:true})})
 expect(codes(result)).toEqual(['PRODAT_GAS_240_FORBIDDEN'])
})
it('exact first register ownership and repeated message identity cannot borrow authority',()=>{
 const body:Parts[]=[line('1','A','1'),...characteristic('Z13','Z22'),['RFF',['LI','EVENT-A']],line('2','A','2'),['RFF',['Z06','ACTUAL-TIM-SERIES']]]
 const wire=raw(body).replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 expect(codes(evaluateProdatGasApplicability({...input(wire),fields:['240'],facts:facts(identity())}))).toEqual(['PRODAT_GAS_240_OCCURRENCE_INVALID','PRODAT_GAS_240_REQUIRED'])
 const one=payload('Z04','Z22',[['RFF',['Z06','ACTUAL-TIM-SERIES']]],'gas')
 const joined=one.slice(0,one.indexOf('UNZ+'))+one.slice(one.indexOf('UNH+'))
 expect(codes(evaluateProdatGasApplicability({...input(joined),fields:['240'],facts:facts(identity())}))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED','PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
})
it('strict selector never coerces nonstring process reason into a supported code',()=>{
 const forged=identity();Reflect.set(forged.objects[0].process,'reason',{toString:()=> 'Z22'})
 expect(()=>copyProdatRegisterFacts({gasReportingIdentity:forged})).toThrow('prodat_register_evidence_gas_reporting_identity_invalid')
})
for(const alphabet of alphabets)it(`identity requires one exact own LI and source placement under ${alphabet}`,()=>{
 for(const refs of [
  [['RFF',['LI','EVENT-A']],['RFF',['LI','']]],
  [['RFF',['LI','EVENT-A']],['RFF',['LI','OTHER']]],
  [['RFF',['li','EVENT-A']]], [['RFF',[' LI','EVENT-A']]],
  [['NAD','UD'],['RFF',['LI','EVENT-A']]],
 ] as Parts[][]){
  const wire=raw([line('1','A'),...characteristic('Z13','Z22'),...refs,['RFF',['Z06','ACTUAL-TIM-SERIES']]],'Z04',alphabet).replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
  expect(codes(evaluateProdatGasApplicability({...input(wire),fields:['240'],facts:facts(identity())}))).not.toEqual([])
 }
 const li='EVENT'+alphabet.join(''),selected=identity();selected.objects[0].lineItemReference=li
 const wire=raw([line('1','A'),...characteristic('Z13','Z22'),['RFF',['LI',li]],['RFF',['Z06','ACTUAL-TIM-SERIES']]],'Z04',alphabet).replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 expect(codes(evaluateProdatGasApplicability({...input(wire),fields:['240'],facts:facts(selected)}))).toEqual([])
})
it('second object cannot borrow first installation reporting identity',()=>{
 const body:Parts[]=[line('1','A'),...characteristic('Z13','Z22'),['RFF',['LI','EVENT-A']],['RFF',['Z06','ACTUAL-TIM-SERIES']],line('2','B'),...characteristic('Z13','Z22'),['RFF',['LI','EVENT-B']],['RFF',['Z06','ACTUAL-TIM-SERIES']]]
 const wire=raw(body).replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 const result=evaluateProdatGasApplicability({...input(wire),fields:['240'],facts:facts(identity())})
 expect(result.issues.filter(i=>i.blocking)).toEqual([expect.objectContaining({code:'PRODAT_GAS_240_IDENTITY_UNDETERMINED',meteringPointId:'B',lineItemReference:'EVENT-B'})])
})
it('new identity source does not infer regime or value from unrelated metadata',()=>{
 for(const inferred of [ {market:'gas',serialId:'A'}, {regime:'TIM',seriesId:'A'}, {meterNumber:'A',product:'GAS',resolution:'PT1H'}, {id:'internal-series-uuid'} ])expect(codes(check('A',inferred))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
 for(const bad of ['', ' '.repeat(2), 'Å', 'x'.repeat(36)])expect(codes(check('A',identity('Z04','Z22','TIM',bad)))).toEqual(['PRODAT_GAS_240_IDENTITY_UNDETERMINED'])
})
