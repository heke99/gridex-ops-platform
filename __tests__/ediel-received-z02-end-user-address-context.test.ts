// Component only: finite readonly RPC evidence port; actual wire parser and
// opaque context ownership. These fixtures assert no native/whole authority.
import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {source} from './fixtures/prodat-identity'
import {line,characteristic,raw,type Parts} from './fixtures/prodat-register'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {fetchReceivedZ02EndUserAddressContext,redeemReceivedZ02EndUserAddressContext,type ReceivedZ02EndUserAddressContext,type ReceivedZ02AddressPolicy} from '@/lib/ediel/prodat/receivedZ02EndUserAddressContext'

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const point='735999000000000001',user='199001011234',li='OWN:+?'
const policy:ReceivedZ02AddressPolicy={code:'Z02',subtype:'L',direction:'inbound',applicationReference:'23-DDQ-PRODAT'}
function wire(code:'Z01'|'Z02',address:readonly string[],reason='Z22',change?:(parts:Parts[])=>Parts[]){
 const sender=code==='Z01'?'12345':'54321',receiver=code==='Z01'?'54321':'12345'
 let parts:Parts[]=[['NAD','FR',[sender,'160','SVK'],'','','','','','','SE'],['NAD','DO',[receiver,'160','SVK'],'','','','','','','SE'],
  line('1',point,undefined,'9'),...characteristic('Z13',reason),['RFF',['LI',li]],['NAD','UD',[user,'SE2','260'],'','Synthetic',address,'Town','','12345','SE']]
 if(change)parts=change(parts)
 const businessSegments=tokenizeEdifact(raw(parts,code)).segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.raw)
 return EdifactEnvelopeCodec.encode({sender,receiver,interchangeReference:code+'-I',applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:false,environment:'test',
  createdAt:new Date('2026-10-06T12:00:00Z'),messages:[{messageReference:code+'-M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments}]})
}
function fixture(originalAddress:readonly string[]=['Original :+?','BOX'],replyAddress:readonly string[]=['Changed address'],reason='Z22'){
 const originalRawPayload=wire('Z01',originalAddress,reason),sourceRawPayload=wire('Z02',replyAddress,reason)
 const message={...source(sourceRawPayload,'Z02'),id:id(1),company_id:id(2),customer_id:id(3),site_id:id(4),grid_owner_id:id(11),message_received_at:'2026-10-06T12:03:00Z',sender_ediel_id:'54321',receiver_ediel_id:'12345',immutable_payload_hash:hash(sourceRawPayload)}
 const originalMessage={...source(originalRawPayload,'Z01'),id:id(5),company_id:id(2),customer_id:id(3),site_id:id(4),grid_owner_id:id(11),direction:'outbound',environment:'test',raw_payload:originalRawPayload,
  immutable_payload_hash:hash(originalRawPayload),immutable_rendered_at:'2026-10-06T12:00:00Z'} as typeof message & {immutable_payload_hash:string;immutable_rendered_at:string}
 const object={objectId:point,identityAgency:'9',lineReference:li,reason,customerId:user,customerQualifier:'SE2',customerAgency:'260'}
 const proof={status:'z02_address_source_basis',version:1,companyId:id(2),environment:'test',sourceMessageId:id(1),sourcePayloadHash:hash(sourceRawPayload),sourceReceivedAt:message.message_received_at,sourceRawPayload,sourceMessage:message,
  originalMessageId:id(5),originalPayloadHash:hash(originalRawPayload),originalRenderedAt:'2026-10-06T12:00:00Z',originalRawPayload,originalMessage,
  sourceObject:{...object},originalObject:{...object},request:{id:id(6),company_id:id(2),customer_id:id(3),site_id:id(4),grid_owner_id:id(11),operation_id:id(7),ediel_message_id:id(5)},
  requestSnapshot:{id:id(8),company_id:id(2),customer_id:id(3),customer_site_id:id(4),operation_id:id(7),request_kind:'customer_data_request',request_reference:id(6),superseded_at:null,grid_owner_id:id(11),site_address_hash:'installation|12345|town'},
  customer:{id:id(3),company_id:id(2),personal_number:user,org_number:null as string|null},site:{id:id(4),company_id:id(2),customer_id:id(3),facility_id:point,grid_owner_id:id(11),street:'Installation',postal_code:'12345',city:'Town',address_hash:'installation|12345|town'},
  acceptedTransport:{id:id(9),message_id:id(5),company_id:id(2),environment:'test',classification:'accepted',entered_at:'2026-10-06T12:01:00Z',observed_at:'2026-10-06T12:02:00Z',binding:{originalHash:hash(originalRawPayload)}},
  acceptedTransportReceipt:{status:'accepted_projection',lane:'generic_journal',companyId:id(2),environment:'test',messageId:id(5),attemptId:id(9),originalHash:hash(originalRawPayload),observedAt:'2026-10-06T12:02:00Z'}}
 const rpc=vi.fn(async()=>({data:proof as unknown,error:null as unknown}))
 return {message,proof,rpc,fetch:()=>fetchReceivedZ02EndUserAddressContext({message,actorUserId:id(10),client:{rpc}})}
}
it.each(['Z22','Z23'])('reads genuine source availability for %s, allowing a changed reply address',async reason=>{
 const f=fixture(undefined,undefined,reason),context=await f.fetch();expect(context).toBeDefined()
 expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_ediel_received_z02_address_source_basis_v1',{p_source_message_id:id(1),p_actor_user_id:id(10)})
 expect(redeemReceivedZ02EndUserAddressContext({message:f.message,context:context!,policy:{...policy,subtype:reason==='Z22'?'L':'LK'}})).toEqual([{
  meteringPointId:point,identityAgency:'9',endUser:{id:user,qualifier:'SE2',agency:'260'},availability:'available',
  source:{kind:'received_z01',companyId:id(2),originalMessageId:id(5),originalPayloadHash:f.proof.originalPayloadHash,requestId:id(6),snapshotId:id(8)}}])
 expect(Object.isFrozen(context)).toBe(true)
})
it.each([{address:[]},{address:['.']}])('original unavailable address $address remains unavailable despite populated reply',async({address})=>{
 const f=fixture(address),context=await f.fetch();expect(context).toBeDefined()
 expect(redeemReceivedZ02EndUserAddressContext({message:f.message,context:context!})[0].availability).toBe('unavailable')
})
it('missing incoming UD cannot suppress the independent original availability',async()=>{
 const f=fixture();f.message.raw_payload=wire('Z02',[], 'Z22',parts=>parts.filter(p=>!(p[0]==='NAD'&&p[1]==='UD')))
 f.proof.sourceRawPayload=f.message.raw_payload;f.proof.sourcePayloadHash=hash(f.message.raw_payload);f.message.immutable_payload_hash=f.proof.sourcePayloadHash
 const context=await f.fetch();expect(context).toBeDefined();expect(redeemReceivedZ02EndUserAddressContext({message:f.message,context:context!})[0].availability).toBe('available')
})
it('RPC null preserves unknown availability without minting a token',async()=>{const f=fixture();f.rpc.mockResolvedValue({data:null,error:null});expect(await f.fetch()).toBeUndefined()})
it('RPC failure propagates a local source-read refusal',async()=>{const f=fixture();f.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'permission denied'}});await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_unavailable')})
it('non-Z02 and non-inbound calls do not read the source RPC',async()=>{
 const f=fixture();f.message.message_code='Z04';expect(await f.fetch()).toBeUndefined();f.message.message_code='Z02';f.message.direction='outbound';expect(await f.fetch()).toBeUndefined();expect(f.rpc).not.toHaveBeenCalled()
})
it.each(['id','company_id','environment','customer_id','site_id','message_received_at','raw_payload','message_standard','immutable_payload_hash'] as const)('cannot redeem after changing actual row %s',async field=>{
 const f=fixture(),context=await f.fetch();expect(context).toBeDefined();const changed={...f.message,[field]:field==='environment'?'production':'CHANGED'}
 expect(()=>redeemReceivedZ02EndUserAddressContext({message:changed,context:context!})).toThrow('received_z02_end_user_address_context_scope_mismatch')
})
it('copied and forged tokens cannot redeem source facts',async()=>{
 const f=fixture(),context=await f.fetch();expect(context).toBeDefined()
 for(const token of [{...context!},JSON.parse(JSON.stringify(context)),{kind:'received_z02_end_user_address'}])expect(()=>redeemReceivedZ02EndUserAddressContext({message:f.message,context:token as ReceivedZ02EndUserAddressContext})).toThrow('received_z02_end_user_address_context_unqualified')
})
it.each(['code','subtype','direction','applicationReference'] as const)('cannot borrow protected availability for foreign policy %s',async key=>{
 const f=fixture(),context=await f.fetch();expect(context).toBeDefined();expect(()=>redeemReceivedZ02EndUserAddressContext({message:f.message,context:context!,policy:{...policy,[key]:'FOREIGN'}})).toThrow('received_z02_end_user_address_context_policy_mismatch')
})
it.each(['sourcePayloadHash','originalPayloadHash','sourceReceivedAt','originalMessageId','companyId','environment'] as const)('rejects mismatched proof %s',async key=>{
 const f=fixture();Reflect.set(f.proof,key,'FOREIGN');await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')
})
it.each(['entered_at','observed_at'] as const)('rejects transport %s after actual receipt',async key=>{
 const f=fixture();f.proof.acceptedTransport[key]='2026-10-06T12:04:00Z';await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')
})
it('rejects a non-accepted transport attempt',async()=>{const f=fixture();f.proof.acceptedTransport.classification='uncertain';await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')})
it('rejects wrong original accepted payload hash',async()=>{const f=fixture();f.proof.acceptedTransport.binding.originalHash='a'.repeat(64);await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')})
it.each(['status','lane','companyId','environment','messageId','attemptId','originalHash','observedAt'] as const)('rejects detached provider receipt %s',async key=>{const f=fixture();f.proof.acceptedTransportReceipt[key]='FOREIGN';await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')})
it('retains a genuine snapshot when current site uses the documented address-hash fallback',async()=>{
 const f=fixture();f.proof.site.address_hash='';expect(await f.fetch()).toBeDefined()
})
it.each(['request','requestSnapshot','customer','site'] as const)('rejects foreign tenant in %s',async key=>{
 const f=fixture();f.proof[key].company_id=id(99);await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')
})
it.each(['objectId','identityAgency','lineReference','reason'] as const)('rejects detached source object %s',async key=>{
 const f=fixture();f.proof.sourceObject[key]='FOREIGN';await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')
})
it('does not derive availability from a populated reply when original UD is missing',async()=>{
 const f=fixture();f.proof.originalRawPayload=wire('Z01',[], 'Z22',parts=>parts.filter(p=>!(p[0]==='NAD'&&p[1]==='UD')));f.proof.originalMessage.raw_payload=f.proof.originalRawPayload;f.proof.originalPayloadHash=hash(f.proof.originalRawPayload);f.proof.acceptedTransport.binding.originalHash=f.proof.originalPayloadHash;f.proof.originalMessage.immutable_payload_hash=f.proof.originalPayloadHash;f.proof.acceptedTransportReceipt.originalHash=f.proof.originalPayloadHash
 await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')
})

it('rejects an internally matching but unsealed source hash',async()=>{const f=fixture();f.message.immutable_payload_hash='a'.repeat(64);await expect(f.fetch()).rejects.toThrow('received_z02_end_user_address_source_invalid')})
it('matches the actual normalized-point and customer blank-value fallbacks',async()=>{const f=fixture();Object.assign(f.proof.site,{normalized_facility_id:'  ',facility_id:' '+point+' '});f.proof.customer.org_number=' ';f.proof.customer.personal_number=' '+user+' ';expect(await f.fetch()).toBeDefined()})
it('retains PostgreSQL microsecond clock scope rather than rounding to milliseconds',async()=>{const f=fixture();f.message.message_received_at='2026-10-06T12:03:00.123456Z';f.proof.sourceReceivedAt=f.message.message_received_at;const context=await f.fetch();expect(context).toBeDefined();expect(()=>redeemReceivedZ02EndUserAddressContext({message:{...f.message,message_received_at:'2026-10-06T12:03:00.123457Z'},context:context!})).toThrow('received_z02_end_user_address_context_scope_mismatch')})
