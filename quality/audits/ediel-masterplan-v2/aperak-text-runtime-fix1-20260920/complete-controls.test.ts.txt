import {it,expect,afterAll} from 'vitest'
import {writeFileSync} from 'node:fs'
import {raw,alphabets,type Parts} from '@/__tests__/fixtures/prodat-register'
import {source,z10} from '@/__tests__/fixtures/prodat-identity'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
const observations:unknown[]=[]
afterAll(()=>writeFileSync('/workspace/scratch/2a201d6d5897/aperak-text-runtime-fix1-20260920/complete-observations.json',JSON.stringify(observations,null,2)))
for(const a of alphabets)for(const field of ['213','214'])for(const invalid of [false,true])it(`complete Z10 ${field} ${invalid?'extra element':'control'} ${a.join('')}`,()=>{
 const extra:Parts[]=field==='213'?[['QTY',['31','100','KWH'],...(invalid?['BAD']:[])]]:[['CCI','','Z02'],['CAV',['','','','1'],...(invalid?['BAD']:[])]]
 const body=z10();body.splice(body.findIndex(p=>p[0]==='CCI'),0,...extra)
 const message=source(raw(body,'Z10',a),'Z10'),d=resolveCanonicalRuntimeDecision(message),errors=d.responsePlan.flatMap(x=>x.applicationErrors??[])
 const p=d.responsePlan.find(p=>p.family==='APERAK')!
 let draft:string|undefined,buildError:string|undefined;try{draft=buildAperakDraft({sourceMessage:message,outcome:p?.outcome==='negative'?'negative':'positive',applicationErrors:p?.applicationErrors}).rawPayload!}catch(e){buildError=String(e)}
 const parsed=tokenizeEdifact(draft??''),text=parsed.segments.filter(s=>s.tag==='FTX').map(s=>({field:segmentComposite(s,3,parsed.una)[0],text:segmentComposite(s,4,parsed.una)}))
 observations.push({field,invalid,alphabet:a,d,text,buildError})
 expect(d.syntaxDecision).toBe('accepted');expect(buildError).toBeUndefined()
 if(!invalid){expect(errors).toEqual([]);expect(d.applicationDecision).toBe('accepted');expect(text).toEqual([{field:'',text:['OK']}])}
 else{expect(d.applicationDecision).toBe('rejected');expect(errors.filter(e=>e.fieldCode===field).length).toBeGreaterThan(0);expect(text.filter(t=>t.field===field).every(t=>t.text.join('').includes('BAD'))).toBe(true)}
})
