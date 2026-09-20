import {it,expect} from 'vitest'
import {raw,alphabets,type Parts} from './fixtures/prodat-register'
import {head,own,source,z10} from './fixtures/prodat-identity'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
const output:unknown[]=[]
const extract=(wire:string)=>{const t=tokenizeEdifact(wire);return {texts:t.segments.filter(s=>s.tag==='FTX').map(s=>({code:segmentComposite(s,3,t.una)[0],values:segmentComposite(s,4,t.una),raw:s.raw})),erc:t.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,t.una)[0]),references:t.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,t.una))}}
const msg=(body:Parts[],alphabet:readonly string[]=alphabets[0],code='Z01')=>source(raw([...head(),...body],code,alphabet),code)
const object=(seq='1',id='735123456789012345',li:string|null='CASE-A',customer='OWN-A')=>own(seq,id,li).map(p=>p[0]==='NAD'?['NAD','UD',[customer,'','89'],'','Synthetic','Street','City','','12345','SE'] as Parts:p)
const observe=(id:string,m:any)=>{const d=resolveCanonicalRuntimeDecision(m),p=d.responsePlan.find(p=>p.family==='APERAK');let wire=null,error=null;try{if(p)wire=extract(buildAperakDraft({sourceMessage:m,outcome:p.outcome as any,applicationErrors:p.applicationErrors}).rawPayload!)}catch(e){error=String(e)};const result={id,syntax:d.syntaxDecision,application:d.applicationDecision,disposition:d.prodatProcessingDisposition,issues:d.issues,plan:p,wire,error};output.push(result);return result}
for(const a of alphabets)it(`P94 missing226 names field and own227 under ${a.join('')}`,()=>{
 const o=observe('normative',msg(object('1',undefined,null),a))
 expect(o.wire?.texts[0].values[0]).toBe('Ärendereferens saknas, kundid=OWN-A')
})
it('P94 wrong format retains actual fault value and field name',()=>{
 const o=observe('normative',msg(object().map(p=>p[0]==='DTM'?['DTM',['92','202610010000','BAD']]:p)))
 expect(o.wire?.texts[0].values[0]).toBe('Felaktigt Avtal, startdatum BAD')
})
it('P94 wrong qualifier retains actual fault value under owning227',()=>{
 const o=observe('normative',msg(object().map(p=>p[0]==='NAD'?['NAD','UD',['OWN-A','BAD','89'],'','Synthetic','Street','City','','12345','SE']:p)))
 expect(o.wire?.texts[0].values[0]).toBe('Felaktigt Kund-id BAD')
})
it('actual submitted delimiters round trip without text loss or extra ERC',()=>{
 const text="Felaktigt Nätområdesid BAD:+?'ERC+100::260'"
 const wire=extract(buildAperakDraft({sourceMessage:msg(object()),outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'260',text}]}).rawPayload!)
 expect(wire.erc).toEqual(['42']);expect(wire.texts[0].values).toEqual([text])
})
it('positive100 stays OK',()=>{
 const o=observe('normative',source(raw(z10(),'Z10'),'Z10'));expect(o.wire?.erc).toEqual(['100']);expect(o.wire?.texts[0].values).toEqual(['OK'])
})
it('source40 fixed text survives',()=>{
 const text='Anläggningen kan inte identifieras'
 const w=extract(buildAperakDraft({sourceMessage:msg(object()),outcome:'negative',applicationErrors:[{ercCode:'40',fieldCode:'105',text}]}).rawPayload!)
 expect(w.erc).toEqual(['40']);expect(w.texts[0].values).toEqual([text])
})
it('actual full draft preflight rejects71 decoded characters',()=>{
 expect(()=>buildAperakDraft({sourceMessage:msg(object()),outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'260',text:'X'.repeat(71)}]})).toThrow('PROFILE_FIELD_LENGTH_EXCEEDED')
})
