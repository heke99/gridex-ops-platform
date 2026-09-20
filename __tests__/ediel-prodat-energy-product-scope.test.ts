import {it,expect} from 'vitest'
import {evaluateIncomingProdatEnergyProduct} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {permissionWire,permissionObject,permissionMessage} from './fixtures/prodat-energy-product'
import {raw,line,input,characteristic,alphabets,type Parts} from './fixtures/prodat-register'
const evaluate=(wire:string)=>evaluateIncomingProdatEnergyProduct(input(wire))
for(const code of ['Z13','Z14'])for(const reason of ['S17','S18'])for(const index of [1,2])it(`${code}/${reason} rejects supplied wrong C889 qualifier ${index} as42/506`,()=>{
 const body=permissionObject(code,reason,null),parts=['','','','','8716867000030'];parts[index]='BAD';body.splice(1,0,['CCI','','Z14'],['CAV',parts])
 expect(evaluate(permissionWire(code,reason,null,alphabets[0],body)).issues).toMatchObject([{prodatDiagnostic:{fieldNumber:'506',errorKind:'invalid'}}])
})
it('binds applicability and references to each physical own LIN, including idless N',()=>{
 const body=[...permissionObject('Z14','S17',null,'1','FIRST'),...permissionObject('Z14','S18','INVALID','2','SECOND'),...permissionObject('Z14','Z96','INVALID','3','THIRD')]
 const result=evaluate(permissionWire('Z14','S17',null,alphabets[0],body))
 expect(result.objects.map(o=>o.applicability)).toEqual(['required','required','false'])
 expect(result.issues.map(i=>i.prodatDiagnostic)).toMatchObject([{fieldNumber:'506',errorKind:'missing',occurrence:{lineIndex:0,lineItemReference:'FIRST'}},{fieldNumber:'506',errorKind:'invalid',occurrence:{lineIndex:1,lineItemReference:'SECOND'}}])
})
for(const reason of ['', 'V','BAD'])it(`unknown own reason ${reason} cannot use root cache, byCell, sibling or energy presence`,()=>{
 const wire=permissionWire('Z14',reason,'INVALID'),data=input(wire,'Z14')
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:'V',applicationReference:'23-DGI-PRODAT',direction:'inbound',referenceDate:'2026-09-20',mode:'catalog_evidence'})
 const issues=validateCanonicalPolicyFields({policy:{...policy,prodatDependentFacts:{canonicalSubtype:'V',market:'electricity',byCell:{'Z14:506':true}}},rawSegments:data.rawSegments,una:data.una})
 expect(issues.filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='506')).toEqual([])
 expect(evaluate(wire).objects.map(o=>o.applicability)).toEqual(['unknown'])
})
it('duplicate, late and cross-object reasons remain U without506 rejection',()=>{
 for(const mode of ['duplicate','late','cross']){
  const body=permissionObject('Z14','S17','INVALID')
  if(mode==='duplicate')body.splice(1,0,...characteristic('Z13','S17'))
  else{const i=body.findIndex(p=>p[0]==='CCI'&&p[2]==='Z13');body.splice(i,2);if(mode==='late')body.push(...characteristic('Z13','S17'));else body.push(...permissionObject('Z14','S17','8716867000030','2','OTHER'))}
  const result=evaluate(permissionWire('Z14','S17',null,alphabets[0],body));expect(result.objects[0].applicability).toBe('unknown');expect(result.issues).toEqual([])
 }
})
it('requires own Z13 independently of reason and ignores later messages and cached market',()=>{
 const first=permissionWire('Z13','S17',null),later=permissionWire('Z13','S17','8716867000030')
 expect(evaluate(first+later.slice(9)).issues).toMatchObject([{prodatDiagnostic:{fieldNumber:'506',errorKind:'missing'}}])
 for(const ref of ['27-DDQ-PRODAT','23-DDQ-PRODAT','INVALID'])expect(evaluate(first.replace('23-DGI-PRODAT',ref)).objects[0].applicability).toBe('unknown')
 const data=input(first.replace('23-DGI-PRODAT','INVALID'))
 expect(evaluateIncomingProdatEnergyProduct({...data,applicationReference:'23-DGI-PRODAT'}).issues).toEqual([])
})
it('retains physical fifth506 for late value and header placement, never relabels fourth242',()=>{
 const body=permissionObject('Z14','S17',null);body.push(...characteristic('Z14','8716867000030',4))
 expect(evaluate(permissionWire('Z14','S17',null,alphabets[0],body)).issues).toMatchObject([{prodatDiagnostic:{fieldNumber:'506',errorKind:'invalid',occurrence:{lineItemReference:'CASE:A+B?C'}}}])
 const header=[...characteristic('Z14','8716867000030',4),...permissionObject('Z14')]
 expect(evaluate(permissionWire('Z14','S17',null,alphabets[0],header)).issues).toMatchObject([{prodatDiagnostic:{fieldNumber:'506',errorKind:'invalid',occurrence:{scope:'header',objectId:null,lineItemReference:null}}}])
})
it('exposes only applicable valid semantic506 while raw descriptive parsing remains unchanged',()=>{
 const message=permissionMessage('Z14','Z96','INVALID'),parsed=parseProdatMessage(message)
 expect(parsed.lineItems[0].energyProductId).toBe('INVALID');expect(message.raw_payload).toContain('INVALID')
 expect(evaluate(message.raw_payload!).objects[0]).toMatchObject({applicability:'false',value:null})
 expect(evaluate(permissionWire()).objects[0]).toMatchObject({applicability:'required',value:'8716867000030'})
})
for(const alphabet of alphabets)for(const reason of ['E64','E32','E34'])it(`selected Z06 ${reason}/${alphabet.join('')} isolates shared/separate506 and retains242`,()=>{
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:reason,direction:'inbound',applicationReference:'23-DDQ-PRODAT',referenceDate:'2026-09-20',mode:'catalog_evidence'})
 const check=(pairs:Parts[],direction:'inbound'|'outbound'='inbound')=>{const d=input(raw([line('1','735123456789012345',undefined,'9'),...characteristic('Z13',reason),...pairs],'Z06',alphabet),'Z06');return validateCanonicalPolicyFields({policy:{...policy,direction,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r && ['242','506'].includes(r.fieldNumber??''))},rawSegments:d.rawSegments,una:d.una}).filter(i=>i.prodatDiagnostic?.kind==='field'&&['242','506'].includes(i.prodatDiagnostic.fieldNumber))}
 const product=characteristic('Z14','L639Q',3)
 expect(check(product)).toEqual([])
 expect(check([['CCI','','Z14'],['CAV',['','','','L639Q','INVALID']]])).toEqual([])
 expect(check([...product,...characteristic('Z14','INVALID',4)])).toEqual([])
 expect(check([['CCI','','Z14'],['CAV',['','','','BAD','INVALID']]]).some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='242')).toBe(true)
 if(reason!=='E34')expect(check(characteristic('Z14','INVALID',4)).some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='242'&&i.prodatDiagnostic.errorKind==='missing')).toBe(true)
 expect(check([...product,...characteristic('Z14','INVALID',4)],'outbound').length).toBeGreaterThan(0)
})
it('incoming preflight does not label false fourth242 as506; outgoing remains strict',()=>{
 const wire=permissionWire('Z14','Z96',null).replace('RFF+LI:',"CCI++Z14'CAV+:::BAD'RFF+LI:")
 expect(preflightEdielPayload({rawPayload:wire,mode:'parse'}).issues.some(i=>i.code==='PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH')).toBe(false)
 expect(preflightEdielPayload({rawPayload:wire,mode:'send'}).issues.some(i=>i.code==='PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH')).toBe(true)
})

for(const code of ['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z15','Z18'])it(`finite function ${code} excludes506 before invalid code, qualifier and placement checks`,()=>{
 const body:Parts[]=[line('1','735123456789012345',undefined,'9'),...characteristic('Z13','S17'),['RFF',['LI','OWN']],['CCI','','Z14'],['CAV',['','BAD','BAD','WRONG','X'.repeat(36)]]]
 for(const reference of ['23-DDQ-PRODAT','27-DDQ-PRODAT']){const wire=raw(body,code).replace('23-DDQ-PRODAT',reference),result=evaluate(wire);expect(result.issues).toEqual([]);expect(result.objects).toMatchObject([{applicability:'false',value:null}])}
})
