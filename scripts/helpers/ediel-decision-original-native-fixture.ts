import {execFileSync} from 'node:child_process'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {closureFixture} from '../../__tests__/helpers/closureWireFixtures'

export const literal=(v:unknown)=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
export function decisionNativeSql<T>(input:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('decision_original_owned_local_only')
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:15000,maxBuffer:2_000_000}).trim();return out?JSON.parse(out) as T:undefined as T
}
export const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
export const syntheticDecisionIssuerKey=Buffer.from('SYNTHETIC ONLY decision original HMAC 01234567890123456789')
export const syntheticDecisionIssuerReference='SYNTHETIC ORIGINAL COMPETENCE ONLY'
export async function decisionUser(company:string,permissions:string[],password:string){
 const email=randomUUID()+'@example.invalid',created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const id=created.data.user!.id
 decisionNativeSql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(id)},'member','active',now(),'{}','member',true,now(),'member');UPDATE public.user_profiles SET user_status='active',disabled_at=NULL WHERE id=${literal(id)};INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) SELECT ${literal(id)},${literal(company)},id,key,true,'active','allow' FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}])`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});expect((await client.auth.signInWithPassword({email,password})).error).toBeNull();expect((await client.auth.getUser()).data.user?.id).toBe(id)
 expect(decisionNativeSql(`SELECT to_jsonb(EXISTS(SELECT FROM public.admin_users WHERE user_id=${literal(id)} AND is_active))`)).toBe(false);return{id,email,client}
}
export function signSyntheticDecisionOriginalPolicy(companyId:string,issuerId:string,basis:{retentionClass:string;targetId:string;sourceHash:string;targetMetadataHash:string},document:Buffer,extra:Record<string,unknown>={}){
 const payload=Buffer.from(JSON.stringify({format:'ediel_retention_decision_original_policy_v1',operation:'erase_retention_decision_original_bytes',companyId,...basis,documentHash:hash(document),issuerLegalReference:syntheticDecisionIssuerReference,legalBasisReference:'SYNTHETIC exact original class/hash/purpose/deadline',journalPurposeReference:'SYNTHETIC limited hash witness',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+172800000).toISOString(),...extra}));return{issuerId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',syntheticDecisionIssuerKey).update(payload).digest('hex')}
}
/** Capture truthful unqualified raw received source, then actual authenticated
 * archive intake of an unapproved old blob decision. No source validation,
 * business acceptance, readiness, supply or private approved row is seeded.
 * Auth users/memberships are actual local GoTrue/JWT fixture actors. Only legal
 * issuer competence is synthetic; it never proves a real retention deadline. */
export async function createDecisionOriginalNativeFixture(password:string){
 const companyId=randomUUID(),foreignCompanyId=randomUUID(),sourceMessageId=randomUUID(),issuerId=randomUUID(),raw=closureFixture({reason:'Z24'}).wire.replace(/UNB[^']*'/,segment=>{const parts=segment.slice(0,-1).split('+');while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1';return parts.join('+')+"'"})
 decisionNativeSql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic own decision-original tenant','active'),(${literal(foreignCompanyId)},'Synthetic foreign decision-original tenant','archived');INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,sender_ediel_id,receiver_ediel_id,interchange_reference) VALUES(${literal(sourceMessageId)},${literal(companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(raw)},clock_timestamp(),'12345','54321','I');UPDATE public.companies SET status='archived' WHERE id=${literal(companyId)}`)
 expect(decisionNativeSql(`SELECT jsonb_build_object('source',count(*),'hash',min(payload_hash)) FROM gridex_received_sources.sources WHERE company_id=${literal(companyId)} AND source_message_id=${literal(sourceMessageId)}`)).toEqual({source:1,hash:hash(Buffer.from(raw))})
 const classes=['ediel.retention.blob_decision_evidence','ediel.retention.decision_policy_evidence'],actor=await decisionUser(companyId,['ediel.retention.submit','ediel.retention.purge','ediel.retention.original_bytes',...classes],password),reviewer=await decisionUser(companyId,['ediel.retention.review',...classes],password),readonly=await decisionUser(companyId,['ediel.retention.read',...classes],password),foreign=await decisionUser(foreignCompanyId,['ediel.retention.read',...classes],password)
 const sourceDocument=Buffer.from('SYNTHETIC unapproved received-original retention decision'),archived=await actor.client.rpc('ediel_submit_blob_retention_v1',{p_company_id:companyId,p_actor_user_id:actor.id,p_retention_class:'received_ediel_message_content',p_target_id:sourceMessageId,p_document_base64:sourceDocument.toString('base64'),p_issuer_receipt:null});expect(archived.error).toBeNull();expect(archived.data.issuerQualified).toBe(false);const targetId=archived.data.decisionId as string
 const legal=Buffer.from('SYNTHETIC decision-original legal competence boundary, not real issuer')
 decisionNativeSql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuerId)},${literal(companyId)},${literal(syntheticDecisionIssuerReference)},decode('${legal.toString('hex')}','hex'),${literal(hash(legal))},decode('${syntheticDecisionIssuerKey.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const read=await reviewer.client.rpc('ediel_read_retention_decision_original_v1',{p_company_id:companyId,p_actor_user_id:reviewer.id,p_retention_class:'blob_retention_decision_original_bytes',p_target_id:targetId,p_include_document:false});expect(read.error).toBeNull();expect(read.data).toMatchObject({companyId,targetId,documentHash:hash(sourceDocument),bytesAvailable:true,documentBase64:null,authority:'none'})
 expect(decisionNativeSql(`SELECT jsonb_build_object('assessments',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(sourceMessageId)}),'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(companyId)}),'reviews',(SELECT count(*) FROM gridex_ediel_retention.blob_reviews WHERE decision_id=${literal(targetId)}))`)).toEqual({assessments:0,attempts:0,reviews:0})
 return{companyId,foreignCompanyId,sourceMessageId,issuerId,targetId,sourceDocument,sourceHash:hash(sourceDocument),basis:{retentionClass:'blob_retention_decision_original_bytes',targetId,sourceHash:read.data.documentHash,targetMetadataHash:read.data.targetMetadataHash},actor,reviewer,readonly,foreign}
}
