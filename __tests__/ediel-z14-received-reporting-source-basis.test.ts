// masterplan: AT-Z14V-ESCO
// Execute the owned READ reader and captured SQL parsers on PostgreSQL.
// Tables are finite source fixtures, not native admitted authority. Actor
// permission/current reviewer/qualified legal-role READ/graph lock, signed-receipt
// verification and accepted transport observations
// are explicitly declared finite IO ports. No send/provider/write authority is
// supplied. Genuine native birth/archive/transport guards remain separate.
import {createHash} from 'node:crypto'
import {existsSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest'

const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
const migration=resolve('supabase/migrations/20261007010849_ediel_received_z14_reporting_source_basis.sql')
const rpc='public.gridex_ediel_received_z14_reporting_source_basis_v1'
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),customer=id(3),source=id(10),original=id(11),intent=id(12),assignment=id(13),permission=id(14)
const point='735123456789012345',second='735123456789012352',li='RECEIVED:SOURCE',sha=(v:string)=>createHash('sha256').update(v).digest('hex')
const archiveAt='2026-10-01T08:00:00Z',reviewAt='2026-10-01T09:00:00Z',originAt='2026-10-01T10:00:00Z',sealAt='2026-10-01T11:00:00Z',acceptedAt='2026-10-01T12:00:00Z',receivedAt='2026-10-01T13:00:00Z'
type Scope={lineIndex:number;objectId:string;identityAgency:string;lineItemReference:string;customer:{id:string;qualifier:string;agency:string};reason:string}
type Basis={status:'qualified'|'held';companyId:string;sourceMessageId:string;environment:string;sourcePayloadHash:string;sourceReceivedAt:string;sourceContextHash:string;sourceReceivedContext:Record<string,unknown>;actorUserId:string;evaluationUtcMs:number;objects:{scope:Scope;classification:string;term:{kind:string;endMinute?:string};purpose:{kind:string;code?:string};original:Record<string,unknown>}[];heldObjects:unknown[];missing?:string[]}
let db:PGlite
function capturedFunction(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('captured_function_unavailable:'+name)
 const text=schema.slice(start),delimiter=text.match(/AS (\$[^$]*\$)/)?.[1]
 if(!delimiter)throw Error('captured_function_body_unavailable:'+name)
 const end=text.indexOf(delimiter+';',text.indexOf(delimiter)+delimiter.length)
 if(end<0)throw Error('captured_function_end_unavailable:'+name)
 return text.slice(0,end+delimiter.length+1)
}
function capturedTable(name:string){
 const start=schema.indexOf('CREATE TABLE '+name+' ('),end=schema.indexOf('\n);',start)
 if(start<0||end<start)throw Error('captured_table_unavailable:'+name)
 // Exact captured columns/defaults, with catalog constraints/native triggers
 // outside this finite reader boundary. No canonical capture is modified.
 return schema.slice(start,end).split('\n    CONSTRAINT ')[0].replace(/,\s*$/,'')+'\n);'
}
type ObjectWire={point?:string|null;customer?:string;qualifier?:string;agency?:string;li?:string;reason?:string;status?:string;purpose?:string|null;end?:string|null}
function raw(code:'Z13'|'Z14',objects:ObjectWire[],test=false){
 const outgoing=code==='Z13',sender=outgoing?'12345':'54321',receiver=outgoing?'54321':'12345'
 const parts=[`UNB+UNOC:3+${sender}:ZZ:${outgoing?'sender':'receiver'}+${receiver}:ZZ:${outgoing?'receiver':'sender'}+261001:1100+SOURCE++23-DGI-PRODAT++++${test?'1':''}`,'UNH+M+PRODAT:D:97A:UN:E2SE6A',`BGM+${code}+D+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((o,i)=>[
  `LIN+${i+1}++${o.point===null?'':o.point??point}:::9`,'DTM+90:202610010000:203',...(o.end===null?[]:[`DTM+91:${o.end??'202701010000'}:203`]),'CCI++Z13',`CAV+${o.reason??'S17'}`,...(o.status?['CCI++Z23',`CAV+${o.status}`]:[]),...(o.purpose===null?[]:['CCI++Z24',`CAV+${o.purpose??'B72'}`]),`RFF+LI:${(o.li??li).replaceAll('?','??').replaceAll(':','?:').replaceAll('+','?+').replaceAll("'","?'")}`,'RFF+Z09:PERMISSION',...(outgoing?[]:['RFF+Z05:TES']),`NAD+UD+${o.customer??'CUSTOMER'}:${o.qualifier??'SE1'}:${o.agency??'260'}`]),'UNT','UNZ+1+SOURCE']
 parts[parts.length-2]=`UNT+${parts.length-2}+M`
 return parts.join("'")+"'"
}

beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE authenticated;CREATE ROLE anon;
 CREATE SCHEMA auth;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_service_permission;CREATE SCHEMA gridex_service_administration;CREATE SCHEMA gridex_ediel_services;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_ediel_technical_ack;CREATE SCHEMA gridex_utilts_binding;
 CREATE TABLE public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,status text,intent_id uuid,customer_id uuid,related_message_id uuid,original_message_id uuid,transaction_reference text,message_sent_at timestamptz,message_received_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,receiver_sub_address text,application_reference text,execution_context_snapshot jsonb);
 CREATE TABLE public.companies(id uuid,status text);
 CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_profiles(id uuid,user_status text);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.probe_read_permissions(company_id uuid,actor_id uuid,permission text,allowed boolean);
 CREATE TABLE public.probe_legal_context(source_message_id uuid,context jsonb);
 CREATE TABLE public.probe_reviewer(company_id uuid,actor_id uuid,current boolean);
 CREATE TABLE public.probe_receipts(artifact_id uuid,current boolean);
 CREATE TABLE public.probe_accepted(message_id uuid,payload_hash text,attempt_id uuid,observed_at timestamptz);
 CREATE FUNCTION public.gridex_actor_has_company_permission(p_actor_user_id uuid,p_company_id uuid,p_permission text) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
 IF p_permission NOT IN('ediel.read','communication.read') THEN RAISE EXCEPTION 'finite_send_permission_must_not_be_consulted';END IF;
 RETURN EXISTS(SELECT FROM public.probe_read_permissions WHERE actor_id=p_actor_user_id AND company_id=p_company_id AND permission=p_permission AND allowed);END$$;`)
 for(const table of ['gridex_service_permission.origins','gridex_service_administration.scope_versions','gridex_ediel_services.artifacts','gridex_ediel_services.reviews','public.ediel_service_evidence','public.ediel_service_assignments'])await db.exec(capturedTable(table))
 await db.exec(`CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,origin text,message_code text,source_received_at timestamptz,captured_at timestamptz,raw_payload text,payload_hash text,received_context jsonb);
 CREATE TABLE gridex_service_administration.commands(command_id uuid,company_id uuid,actor_user_id uuid,input jsonb,result jsonb,created_at timestamptz);
 CREATE FUNCTION gridex_ediel_ack_replay.require_current_source_role_v2(c uuid,env text,source_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE ctx jsonb;BEGIN SELECT context INTO ctx FROM public.probe_legal_context WHERE source_message_id=source_id;IF ctx IS NULL OR ctx->>'companyId' IS DISTINCT FROM c::text OR ctx->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_current_captured_role_unavailable' USING ERRCODE='42501';END IF;RETURN ctx;END$$;
 CREATE FUNCTION gridex_ediel_services.lock_evidence_graph_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION gridex_ediel_services.actor_current_v1(c uuid,actor uuid,review boolean) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN IF review IS NOT TRUE THEN RAISE EXCEPTION 'finite_review_port_not_send_authority';END IF;RETURN EXISTS(SELECT FROM public.probe_reviewer WHERE company_id=c AND actor_id=actor AND current);END$$;
 CREATE FUNCTION gridex_ediel_services.receipt_current_v1(a gridex_ediel_services.artifacts) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.probe_receipts WHERE artifact_id=a.id AND current)$$;
 CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE n int;r public.probe_accepted%rowtype;BEGIN
 SELECT count(*) INTO n FROM public.probe_accepted WHERE message_id=m.id;IF n=0 THEN RETURN NULL;END IF;IF n<>1 THEN RAISE EXCEPTION 'ediel_accepted_projection_ambiguous';END IF;
 SELECT * INTO STRICT r FROM public.probe_accepted WHERE message_id=m.id;
 IF r.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_accepted_projection_original_changed';END IF;
 RETURN jsonb_build_object('status','accepted_projection','companyId',m.company_id,'environment',m.environment,'messageId',m.id,'attemptId',r.attempt_id,'originalHash',r.payload_hash,'observedAt',r.observed_at,'authorizesProviderEntry',false,'deliveryProven',false);END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_partition_wire_v1','gridex_received_sources.permission_wire_v1','gridex_received_sources.permission_date_v1','gridex_received_sources.permission_time_v1','gridex_utilts_binding.wire_tokens_v1','gridex_ediel_technical_ack.envelope','gridex_ediel_services.evidence_basis_v1','gridex_ediel_services.evidence_terms_v1'])await db.exec(capturedFunction(name))
 // Preflight only the finite fixture/parser plumbing, before any reader exists.
 await db.exec('BEGIN');await fixture()
 expect((await db.query<{wire:{code:string}}>('SELECT gridex_received_sources.permission_wire_v1(raw_payload) wire FROM ediel_messages WHERE id=$1',[original])).rows[0].wire.code).toBe('Z13')
 await db.exec('ROLLBACK')
 // A missing migration/function is a setup gap, never a business RED result.
 if(!existsSync(migration))throw Error('SOURCE_READER_SETUP_GAP: authorized forward remains absent; no business RED claimed')
 await db.exec(readFileSync(migration,'utf8'))
},30_000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{await db.exec('BEGIN');await fixture()})
afterEach(async()=>{await db.exec('ROLLBACK;RESET ROLE')})

async function fixture(options:{classification?:'private'|'nonprivate';indefinite?:boolean;incomingObjects?:ObjectWire[]}={}){
 const end=options.indefinite?null:'202701010000',out=raw('Z13',[{point:null,end}]),incoming=raw('Z14',options.incomingObjects??[{status:'A74',end}])
 const scope={companyId:company,beneficiaryCompanyId:id(20),providerActorId:id(21),actorProfileId:id(22),customerId:customer,dsoActorId:id(23),environment:'production',mode:'V',purpose:'customer_reporting',objects:[point],products:['8716867000030'],fields:['energy'],dataStart:'2026-09-30T23:00:00+00:00',dataEnd:options.indefinite?null:'2026-12-31T23:00:00+00:00',validFrom:'2026-01-01T00:00:00+00:00',validTo:null}
 await db.query(`INSERT INTO auth.users VALUES($1,NULL,NULL),($2,NULL,NULL)`,[actor,id(25)])
 await db.query(`INSERT INTO probe_reviewer VALUES($1,$2,true)`,[company,id(25)])
 await db.query(`INSERT INTO companies VALUES($1,'active')`,[company]);await db.query(`INSERT INTO user_profiles VALUES($1,'active')`,[actor])
 await db.query(`INSERT INTO company_memberships VALUES($1,$2,'active',true,'2026-01-01')`,[company,actor]);await db.query(`INSERT INTO probe_read_permissions VALUES($1,$2,'ediel.read',true)`,[company,actor])
 await db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,intent_id,customer_id,transaction_reference,message_sent_at,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'production','outbound','edifact','PRODAT','Z13',$3,'sent',$4,$5,$6,$7,$8,$9)`,[original,company,out,intent,customer,li,acceptedAt,sealAt,sha(out)])
 await db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,customer_id,message_received_at) VALUES($1,$2,'production','inbound','edifact','PRODAT','Z14',$3,'received',$4,$5)`,[source,company,incoming,customer,receivedAt])
 const received={version:1,contextOrigin:'database_insert',sourceMessageId:source,companyId:company,environment:'production',messageCode:'Z14',payloadHash:sha(incoming),sourceReceivedAt:receivedAt,capturedAt:receivedAt}
 await db.query('INSERT INTO probe_legal_context VALUES($1,$2)',[source,{basisKind:'observed_source_persistence',companyId:company,environment:'production',family:'PRODAT',code:'Z14',actorRole:'energy_service_company',legalActorId:id(21),legalEdielId:'12345'}])
 await db.query(`INSERT INTO gridex_received_sources.sources VALUES($1,$2,'production','database_insert','Z14',$3,$3,$4,$5,$6)`,[source,company,receivedAt,incoming,sha(incoming),received])
 await db.query('UPDATE ediel_messages SET execution_context_snapshot=$1 WHERE id=$2',[{receivedProdatContext:received},source])
 await db.query(`UPDATE ediel_messages SET sender_ediel_id=CASE WHEN direction='outbound' THEN '12345' ELSE '54321' END,receiver_ediel_id=CASE WHEN direction='outbound' THEN '54321' ELSE '12345' END,sender_sub_address=CASE WHEN direction='outbound' THEN 'sender' ELSE 'receiver' END,receiver_sub_address=CASE WHEN direction='outbound' THEN 'receiver' ELSE 'sender' END,application_reference='23-DGI-PRODAT'`)
 await db.query('INSERT INTO probe_accepted VALUES($1,$2,$3,$4)',[original,sha(out),id(24),acceptedAt])
 await db.query('INSERT INTO gridex_service_administration.scope_versions VALUES($1,$2,1,$3,$4)',[company,assignment,scope,originAt])
 await db.query(`INSERT INTO ediel_service_assignments(id,company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to,status,version,scope_basis_version) VALUES($1,$2,$3,$4,$5,$6,$7,'production','V','customer_reporting',ARRAY[$8],ARRAY['8716867000030'],ARRAY['energy'],$9,$10,'2026-01-01',NULL,'active',1,1)`,[assignment,company,id(20),id(21),id(22),customer,id(23),point,scope.dataStart,scope.dataEnd])
 const kinds=['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']
 for(const [index,kind] of kinds.entries()){
  const evidence=id(100+index),artifact=id(200+index),stage=id(300+index),review=id(400+index),bytes='finite '+kind,evidenceHash=sha(bytes)
  await db.query(`INSERT INTO ediel_service_evidence(id,company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,valid_to,status,approved_by,approved_at,approved_assignment_version,permission_purpose_code,permission_reporting_frequency,permission_request_grid_area,permission_reporting_term_kind,permission_customer_classification) VALUES($1,$2,$3,$4,$5,$6,'revision-1','2026-01-01',NULL,'verified',$7,$8,1,'B72','PT1H','TES',$9,$10)`,[evidence,company,assignment,kind,'fixture:'+kind,evidenceHash,id(25),reviewAt,options.indefinite?'indefinite':'bounded',options.classification??'private'])
  const e=(await db.query<{basis:unknown;terms:unknown}>('SELECT gridex_ediel_services.evidence_basis_v1(e) basis,gridex_ediel_services.evidence_terms_v1(e) terms FROM ediel_service_evidence e WHERE id=$1',[evidence])).rows[0]
  await db.query(`INSERT INTO gridex_ediel_services.artifacts(id,company_id,environment,assignment_id,scope_basis_version,scope,scope_hash,evidence_kind,evidence_terms,source_bytes,source_hash,mime_type,source_reference,source_version,submitted_by,archived_at) VALUES($1,$2,'production',$3,1,$4,$5,$6,$7,convert_to($8,'UTF8'),$9,'application/pdf',$10,'revision-1',$11,$12)`,[artifact,company,assignment,scope,(await db.query<{hash:string}>("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') hash",[scope])).rows[0].hash,kind,e.terms,bytes,evidenceHash,'fixture:'+kind,id(26),archiveAt])
  await db.query(`INSERT INTO gridex_service_administration.commands VALUES($1,$2,$3,$4,$5,$6)`,[stage,company,id(26),{action:'stage_evidence'},{evidenceId:evidence},archiveAt])
  await db.query(`INSERT INTO gridex_ediel_services.reviews(id,company_id,artifact_id,evidence_id,stage_command_id,scope_basis_version,evidence_basis,reviewer_user_id,review_sequence,decision,reason,missing,reviewed_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,1,'approved','finite external review port','[]',$8)`,[review,company,artifact,evidence,stage,e.basis,id(25),reviewAt])
  await db.query('INSERT INTO probe_receipts VALUES($1,true)',[artifact])
 }
 const basis={status:'authorized',companyId:company,assignmentId:assignment,assignmentVersion:1,scopeBasisVersion:1,permissionId:permission,code:'Z13',environment:'production',providerActorId:id(21),dsoActorId:id(23),legalSenderId:'12345',legalReceiverId:'54321',customerId:customer,customer:{org_number:'CUSTOMER'},mode:'V',purposeCode:'B72',frequency:'PT1H',reportingTerm:options.indefinite?'indefinite':'bounded',customerClassification:options.classification??'private',evidenceId:id(100),evidenceSha256:sha('finite end_user_contract'),evidenceVersion:'revision-1',objects:[{point:null,permissionId:null,product:'8716867000030',gridArea:'TES',reportStart:scope.dataStart,reportEnd:scope.dataEnd}]}
 await db.query(`INSERT INTO gridex_service_permission.origins(intent_id,company_id,assignment_id,permission_id,actor_user_id,message_code,command_key,basis,message_id,created_at) VALUES($1,$2,$3,$4,$5,'Z13','finite-origin',$6,$7,$8)`,[intent,company,assignment,permission,actor,basis,original,originAt])
}
async function replaceReceivedWire(incoming:string){
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[incoming,source])
 await db.query("UPDATE gridex_received_sources.sources SET raw_payload=$1,payload_hash=$2,received_context=jsonb_set(received_context,'{payloadHash}',to_jsonb($2::text))",[incoming,sha(incoming)])
 await db.exec("UPDATE ediel_messages m SET execution_context_snapshot=jsonb_build_object('receivedProdatContext',s.received_context) FROM gridex_received_sources.sources s WHERE m.id=s.source_message_id")
}
async function read(sourceId=source,actorId=actor){
 await db.exec('SET ROLE service_role')
 const result=(await db.query<{basis:Basis|null}>(`SELECT ${rpc}($1,$2) basis`,[sourceId,actorId])).rows[0].basis
 await db.exec('RESET ROLE');return result
}
async function rejectsReadWithoutWrites(pattern:RegExp){
 const before=await snapshot();await db.exec('SAVEPOINT rejected_read')
 await expect(read()).rejects.toThrow(pattern)
 await db.exec('ROLLBACK TO SAVEPOINT rejected_read');expect(await snapshot()).toEqual(before)
}
async function snapshot(){
 const tables=(await db.query<{schemaname:string;tablename:string}>(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema') ORDER BY schemaname,tablename`)).rows
 const result:Record<string,unknown>={}
 for(const t of tables){const name=`"${t.schemaname}"."${t.tablename}"`;result[name]=(await db.query<{rows:unknown}>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') rows FROM ${name} t`)).rows[0].rows}
 return result
}
async function unchangedRead(){const before=await snapshot(),result=await read();expect(await snapshot()).toEqual(before);return result}
async function replaceFixture(options:Parameters<typeof fixture>[0]){
 const tables=(await db.query<{schemaname:string;tablename:string}>(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema')`)).rows
 for(const t of tables)await db.exec(`TRUNCATE "${t.schemaname}"."${t.tablename}"`)
 await fixture(options)
}

it('reads private bounded facts from one genuine finite sealed/SENT origin without any SEND permission or writes',async()=>{
 const result=await unchangedRead()
 expect(result).toMatchObject({status:'qualified',companyId:company,sourceMessageId:source,environment:'production',actorUserId:actor,objects:[{scope:{lineIndex:0,objectId:point,identityAgency:'9',lineItemReference:li,customer:{id:'CUSTOMER',qualifier:'SE1',agency:'260'},reason:'S17'},classification:'private',term:{kind:'bounded',endMinute:'202701010000'},purpose:{kind:'present',code:'B72'},original:{messageId:original,payloadHash:sha(raw('Z13',[{point:null}])),originIntentId:intent,assignmentId:assignment,permissionId:permission,scopeBasisVersion:1,acceptedAttemptId:id(24),evidenceId:id(100),evidenceSha256:sha('finite end_user_contract'),evidenceVersion:'revision-1'}}],heldObjects:[]})
 expect(result?.sourcePayloadHash).toBe(sha(raw('Z14',[{status:'A74'}])))
 expect(result?.sourceContextHash).toMatch(/^[a-f0-9]{64}$/)
 expect(result?.sourceReceivedContext).toEqual({version:1,contextOrigin:'database_insert',sourceMessageId:source,companyId:company,environment:'production',messageCode:'Z14',payloadHash:sha(raw('Z14',[{status:'A74'}])),sourceReceivedAt:receivedAt,capturedAt:receivedAt})
 expect(result?.evaluationUtcMs).toBeGreaterThan(Date.parse(receivedAt))
 expect(Date.parse(result!.sourceReceivedAt)).toBe(Date.parse(receivedAt))
})
it('ordinary grant state and later assignment lifecycle cannot erase the original historical classification and bounds',async()=>{
 await db.exec(`UPDATE ediel_service_assignments SET status='ended',version=3,scope_basis_version=2,data_end='2027-02-01'`)
 expect(await unchangedRead()).toMatchObject({status:'qualified',objects:[{classification:'private',term:{kind:'bounded',endMinute:'202701010000'},original:{scopeBasisVersion:1}}]})
})
it('genuinely assessed nonprivate purpose remains independent of the response\'s supplied value',async()=>{
 await replaceFixture({classification:'nonprivate'})
 expect(await unchangedRead()).toMatchObject({status:'qualified',objects:[{classification:'nonprivate',purpose:{kind:'present',code:'B72'}}]})
})
it('explicit indefinite source terms remain indefinite without deriving a missing end from the reply',async()=>{
 await replaceFixture({indefinite:true})
 expect(await unchangedRead()).toMatchObject({status:'qualified',objects:[{term:{kind:'indefinite'}}]})
})
it.each([null,'202612010000','202702010000'])('a reply end %s cannot rewrite the independent original bounded term',async end=>{
 await replaceFixture({incomingObjects:[{status:'A74',end}]})
 expect(await unchangedRead()).toMatchObject({status:'qualified',objects:[{term:{kind:'bounded',endMinute:'202701010000'}}]})
})
it('one customer-bound NULL-installation original can classify two own physical response objects',async()=>{
 const incoming=raw('Z14',[{status:'A74'},{point:second,status:'A74'}])
 await replaceReceivedWire(incoming)
 expect((await unchangedRead())?.objects.map(o=>o.scope.objectId)).toEqual([point,second])
})
it('a wrong full UD tuple cannot borrow its good same-LI sibling\'s classification',async()=>{
 const incoming=raw('Z14',[{status:'A74'},{point:second,status:'A74',qualifier:'SE2'}])
 await replaceReceivedWire(incoming)
 const result=await unchangedRead();expect(result?.objects.map(o=>o.scope.objectId)).toEqual([point]);expect(result?.heldObjects).toHaveLength(1)
})
it.each([
 ['source hash',`UPDATE gridex_received_sources.sources SET payload_hash=repeat('a',64)`],
 ['born raw bytes',`UPDATE gridex_received_sources.sources SET raw_payload=raw_payload||' '`],
 ['born environment',`UPDATE gridex_received_sources.sources SET environment='test'`],
 ['current qualified receiver role',`UPDATE probe_legal_context SET context=jsonb_set(context,'{actorRole}','"supplier"')`],
 ['current qualified receiver identity',`UPDATE probe_legal_context SET context=jsonb_set(context,'{legalEdielId}','"99999"')`],
 ['changed public snapshot',`UPDATE ediel_messages SET execution_context_snapshot=jsonb_set(execution_context_snapshot,'{receivedProdatContext,sourceMessageId}','"99999"') WHERE id='${source}'`],
 ['original seal hash',`UPDATE ediel_messages SET immutable_payload_hash=repeat('a',64) WHERE id='${original}'`],
 ['original unsealed',`UPDATE ediel_messages SET immutable_rendered_at=NULL WHERE id='${original}'`],
 ['original unsent',`UPDATE ediel_messages SET status='queued',message_sent_at=NULL WHERE id='${original}'`],
 ['original foreign company',`UPDATE ediel_messages SET company_id='${id(9)}' WHERE id='${original}'`],
 ['original test environment',`UPDATE ediel_messages SET environment='test' WHERE id='${original}'`],
 ['no actual accepted observation',`DELETE FROM probe_accepted`],
 ['accepted after birth',`UPDATE probe_accepted SET observed_at='2026-10-01T14:00:00Z'`],
 ['missing historical scope journal',`DELETE FROM gridex_service_administration.scope_versions`],
 ['changed historical scope',`UPDATE gridex_service_administration.scope_versions SET scope=jsonb_set(scope,'{customerId}','"${id(9)}"')`],
 ['archive bytes changed',`UPDATE gridex_ediel_services.artifacts SET source_bytes=convert_to('changed','UTF8') WHERE evidence_kind='end_user_contract'`],
 ['archive company changed',`UPDATE gridex_ediel_services.artifacts SET company_id='${id(9)}' WHERE evidence_kind='end_user_contract'`],
 ['archive scope changed',`UPDATE gridex_ediel_services.artifacts SET scope=jsonb_set(scope,'{mode}','"VH"') WHERE evidence_kind='end_user_contract'`],
 ['archive born too late',`UPDATE gridex_ediel_services.artifacts SET archived_at='2026-10-01T11:30:00Z' WHERE evidence_kind='end_user_contract'`],
 ['review born too late',`UPDATE gridex_ediel_services.reviews SET reviewed_at='2026-10-01T11:30:00Z' WHERE evidence_id='${id(100)}'`],
 ['review predates archive',`UPDATE gridex_ediel_services.reviews SET reviewed_at='2026-10-01T07:30:00Z' WHERE evidence_id='${id(100)}'`],
 ['changed reviewed evidence',`UPDATE gridex_ediel_services.reviews SET evidence_basis=jsonb_set(evidence_basis,'{permission_customer_classification}','"nonprivate"') WHERE evidence_id='${id(100)}'`],
 ['current evidence approver linkage',`UPDATE ediel_service_evidence SET approved_by='${id(9)}' WHERE kind='end_user_contract'`],
 ['current evidence approved clock linkage',`UPDATE ediel_service_evidence SET approved_at='2026-10-01T09:30:00Z' WHERE kind='end_user_contract'`],
 ['current evidence approved scope linkage',`UPDATE ediel_service_evidence SET approved_assignment_version=2 WHERE kind='end_user_contract'`],
 ['current reviewer revoked',`UPDATE probe_reviewer SET current=false`],
 ['current reviewer banned',`UPDATE auth.users SET banned_until='2099-01-01' WHERE id='${id(25)}'`],
 ['current reviewer deleted',`UPDATE auth.users SET deleted_at='2026-10-01' WHERE id='${id(25)}'`],
 ['current evidence revoked',`UPDATE ediel_service_evidence SET status='revoked' WHERE kind='end_user_contract'`],
 ['current issuer receipt revoked',`UPDATE probe_receipts SET current=false WHERE artifact_id='${id(200)}'`],
 ['missing mandatory privacy review',`DELETE FROM gridex_ediel_services.reviews WHERE evidence_id='${id(104)}'`],
 ['missing mandatory DSO artifact',`DELETE FROM gridex_ediel_services.artifacts WHERE evidence_kind='dso_contract'`],
] as const)('%s cannot supply qualified received reporting facts',async(_name,sql)=>{
 await db.exec(sql)
 const result=await unchangedRead();expect(result).toMatchObject({status:'held',objects:[]})
 expect((result?.missing?.length??0)+(result?.heldObjects.length??0)).toBeGreaterThan(0)
})
it.each([
 ['full legal sender qualifier','NAD+FR+12345:160:SVK','NAD+FR+12345:ZZ:SVK'],
 ['full legal recipient agency','NAD+DO+54321:160:SVK','NAD+DO+54321:160:OTHER'],
 ['full original UD qualifier','NAD+UD+CUSTOMER:SE1:260','NAD+UD+CUSTOMER:SE2:260'],
 ['full original UD agency','NAD+UD+CUSTOMER:SE1:260','NAD+UD+CUSTOMER:SE1:OTHER'],
 ['own original LI','RFF+LI:RECEIVED?:SOURCE','RFF+LI:OTHER'],
 ['original subtype','CAV+S17','CAV+S18'],
 ['original purpose','CAV+B72','CAV+B71'],
 ['original bounded period','DTM+91:202701010000:203','DTM+91:202702010000:203'],
 ['full UNB sender subaddress','12345:ZZ:sender','12345:ZZ:OTHER'],
 ['full UNB receiver subaddress','54321:ZZ:receiver','54321:ZZ:OTHER'],
 ['UNB application','23-DGI-PRODAT','23-DDQ-PRODAT'],
] as const)('%s must correspond even when the finite transport receipt matches the changed raw hash',async(_name,from,to)=>{
 await db.query(`UPDATE ediel_messages SET raw_payload=replace(raw_payload,$1,$2) WHERE id=$3`,[from,to,original])
 await db.query(`UPDATE ediel_messages SET immutable_payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex') WHERE id=$1`,[original])
 await db.query('UPDATE probe_accepted SET payload_hash=(SELECT immutable_payload_hash FROM ediel_messages WHERE id=$1)',[original])
 expect(await unchangedRead()).toMatchObject({status:'held',objects:[]})
})
it('an explicit later rejection supersedes an older approved receipt without reclassifying the source',async()=>{
 await db.exec(`INSERT INTO gridex_ediel_services.reviews SELECT '${id(500)}',company_id,artifact_id,evidence_id,stage_command_id,scope_basis_version,evidence_basis,reviewer_user_id,2,'rejected','explicit later rejection','[]','2026-10-02' FROM gridex_ediel_services.reviews WHERE evidence_id='${id(100)}'`)
 expect(await unchangedRead()).toMatchObject({status:'held',objects:[]})
})
it('two accepted original observations are not arbitrarily collapsed to the latest',async()=>{
 await db.exec(`INSERT INTO probe_accepted SELECT message_id,payload_hash,'${id(99)}',observed_at FROM probe_accepted`)
 const before=await snapshot();await db.exec('SAVEPOINT ambiguous_read')
 await expect(read()).rejects.toThrow('ediel_accepted_projection_ambiguous')
 await db.exec('ROLLBACK TO SAVEPOINT ambiguous_read');expect(await snapshot()).toEqual(before)
})
it.each(['ediel.read','communication.read'])('actual tenant %s is sufficient without send/write authority',async permissionKey=>{
 await db.query('UPDATE probe_read_permissions SET permission=$1',[permissionKey])
 expect(await unchangedRead()).toMatchObject({status:'qualified'})
})
it.each([
 ['current READ deny',`UPDATE probe_read_permissions SET allowed=false`],
 ['inactive execution actor',`UPDATE user_profiles SET user_status='inactive'`],
 ['unaccepted tenant membership',`UPDATE company_memberships SET accepted_at=NULL`],
 ['inactive tenant membership',`UPDATE company_memberships SET is_active=false`],
 ['foreign tenant membership',`UPDATE company_memberships SET company_id='${id(9)}'`],
] as const)('%s refuses the READ without leaking or altering source facts',async(_name,sql)=>{
 await db.exec(sql);const before=await snapshot();await db.exec('SAVEPOINT forbidden_read')
 await expect(read()).rejects.toThrow(/forbidden|unqualified/)
 await db.exec('ROLLBACK TO SAVEPOINT forbidden_read');expect(await snapshot()).toEqual(before)
})
it('an authenticated database client cannot invoke the service-only source reader',async()=>{
 const before=await snapshot();await db.exec('SAVEPOINT service_only;SET ROLE authenticated')
 await expect(db.query(`SELECT ${rpc}($1,$2)`,[source,actor])).rejects.toThrow(/permission denied|service_required/)
 await db.exec('ROLLBACK TO SAVEPOINT service_only;RESET ROLE');expect(await snapshot()).toEqual(before)
})
it('an unrelated message returns no reporting authority',async()=>{
 await db.exec(`UPDATE ediel_messages SET message_code='Z06' WHERE id='${source}'`)
 expect(await unchangedRead()).toBeNull()
})

it('an acknowledged sealed original keeps its genuine unique SENT observation',async()=>{await db.exec("UPDATE ediel_messages SET status='acknowledged' WHERE direction='outbound'");expect(await unchangedRead()).toMatchObject({status:'qualified',objects:[{classification:'private'}]})})
it.each(['deleted_at','banned_until'] as const)('active profile cannot override receiver auth user %s',async field=>{await db.exec(`UPDATE auth.users SET ${field}='2099-01-01' WHERE id='${actor}'`);await rejectsReadWithoutWrites(/forbidden/)})

it('generic immutable birth retains exact microsecond clocks without inventing legal fields',async()=>{
 const instant='2026-10-01T13:00:00.123456Z'
 await db.query("UPDATE gridex_received_sources.sources SET source_received_at=$1,captured_at=$1,received_context=received_context||jsonb_build_object('sourceReceivedAt',$2::text,'capturedAt',$2::text)",[instant,instant])
 await db.query('UPDATE ediel_messages SET message_received_at=$1 WHERE id=$2',[instant,source])
 await db.exec("UPDATE ediel_messages m SET execution_context_snapshot=jsonb_build_object('receivedProdatContext',s.received_context) FROM gridex_received_sources.sources s WHERE m.id=s.source_message_id")
 const result=await unchangedRead();expect(result).toMatchObject({status:'qualified',sourceReceivedAt:'2026-10-01T13:00:00.123456+00:00',sourceReceivedContext:{sourceReceivedAt:instant,capturedAt:instant}})
 expect(Object.keys(result!.sourceReceivedContext).sort()).toEqual(['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt'].sort())
})
it('a structurally matching birth snapshot cannot conceal a one-microsecond source clock mismatch',async()=>{
 await db.exec("UPDATE gridex_received_sources.sources SET received_context=jsonb_set(received_context,'{sourceReceivedAt}',to_jsonb('2026-10-01T13:00:00.000001Z'::text));UPDATE ediel_messages m SET execution_context_snapshot=jsonb_build_object('receivedProdatContext',s.received_context) FROM gridex_received_sources.sources s WHERE m.id=s.source_message_id")
 expect(await unchangedRead()).toMatchObject({status:'held',objects:[]})
})
it('a same-scope immutable original cannot borrow a different frozen customer identity',async()=>{
 await db.exec("UPDATE gridex_service_permission.origins SET basis=jsonb_set(basis,'{customer,org_number}','\"OTHER\"')")
 expect(await unchangedRead()).toMatchObject({status:'held',objects:[]})
})
it('service clients use the narrow public entry and cannot invoke the private authority directly',async()=>{
 const before=await snapshot();await db.exec('SAVEPOINT private_entry;SET ROLE service_role')
 await expect(db.query('SELECT gridex_received_sources.received_z14_reporting_source_basis_v1($1,$2)',[source,actor])).rejects.toThrow(/permission denied/)
 await db.exec('ROLLBACK TO SAVEPOINT private_entry;RESET ROLE');expect(await snapshot()).toEqual(before)
})
it('unrelated own LI without immutable service origin remains unknown rather than inferred private',async()=>{
 await replaceReceivedWire(raw('Z14',[{status:'A74',li:'UNRELATED'}]));expect(await unchangedRead()).toBeNull()
})

it('real BEFORE birth and later AFTER archive clocks may differ by microseconds',async()=>{
 await db.exec("UPDATE gridex_received_sources.sources SET captured_at='2026-10-01T13:00:00.000002Z',received_context=jsonb_set(received_context,'{capturedAt}',to_jsonb('2026-10-01T13:00:00.000001Z'::text));UPDATE ediel_messages m SET execution_context_snapshot=jsonb_build_object('receivedProdatContext',s.received_context) FROM gridex_received_sources.sources s WHERE m.id=s.source_message_id")
 expect(await unchangedRead()).toMatchObject({status:'qualified',sourceReceivedContext:{capturedAt:'2026-10-01T13:00:00.000001Z'}})
})
it.each([
 ['AFTER archive before immutable BEFORE birth',"UPDATE gridex_received_sources.sources SET captured_at='2026-10-01T13:00:00.000001Z',received_context=jsonb_set(received_context,'{capturedAt}',to_jsonb('2026-10-01T13:00:00.000002Z'::text))"],
 ['immutable BEFORE birth before source receive',"UPDATE gridex_received_sources.sources SET received_context=jsonb_set(received_context,'{capturedAt}',to_jsonb('2026-10-01T12:59:59.999999Z'::text))"],
 ['future AFTER capture',"UPDATE gridex_received_sources.sources SET captured_at='2099-01-01'"],
]as const)('%s remains held despite exact public/private snapshot equality',async(_name,sql)=>{
 await db.exec(sql);await db.exec("UPDATE ediel_messages m SET execution_context_snapshot=jsonb_build_object('receivedProdatContext',s.received_context) FROM gridex_received_sources.sources s WHERE m.id=s.source_message_id")
 expect(await unchangedRead()).toMatchObject({status:'held',objects:[]})
})

it.each(['unavailable','wrong role']as const)('an unrelated own LI needs no %s service-specific legal READ',async availability=>{
 await db.exec('DELETE FROM gridex_service_permission.origins')
 if(availability==='unavailable')await db.exec('DELETE FROM probe_legal_context')
 else await db.exec(`UPDATE probe_legal_context SET context=jsonb_set(context,'{actorRole}','"electricity_supplier"')`)
 // The finite legal port is explicitly forbidden on this service-less source.
 // Its data cannot establish classification or a new generic READ obligation.
 await db.exec(`CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.require_current_source_role_v2(c uuid,env text,source_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'finite_nonservice_legal_read_must_not_be_consulted';END$$`)
 expect(await unchangedRead()).toBeNull()
})
