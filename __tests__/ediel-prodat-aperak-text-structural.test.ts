import {it,expect} from 'vitest'
import {raw,alphabets,type Parts} from '@/__tests__/fixtures/prodat-register'
import {source,z10} from '@/__tests__/fixtures/prodat-identity'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
for(const a of alphabets)for(const field of ['213','214'])for(const invalid of [false,true])it(`complete Z10 ${field} ${invalid?'extra element':'control'} ${a.join('')}`,()=>{
 const extra:Parts[]=field==='213'?[['QTY',['31','100','KWH'],...(invalid?['BAD']:[])]]:[['CCI','','Z02'],['CAV',['','','','1'],...(invalid?['BAD']:[])]]
 const body=z10();body.splice(body.findIndex(p=>p[0]==='CCI'),0,...extra)
 const message=source(raw(body,'Z10',a),'Z10'),d=resolveCanonicalRuntimeDecision(message),errors=d.responsePlan.flatMap(x=>x.applicationErrors??[])
 const p=d.responsePlan.find(p=>p.family==='APERAK')!
 let draft:string|undefined,buildError:string|undefined;try{draft=buildAperakDraft({sourceMessage:message,outcome:p?.outcome==='negative'?'negative':'positive',applicationErrors:p?.applicationErrors}).rawPayload!}catch(e){buildError=String(e)}
 const parsed=tokenizeEdifact(draft??''),text=parsed.segments.filter(s=>s.tag==='FTX').map(s=>({field:segmentComposite(s,3,parsed.una)[0],text:segmentComposite(s,4,parsed.una)}))
 expect(d.syntaxDecision).toBe('accepted');expect(buildError).toBeUndefined()
 if(!invalid){expect(errors).toEqual([]);expect(d.applicationDecision).toBe('accepted');expect(text).toEqual([{field:'',text:['OK']}])}
 else{expect(d.applicationDecision).toBe('rejected');expect(errors.filter(e=>e.fieldCode===field).length).toBeGreaterThan(0);expect(text.filter(t=>t.field===field).every(t=>t.text.join('').includes('BAD'))).toBe(true)}
})

import {input,line,characteristic,validate} from './fixtures/prodat-register'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
for(const a of alphabets)for(const extra of [false,true])it(`310 adjacent CAV ${extra} ${a.join('')}`,()=>{
 const status:Parts[]=[['CCI','','Z17'],['CAV','Z41'],...(extra?[['CAV','BAD']]:[])]
 const wire=deathRaw('Z06',deathBody('E34',status),a),p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z06'),code:'Z06',direction:'inbound'}))
 if(!extra){expect(p.applicationErrors).toEqual([]);return}
 expect(p.applicationErrors).toHaveLength(1)
 expect(p.applicationErrors[0].text).toBe('Felaktigt Kundstatus Z41 / BAD')
 const draft=buildAperakDraft({sourceMessage:source(wire,'Z06'),outcome:'negative',applicationErrors:p.applicationErrors}).rawPayload!
 const t=tokenizeEdifact(draft)
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
 const wire=deathRaw('Z09',deathBody('E34',status)),p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z09'),code:'Z09',direction:'outbound'}))
 expect(p.applicationErrors.length).toBeGreaterThan(0)
 for(const e of p.applicationErrors)expect(e.text).toContain('BAD')
})
for(const field of ['213','214'])it(`complete ${field} structural capacity retains F and prevents positive fallback`,()=>{
 const bad='X'.repeat(71),extra:Parts[]=field==='213'?[['QTY',['31','100','KWH'],bad]]:[['CCI','','Z02'],['CAV',['','','','1'],bad]]
 const body=z10();body.splice(body.findIndex(p=>p[0]==='CCI'),0,...extra)
 const d=resolveCanonicalRuntimeDecision(source(raw(body,'Z10'),'Z10'))
 expect(d).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'manual_review',prodatProcessingDisposition:{kind:'internal_review'}})
 expect(d.responsePlan.flatMap(p=>p.applicationErrors??[])).toEqual([])
 expect(JSON.stringify(d)).toContain(bad)
})
for(const [field,segments,contents] of [
 ['213',[['QTY',['31','100','KWH'],'BAD'],['QTY',['31','200','KWH'],'OTHER']],['31:100:KWH:BAD','31:200:KWH:OTHER']],
 ['214',[['CCI','','Z02'],['CAV',['','','','1'],'BAD'],['CCI','','Z02'],['CAV',['','','','2'],'OTHER']],[':::1:BAD',':::2:OTHER']],
] as [string,Parts[],string[]][])it(`conflicting ${field} candidates retain order and extra elements`,()=>{
 const wire=raw([line('1','OWN'),...segments,['RFF',['LI','CASE']]]),p=projectProdatDiagnostics(validate(wire,[field]))
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.prodatFieldDiagnostic).toMatchObject({failureEvidence:contents.map(content=>({content}))})
 expect(p.applicationErrors.find(e=>e.fieldCode===field)!.text).toContain(contents.join(' / '))
})
