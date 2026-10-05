import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {company,actor,mailId,parseId,oldId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'
const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const raw=energyHandoffMessage().raw_payload!,hash=(wire:string)=>createHash('sha256').update(wire).digest('hex')
const parse=(wire=raw)=>{const parsed=parseInboundEmailContent({attachmentText:wire});if(!parsed)throw Error('actual_fixture_parse_required');return parsed}
let db:ReturnType<typeof inboundReceptionBoundary>,receivedRaw:string
beforeEach(()=>{
 vi.clearAllMocks();receivedRaw=raw;db=inboundReceptionBoundary(parse());io.from.mockImplementation(db.from)
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name!=='ediel_record_inbound_reception_v1')return db.rpc(name,args)
  const source=args.p_message_id===oldId?db.state.original:{id:newId,company_id:company,environment:'test',raw_payload:receivedRaw}
  if(args.p_company_id!==company||args.p_actor_user_id!==actor||args.p_inbound_email_message_id!==mailId||args.p_parse_result_id!==parseId
   ||source.company_id!==company||source.environment!=='test')throw Error('ediel_real_reception_source_scope_required')
  const conflict=source.raw_payload!==receivedRaw
  return {error:null,data:{companyId:company,sourceMessageId:source.id,inboundEmailMessageId:mailId,parseResultId:parseId,
   receptionId:'00000000-0000-4000-8000-000000000007',classification:conflict?'identity_conflict':'first_reception',isReplay:source.id===oldId,
   receivedAt,canonicalPayloadHash:hash(String(source.raw_payload)),receivedPayloadHash:hash(receivedRaw),
   responseRequestId:conflict?'00000000-0000-4000-8000-000000000008':null,status:conflict?'held':'observed',
   reason:conflict?'same_identity_different_original_requires_review':null,businessEffectAuthorized:false}}
 })
})
const save=(wire=raw)=>{receivedRaw=wire;return createInboundEdielMessage({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse(wire)})}
const noOriginalWrites=()=>expect(db.writes('ediel_messages')).toEqual([])
it('same natural identity and changed QTY cannot overwrite original raw',async()=>{
 const before=structuredClone(db.state.original)
 await expect(save(raw.replace('QTY+136:500','QTY+136:999'))).rejects.toMatchObject({name:'InboundReceptionHeldError',reception:{classification:'identity_conflict',businessEffectAuthorized:false}})
 noOriginalWrites();expect(db.state.original).toEqual(before);expect(db.writes('ediel_message_events')).toEqual([])
})
it('same bytes in another environment cannot reuse the original source',async()=>{
 db.state.existingEnvironment='production';const before=structuredClone(db.state.original)
 await expect(save()).resolves.toBe(newId)
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toHaveLength(1)
 expect(db.writes('ediel_messages')[0]).toMatchObject({operation:'insert',payload:{environment:'test',raw_payload:raw,message_received_at:receivedAt}})
})
it('identical bytes and scope preserve read-only normal reuse',async()=>{
 const before=structuredClone(db.state.original)
 await expect(save()).resolves.toBe(oldId)
 noOriginalWrites();expect(db.state.original).toEqual(before);expect(db.writes('ediel_message_events')).toEqual([])
})
it('unique-conflict recovery cannot return changed original as successful reuse',async()=>{
 db.state.existing=false;db.state.error={code:'23505',message:'declared_actual_unique_collision'}
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='ediel_messages'){
   const insert=q.insert
   q.insert=(payload:Record<string,unknown>)=>{const result=insert(payload);db.state.existing=true;return result}
  }
  return q
 })
 const before=structuredClone(db.state.original)
 await expect(save(raw.replace('QTY+136:500','QTY+136:999'))).rejects.toMatchObject({name:'InboundReceptionHeldError',reception:{classification:'identity_conflict'}})
 expect(db.writes('ediel_messages')).toHaveLength(1);expect(db.writes('ediel_messages')[0].operation).toBe('insert')
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_message_events')).toEqual([])
})
