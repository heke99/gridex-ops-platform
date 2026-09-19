import {it,expect} from 'vitest'
import {copyDeathSelection,deathCondition} from '@/lib/ediel/prodat/prodatDeathStatus'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {resolveProdatRegisterConditionFacts,createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {deathSelection,deathBody,deathRaw} from './fixtures/prodat-death-status'
import {alphabets,input,characteristic,type Parts} from './fixtures/prodat-register'
const check=(code:string,body:Parts[],value:'death'|'not_death'|null,direction:'inbound'|'outbound',alphabet?:readonly string[])=>validateProdatDeathStatus({...input(deathRaw(code,body,alphabet),code),direction,facts:{deathStatus:value?deathSelection(value,code==='Z05'?'Z05':'Z06'):null}})
it('strict owner deepcopies provenance, rejects extra/missing nested keys, duplicates and mismatched event revision',()=>{
 const source=deathSelection(),copy=copyDeathSelection(source);source.objects[0].customer.id='changed';expect(copy.objects[0].customer.id).toBe('CUSTOMER-A')
 const changes:[string[],unknown][]=[
  [['objects','0','assessment','evidence','revision'],'wrong'],[['objects','0','event','eventKey'],'other'],
  [['objects','0','legalSupplier','extra'],true],[['objects','0','customer','revision'],undefined],
  [['source','kind'],'tgt'],[['objects','0','installation','id'],12],
 ]
 for(const [path,value] of changes){const v=deathSelection();let target:unknown=v;for(const key of path.slice(0,-1))target=(target as Record<string,unknown>)[key];Reflect.set(target as object,path.at(-1)!,value);expect(()=>copyDeathSelection(v)).toThrow('death_status_invalid')}
 const repeated=deathSelection();repeated.objects.push(repeated.objects[0]);expect(()=>copyDeathSelection(repeated)).toThrow('death_status_invalid')

})
it('explicit clear and empty selection do not resurrect root fallback or persisted authority',()=>{
 const original={deathStatus:deathSelection(),businessContext:'death'}
 expect(resolveProdatRegisterConditionFacts(original,{dependentConditionFacts:{deathStatus:null}}).deathStatus).toBeNull()
 expect(resolveProdatRegisterConditionFacts(original,{dependentConditionFacts:{deathStatus:{source:original.deathStatus.source,objects:[]}}}).deathStatus?.objects).toEqual([])
 const wire=input(deathRaw()),evidence=createProdatRegisterEvidence({code:'Z06',rawSegments:wire.rawSegments,facts:original})
 expect(()=>readProdatRegisterEvidence({code:'Z06',rawSegments:wire.rawSegments,parsedPayload:{prodatEngine:{registerEvidence:evidence}}})).toThrow('prodat_register_evidence_invalid')
})
for(const alphabet of alphabets){
 it(`known false ignores all incoming extra310 before bad code/qualifiers ${alphabet.join('')}`,()=>{
  expect(check('Z06',deathBody('E34',[['CCI','BAD',['Z17','EXTRA']],['CAV',['BAD','X','9','text']]]),'not_death','inbound',alphabet)).toEqual([])
  expect(check('Z05',deathBody('Z22',characteristic('Z17','BAD')),null,'inbound',alphabet)).toEqual([])
 })
 it(`true and U qualifier/code matrix ${alphabet.join('')}`,()=>{
  for(const value of ['death',null] as const){
   for(const parts of [['BAD'],['Z41','BAD'],['Z41','','9']])expect(check('Z06',deathBody('E34',[['CCI','','Z17'],['CAV',parts]]),value,'inbound',alphabet).some(i=>i.blocking)).toBe(true)
   expect(check('Z06',deathBody('E34',[['CCI','EXTRA',['Z17','X']],['CAV',['Z41','','','ignored','ignored']]]),value,'inbound',alphabet)).toEqual([])
   expect(check('Z06',deathBody(),value,'inbound',alphabet).some(i=>i.code.endsWith('_REQUIRED'))).toBe(value==='death')
  }
 })
 it(`outgoing unused residuals forbidden, actual binding mismatch cannot borrow death ${alphabet.join('')}`,()=>{
  expect(check('Z06',deathBody('E34',[['CCI','X','Z17'],['CAV',['Z41','','','text']]]),'death','outbound',alphabet).some(i=>i.code.endsWith('_UNUSED_COMPONENT'))).toBe(true)
  const wire=input(deathRaw('Z06',deathBody('E34',[],'B'),alphabet),'Z06')
  expect(validateProdatDeathStatus({...wire,facts:{deathStatus:deathSelection()},direction:'outbound'}).some(i=>i.code.endsWith('_UNDETERMINED'))).toBe(true)
 })
}
it('Z09E has no independent event prerequisite and excluded valid subtypes are false',()=>{
 expect(deathCondition('Z09','E')).toBe(true)
 for(const [code,sub] of [['Z05','L'],['Z06','F'],['Z06','G'],['Z09','B'],['Z09','D'],['Z09','F'],['Z09','G']])expect(deathCondition(code,sub)).toBe(false)
 expect(deathCondition('Z05','V')).toBeNull()
})
it('outbound extra status outside own first register cannot bypass policy',()=>{
 const body=[...characteristic('Z17','Z41'),...deathBody('Z22')]
 expect(check('Z05',body,null,'outbound').some(i=>i.code.endsWith('_OCCURRENCE_INVALID'))).toBe(true)
})
it('full envelope with valid own nondeath does not invent a prefix object',()=>{
 expect(check('Z06',deathBody(),'not_death','outbound')).toEqual([])
})

for(const alphabet of alphabets)it(`own occurrence scope cannot borrow adjacent object/message/later register ${alphabet.join('')}`,()=>{
 const selected=deathSelection('not_death'),wire=input(deathRaw('Z06',deathBody('E34',characteristic('Z17','BAD')),alphabet),'Z06')
 for(const field of ['customer','legalSupplier','legalGridOwner'] as const){const facts=deathSelection('not_death');facts.objects[0][field].id='other';const issues=validateProdatDeathStatus({...wire,facts:{deathStatus:facts},direction:'inbound'});expect(issues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_VALUE_INVALID');expect(issues.filter(i=>i.code.endsWith('_CONTEXT_MISMATCH')).every(i=>!i.blocking)).toBe(true)}
 selected.objects[0].lineItemReference='different';expect(validateProdatDeathStatus({...wire,facts:{deathStatus:selected},direction:'inbound'}).map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_VALUE_INVALID')
 const second=deathRaw('Z09',deathBody('E34',[],'B'),alphabet),firstMessage=deathRaw('Z09',deathBody('E34',characteristic('Z17','Z41')),alphabet)
 const two=firstMessage.slice(0,firstMessage.indexOf(`UNZ${alphabet[1]}`))+second.slice(second.indexOf(`UNH${alphabet[1]}`)).replace(`UNZ${alphabet[1]}1`, `UNZ${alphabet[1]}2`)
 expect(validateProdatDeathStatus({...input(two,'Z09'),direction:'inbound'}).filter(i=>i.code.endsWith('_REQUIRED'))).toEqual([expect.objectContaining({meteringPointId:'B',lineItemReference:'LI-B'})])
 const first=deathBody();first[0]=['LIN','1','',['A','','','89'],['1','1']]
 const later=[['LIN','2','',['A','','','89'],['1','2']],...characteristic('Z17','Z41')]
 expect(validateProdatDeathStatus({...input(deathRaw('Z06',[...first,...later],alphabet),'Z06'),facts:{deathStatus:deathSelection()},direction:'inbound'}).filter(i=>i.code.endsWith('_REQUIRED'))).toHaveLength(1)
})
it('applicable duplicate CAV values are ambiguous, while known false extra field stays ignored',()=>{
 const body=deathBody('E34',[...characteristic('Z17','Z41'),['CAV','BAD']])
 expect(check('Z06',body,'death','inbound').map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_OCCURRENCE_INVALID')
 expect(check('Z06',body,'not_death','inbound')).toEqual([])
})
