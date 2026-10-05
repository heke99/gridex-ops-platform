import {identity} from './fixtures/prodat-gas-identity'
import {it,expect} from 'vitest'
import {copyGasSerialChangeSelection,gasRequirement} from '@/lib/ediel/prodat/prodatGasApplicability'
import {evaluateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
import {copyProdatRegisterFacts,resolveProdatRegisterConditionFacts,createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {payload} from './fixtures/prodat-gas'
import {raw,line,characteristic,input,alphabets,type Parts} from './fixtures/prodat-register'
import {selection} from './fixtures/prodat-gas'
const check=(wire:string,code='Z06',direction:'inbound'|'outbound'='outbound',gasSerialChange?:unknown,gasReportingIdentity?:unknown)=>evaluateProdatGasApplicability({...input(wire,code),direction,facts:{gasSerialChange:gasSerialChange as never,gasReportingIdentity:gasReportingIdentity as never}})
const errors=(r:ReturnType<typeof check>)=>r.issues.filter(i=>i.blocking).map(i=>i.code)
// Literal table from original pp21/65/77/110; requirement kind must survive false.
for(const [code,subtype,field,changed,want] of [
 ['Z04','L','320',undefined,'required'],['Z04','D','240',undefined,'required'],
 ['Z06','E','320',undefined,'forbidden'],['Z06','E','240',undefined,'optional'],
 ['Z06','F','320',undefined,'required'],['Z06','G','320',undefined,'required'],
 ['Z06','F','240',true,'required'],['Z06','G','240',false,'optional'],
 ['Z06','F','240',undefined,'undetermined'],['Z10','M','240',true,'required'],
 ['Z10','M','240',false,'optional'],['Z10','M','240',undefined,'undetermined'],
 ['Z10','F','240',true,'undetermined'],
] as const)it(`source table ${code}/${subtype}/${field}/${changed}`,()=>{
 expect(gasRequirement(code,field,'gas',subtype,changed)).toBe(want)
 expect(gasRequirement(code,field,'electricity',subtype,changed)).toBe('forbidden')
 expect(gasRequirement(code,field,null,subtype,changed)).toBe('undetermined')
})
it('strict causal evidence copies, rejects stale/cross-event/forged shapes and clears',()=>{
 const source=selection(true),copy=copyGasSerialChangeSelection(source)
 source.objects[0].event.key='mutated';expect(copy.objects[0].event.key).toBe('EVENT-A')
 const bads:unknown[]=[{}, {...selection(true),extra:1},{...selection(true),objects:[]}, {...selection(true),source:{kind:'server',reference:'x'}}]
 const duplicate=selection(true);duplicate.objects.push(structuredClone(duplicate.objects[0]));bads.push(duplicate)
 for(const path of ['eventRevision','eventKey']){const s=selection(true);if(s.objects[0].assessment.kind==='known')s.objects[0].assessment.evidence[path as 'eventKey']='wrong';bads.push(s)}
 const bool=selection(true);Reflect.set(bool.objects[0].assessment,'changed','true');bads.push(bool)
 const own=selection(true);Reflect.set(own.objects[0],'unknown','value');bads.push(own)
 for(const bad of bads)expect(()=>copyGasSerialChangeSelection(bad)).toThrow('prodat_register_evidence_gas_serial_change_invalid')
 for(const gasSerialChange of [undefined,null])expect(copyProdatRegisterFacts({gasSerialChange})).toMatchObject({gasSerialChange:null})
 expect(copyProdatRegisterFacts({}).gasSerialChange).toBeUndefined()
})
for(const alphabet of alphabets)it(`actual wire market beats root hints and requires coherent own envelope ${alphabet}`,()=>{
 const wire=payload('Z04','Z22',[['RFF',['Z08','bad']],['RFF',['Z06','bad']]],'electricity',alphabet)
 expect(errors(evaluateProdatGasApplicability({...input(wire),facts:{market:'gas',byCell:{'Z04:320':true}}}))).toEqual(['PRODAT_GAS_320_FORBIDDEN','PRODAT_GAS_240_FORBIDDEN'])
 expect(errors(check(wire,'Z04','inbound'))).toEqual([])
 for(const malformed of [wire.replace('E2SE6A','E2SE6B'),wire.replace('23-DDQ-PRODAT','UNKNOWN'),wire.slice(0,9)+wire.slice(wire.indexOf('UNH'))])expect(check(malformed,'Z04').requirements.get('320')).toBe('undetermined')
})
it('GAS 320 cardinality and exact RFF slots; false/grey input content ignored',()=>{
 expect(errors(check(payload('Z06','E32',[],'gas')))).toContain('PRODAT_GAS_320_REQUIRED')
 for(const value of ['', 'x'.repeat(36)])expect(errors(check(payload('Z06','E32',[['RFF',['Z08',value]]],'gas'),'Z06','inbound'))).toContain('PRODAT_GAS_320_VALUE_INVALID')
 const extra:Parts[]=[['RFF',['Z08','HEAT','UNUSED','VERSION']],['RFF',['Z06','Å'.repeat(36),'unused']]]
 expect(errors(check(payload('Z06','E34',extra,'gas'),'Z06','inbound'))).toEqual([])
 expect(errors(check(payload('Z06','E32',extra,'gas'),'Z06','inbound'))).toEqual([])
 const out=errors(check(payload('Z06','E34',extra,'gas')))
 expect(out).toContain('PRODAT_GAS_320_FORBIDDEN');expect(out).toContain('PRODAT_GAS_240_VALUE_INVALID')
 expect(errors(check(payload('Z06','E32',[['RFF',['Z08','HEAT','unused']]],'gas')))).toContain('PRODAT_GAS_320_UNUSED_COMPONENT')
})
it('own event evidence determines condition; emitted serial, foreign agency/LI/process do not',()=>{
 const wire=payload('Z06','E64',[['RFF',['Z08','HEAT']],['RFF',['Z06','SERIAL']]],'gas')
 for(const changed of [true,false,undefined])expect(check(wire,'Z06','outbound',selection(changed)).requirements.get('240')).toBe(changed===true?'required':changed===false?'optional':'undetermined')
 for(const mutation of ['agency','lineItemReference','reason'] as const){const s=selection(true);if(mutation==='agency')s.objects[0].installation.agency='9';else if(mutation==='reason')s.objects[0].process.reason='E32';else s.objects[0].lineItemReference='OTHER';expect(check(wire,'Z06','outbound',s).requirements.get('240')).toBe('undetermined')}
 const bad={source:{kind:'caller_selection',reference:'x'},objects:[null]}
 expect(check(wire,'Z06','inbound',bad).issues).toContainEqual(expect.objectContaining({code:'PRODAT_GAS_EVIDENCE_INVALID',blocking:false,severity:'warning'}))
})
it('first register and exact own message/object scope cannot borrow common data or causal evidence',()=>{
 const body:Parts[]=[line('1','A','1'),...characteristic('Z13','E64'),['RFF',['LI','EVENT-A']],line('2','A','2'),['RFF',['Z08','LATE']],['RFF',['Z06','LATE']]]
 const wire=raw(body,'Z06').replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 expect(errors(check(wire))).toContain('PRODAT_GAS_320_REQUIRED')
 const other=payload('Z06','E64',[['RFF',['Z08','HEAT']]],'gas')
 const joined=other.slice(0,other.indexOf("UNZ+"))+other.slice(other.indexOf('UNH+'))
 expect(check(joined,'Z06','outbound',selection(true)).requirements.get('240')).toBe('undetermined')
 const misplaced=raw([['RFF',['Z08','HEAT']],line('1','A'),...characteristic('Z13','E32'),['RFF',['LI','EVENT-A']]],'Z06').replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 expect(errors(check(misplaced))).toContain('PRODAT_GAS_320_OCCURRENCE_INVALID')
})
for(const alphabet of alphabets)it(`decoded RFF value length and released fake tag remain source data ${alphabet}`,()=>{
 const value='x'.repeat(31)+alphabet.join('')
 const valid=payload('Z04','Z22',[['RFF',['Z08',value]],['RFF',['Z06','SERIES']]],'gas',alphabet)
 expect(errors(check(valid,'Z04','outbound',undefined,identity('Z04','Z22','TIM','SERIES')))).toEqual([])
 const long=payload('Z04','Z22',[['RFF',['Z08',value+'x']],['RFF',['Z06','SERIES']]],'gas',alphabet)
 expect(errors(check(long,'Z04','outbound',undefined,identity('Z04','Z22','TIM','SERIES')))).toEqual(['PRODAT_GAS_320_VALUE_INVALID'])
 const fake=payload('Z04','Z22',[['FTX','AAI','','',"'RFF+Z08:FAKE"],['RFF',['Z06','SERIES']]],'gas',alphabet)
 expect(errors(check(fake,'Z04','outbound',undefined,identity('Z04','Z22','TIM','SERIES')))).toContain('PRODAT_GAS_320_REQUIRED')
})
it('GAS Z10M own E58 accepts causal false as optional and never borrows another object',()=>{
 const wire=payload('Z10','E58',[],'gas')
 expect(check(wire,'Z10','outbound',selection(false,'Z10')).requirements.get('240')).toBe('optional')
 const foreign=selection(true,'Z10');foreign.objects[0].installation.id='B'
 expect(check(wire,'Z10','outbound',foreign).requirements.get('240')).toBe('undetermined')
})

it('fresh source copies clear stale selection; serialization cannot confer persisted authority',()=>{
 const gasSerialChange=selection(true)
 for(const current of [{},{gasSerialChange:undefined},{gasSerialChange:null}]){
  expect(resolveProdatRegisterConditionFacts({gasSerialChange},{dependentConditionFacts:current}).gasSerialChange).toBe(Object.hasOwn(current,'gasSerialChange')?null:undefined)
 }
 const wire=input(payload('Z06','E64',[],'gas'),'Z06')
 const evidence=createProdatRegisterEvidence({...wire,facts:{gasSerialChange}})
 gasSerialChange.objects[0].event.revision='mutation'
 expect(evidence.facts.gasSerialChange?.objects[0].event.revision).toBe('r1')
 expect(()=>readProdatRegisterEvidence({...wire,parsedPayload:{prodatEngine:{registerEvidence:evidence}}})).toThrow('prodat_register_evidence_invalid')
})
for(const alphabet of alphabets)it(`causal240 requires one exact unfiltered own LI ${alphabet}`,()=>{
 const own=(refs:Parts[])=>raw([line('1','A'),...characteristic('Z13','E64'),...refs],'Z06',alphabet).replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
 for(const refs of [
  [['RFF',['LI','EVENT-A']],['RFF',['LI','']]],
  [['RFF',['LI','EVENT-A']],['RFF',['LI','OTHER']]],
  [['RFF',['li','EVENT-A']]], [['RFF',[' LI','EVENT-A']]],
  [['NAD','UD'],['RFF',['LI','EVENT-A']]],
  [['RFF',['LI','EVENT-A']],['NAD','UD'],['RFF',['LI','']]],
 ] as Parts[][]){
  expect(check(own(refs),'Z06','outbound',selection(true)).requirements.get('240')).toBe('undetermined')
  expect(check(own(refs),'Z06','inbound',selection(true)).issues.filter(i=>i.fieldPath==='RFF+Z06'&&i.blocking)).toEqual([])
 }
 expect(check(own([['RFF',['LI','EVENT-A']]]),'Z06','outbound',selection(true)).requirements.get('240')).toBe('required')
 const literal='EVENT'+alphabet.join(''),facts=selection(true);facts.objects[0].lineItemReference=literal
 expect(check(own([['RFF',['LI',literal]]]),'Z06','outbound',facts).requirements.get('240')).toBe('required')
})
