import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({source:{} as Record<string,unknown>,read:vi.fn(),final:vi.fn(),outbox:vi.fn(),guide:vi.fn(),create:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.source}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/ackDraftSource',()=>({readExistingAckBeforeDraft:io.read}))
vi.mock('@/lib/ediel/core/receivedProdatFinalResponsePlan',()=>({readReceivedProdatFinalResponsePlan:io.final,receivedProdatFinalResponseQualification:vi.fn()}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.guide}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.create}))
vi.mock('@/lib/ediel/ack',()=>({buildAperakDraft:vi.fn()}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:io.outbox}))
import {createReceivedProdatStructuralAcks,createReceivedProdatCommittedEffectAcks} from '@/lib/ediel/flows/receivedProdatStructuralAcks'
import {raw,line} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
const companyId='00000000-0000-4000-8000-000000000002',actorUserId='ACTOR'
beforeEach(()=>{
 vi.clearAllMocks();io.source={...source(raw([...head(),line('1','A',undefined,'9'),['RFF',['LI','OWN-A']],line('2','B',undefined,'9'),['RFF',['LI','OWN-B']]],'Z06'),'Z06'),company_id:companyId}
 io.actor.mockResolvedValue(undefined);io.outbox.mockResolvedValue({status:'prepared'});io.final.mockResolvedValue(null)
 io.read.mockImplementation(async(input:{acknowledgedReferences:string[]})=>({id:input.acknowledgedReferences[0],status:'failed',ack_outcome:'positive'}))
})
it('repairs genuine retained own positives before a new primary receipt or current guide is requested',async()=>{
 const ids=await createReceivedProdatStructuralAcks({companyId,actorUserId,sourceMessageId:String(io.source.id)})
 expect(ids).toEqual(['OWN-A','OWN-B']);expect(io.final).not.toHaveBeenCalled();expect(io.guide).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 expect(io.outbox).toHaveBeenCalledTimes(2)
 expect(io.outbox).toHaveBeenCalledWith(expect.objectContaining({status:'prepared',queueOnlyIfInserted:true,message:expect.objectContaining({status:'failed'})}))
})
it('keeps an original negative immutable and never borrows it as a positive source effect',async()=>{
 io.read.mockImplementation(async(input:{acknowledgedReferences:string[]})=>({id:input.acknowledgedReferences[0],status:'sent',ack_outcome:input.acknowledgedReferences[0]==='OWN-A'?'positive':'negative'}))
 expect(await createReceivedProdatStructuralAcks({companyId,actorUserId,sourceMessageId:String(io.source.id)})).toEqual(['OWN-A'])
 expect(io.final).not.toHaveBeenCalled();expect(io.outbox).toHaveBeenCalledTimes(1)
 const badIndex=tokenizeEdifact(String(io.source.raw_payload)).segments.filter(segment=>segment.tag==='LIN')[1].index
 await expect(createReceivedProdatStructuralAcks({companyId,actorUserId,sourceMessageId:String(io.source.id),objectLineIndices:[badIndex]})).rejects.toThrow('blocked_final_ack_exists')
 expect(io.guide).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})

it('binds retained lookup to the complete own physical object even when two objects share LI',async()=>{
 io.source={...io.source,raw_payload:raw([...head(),line('1','A',undefined,'9'),['RFF',['LI','SHARED']],line('2','B',undefined,'9'),['RFF',['LI','SHARED']]],'Z06')}
 const groups=tokenizeEdifact(String(io.source.raw_payload)).segments.filter(segment=>segment.tag==='LIN')
 io.read.mockImplementation(async(input:{acknowledgedReferences:string[];acknowledgedProdatObjects?:{objectId:string;identityAgency:string;firstLineIndex:number;lineItemReference:string}[]})=>{
  const own=input.acknowledgedProdatObjects?.[0]
  if(!own)throw new Error('complete_physical_scope_required')
  expect(input.acknowledgedReferences).toEqual(['SHARED'])
  expect(own).toEqual({objectId:own.objectId,identityAgency:'9',firstLineIndex:own.objectId==='A'?groups[0].index:groups[1].index,lineItemReference:'SHARED'})
  return {id:'ACK-'+own.objectId,status:'failed',ack_outcome:own.objectId==='A'?'positive':'negative'}
 })
 expect(await createReceivedProdatStructuralAcks({companyId,actorUserId,sourceMessageId:String(io.source.id)})).toEqual(['ACK-A'])
 expect(io.outbox).toHaveBeenCalledTimes(1)
 expect(io.outbox).toHaveBeenCalledWith(expect.objectContaining({message:expect.objectContaining({id:'ACK-A'}),status:'prepared'}))
 expect(io.final).not.toHaveBeenCalled();expect(io.guide).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 await expect(createReceivedProdatStructuralAcks({companyId,actorUserId,sourceMessageId:String(io.source.id),objectLineIndices:[groups[1].index]})).rejects.toThrow('blocked_final_ack_exists')
})

it.each(['Z04','Z05','Z14','Z15'])('retained %s responses repair before new domain receipts or current rules',async(code)=>{
 io.source={...io.source,message_code:code,raw_payload:String(io.source.raw_payload).replace('BGM+Z06','BGM+'+code)}
 expect(await createReceivedProdatCommittedEffectAcks({companyId,actorUserId,sourceMessageId:String(io.source.id)})).toEqual(['OWN-A','OWN-B'])
 expect(io.final).not.toHaveBeenCalled();expect(io.guide).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 expect(io.outbox).toHaveBeenCalledTimes(2)
 expect(io.outbox).toHaveBeenCalledWith(expect.objectContaining({status:'prepared',queueOnlyIfInserted:true}))
})
