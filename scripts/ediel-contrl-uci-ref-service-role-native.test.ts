// reality-defects: F99
// The CONTRL UCI candidate index evaluated the postgres-only wire_v1 under the
// writing role, so service_role (PostgREST) INSERTs and non-HOT UPDATEs of an
// outbound CONTRL failed with 42501 (after an accepted SMTP send the post-send
// update failed and the outbox row became delivery_uncertain). 20261023120000
// stores a derived-only contrl_uci_ref column instead. Disposable native
// Supabase and synthetic tenant/wire only; all writes go through PostgREST as
// service_role with every ediel_messages trigger active.
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordEdielTechnicalSyntaxDecision,captureEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"
function sql<T>(input:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
 const output=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000}).trim()
 return output?JSON.parse(output) as T:undefined as T
}
const contrlRoute=(company:string,endpoint:string)=>{const route=randomUUID(),profile=randomUUID();sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(company)},'Native own CONTRL','ediel_ack','bilateral_test',true,'remote@example.invalid');INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port) VALUES(${literal(profile)},${literal(company)},${literal(route)},'Native own CONTRL','test','edifact','edifact','CONTRL','CONTRL',${literal(endpoint)},'12345','23-DDQ-PRODAT',true,true,'local@example.invalid','smtp.example.invalid',587)`);return {communication_route_id:route,route_profile_id:profile,application_reference:'23-DDQ-PRODAT'}}
const unlistedProdatRulePin=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object('canonical_rule_pack_id',pack.id,'rule_profile_key',profile.profile_key,'rule_profile_version_id',profile.id,'rule_profile_version',pack.guide_version||':r'||pack.guide_revision,'rule_pack_checksum',pack.source_hash,'rule_pack_snapshot',profile.profile) FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.is_enabled AND profile.profile->>'family'='PRODAT' AND profile.direction IN('inbound','both') AND pack.status IN('active','future') ORDER BY profile.profile_key LIMIT 1`)

// The read with its candidate branches and the same body with the original
// unrestricted scan (pre-20261020120200), compared over identical rows.
const ORIGINALS=(source:string)=>`DO $c$DECLARE d text:=pg_get_functiondef('gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure);
 head CONSTANT text:=' FOR ack IN SELECT m.* FROM (';tail CONSTANT text:=') candidate JOIN public.ediel_messages m ON m.id=candidate.id WHERE';
BEGIN IF strpos(d,head)=0 OR strpos(d,tail)=0 THEN RAISE EXCEPTION 'candidate_shape_changed';END IF;
 d:=replace(left(d,strpos(d,head)-1)||' FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE'||substr(d,strpos(d,tail)+length(tail)),'gridex_ack_authority.read_outbound_originals_v1(','pg_temp.read_outbound_originals_unbounded(');
 EXECUTE d;END$c$;
SELECT jsonb_build_object('bounded',(SELECT coalesce(jsonb_agg(o#>>'{message,id}' ORDER BY o#>>'{message,id}'),'[]') FROM jsonb_array_elements(gridex_ack_authority.read_outbound_originals_v1(${literal(source)},'CONTRL')->'originals') o),
 'unbounded',(SELECT coalesce(jsonb_agg(o#>>'{message,id}' ORDER BY o#>>'{message,id}'),'[]') FROM jsonb_array_elements(pg_temp.read_outbound_originals_unbounded(${literal(source)},'CONTRL')->'originals') o));`

it('service_role inserts and non-HOT updates an outbound CONTRL, contrl_uci_ref stays derived and ACK originals are unchanged',async()=>{
 const company=randomUUID(),actor=randomUUID(),sourceId=randomUUID(),ackId=randomUUID(),identifierId=randomUUID()
 const endpoint=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999)n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text AND (i.valid_to IS NULL OR now()<i.valid_to))`)
 const sourceReference='S'+sourceId.replaceAll('-','').slice(0,13),ackReference='A'+ackId.replaceAll('-','').slice(0,13),sourceUnh='S'+sourceId.slice(0,8),ackUnh='A'+ackId.slice(0,8)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Disposable F99 CONTRL UCI native','active');
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Disposable F99 operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(company)},id,key FROM public.permissions WHERE key='communication.write';
  INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(identifierId)},${literal(company)},'test',${literal(actor)},'EdielId',${literal(endpoint)},now()-interval '1 day');`)

 // wire_v1 and the derivation stay private: no API role may execute either.
 expect(sql(`SELECT jsonb_object_agg(r,jsonb_build_array(has_function_privilege(r,'gridex_ack_authority.wire_v1(text)','EXECUTE'),has_function_privilege(r,'gridex_ack_authority.derive_contrl_uci_ref_v1()','EXECUTE'))) FROM unnest(ARRAY['anon','authenticated','service_role']) r`))
  .toEqual({anon:[false,false],authenticated:[false,false],service_role:[false,false]})
 expect(sql(`SELECT jsonb_build_object('expression',to_regclass('public.ediel_messages_contrl_uci_ref_idx') IS NOT NULL,'column',to_regclass('public.ediel_messages_contrl_uci_ref_col_idx') IS NOT NULL)`)).toEqual({expression:false,column:true})

 const raw=`UNB+UNOC:3+12345:14+${endpoint}:14+260930:1200+${sourceReference}++23-DDQ-PRODAT++++1'UNH+${sourceUnh}+PRODAT:D:97A:UN:E2SE6A'BGM+Z99+SOURCE+9+AB'DTM+137:202609301200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+${endpoint}:160:SVK+++++++SE'LIN+1'UNT+8+${sourceUnh}'UNZ+1+${sourceReference}'`
 const stored=await supabaseService.from('ediel_messages').insert({id:sourceId,company_id:company,...unlistedProdatRulePin(),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z99',status:'received',raw_payload:raw,message_received_at:new Date().toISOString()}).select('*').single()
 expect(stored.error).toBeNull();const source=stored.data as EdielMessageRow
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 await recordEdielTechnicalSyntaxDecision({companyId:company,sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw).digest('hex'),syntaxDecision:decision.syntaxDecision as 'accepted'|'rejected',reasonCodes:decision.issues.map(issue=>issue.code),execution:{actorUserId:actor,phase:'prepare'}})
 const evidence=await captureEdielTechnicalSyntaxAckEvidence(company,sourceId,{actorUserId:actor,phase:'prepare'})
 const outcome=evidence.syntaxDecision==='accepted'?'positive':'negative'
 const ownRaw=`UNB+UNOC:3+${endpoint}:14+12345:14+260930:1201+${ackReference}++23-DDQ-PRODAT++++1'UNH+${ackUnh}+CONTRL:2:2:UN:EDIEL2'UCI+${sourceReference}+12345:14+${endpoint}:14+${outcome==='positive'?'1':'4'}'UNT+3+${ackUnh}'UNZ+1+${ackReference}'`

 // INSERT maintains the partial index for every outbound CONTRL: before the
 // fix this was a deterministic 42501. A caller-supplied value is overwritten.
 const persisted=await supabaseService.from('ediel_messages').insert({id:ackId,company_id:company,...contrlRoute(company,endpoint),environment:'test',direction:'outbound',message_standard:'edifact',message_family:'CONTRL',message_code:'CONTRL',status:'draft',related_message_id:sourceId,raw_payload:ownRaw,ack_outcome:outcome,source_operation_id:`ediel_ack:${sourceId}:CONTRL:message`,contrl_uci_ref:'FORGEDUCI0001'}).select('id,contrl_uci_ref').single()
 expect(persisted.error).toBeNull()
 const derived=()=>sql<{stored:string|null;wire:string|null}>(`SELECT jsonb_build_object('stored',contrl_uci_ref,'wire',gridex_ack_authority.wire_v1(raw_payload)->>'uciRef') FROM public.ediel_messages WHERE id=${literal(ackId)}`)
 expect(persisted.data).toEqual({id:ackId,contrl_uci_ref:sourceReference})
 expect(derived()).toEqual({stored:sourceReference,wire:sourceReference})

 // The outbox post-send projection (lib/ediel/transport) plus a status change:
 // status is indexed, so this UPDATE cannot be HOT and maintains every index.
 const postSend=await supabaseService.from('ediel_messages').update({status:'sent',transport_security_mode:'unencrypted',route_transport_security_mode:null,was_smime_encrypted:false,expected_receiver_certificate_id:null,cms_expected_receiver_present:null,updated_by:actor,updated_at:new Date().toISOString()})
  .eq('id',ackId).eq('company_id',company).eq('environment','test').select('id,status,was_smime_encrypted,contrl_uci_ref').single()
 expect(postSend.error).toBeNull()
 expect(postSend.data).toEqual({id:ackId,status:'sent',was_smime_encrypted:false,contrl_uci_ref:sourceReference})
 // The same non-HOT shape as plain SQL under the service_role (F99 reproduction).
 expect(sql(`BEGIN;SET LOCAL ROLE service_role;
  WITH u AS (UPDATE public.ediel_messages SET was_smime_encrypted=NOT coalesce(was_smime_encrypted,false),status=CASE status WHEN 'sent' THEN 'queued' ELSE 'sent' END,updated_at=now() WHERE id=${literal(ackId)} RETURNING contrl_uci_ref)
  SELECT to_jsonb(contrl_uci_ref) FROM u;ROLLBACK;`)).toBe(sourceReference)

 // A writer can never store its own value, alone or together with other columns.
 for(const patch of [{contrl_uci_ref:'FORGEDUCI0002'},{contrl_uci_ref:null},{contrl_uci_ref:'FORGEDUCI0003',updated_at:new Date().toISOString()}]){
  const forged=await supabaseService.from('ediel_messages').update(patch).eq('id',ackId).select('contrl_uci_ref').single()
  expect(forged.error).toBeNull();expect(forged.data).toEqual({contrl_uci_ref:sourceReference})
 }
 expect(derived()).toEqual({stored:sourceReference,wire:sourceReference})
 // The inbound source is no outbound CONTRL and carries no derived value.
 expect(sql(`SELECT jsonb_build_object('ref',contrl_uci_ref) FROM public.ediel_messages WHERE id=${literal(sourceId)}`)).toEqual({ref:null})

 // Identical originals to the unrestricted original predicate: as stored, and
 // (rolled back) with the relation removed so only the UCI branch finds it.
 const stored1=sql<{bounded:string[];unbounded:string[]}>(ORIGINALS(sourceId))
 expect(stored1).toEqual({bounded:[ackId],unbounded:[ackId]})
 const uciOnly=sql<{bounded:string[];unbounded:string[]}>(`BEGIN;SET LOCAL session_replication_role=replica;
  UPDATE public.ediel_messages SET related_message_id=NULL WHERE id=${literal(ackId)};SET LOCAL session_replication_role=origin;
  ${ORIGINALS(sourceId)}ROLLBACK;`)
 expect(uciOnly).toEqual({bounded:[ackId],unbounded:[ackId]})
 // Control: that UCI-only candidate is drawn from the stored column alone.
 const underived=sql<{bounded:string[];unbounded:string[]}>(`BEGIN;SET LOCAL session_replication_role=replica;
  UPDATE public.ediel_messages SET related_message_id=NULL,contrl_uci_ref=NULL WHERE id=${literal(ackId)};SET LOCAL session_replication_role=origin;
  ${ORIGINALS(sourceId)}ROLLBACK;`)
 expect(underived).toEqual({bounded:[],unbounded:[ackId]})
 expect(sql(`SELECT to_jsonb(related_message_id) FROM public.ediel_messages WHERE id=${literal(ackId)}`)).toBe(sourceId)
},120000)
