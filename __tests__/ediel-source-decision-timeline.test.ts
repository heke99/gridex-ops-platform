import {test} from 'vitest'
import assert from 'node:assert/strict'
import {inspectReceivedSourceDecisionTimeline,readReceivedSourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import {timelineScope,timelineBody,timelineReceipt,timelineSource,timelineAssessment,rewriteTimelineFacts} from './helpers/sourceDecisionTimelineFixtures'
import {OWNER,ownerId} from './helpers/sourceOwnerFixtures'
const inspect=(body=timelineBody())=>inspectReceivedSourceDecisionTimeline(timelineScope,timelineReceipt(body))
const hidden=(result:ReturnType<typeof inspect>)=>{assert.deepEqual(result.sources,[]);assert.equal(result.snapshotId,null);assert.equal(result.readsetHash,null);assert.equal(result.sourceCount,null)}
const nonAuthority=(result:ReturnType<typeof inspect>)=>{
 assert.equal(result.authorityStatus,'not_established');assert.equal(result.selection,'not_performed');assert.equal(result.marketSupersession,'not_performed');assert.equal(result.historyCoverage,'before_ledger_unknown')
}
test('projects a witnessed unavailable assessment without inventing source authority',()=>{
 const result=inspect();assert.equal(result.status,'inspected');assert.equal(result.boundedReadComplete,true);nonAuthority(result)
 assert.equal(result.sources[0].asOf?.assessmentId,ownerId(101));assert.equal(result.sources[0].asOf?.recordedDisposition,'unavailable')
 assert.equal(result.sources[0].asOf?.objects[0].object.objectId,OWNER.external)
 assert.equal(result.sources[0].revisions[0].availability,'witnessed_by_cutoff')
 assert.ok(!JSON.stringify(result).includes('UNA:'));assert.ok(!JSON.stringify(result).includes('canonicalFactsHash'))
})
test('empty bounded read is not complete market history',()=>{const r=inspect(timelineBody([]));assert.equal(r.status,'inspected');assert.deepEqual(r.sources,[]);nonAuthority(r)})
test('uses predecessor order, not equal assessment timestamps, witness order or input order',()=>{
 const first=timelineAssessment(101,null,{availableAt:'2026-09-22T11:55:00Z'})
 const second=timelineAssessment(102,first.id,{availableAt:'2026-09-22T11:10:00Z'})
 const r=inspect(timelineBody([timelineSource({assessments:[second,first]})]))
 assert.equal(r.status,'inspected');assert.equal(r.sources[0].asOf?.assessmentId,second.id)
 assert.deepEqual(r.sources[0].revisions.map(x=>x.assessmentId),[first.id,second.id])
})
test('a witnessed unavailable correction supersedes the earlier recorded assessment',()=>{
 const first=timelineAssessment(),second=timelineAssessment(102,first.id,{assessedAt:'2026-09-22T11:30:00Z',availableAt:'2026-09-22T11:30:01Z'})
 rewriteTimelineFacts(first,f=>{f.objects[0].disposition='rejected';f.objects[0].reasons=['canonical_rejected']})
 const r=inspect(timelineBody([timelineSource({assessments:[first,second]})]))
 assert.equal(r.sources[0].asOf?.recordedDisposition,'unavailable');assert.equal(r.sources[0].asOf?.assessmentId,second.id)
})
for(const availableAt of [null,'2026-09-22T12:00:00.000002Z'])test(`never retroactively grants visibility for ${availableAt}`,()=>{
 const a=timelineAssessment(101,null,{availableAt,availabilityWitnessId:availableAt?ownerId(2101):null})
 const r=inspect(timelineBody([timelineSource({assessments:[a]})]));assert.equal(r.status,'inspected');assert.equal(r.sources[0].asOf,null);assert.equal(r.sources[0].visibility,'incomplete')
})
test('accepts witness at exact cutoff using all six fractional digits',()=>{
 const r=inspect(timelineBody([timelineSource({assessments:[timelineAssessment(101,null,{availableAt:timelineScope.cutoffAt})]})]))
 assert.equal(r.sources[0].asOf?.assessmentId,ownerId(101))
})
test('equivalent offset cutoff is compared as an instant without rewriting the caller spelling',()=>{
 const body=timelineBody();body.cutoffAt='2026-09-22T14:00:00.000001+02:00'
 const r=inspect(body);assert.equal(r.status,'inspected');assert.equal(r.cutoffAt,timelineScope.cutoffAt)
})
test('a future assessment cannot change the historical predecessor',()=>{
 const first=timelineAssessment(),second=timelineAssessment(102,first.id,{assessedAt:'2026-09-22T12:00:00.000002Z',availableAt:'2026-09-22T12:00:00.000003Z'})
 const r=inspect(timelineBody([timelineSource({assessments:[second,first]})]));assert.equal(r.sources[0].asOf?.assessmentId,first.id)
 assert.equal(r.sources[0].revisions[1].availability,'after_cutoff')
})
test('unproven successor visibility blocks fallback to an older witnessed assessment',()=>{
 const first=timelineAssessment(),second=timelineAssessment(102,first.id,{assessedAt:'2026-09-22T11:30:00Z',availableAt:null,availabilityWitnessId:null})
 const r=inspect(timelineBody([timelineSource({assessments:[first,second]})]));assert.equal(r.sources[0].asOf,null);assert.equal(r.sources[0].visibility,'incomplete')
})
test('a fully witnessed successor can replace an unwitnessed predecessor without using its authority',()=>{
 const first=timelineAssessment(101,null,{availableAt:null,availabilityWitnessId:null}),second=timelineAssessment(102,first.id)
 const r=inspect(timelineBody([timelineSource({assessments:[first,second]})]));assert.equal(r.sources[0].asOf?.assessmentId,second.id)
})
for(const [label,mutate] of [
 ['foreign company',(b)=>{b.companyId=ownerId(700)}],['foreign environment',(b)=>{Object.assign(b,{environment:'production'})}],
 ['wrong cutoff',(b)=>{b.cutoffAt='2026-09-22T12:00:00.000002Z'}],['bad capture date',(b)=>{b.capturedAt='2026-02-30T00:00:00Z'}],
 ['capture before cutoff',(b)=>{b.capturedAt='2026-09-22T11:59:59Z'}],['unsupported coverage',(b)=>{b.historyCoverage='complete'}],
 ['wrong count',(b)=>{b.sourceCount=2}],['unknown top field',(b)=>{Object.assign(b,{approved:true})}],
 ['future source receipt',(b)=>{b.sources[0].receivedAt='2026-09-22T12:00:00.000002Z'}],
 ['future source capture',(b)=>{b.sources[0].capturedAt='2026-09-22T12:00:00.000002Z'}],
 ['capture before ledger',(b)=>{b.sources[0].capturedAt='2026-09-22T07:59:59Z'}],
 ['raw hash mismatch',(b)=>{b.sources[0].rawPayload+='x'}],['facts hash mismatch',(b)=>{b.sources[0].assessments[0].factsText+=' '}],
 ['orphan',(b)=>{b.sources[0].assessments[0].previousAssessmentId=ownerId(800)}],
 ['cycle',(b)=>{b.sources[0].assessments[0].previousAssessmentId=b.sources[0].assessments[0].id}],
 ['missing witness id',(b)=>{b.sources[0].assessments[0].availabilityWitnessId=null}],
 ['witness before assessment',(b)=>{b.sources[0].assessments[0].availableAt='2026-09-22T10:59:59Z'}],
 ['assessment before capture',(b)=>{b.sources[0].assessments[0].assessedAt='2026-09-22T09:59:59Z'}],
 ['invalid effective month in assessment time',(b)=>{b.sources[0].assessments[0].assessedAt='2026-13-01T00:00:00Z'}],
 ['unknown assessment field',(b)=>{Object.assign(b.sources[0].assessments[0],{accepted:true})}],
 ['forged accepted status without actual owners',(b)=>{rewriteTimelineFacts(b.sources[0].assessments[0],f=>{f.objects[0].disposition='accepted';f.objects[0].reasons=[]})}],
 ['missing physical object',(b)=>{rewriteTimelineFacts(b.sources[0].assessments[0],f=>{f.objects=[]})}],
 ['foreign physical object',(b)=>{rewriteTimelineFacts(b.sources[0].assessments[0],f=>{f.objects[0].object.objectId='FOREIGN'})}],
] as Array<[string,(body:ReturnType<typeof timelineBody>)=>void]>)test(`rejects the whole readset on ${label}`,()=>{
 const body=timelineBody();mutate(body);const r=inspect(body);assert.equal(r.status,'read_failed');hidden(r);nonAuthority(r)
})
for(const [label,assessments] of [
 ['fork',[timelineAssessment(),timelineAssessment(102,ownerId(101)),timelineAssessment(103,ownerId(101))]],
 ['two roots',[timelineAssessment(),timelineAssessment(102)]],
 ['duplicate id',[timelineAssessment(),timelineAssessment()]],
 ['backward assessment clock',[timelineAssessment(),timelineAssessment(102,ownerId(101),{assessedAt:'2026-09-22T10:59:59Z'})]],
 ['disconnected cycle',[timelineAssessment(),timelineAssessment(102,ownerId(103)),timelineAssessment(103,ownerId(102))]],
] as const)test(`rejects ${label}`,()=>{const r=inspect(timelineBody([timelineSource({assessments})]));assert.equal(r.status,'read_failed');hidden(r)})
test('a late malformed second source never discloses the first good source',()=>{
 const b=timelineBody([timelineSource(),timelineSource({sourceMessageId:ownerId(900),payloadHash:'0'.repeat(64)})]);const r=inspect(b);assert.equal(r.status,'read_failed');hidden(r)
})
test('cross-source predecessor and reused witness ids fail closed',()=>{
 const first=timelineSource(),second=timelineSource({sourceMessageId:ownerId(900),assessments:[timelineAssessment(102,ownerId(101))]})
 assert.equal(inspect(timelineBody([first,second])).status,'read_failed')
 second.assessments=[timelineAssessment(102,null,{availabilityWitnessId:first.assessments[0].availabilityWitnessId})]
 const r=inspect(timelineBody([first,second]));assert.equal(r.status,'read_failed');hidden(r)
})
test('source rows without assessment/receipt/payload remain unavailable rather than approved',()=>{
 const r=inspect(timelineBody([timelineSource({rawPayload:null,payloadHash:null,receivedAt:null,assessments:[]})]))
 assert.equal(r.status,'inspected');assert.equal(r.sources[0].asOf,null);assert.equal(r.sources[0].visibility,'no_assessment');nonAuthority(r)
})
test('SQL incomplete readset does not expose a prefix or snapshot authority',()=>{
 const r=inspect(timelineBody([],{complete:false,sourceCount:1001}));assert.equal(r.status,'incomplete');hidden(r);nonAuthority(r)
 const malformed=inspect(timelineBody([timelineSource()],{complete:false,sourceCount:1001}));assert.equal(malformed.status,'read_failed');hidden(malformed)
})
test('an authentic pre-ledger cutoff with zero captured sources is explicit incomplete history',()=>{
 const b=timelineBody([],{cutoffAt:'2026-09-22T07:00:00Z'}),r=inspectReceivedSourceDecisionTimeline({...timelineScope,cutoffAt:b.cutoffAt},timelineReceipt(b))
 assert.equal(r.status,'incomplete');hidden(r)
})
test('caps per-source assessment history without keeping a partial chain',()=>{
 const assessments=Array.from({length:129},(_,n)=>timelineAssessment(101+n,n?ownerId(100+n):null))
 const r=inspect(timelineBody([timelineSource({assessments})]));assert.equal(r.status,'incomplete');hidden(r)
})
test('caps payload bytes before any tokenization',()=>{const b=timelineBody();b.sources[0].rawPayload='x'.repeat(262145);const r=inspect(b);assert.equal(r.status,'incomplete');hidden(r)})
test('transport corruption cannot be repaired with a caller approved flag',()=>{
 const receipt=timelineReceipt();receipt.readsetHash='0'.repeat(64)
 const r=inspectReceivedSourceDecisionTimeline(timelineScope,{...receipt,approved:true});assert.equal(r.status,'read_failed');hidden(r)
})
test('IO retains original company/environment and all cutoff microseconds',async()=>{
 let called=false;const r=await readReceivedSourceDecisionTimeline(timelineScope,{async openSnapshot(scope){called=true;assert.deepEqual(scope,timelineScope);return timelineReceipt()}})
 assert.equal(called,true);assert.equal(r.status,'inspected')
})
test('IO failure stays unavailable and never leaks transport error details',async()=>{
 const r=await readReceivedSourceDecisionTimeline(timelineScope,{async openSnapshot(){throw Error('private-token-sensitive')}})
 assert.equal(r.status,'read_failed');hidden(r);assert.ok(!JSON.stringify(r).includes('private-token-sensitive'))
})
test('invalid caller scope never reaches the privileged RPC',async()=>{
 const r=await readReceivedSourceDecisionTimeline({...timelineScope,companyId:'invalid'},{async openSnapshot(){assert.fail('must not read')}})
 assert.equal(r.status,'not_requested');hidden(r)
})

test('rejects a coercible environment before issuing any snapshot read',async()=>{
 let calls=0
 const result=await readReceivedSourceDecisionTimeline({...timelineScope,environment:['test']},{async openSnapshot(){calls++;return timelineReceipt(timelineBody())}})
 assert.equal(calls,0);assert.equal(result.status,'not_requested');hidden(result)
})
test('rejects a coercible object disposition instead of exporting a non-string enum',()=>{
 const body=timelineBody()
 rewriteTimelineFacts(body.sources[0].assessments[0],facts=>{Object.assign(facts.objects[0],{disposition:['unavailable']})})
 const result=inspect(body);assert.equal(result.status,'read_failed');hidden(result)
})
