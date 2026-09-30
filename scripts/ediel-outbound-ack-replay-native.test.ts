import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordEdielTechnicalSyntaxDecision,captureEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Disposable native Supabase only. No parser, owner, database, gateway or
// permission mock and no provider entry/traffic. Source/ACK are synthetic.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"
function sql<T>(input:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
 const output=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:10000}).trim()
 return output?JSON.parse(output) as T:undefined as T
}
it('replays a genuine native own CONTRL without current route selection and holds current grant/membership/endpoint revocation without effects',async()=>{
 const company=randomUUID(),actor=randomUUID(),sourceId=randomUUID(),ackId=randomUUID(),identifierId=randomUUID()
 const endpoint=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999)n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text AND (i.valid_to IS NULL OR now()<i.valid_to))`)
 const sourceReference='S'+sourceId.replaceAll('-','').slice(0,13),ackReference='A'+ackId.replaceAll('-','').slice(0,13),sourceUnh='S'+sourceId.slice(0,8),ackUnh='A'+ackId.slice(0,8)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Disposable ACK replay native','active');
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Disposable ACK operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(company)},id,key FROM public.permissions WHERE key='communication.write';
  INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(identifierId)},${literal(company)},'test',${literal(actor)},'EdielId',${literal(endpoint)},now()-interval '1 day');`)
 const raw=`UNB+UNOC:3+12345:14+${endpoint}:14+260930:1200+${sourceReference}++23-DDQ-PRODAT++++1'UNH+${sourceUnh}+PRODAT:D:96A:UN:E2SE6A'BGM+UNLISTED+SOURCE+9+AB'DTM+137:202609301200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+${endpoint}:160:SVK+++++++SE'UNT+7+${sourceUnh}'UNZ+1+${sourceReference}'`
 const stored=await supabaseService.from('ediel_messages').insert({id:sourceId,company_id:null,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'UNLISTED',status:'received',raw_payload:raw,message_received_at:new Date().toISOString()}).select('*').single()
 expect(stored.error).toBeNull();const source=stored.data as EdielMessageRow
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect(['accepted','rejected']).toContain(decision.syntaxDecision)
 await recordEdielTechnicalSyntaxDecision({companyId:company,sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw).digest('hex'),syntaxDecision:decision.syntaxDecision as 'accepted'|'rejected',reasonCodes:decision.issues.map(issue=>issue.code)})
 const evidence=await captureEdielTechnicalSyntaxAckEvidence(company,sourceId)
 const outcome=evidence.syntaxDecision==='accepted'?'positive':'negative'
 const ownRaw=`UNB+UNOC:3+${endpoint}:14+12345:14+260930:1201+${ackReference}++23-DDQ-PRODAT++++1'UNH+${ackUnh}+CONTRL:2:2:UN:EDIEL2'UCI+${sourceReference}+12345:14+${endpoint}:14+${outcome==='positive'?'8':'4'}'UNT+3+${ackUnh}'UNZ+1+${ackReference}'`
 // Actual INSERT triggers qualify reversed own wire against the already
 // committed technical facet/guide and reserve its immutable namespace.
 const persisted=await supabaseService.from('ediel_messages').insert({id:ackId,company_id:company,environment:'test',direction:'outbound',message_standard:'edifact',message_family:'CONTRL',message_code:'CONTRL',status:'draft',related_message_id:sourceId,raw_payload:ownRaw,ack_outcome:outcome,source_operation_id:`ediel_ack:${sourceId}:CONTRL:message`}).select('*').single()
 expect(persisted.error).toBeNull()
 const effects=()=>sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE id IN(${literal(sourceId)},${literal(ackId)}) OR related_message_id=${literal(sourceId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE source_message_id=${literal(sourceId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(company)}),'events',(SELECT count(*) FROM public.ediel_message_events WHERE ediel_message_id IN(${literal(sourceId)},${literal(ackId)})))`)
 const before=effects(),draft={actorUserId:actor,companyId:company,environment:'test' as const,direction:'outbound' as const,messageStandard:'edifact' as const,messageFamily:'CONTRL' as const,messageCode:'CONTRL',rawPayload:ownRaw}
 const nativeRead=()=>{const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;return rpc('ediel_read_outbound_ack_replay_v1',{p_company_id:company,p_environment:'test',p_source_message_id:sourceId,p_actor_user_id:actor,p_ack_family:'CONTRL',p_sequence_field:null,p_sequence_value:null})}
 const replay=()=>createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'CONTRL',outcome,draft})
 // No configured route/profile exists: established replay must avoid any
 // current route/profile read, new witness, message, event or outbox row.
 expect((await nativeRead()).error).toBeNull();expect((await replay()).id).toBe(ackId);expect((await replay()).raw_payload).toBe(ownRaw);expect(effects()).toEqual(before)
 await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'CONTRL',outcome:outcome==='positive'?'negative':'positive',draft})).rejects.toThrow('conflicting_ack_draft_exists');expect(effects()).toEqual(before)
 await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:{...source,raw_payload:raw+'altered'},ackFamily:'CONTRL',outcome,draft})).rejects.toThrow('actual_original_mismatch')
 sql(`UPDATE public.user_permissions SET is_active=false WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`);expect((await nativeRead()).error?.message).toContain('actor_not_authorized');await expect(replay()).rejects.toThrow();sql(`UPDATE public.user_permissions SET is_active=true WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`)
 sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`);expect((await nativeRead()).error?.message).toContain('actor_not_authorized');await expect(replay()).rejects.toThrow();sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`)
 sql(`UPDATE public.tenant_actor_identifiers SET valid_to=now() WHERE id=${literal(identifierId)}`);expect((await nativeRead()).error?.message).toContain('endpoint_unqualified');await expect(replay()).rejects.toThrow();sql(`UPDATE public.tenant_actor_identifiers SET valid_to=null WHERE id=${literal(identifierId)}`)
 expect((await replay()).id).toBe(ackId);expect(effects()).toEqual(before)
})
