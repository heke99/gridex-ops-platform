import {randomUUID,createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {decisionNativeSql as sql,decisionUser,literal} from './helpers/ediel-decision-original-native-fixture'

// Genuine local GoTrue/native reception owner mechanics. The wire is explicit
// unapproved transport input, not market validation or duplicate ACK authority.
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const wire="UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:0000+OWN+++++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:EDIEL3'BGM+Z02+OWN+9'DTM+137:202610010000:203'LIN+1'UNT+5+1'UNZ+1+OWN'"
type Reception={receptionId:string;responseRequestId:string|null;classification:string;status:string;isReplay:boolean;businessEffectAuthorized:boolean;canonicalPayloadHash:string;receivedPayloadHash:string;firstOutcomeAvailable?:boolean;duplicateResponseActivated?:boolean}
async function fixture(){
 const companyId=randomUUID(),foreignCompanyId=randomUUID(),mailboxId=randomUUID(),messageId=randomUUID()
 sql('INSERT INTO public.companies(id,name,status) VALUES('+literal(companyId)+",'Synthetic native reception A','active'),("+literal(foreignCompanyId)+",'Synthetic native reception B','active');INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,environment,is_active,is_shared_platform_mailbox) VALUES("+literal(mailboxId)+','+literal(companyId)+",'Synthetic retained-only reception mailbox','test',true,false)")
 const actor=await decisionUser(companyId,['communication.send','communication.read'],randomUUID()+'Aa1!')
 const add=async(raw=wire)=>{
  const mailId=randomUUID(),parseId=randomUUID(),parsed=parseEdifactPayload(raw)
  sql('INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,raw_edifact_payload,body_text,processing_status,match_status) VALUES('+literal(mailId)+','+literal(companyId)+",'test',"+literal(mailboxId)+','+literal(mailId+'@example.invalid')+',clock_timestamp(),'+literal(raw)+','+literal(raw)+",'received','not_checked');INSERT INTO public.inbound_ediel_parse_results(id,inbound_email_message_id,company_id,raw_payload,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_family,message_code,parse_status) VALUES("+literal(parseId)+','+literal(mailId)+','+literal(companyId)+','+literal(parsed.rawPayload)+','+literal(parsed.senderEdielId)+','+literal(parsed.receiverEdielId)+','+literal(parsed.applicationReference)+','+literal(parsed.interchangeReference)+','+literal(parsed.messageFamily)+','+literal(parsed.messageCode)+",'parsed')")
  return{mailId,parseId,parsed}
 }
 const first=await add()
 // Z02 has two enabled subtype profiles (L, LK); like the retained closure
 // fixture, pin the actual enabled L registry profile instead of date-only
 // inference, which cannot choose between them.
 sql('INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,mailbox_message_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT '+literal(messageId)+','+literal(companyId)+",'test','inbound','edifact',"+literal(first.parsed.messageFamily)+','+literal(first.parsed.messageCode)+",'received',"+literal(wire)+',clock_timestamp(),'+literal(first.parsed.senderEdielId)+','+literal(first.parsed.receiverEdielId)+','+literal(first.parsed.applicationReference)+','+literal(first.parsed.interchangeReference)+','+literal(first.mailId)+",pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z02:L:26.A:r3' AND profile.is_enabled")
 const record=(reception=first,company=companyId,actorId=actor.id)=>supabaseService.rpc('ediel_record_inbound_reception_v1',{p_company_id:company,p_message_id:messageId,p_actor_user_id:actorId,p_inbound_email_message_id:reception.mailId,p_parse_result_id:reception.parseId})
 const read=(mailId=first.mailId)=>supabaseService.rpc('ediel_inbound_reception_request_v1',{p_company_id:companyId,p_message_id:messageId,p_actor_user_id:actor.id,p_inbound_email_message_id:mailId})
 const snapshot=()=>sql<Record<string,unknown>>('SELECT jsonb_build_object(\'original\',to_jsonb(m),\'receptions\',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),\'[]\') FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id),\'requests\',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),\'[]\') FROM gridex_ediel_inbound_receptions.response_requests r WHERE r.source_message_id=m.id)) FROM public.ediel_messages m WHERE m.id='+literal(messageId))
 const business=()=>sql<Record<string,number>>('SELECT jsonb_build_object(\'validation\',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id='+literal(messageId)+'),\'outbound\',(SELECT count(*) FROM public.ediel_messages WHERE company_id='+literal(companyId)+" AND direction='outbound'),'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id="+literal(companyId)+'))')
 return{companyId,foreignCompanyId,mailboxId,messageId,actor,first,add,record,read,snapshot,business}
}
it('actual installed public original uses only mailbox_message_id and preserves the qualified erase prefix',()=>{
 expect(sql('SELECT coalesce(jsonb_agg(jsonb_build_object(\'name\',attname,\'type\',atttypid::regtype::text) ORDER BY attname),\'[]\') FROM pg_attribute WHERE attrelid=\'public.ediel_messages\'::regclass AND attname IN(\'inbound_email_message_id\',\'mailbox_message_id\') AND NOT attisdropped')).toEqual([{name:'inbound_email_message_id',type:'uuid'},{name:'mailbox_message_id',type:'text'}])
 const source=sql<{guard:string;record:string}>("SELECT jsonb_build_object('guard',(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_inbound_receptions.guard_original_v1()'::regprocedure),'record',(SELECT prosrc FROM pg_proc WHERE oid='public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)'::regprocedure))")
 expect(source.guard).not.toContain('NEW.inbound_email_message_id');expect(source.record).not.toContain('m.inbound_email_message_id');expect(source.guard).toContain('public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;')
},30000)
it('genuine retained mail and real parser record a first own original without market or ACK authority',async()=>{
 const f=await fixture(),before=f.snapshot(),r=await f.record();expect(r.error).toBeNull();expect(r.data as Reception).toMatchObject({classification:'first_reception',status:'observed',isReplay:false,responseRequestId:null,businessEffectAuthorized:false,canonicalPayloadHash:hash(wire),receivedPayloadHash:hash(wire)})
 expect(f.snapshot().original).toEqual(before.original);expect(f.business()).toEqual({validation:0,outbound:0,attempts:0})
 const row=sql<{clockMatches:boolean;mailboxMatches:boolean}>('SELECT jsonb_build_object(\'clockMatches\',r.received_at=mail.received_at,\'mailboxMatches\',r.transport_source_snapshot->>\'mailboxId\'=mail.mailbox_id::text) FROM gridex_ediel_inbound_receptions.receptions r JOIN public.inbound_email_messages mail ON mail.id=r.inbound_email_message_id WHERE r.source_message_id='+literal(f.messageId));expect(row).toEqual({clockMatches:true,mailboxMatches:true})
},30000)
it('same retained-mail replay returns the immutable first receipt without new writes',async()=>{
 const f=await fixture(),first=await f.record();expect(first.error).toBeNull();const before=f.snapshot(),again=await f.record();expect(again.error).toBeNull();expect(again.data).toMatchObject({isReplay:true,receptionId:first.data.receptionId,responseRequestId:null});expect(f.snapshot()).toEqual(before)
},30000)
it('a new mail with the same protocol identity is a held duplicate with stable request and zero effects',async()=>{
 const f=await fixture();expect((await f.record()).error).toBeNull();const newMail=await f.add(),r=await f.record(newMail);expect(r.error).toBeNull();expect(r.data).toMatchObject({classification:'protocol_duplicate',status:'held',businessEffectAuthorized:false});expect(r.data.responseRequestId).toBeTruthy();const before=f.snapshot();expect((await f.record(newMail)).data).toMatchObject({isReplay:true,responseRequestId:r.data.responseRequestId});expect(f.snapshot()).toEqual(before);expect(f.business()).toEqual({validation:0,outbound:0,attempts:0})
},30000)
it('same envelope identity with different retained bytes is held and preserves first hash/clock/body',async()=>{
 const f=await fixture();expect((await f.record()).error).toBeNull();const before=f.snapshot().original,changed=await f.add(wire.replace('BGM+Z02+OWN','BGM+Z02+CHANGED')),r=await f.record(changed);expect(r.error).toBeNull();expect(r.data).toMatchObject({classification:'identity_conflict',status:'held',businessEffectAuthorized:false});expect(f.snapshot().original).toEqual(before);expect(f.business()).toEqual({validation:0,outbound:0,attempts:0})
},30000)
it('actual current membership revocation rejects replay and reading with unchanged receipt journals',async()=>{
 const f=await fixture();expect((await f.record()).error).toBeNull();const before=f.snapshot();sql("UPDATE public.company_memberships SET status='revoked',is_active=false WHERE company_id="+literal(f.companyId)+' AND user_id='+literal(f.actor.id));expect((await f.record()).error?.message).toContain('actor_forbidden');expect((await f.read()).error?.message).toContain('actor_forbidden');expect(f.snapshot()).toEqual(before)
},30000)
it('foreign actor scope cannot attach an original or create a reception',async()=>{
 const f=await fixture(),foreign=await decisionUser(f.foreignCompanyId,['communication.send'],randomUUID()+'Aa1!'),before=f.snapshot();expect((await f.record(f.first,f.companyId,foreign.id)).error?.message).toContain('actor_forbidden');expect(f.snapshot()).toEqual(before);expect(f.business()).toEqual({validation:0,outbound:0,attempts:0})
},30000)
it('a parse projection absent from retained native bytes is rejected without a reception',async()=>{
 const f=await fixture(),before=f.snapshot();sql('UPDATE public.inbound_ediel_parse_results SET raw_payload=\'FORGED-UNRETAINED\' WHERE id='+literal(f.first.parseId));expect((await f.record()).error?.message).toContain('retained_transport_bytes_required');expect(f.snapshot()).toEqual(before)
},30000)
it('actual nullable missing transport clock is refused without invented admission time or journal writes',async()=>{
 const f=await fixture(),before=f.snapshot();sql('UPDATE public.inbound_email_messages SET received_at=NULL WHERE id='+literal(f.first.mailId));expect((await f.record()).error?.message).toContain('source_scope_required');expect(f.snapshot()).toEqual(before)
},30000)
it('original mailbox selector/hash/clock/body stay immutable while actual status projection can update',async()=>{
 const f=await fixture();expect((await f.record()).error).toBeNull();const before=f.snapshot();for(const field of ['mailbox_message_id','raw_payload','message_received_at'])expect(()=>sql('UPDATE public.ediel_messages SET '+field+'='+ (field==='message_received_at'?"clock_timestamp()+interval '1 hour'":literal('CHANGED'))+' WHERE id='+literal(f.messageId))).toThrow(/immutable/);expect(f.snapshot()).toEqual(before);sql("UPDATE public.ediel_messages SET status='parsed' WHERE id="+literal(f.messageId));expect(sql('SELECT to_jsonb(status) FROM public.ediel_messages WHERE id='+literal(f.messageId))).toBe('parsed')
},30000)
it('read-only exact reception selection has no first business outcome or active duplicate response',async()=>{
 const f=await fixture();expect((await f.record()).error).toBeNull();const n=await f.add(),duplicate=await f.record(n);expect(duplicate.error).toBeNull();const before=f.snapshot(),read=await f.read(n.mailId);expect(read.error).toBeNull();expect(read.data).toMatchObject({receptionId:duplicate.data.receptionId,firstValidationAssessmentId:null,firstOutcomeAvailable:false,duplicateResponseActivated:false});expect(f.snapshot()).toEqual(before);expect(f.business()).toEqual({validation:0,outbound:0,attempts:0})
},30000)
