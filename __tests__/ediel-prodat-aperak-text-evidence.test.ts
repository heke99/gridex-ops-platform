import {it,expect} from 'vitest'
import {raw,alphabets,line,characteristic,input,rule,type Parts} from './fixtures/prodat-register'
import {head,own,source} from './fixtures/prodat-identity'
import {permissionMessage,permissionWire,permissionObject} from './fixtures/prodat-energy-product'
import {PRODAT_26A_FIELD_MATRIX} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {PRODAT_APERAK_FIELD_NAMES,composeProdatAperakText} from '@/lib/ediel/prodat/prodatAperakText'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {projectProdatDiagnostics,isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {evaluateIncomingProdatEnergyProduct,assertIncomingProdatEnergyProductReview} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
const body=(id='OWN',li:string|null='CASE'):Parts[]=>own('1','735123456789012345',li).map(p=>p[0]==='NAD'?['NAD','UD',[id,'','89'],'','Synthetic','Street','City','','12345','SE']:p)
const projected=(parts:Parts[],fields:string[],code='Z01',a:readonly string[]=alphabets[0])=>projectProdatDiagnostics(validateFieldMatrixPayload(input(raw([...head(),...parts],code,a),code),fields.map(f=>rule(f,code))))
const texts=(wire:string)=>{const t=tokenizeEdifact(wire);return t.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,4,t.una))}
it('every admitted numeric descriptor has a source name; invalid findings require actual failure evidence',()=>{
 const fields=PRODAT_26A_FIELD_MATRIX.filter(f=>/^\d+$/.test(f.fieldNumber));expect(fields).toHaveLength(74)
 expect(Object.keys(PRODAT_APERAK_FIELD_NAMES).sort()).toEqual(fields.map(f=>f.fieldNumber).sort())
 for(const field of fields){
  const wire=input(raw([...head(),...body()]));const diagnostic=prodatFieldDiagnostic(field.fieldNumber,'missing',wire,wire.rawSegments,'P94',0)
  expect(composeProdatAperakText(diagnostic)).toMatchObject({kind:'ready',text:`${PRODAT_APERAK_FIELD_NAMES[field.fieldNumber]} saknas`})
  if(diagnostic.kind==='field')expect(composeProdatAperakText({...diagnostic,errorKind:'invalid',failureEvidence:undefined})).toEqual({kind:'unready',reason:'failure_evidence_unavailable'})
 }
})
for(const a of alphabets){
 for(const missing of ['209','226','both'])it(`own customer suffix with absent ${missing} under ${a.join('')}`,()=>{
  const parts=body('ÅÄÖ:+?\'');if(missing!=='226')parts[0]=['LIN','1'];
  const p=projected(missing!=='209'?parts.filter(t=>t[0]!=='RFF'||(t[1] as string[])[0]!=='LI'):parts,['209','226'],'Z01',a)
  expect(p.disposition.kind).toBe('continue');expect(p.applicationErrors.length).toBe(missing==='both'?2:1)
  for(const error of p.applicationErrors)expect(error.text).toBe(`${PRODAT_APERAK_FIELD_NAMES[error.fieldCode!]} saknas, kundid=ÅÄÖ:+?'`)
 })
 it(`format and qualifier faults preserve exact component under ${a.join('')}`,()=>{
  for(const parts of [['OWN','BAD','89'],['OWN','','BAD']]){
   const p=projected(body().map(t=>t[0]==='NAD'?['NAD','UD',parts,'','Name','Street','City','','12345','SE']:t),['227'],'Z01',a)
   expect(p.applicationErrors[0]?.text).toBe('Felaktigt Kund-id BAD')
  }
  const p=projected(body().map(t=>t[0]==='DTM'?['DTM',['92','202610010000','BAD']]:t),['210'],'Z01',a)
  expect(p.applicationErrors[0]?.text).toBe('Felaktigt Avtal, startdatum BAD')
 })
 it(`typed literal content is escaped once under ${a.join('')}`,()=>{
  const value="ÅÄÖ:+?'",message={...permissionMessage('Z14','S17',value),raw_payload:permissionWire('Z14','S17',value,a)}
  const d=resolveCanonicalRuntimeDecision(message),errors=d.responsePlan.flatMap(p=>p.applicationErrors??[])
  expect(errors).toHaveLength(1);expect(errors[0].text).toBe(`Felaktigt Produkt id (Energiprodukt) ${value}`)
  const draft=buildAperakDraft({sourceMessage:message,outcome:'negative',applicationErrors:errors})
  expect(texts(draft.rawPayload!)).toEqual([[errors[0].text]])
  expect(tokenizeEdifact(draft.rawPayload!).segments.filter(t=>t.tag==='ERC')).toHaveLength(1)
 })
}
it('base41 has no suffix with both references present; optional absent and conflicting227 add no hold',()=>{
 for(const customer of ['present','absent','conflict']){
  let parts=body();if(customer==='absent')parts=parts.filter(t=>t[0]!=='NAD');if(customer==='conflict')parts.push(['NAD','UD',['OTHER','','89']])
  const p=projected(parts.filter(t=>t[0]!=='RFF'||(t[1] as string[])[0]!=='Z05'),['260'])
  expect(p.applicationErrors[0]).toMatchObject({text:'Nätområdesid saknas',prodatAperakText:{fallback:'not_needed'}});expect(p.disposition.kind).toBe('continue')
  const missing=projected(parts.filter(t=>t[0]!=='RFF'||(t[1] as string[])[0]!=='LI'),['226'])
  expect(missing.applicationErrors[0]?.prodatAperakText).toMatchObject({kind:'ready',fallback:customer==='present'?'included':'unavailable'});expect(missing.disposition.kind).toBe('continue')
 }
})
it('second object and later UNH cannot donate customer fallback',()=>{
 const second=body('OWN-B',null).map(t=>t[0]==='LIN'?line('2','735123456789012352'):t)
 const wire=raw([...head(),...body('OWN-A'),...second],'Z01')+raw([...head(),...body('LATER')],'Z01').slice(raw([...head(),...body('LATER')],'Z01').indexOf('UNH'))
 const p=projectProdatDiagnostics(validateFieldMatrixPayload(input(wire,'Z01'),[rule('226','Z01')]))
 expect(p.applicationErrors).toHaveLength(1);expect(p.applicationErrors[0].text).toBe('Ärendereferens saknas, kundid=OWN-B')
})
it('valid own repeated register takes common227 from own first register',()=>{
 const parts:Parts[]=[line('1','A','1'),['NAD','UD',['OWN-A','','89']],line('2','A','2'),...characteristic('Z02','bad',3),line('3','B'),['NAD','UD',['OTHER','','89']]]
 const wire=input(raw(parts,'Z04'),'Z04'),diagnostic=prodatFieldDiagnostic('214','missing',wire,[],'P94',1)
 expect(composeProdatAperakText(diagnostic)).toMatchObject({kind:'ready',text:'Konstant för mätare saknas, kundid=OWN-A'})
})
it('compound empty slots and conflicting dates retain complete candidates in source order',()=>{
 for(const components of [['92','','BAD'],['92','202610010000','203','EXTRA']]){
  const p=projected(body().map(t=>t[0]==='DTM'?['DTM',components]:t),['210'])
  expect(p.applicationErrors[0]?.text).toBe(`Felaktigt Avtal, startdatum ${components.join(':')}`)
 }
 const p=projected([...body(),['DTM',['92','BAD','203']]],['210'])
 const f=p.observations[0].prodatDiagnostic
 expect(f).toMatchObject({kind:'field',fieldNumber:'210',failureEvidence:[{content:'92:202610010000:203'},{content:'92:BAD:203'}]})
})
it('energy single qualifier failure uses bad qualifier; conflicts keep all submitted candidates',()=>{
 for(const parts of [['','','BAD','','8716867000030'],['','BAD','','','8716867000030']]){
  const own=permissionObject('Z14','S17',null);own.splice(1,0,['CCI','','Z14'],['CAV',parts]);const wire=permissionWire('Z14','S17',null,alphabets[0],own)
  const p=projectProdatDiagnostics(evaluateIncomingProdatEnergyProduct(input(wire,'Z14')).issues)
  expect(p.applicationErrors[0]?.text).toBe('Felaktigt Produkt id (Energiprodukt) BAD')
 }
 const own=permissionObject('Z14','S17','BAD');own.splice(1,0,...characteristic('Z14','OTHER',4));const wire=permissionWire('Z14','S17',null,alphabets[0],own)
 const p=projectProdatDiagnostics(evaluateIncomingProdatEnergyProduct(input(wire,'Z14')).issues)
 for(const observation of p.observations)expect(observation.prodatDiagnostic).toMatchObject({failureEvidence:[{content:'::::OTHER'},{content:'::::BAD'}]})
})
for(const size of [69,70,71])it(`decoded ${size} typed characters; no truncation despite escape expansion`,()=>{
 const value=':'.repeat(size-'Felaktigt Produkt id (Energiprodukt) '.length),message=permissionMessage('Z14','S17',value),d=resolveCanonicalRuntimeDecision(message)
 const errors=d.responsePlan.flatMap(p=>p.applicationErrors??[])
 if(size<=70){expect(errors[0]?.text).toHaveLength(size);const wire=buildAperakDraft({sourceMessage:message,outcome:'negative',applicationErrors:errors}).rawPayload!;expect(texts(wire)).toEqual([[errors[0].text]])}
 else {expect(errors).toEqual([]);expect(d).toMatchObject({applicationDecision:'rejected',functionalDecision:'manual_review',prodatProcessingDisposition:{kind:'internal_review'}})}
})
it('stale/incomplete ready data is ineligible after persistence',()=>{
 const original=projected(body('OWN',null),['226']).applicationErrors[0];expect(isQualifiedProdatApplicationError(original)).toBe(true)
 for(const mutate of [(e:typeof original)=>{delete e.prodatAperakText},(e:typeof original)=>{e.text='stale'},(e:typeof original)=>{if(e.prodatAperakText?.kind==='ready')e.prodatAperakText.text='stale'},(e:typeof original)=>{if(e.prodatFieldDiagnostic?.kind==='field')delete e.prodatFieldDiagnostic.occurrence.ownReferences}]){
  const error=structuredClone(original);mutate(error);expect(isQualifiedProdatApplicationError(error)).toBe(false)
  expect(()=>buildAperakDraft({sourceMessage:source(raw([...head(),...body()],'Z01')),outcome:'negative',applicationErrors:[error]})).toThrow('PRODAT_APERAK_TEXT_REVIEW_REQUIRED')
 }
})
it('direct and manual shared506 expose unready before any positive fallback',()=>{
 const message=permissionMessage('Z14','S17','X'.repeat(36))
 expect(()=>decideProdatAperak({message})).toThrow('PRODAT_APERAK_TEXT_REVIEW_REQUIRED')
 expect(()=>assertIncomingProdatEnergyProductReview(message.raw_payload)).toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
})
for(const a of alphabets)it(`actual ownLI ending in apostrophe survives full draft ${a.join('')}`,()=>{
 const wire=raw([...head(),...body('OWN',"CASE'").filter(t=>t[0]!=='RFF'||(t[1] as string[])[0]!=='Z05')],'Z01',a)
 const message=source(wire),d=resolveCanonicalRuntimeDecision(message),errors=d.responsePlan.flatMap(p=>p.applicationErrors??[])
 const draft=buildAperakDraft({sourceMessage:message,outcome:'negative',applicationErrors:errors}),tokens=tokenizeEdifact(draft.rawPayload!)
 expect(tokens.segments.filter(t=>t.tag==='RFF').map(t=>segmentComposite(t,1,tokens.una))).toContainEqual(['LI',"CASE'"])
 expect(tokens.segments.filter(t=>t.tag==='UNT')).toHaveLength(1);expect(tokens.segments.filter(t=>t.tag==='UNZ')).toHaveLength(1)
 const start=tokens.segments.findIndex(t=>t.tag==='UNH'),end=tokens.segments.findIndex(t=>t.tag==='UNT')
 expect(Number(segmentComposite(tokens.segments[end],1,tokens.una)[0])).toBe(end-start+1)
})
it('Z13 forbidden birth-date qualifier reports that exact qualifier, not valid customer scalar',()=>{
 const parts=permissionObject('Z13','S17','8716867000030').map(t=>t[0]==='NAD'&&(t[1] as string)==='UD'?['NAD','UD',['197001010000','1','260'],'','Synthetic','Street','City','','12345','SE'] as Parts:t)
 const wire=permissionWire('Z13','S17','8716867000030',alphabets[0],parts)
 const p=projectProdatDiagnostics(validateFieldMatrixPayload(input(wire,'Z13'),[rule('227','Z13')]))
 expect(p.applicationErrors[0]?.text).toBe('Felaktigt Kund-id 1')
})
it('stale malformed own-reference and failure arrays reject cleanly instead of throwing',()=>{
 const original=projected(body('OWN',null),['226']).applicationErrors[0]
 const missing=structuredClone(original);if(missing.prodatFieldDiagnostic?.kind==='field')missing.prodatFieldDiagnostic.occurrence.ownReferences={} as never
 expect(isQualifiedProdatApplicationError(missing)).toBe(false)
 const invalid=projected(body().map(t=>t[0]==='DTM'?['DTM',['92','BAD','203']]:t),['210']).applicationErrors[0]
 if(invalid.prodatFieldDiagnostic?.kind==='field')invalid.prodatFieldDiagnostic.failureEvidence='bad' as never
 expect(isQualifiedProdatApplicationError(invalid)).toBe(false)
})
it('typed109 uses the fixed p93 text without customer fallback',()=>{
 const wire=input(raw([...head(),...body('OWN',null)])),field=prodatFieldDiagnostic('210','invalid',wire,wire.rawSegments,'P93',0)
 if(field.kind!=='field')throw Error('fixture missing field occurrence')
 const projected=projectProdatDiagnostics([{code:'XOR',severity:'error',blocking:true,title:'Both dates',description:'unrelated developer description',prodatDiagnostic:{kind:'application',ercCode:'40',applicationCode:'109',sourceRule:'P93',occurrence:field.occurrence}}])
 expect(projected.applicationErrors[0]).toMatchObject({ercCode:'40',fieldCode:'109',text:'En period anges där endast en dag/tidpunkt förväntas',prodatAperakText:{fallback:'not_needed'}})
})
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import {validateProdatProductScope} from '@/lib/ediel/rulebook/prodatProductScope'
it('death owner carries the one faulty qualifier without substituting valid Z41',()=>{
 const wire=deathRaw('Z06',deathBody('E34',[['CCI','','Z17'],['CAV',['Z41','BAD','']]]))
 const p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z06'),code:'Z06',direction:'inbound'}))
 expect(p.applicationErrors[0]?.text).toBe('Felaktigt Kundstatus BAD')
})
it('product owner carries faulty qualifier and every conflicting candidate',()=>{
 const single=input(raw([line('1','A'),['CCI','','Z14'],['CAV',['','BAD','','L917']],['RFF',['LI','CASE']]],'Z06'),'Z06')
 const p=projectProdatDiagnostics(validateProdatProductScope(single,[rule('242','Z06')],'inbound'))
 expect(p.applicationErrors[0]?.text).toBe('Felaktigt Produktkod BAD')
 const conflict=input(raw([line('1','A'),...characteristic('Z14','L917',3),...characteristic('Z14','L809',3),['RFF',['LI','CASE']]],'Z06'),'Z06')
 const q=projectProdatDiagnostics(validateProdatProductScope(conflict,[rule('242','Z06')],'inbound'))
 for(const i of q.observations)expect(i.prodatDiagnostic).toMatchObject({failureEvidence:[{content:':::L917'},{content:':::L809'}]})
})
import {validateProdatMeterChange} from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import {changeRaw,changeBody} from './fixtures/prodat-meter-change'
it('meter-change owner retains the actual failing1131 instead of valid product',()=>{
 const wire=changeRaw(changeBody([['CCI','','Z14'],['CAV',['','BAD','','L917']]]))
 const p=projectProdatDiagnostics(validateProdatMeterChange({...input(wire,'Z10'),code:'Z10',direction:'inbound'}))
 expect(p.applicationErrors.filter(e=>e.fieldCode==='242').map(e=>e.text)).toEqual(['Felaktigt Produktkod BAD'])
})
it('structural product content keeps faulty CCI and extra CAV data rather than a valid scalar',()=>{
 for(const fields of [[['CCI','BAD','Z14'],['CAV',['','','','L917']]],[['CCI','','Z14'],['CAV',['','','','L917'],'BAD']],[['CCI','','Z14'],['CAV',['','','','L917']],['CAV',['','','','BAD']]]] as Parts[][]){
  const wire=input(raw([line('1','A'),...fields,['RFF',['LI','CASE']]],'Z06'),'Z06')
  const p=projectProdatDiagnostics(validateProdatProductScope(wire,[rule('242','Z06')],'inbound'))
  expect(p.observations.length).toBeGreaterThan(0)
  expect(JSON.stringify(p.observations.map(i=>i.prodatDiagnostic))).toContain('BAD')
  for(const e of p.applicationErrors)expect(e.text).toContain('BAD')
 }
})
