import {it,expect} from 'vitest'
import {raw,alphabets,type Parts} from '@/__tests__/fixtures/prodat-register'
import {source,z10} from '@/__tests__/fixtures/prodat-identity'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {renderProdatAperakDiagnosticRaw} from './helpers/prodatAperakDiagnosticRenderFixture'
import {head} from './fixtures/prodat-identity'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
for(const a of alphabets)for(const field of ['213','214'])for(const invalid of [false,true])it(`complete Z10 ${field} ${invalid?'extra element':'control'} ${a.join('')}`,()=>{
 const extra:Parts[]=field==='213'?[['QTY',['31','100','KWH'],...(invalid?['BAD']:[])]]:[['CCI','','Z02'],['CAV',['','','','1'],...(invalid?['BAD']:[])]]
 const body=z10();body.splice(body.findIndex(p=>p[0]==='CCI'),0,...extra)
 const message=source(raw(body,'Z10',a),'Z10'),d=resolveCanonicalRuntimeDecision(message),errors=d.responsePlan.flatMap(x=>x.applicationErrors??[])
 if(invalid){
  expect(d.syntaxDecision).toBe('rejected')
  expect(d.responsePlan).toEqual([expect.objectContaining({family:'CONTRL',outcome:'negative'})])
  expect(d.responsePlan.some(p=>p.family==='APERAK')).toBe(false)
  expect(errors).toEqual([])
  return
 }
 expect(d.syntaxDecision).toBe('accepted');expect(errors).toEqual([]);expect(d.applicationDecision).toBe('accepted')
 const params={sourceMessage:message,outcome:'positive' as const}
 expect(()=>buildAperakDraft(params)).toThrow('UNSM_MESSAGE_STRUCTURE_INVALID')
 const parsed=tokenizeEdifact(renderProdatAperakDiagnosticRaw(params))
 expect(parsed.segments.filter(s=>s.tag==='FTX').map(s=>({field:segmentComposite(s,3,parsed.una)[0],text:segmentComposite(s,4,parsed.una)}))).toEqual([{field:'',text:['OK']}])
})

import {input,line,characteristic,validate} from './fixtures/prodat-register'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
for(const a of alphabets)for(const extra of [false,true])it(`310 adjacent CAV ${extra} ${a.join('')}`,()=>{
 const status:Parts[]=[['CCI','','Z17'],['CAV','Z41'],...(extra?[['CAV','BAD']]:[])]
 const wire=raw([...head(),...deathBody('E34',status)],'Z06',a),p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z06'),code:'Z06',direction:'inbound'}))
 if(!extra){expect(p.applicationErrors).toEqual([]);return}
 expect(p.applicationErrors).toHaveLength(1)
 expect(p.applicationErrors[0].text).toBe('Felaktigt Kundstatus Z41 / BAD')
 const params={sourceMessage:source(wire,'Z06'),outcome:'negative' as const,applicationErrors:p.applicationErrors}
 expect(()=>buildAperakDraft(params)).toThrow('UNSM_MESSAGE_STRUCTURE_INVALID')
 const t=tokenizeEdifact(renderProdatAperakDiagnosticRaw(params))
 expect(t.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,4,t.una))).toContainEqual(['Felaktigt Kundstatus Z41 / BAD'])
})
for(const [field,segments,content] of [
 ['213',[['QTY',['31','100','KWH'],'', ['BAD','']]],'31:100:KWH::BAD:'],
 ['214',[...characteristic('Z02','1',3).slice(0,1),['CAV',['','','','1'],'', ['BAD','']]],':::1::BAD:'],
 ['258',[['LIN','1','',['OWN','','','89'],['1','1'],'BAD']],'1:1:BAD'],
] as [string,Parts[],string][])it(`structural ${field} preserves decoded empty slots`,()=>{
 const body:Parts[]=field==='258'?segments:[line('1','OWN'),...segments]
 body.push(['RFF',['LI','CASE']])
 const wire=raw(body),p=projectProdatDiagnostics(validate(wire,[field]))
 expect(p.applicationErrors.filter(e=>e.fieldCode===field).length).toBeGreaterThan(0)
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.prodatFieldDiagnostic).toMatchObject({failureEvidence:[{content}]})
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.text).toContain(content)
})

for(const status of [
 [['CCI','BAD','Z17'],['CAV','Z41']],
 [['CCI','','Z17'],['CAV','Z41','BAD']],
 [['CCI','','Z17'],['CAV',['Z41','','','BAD']]],
] as Parts[][])it(`310 already rejected structural content ${JSON.stringify(status)}`,()=>{
 const wire=deathRaw('Z09',deathBody('E34',status)),p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z09'),code:'Z09',direction:'outbound',facts:{deathStatus:deathSelection('death','Z09')}}))
 expect(p.applicationErrors.length).toBeGreaterThan(0)
 for(const e of p.applicationErrors)expect(e.text).toContain('BAD')
})
for(const field of ['213','214'])it(`complete ${field} structural capacity retains F and prevents positive fallback`,()=>{
 const bad='X'.repeat(71),extra:Parts[]=field==='213'?[['QTY',['31','100','KWH'],bad]]:[['CCI','','Z02'],['CAV',['','','','1'],bad]]
 const body=z10();body.splice(body.findIndex(p=>p[0]==='CCI'),0,...extra)
 const d=resolveCanonicalRuntimeDecision(source(raw(body,'Z10'),'Z10'))
 expect(d.syntaxDecision).toBe('rejected')
 expect(d.responsePlan).toEqual([expect.objectContaining({family:'CONTRL',outcome:'negative'})])
 expect(d.responsePlan.flatMap(p=>p.applicationErrors??[])).toEqual([])
 // The lower field owner retains the complete original candidate, while the
 // actual runtime stops at whole UNSM syntax before application evaluation.
 const projection=projectProdatDiagnostics(validate(raw(body,'Z10'),[field],'Z10'))
 expect(JSON.stringify(projection.observations)).toContain(bad)
})
for(const [field,segments,contents] of [
 ['213',[['QTY',['31','100','KWH'],'BAD'],['QTY',['31','200','KWH'],'OTHER']],['31:100:KWH:BAD','31:200:KWH:OTHER']],
 ['214',[['CCI','','Z02'],['CAV',['','','','1'],'BAD'],['CCI','','Z02'],['CAV',['','','','2'],'OTHER']],[':::1:BAD',':::2:OTHER']],
] as [string,Parts[],string[]][])it(`conflicting ${field} candidates retain order and extra elements`,()=>{
 const wire=raw([line('1','OWN'),...segments,['RFF',['LI','CASE']]]),p=projectProdatDiagnostics(validate(wire,[field]))
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.prodatFieldDiagnostic).toMatchObject({failureEvidence:contents.map(content=>({content}))})
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.text).toContain(contents.join(' / '))
})
