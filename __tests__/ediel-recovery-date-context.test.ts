import {beforeEach,describe,expect,it,vi} from 'vitest'
import {loadProdatDateEventValidationContext,recoveryDateEventScope} from '@/lib/ediel/production/dateEventContext'
import type {ProdatDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type {ProdatDateEventObject} from '@/lib/ediel/prodat/prodatDateEvents'
import type {RecoverySourceBasis} from '@/lib/ediel/recovery/sourceContext'
import {source} from './fixtures/prodat-identity'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tgt:vi.fn(),route:vi.fn(),production:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/testing/tgtDateEventContext',()=>({loadTgtDateEventValidationContext:io.tgt}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/production/contractSource',()=>({productionContractDateContext:io.production}))
const basis:RecoverySourceBasis={originalMessageId:'original',sourceOriginMessageId:'original',operationId:'operation',sourceAckMessageId:'ack',kind:'aperak_correction',correctedPayloadHash:'a'.repeat(64),allowedObjects:[{point:'A',identityAgency:'89',li:'LI'}]}
const context:ProdatDateEventValidationContext={source:{kind:'production_contract',companyId:'tenant',environment:'production',code:'Z09',eventId:'event',sourceDigest:'a'.repeat(64),sourceVersion:'1',actorId:'actor',reference:'source',route:{actorSettingId:'actor-setting',routeProfileId:'profile',communicationRouteId:'route',legalSender:{id:'111',qualifier:'160',agency:'SVK'},legalRecipient:{id:'222',qualifier:'160',agency:'SVK'},senderId:'111',receiverId:'222',senderQualifier:'ZZ',receiverQualifier:'ZZ',senderSubaddress:null,receiverSubaddress:null,transportType:'smtp',mailbox:null,receiverEmail:null,applicationReference:'23-DDQ-PRODAT',suppliers:[]}},objects:['A','B'].map((meteringPointId):ProdatDateEventObject=>({kind:'production_contract',direction:'production',meteringPointId,identityAgency:'89',contract:{reference:'contract',revision:'1'},event:{reference:'event',revision:'1',kind:'signed'},supplyBoundaryAt:'2026-10-01T12:00:00Z'}))}
const original={...source('SOURCE'),company_id:'tenant',id:'original',environment:'production' as const,direction:'outbound' as const,message_code:'Z09',intent_id:'original-intent'}
const corrected={...original,id:'corrected',original_message_id:'original',source_operation_id:'operation',intent_id:'new-intent'}
beforeEach(()=>{vi.resetAllMocks();io.tgt.mockResolvedValue(undefined);io.production.mockReturnValue(context);io.route.mockResolvedValue({route:{id:'route'}});io.rpc.mockResolvedValue({data:null,error:null});const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:original,error:null})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);io.from.mockReturnValue(q)})
describe('private correction date context',()=>{
 it('keeps only physically failed own objects and rejects an unqualified scope',()=>{
  expect(recoveryDateEventScope(context,basis)?.objects.map(o=>o.meteringPointId)).toEqual(['A'])
  expect(()=>recoveryDateEventScope(context,{...basis,allowedObjects:[{point:'OTHER',identityAgency:'89'}]})).toThrow('date_scope_unqualified')
 })
 it('cannot select a production source from mutable parsed event/recovery metadata',async()=>{
  expect(await loadProdatDateEventValidationContext({...corrected,parsed_payload:{productionContractEventId:'event',recoveryOperationId:'operation'}},'actor')).toBeUndefined()
  expect(io.from).not.toHaveBeenCalled();expect(io.production).not.toHaveBeenCalled()
 })
 it('follows only private exact correction binding and loads the current real original source',async()=>{
  io.rpc.mockImplementation(async(name:string,args:Record<string,string>)=>({data:name==='ediel_prodat_recovery_original_basis_v1'&&args.p_message_id==='corrected'?basis:name==='ediel_production_contract_message_basis_v1'?{basis:{status:'authorized',companyId:'tenant',environment:'production',legalReceiverId:'222'},intentId:'original-intent'}:null,error:null}))
  expect((await loadProdatDateEventValidationContext(corrected,'actor'))?.objects.map(o=>o.meteringPointId)).toEqual(['A'])
  expect(io.rpc).toHaveBeenCalledWith('ediel_production_contract_message_basis_v1',{p_company_id:'tenant',p_message_id:'original',p_actor_user_id:'actor'})
 })
 it('does not fall back when the private source qualifier fails',async()=>{
  io.rpc.mockResolvedValue({data:null,error:{message:'immutable_source_held'}})
  await expect(loadProdatDateEventValidationContext(corrected,'actor')).rejects.toEqual({message:'immutable_source_held'});expect(io.tgt).not.toHaveBeenCalled()
 })
})
