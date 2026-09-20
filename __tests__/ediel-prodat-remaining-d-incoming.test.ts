import {beforeEach,it,expect,vi} from 'vitest'
import {permissionAckMessage,permissionAckObject,alphabets} from './fixtures/prodat-permission-ack'
import {changeRaw,changeBody,changeFields} from './fixtures/prodat-meter-change'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import {payload,characteristic} from './fixtures/prodat-gas'
import {source} from './fixtures/prodat-identity'
import {deriveProdatAperakValidationIssues,resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
const db=vi.hoisted(()=>({reads:[] as string[],writes:[] as {table:string;body:Record<string,unknown>}[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 db.reads.push(table);let single=false;const q:Record<string,unknown>={then:(done:(v:unknown)=>unknown)=>done({data:single?{id:'synthetic-issue'}:[],error:null})}
 for(const op of ['select','limit','eq','in','order','or','is','upsert','maybeSingle'])q[op]=(...args:unknown[])=>{if(op==='maybeSingle')single=true;if(op==='upsert')db.writes.push({table,body:args[0] as Record<string,unknown>});return q};return q
}}}))
beforeEach(()=>{db.reads=[];db.writes=[]})
const reporting=(field:string,a:readonly string[]=alphabets[0])=>{const m=permissionAckMessage('Z14','S18','A74',null,a);m.raw_payload=m.raw_payload!.replace(field==='321'?'202611010000':'B72',field==='321'?'202602300000':'BAD');return m}
const cells=(a:readonly string[]=alphabets[0]):[string,string,string,EdielMessageRow][]=>[
 ['Z14','321','42',reporting('321',a)],['Z14','323','42',reporting('323',a)],
 ['Z10','254','42',source(changeRaw(changeBody(changeFields('BAD','L639Q')),a),'Z10')],
 ['Z10','242','42',source(changeRaw(changeBody(changeFields('Z32','BAD')),a),'Z10')],
 ...(['Z05','Z06','Z09'] as const).map(code=>[code,'310','42',source(deathRaw(code,deathBody(code==='Z05'?'Z23':'E34',characteristic('Z17','BAD')),a),code)] as [string,string,string,EdielMessageRow]),
 ...(['Z04','Z06'] as const).map(code=>[code,'320','41',source(payload(code,code==='Z04'?'Z22':'E32',[], 'gas',a),code)] as [string,string,string,EdielMessageRow]),
]
for(const a of alphabets)for(const [code,field,erc,m] of cells(a)){
 it(`direct typed ${code}/${field} ${a.join('')}`,()=>{
  const result=decideProdatAperak({rawPayload:m.raw_payload,testKind:'production'})
  expect(result.applicationErrors).toContainEqual(expect.objectContaining({fieldCode:field,ercCode:erc,prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field}),prodatAperakText:expect.objectContaining({kind:'ready'})}))
 })
}
it('registry carries reporting321 and323 as immutable own errors',async()=>{
 for(const field of ['321','323']){
  const m=reporting(field);const issues=deriveProdatAperakValidationIssues({message:m});expect(issues.length).toBeGreaterThan(0)
  const r=await resolveAndStoreProdatAperakErrors({message:m});expect(r.errors).toContainEqual(expect.objectContaining({fieldCode:field,ercCode:'42',referenceNumber:'735123456789012345',lineItemReference:'CASE:A+B?C'}))
 }
 expect(db.writes.filter(w=>w.table==='ediel_aperak_error_details').map(w=>w.body.free_text_code)).toEqual(['321','323'])
})
for(const a of alphabets)it(`canonical supplied323 own negative ${a.join('')}`,()=>{
 expect(resolveCanonicalRuntimeDecision(reporting('323',a)).responsePlan).toContainEqual(expect.objectContaining({family:'APERAK',outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'323',ercCode:'42'})])}))
})
it('Z14N extra BAD ignored, U absence not missing, Z13 unchanged',()=>{
 for(const code of ['Z13','Z14']){
  const m=permissionAckMessage(code,code==='Z14'?'Z96':'S17',code==='Z14'?'A76':'A74');m.raw_payload=m.raw_payload!.replace('B72','BAD')
  expect(decideProdatAperak({rawPayload:m.raw_payload,testKind:'production'}).applicationErrors.filter(e=>e.fieldCode==='323')).toEqual([])
 }
 const body=permissionAckObject().filter((t,i,all)=>!(t[0]==='CCI'&&t[2]==='Z24'||t[0]==='CAV'&&all[i-1]?.[2]==='Z24'))
 expect(decideProdatAperak({rawPayload:permissionAckMessage('Z14','S17','A74',null,alphabets[0],body).raw_payload,testKind:'production'}).applicationErrors.filter(e=>e.fieldCode==='323')).toEqual([])
})
it('text readiness holds before all persistence and retains independently known321',async()=>{
 const m=reporting('321');m.raw_payload=m.raw_payload!.replace('B72','X'.repeat(80))
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toMatchObject({assessment:{disposition:{kind:'internal_review'},applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'321'})])}})
 expect(db.reads).toEqual([]);expect(db.writes).toEqual([])
})
it('multiple UNH requires explicit selected internal hold before registry I/O',async()=>{
 const m=reporting('323'),t=tokenizeEdifact(m.raw_payload!),second=t.segments.filter(t=>!['UNA','UNB','UNZ'].includes(t.tag)).map(t=>t.raw+"'").join('')
 m.raw_payload=m.raw_payload!.replace("UNZ+1+I'",second+"UNZ+2+I'")
 expect(tokenizeEdifact(m.raw_payload).segments.filter(t=>t.tag==='UNH').map(t=>segmentComposite(t,1))).toHaveLength(2)
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toThrow(/REVIEW_REQUIRED/);expect(db.reads).toEqual([])
})
