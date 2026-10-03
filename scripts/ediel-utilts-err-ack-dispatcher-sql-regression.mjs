// masterplan: U-14 regression — the received UTILTS_ERR dispatcher must survive the later UTILTS storage-authority rewrite.
// Focused prospective ERR response proof and first-final scope mechanics.
// The preceding accepted-correlation apply, original legal/pack receipts and
// full national guide binder are explicit boundary fixtures. Actual shared wire
// decoder/source correlation and this entire forward execute unchanged. This
// is synthetic mechanism proof, not full/native replay or legal activation.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;let checks=0
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
function fn(sql,name){const at=sql.indexOf(`FUNCTION ${name}(`);assert.ok(at>=0,name);const start=sql.lastIndexOf('CREATE',at),body=sql.indexOf('$$',at),end=sql.indexOf('$$;',body+2);return sql.slice(start,end+3)}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_ack_authority;create schema gridex_utilts_binding;create schema gridex_received_sources;create schema gridex_ediel_source_rules;create schema gridex_ediel_inbound_context;create schema gridex_ediel_ack_guide;create schema gridex_ediel_outbound_owner;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,message_standard text,raw_payload text,message_sent_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,message_received_at timestamptz,related_message_id uuid);
 create table gridex_received_sources.sources(source_message_id uuid primary key,company_id uuid,environment text,raw_payload text,payload_hash text,received_context jsonb);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,owner text,facts_text text,facts_hash text);
 create table gridex_ack_authority.source_correlations(ack_message_id uuid primary key,source_message_id uuid,company_id uuid,environment text,ack_payload_hash text,source_payload_hash text,canonical_assessment_id uuid,ack_family text,ack_outcome text,correlated_at timestamptz default clock_timestamp());
 create table gridex_ediel_source_rules.receipts(source_message_id uuid primary key,company_id uuid,environment text,direction text,payload_sha256 text,canonical_assessment_id uuid,original_source_message_id uuid,evidence jsonb);
 create table gridex_ediel_inbound_context.receipts(source_message_id uuid primary key,context jsonb);
 create table gridex_ediel_ack_guide.editions(source_version text primary key,input_manifest jsonb,projection jsonb);
 create table gridex_ediel_ack_guide.edition_extensions(original_source_version text primary key,extended_source_version text);
 create table gridex_ediel_ack_guide.source_bindings(source_message_id uuid primary key,basis jsonb);
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create function gridex_ediel_source_rules.require_v1(c uuid,m uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select evidence into e from gridex_ediel_source_rules.receipts r join public.ediel_messages s on s.id=r.source_message_id where r.source_message_id=m and r.company_id=c and r.payload_sha256=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex');if e is null then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return e;end$$;
 create function gridex_ediel_inbound_context.require_v1(c uuid,m uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select context into e from gridex_ediel_inbound_context.receipts where source_message_id=m;if e is null then raise exception 'held_original_context';end if;return e;end$$;
 create function gridex_ediel_inbound_context.derive(public.ediel_messages,timestamptz) returns jsonb language sql as $$select jsonb_build_object('originalBoundary',true)$$;
 create function gridex_ediel_ack_guide.bind_source_v1(m public.ediel_messages,k text,b jsonb) returns void language sql as $$insert into gridex_ediel_ack_guide.source_bindings values(m.id,b)$$;
 create function gridex_ack_authority.apply_v1(c uuid,e text,a uuid,s uuid,u uuid) returns jsonb language plpgsql as $$begin
 if not exists(select from gridex_ack_authority.source_correlations where ack_message_id=a) then
 insert into gridex_ack_authority.source_correlations select a,s,c,e,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),o.immutable_payload_hash,v.id,'UTILTS_ERR','negative',clock_timestamp() from public.ediel_messages m,public.ediel_messages o,gridex_received_sources.validation_assessments v where m.id=a and o.id=s and v.source_message_id=a;end if;return jsonb_build_object('sameApplicationBoundary',true);end$$;
 create function public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid default null,text default null) returns jsonb language sql as $$select jsonb_build_object('ordinaryStorageBoundary',true)$$;
 create function gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean) returns void language plpgsql as $$begin return;end$$;
 create table public.user_profiles(id uuid primary key,user_status text);
 create table public.company_memberships(id uuid primary key,company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create function public.gridex_actor_has_company_permission(u uuid,c uuid,p text) returns boolean language sql as $$select u='${id(7)}'::uuid and c='${id(1)}'::uuid and p='communication.write'$$;
 insert into user_profiles values('${id(7)}','active');insert into company_memberships values('${id(8)}','${id(1)}','${id(7)}','active',true,now());`)
 await db.exec(fn(read('20260923135706_ediel_utilts_consumption_binding_v1.sql'),'gridex_utilts_binding.wire_tokens_v1'))
 await db.exec(fn(read('20260930202616_ediel_native_aperak_own_erc_scope.sql'),'gridex_ack_authority.wire_v1'))
 await db.exec(fn(read('20260930203615_ediel_ack_first14_and_committed_replay.sql'),'gridex_ack_authority.source_match_v1'))
 // Same actual previously published source_match extension: APERAK on ERR is
 // permitted, while ERR cannot recursively reject ERR.
 const sql=read('20260930223930_ediel_outbound_ack_original_read_authority.sql');await db.exec(sql.slice(sql.indexOf('DO $$'),sql.indexOf('CREATE FUNCTION',sql.indexOf('DO $$'))));
 await db.exec(read('20261001003657_ediel_received_err_application_response_authority.sql'));checks++
 // U-14: 20261001003807 replaced the public authority with a UTILTS-only storage body.
 await db.exec('SET check_function_bodies=off;'+fn(read('20261001003807_ediel_utilts_esco_pre_storage_scope.sql'),'public.gridex_require_utilts_positive_ack_authority_v1')+';SET check_function_bodies=on;');checks++
 if(process.env.U14_APPLY_FIX!=='0'){const fix=read('20261003150000_ediel_utilts_late_version_and_err_ack_dispatcher.sql');await db.exec(fix.slice(fix.indexOf('DO $u14$'),fix.lastIndexOf('COMMIT;')));checks++}
 const envelope=(family,business,reverse=false,ref='I')=>`UNB+UNOC:3+${reverse?'LOCAL:14+REMOTE:14':'REMOTE:14+LOCAL:14'}+260930:1200+${ref}++23-DDQ-E66-T++++1'UNH+M+${family}'${business.join("'")}'UNT+${business.length+2}+M'UNZ+1+${ref}'`
 const original=envelope('UTILTS:D:02B:UN:E5SE5A',['BGM+E66::260+ORIGINAL-D+9+AB','NAD+MS+52101:SVK:260','NAD+MR+52100:SVK:260','IDE+24+ORIGINAL-T'],true,'ORIG-I')
 const err=envelope('UTILTS:D:02B:UN:E5SE5A',['BGM+ERR::260+ERR-D+9+AB','NAD+MS+52100:SVK:260','NAD+MR+52101:SVK:260','IDE+24+OWN?:A?+B??C','STS+E01::260+41+E51::260','RFF+TN:ORIGINAL-T','RFF+E66:ORIGINAL-D'],false,'ERR-I')
 const ack=(tx='OWN?:A?+B??C',code='312',own='ACK-I')=>envelope('APERAK:D:04A:UN:E5SE5A',[`BGM+${code}+ACK-D+9`,'DTM+137:202610010000:203','DTM+735:?+0100:406','NAD+MS+52101:SVK:260','NAD+MR+52100:SVK:260','DOC+ERR::260+ERR-D',`ERC+${code==='312'?'100':'42'}::260`,`FTX+AAO+++${code==='312'?'OK':'INCORRECT DATA BAD'}`,'RFF+DM:OWN-DM',`RFF+ACW:${tx}`],true,own)
 const basis={rulePackId:id(30),messageProfileId:id(31),profileKey:'modeled-original-registered',version:'opaque-original-version',sourceHash:'a'.repeat(64),snapshot:{profileKey:'modeled-original-registered',profileVersionId:id(31),version:'opaque-original-version',checksum:'a'.repeat(64),rulePack:{id:id(30),family:'UTILTS',guide_version:'25-A-3',guide_revision:'3'},messageProfile:{id:id(31)},guideSources:[]}}
 const witness={...basis,snapshot:{rulePack:basis.snapshot.rulePack,messageProfile:basis.snapshot.messageProfile,guideSources:[]}}
 const put=async(n,raw,family,direction='inbound',related=null)=>db.query("insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,message_standard,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash,message_received_at,related_message_id)values($1,$2,'test',$3,$4,$5,'edifact',$6,case when $3='outbound' then now() end,case when $3='outbound' then now() end,encode(sha256(convert_to($6,'UTF8')),'hex'),now(),$7)",[id(n),id(1),direction,family,family==='UTILTS_ERR'?'ERR':family==='APERAK'?'312':'E66',raw,related&&id(related)])
 await put(10,original,'UTILTS','outbound');await db.query('insert into gridex_ediel_source_rules.receipts values($1,$2,$3,$4,encode(sha256(convert_to($5,\'UTF8\')),\'hex\'),null,null,$6)',[id(10),id(1),'test','outbound',original,basis]);await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[id(10),{transportEdielId:'LOCAL',legalEdielId:'52101',applicationReference:'23-DDQ-E66-T',actorRole:'supplier'}])
 const prepareSource=async(n,raw=err,facts={owner:'canonical-runtime-with-registry-v1',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',rulePackEvidence:witness})=>{await put(n,raw,'UTILTS_ERR');await db.query('insert into gridex_received_sources.sources values($1,$2,\'test\',$3,encode(sha256(convert_to($3,\'UTF8\')),\'hex\'),\'{"origin":"modeled-actual-insert"}\')',[id(n),id(1),raw]);await db.query('insert into gridex_received_sources.validation_assessments values($1,$2,$3,\'test\',encode(sha256(convert_to($4,\'UTF8\')),\'hex\'),\'canonical-runtime-with-registry-v1\',$5,encode(sha256(convert_to($5,\'UTF8\')),\'hex\'))',[id(n+100),id(n),id(1),raw,JSON.stringify(facts)])}
 const apply=n=>db.query('select gridex_ack_authority.apply_v1($1,\'test\',$2,$3,$4) r',[id(1),id(n),id(10),id(7)])
 const require=n=>db.query('select gridex_received_err_response.require_v1($1,\'test\',$2) r',[id(1),id(n)])
 await prepareSource(20);await apply(20);const proof=(await require(20)).rows[0].r;assert.deepEqual(proof.transactions,[{transactionIndex:0,transactionId:'OWN:A+B?C'}]);assert.equal(proof.authorizesBusinessEffect,false);assert.deepEqual(proof.sourceRulePackEvidence,basis);checks+=3
 assert.deepEqual((await db.query('select gridex_ediel_inbound_context.require_v1($1,$2) r',[id(1),id(20)])).rows[0].r,proof.localContext);checks++
 const q=(await db.query("select public.gridex_require_utilts_positive_ack_authority_v1($1,'test',$2,$3) r",[id(1),id(20),'OWN:A+B?C'])).rows[0].r;assert.equal(q.authorityVersion,1);assert.equal(q.ackMessageId,null);checks++
 await assert.rejects(db.query("select public.gridex_require_utilts_positive_ack_authority_v1($1,'test',$2,'ORIGINAL-T')",[id(1),id(20)]),/utilts_err_application_response_authority_unavailable/);checks++
 for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query("select has_function_privilege($1,'gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)','EXECUTE') a",[role])).rows[0].a,false);checks++}
 assert.equal((await db.query("select has_function_privilege('service_role','public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text)','EXECUTE') a")).rows[0].a,true);checks++
 console.log(`PASS ${checks} U-14 received-ERR positive-ACK dispatcher checks (focused PGlite mechanics, not native replay)`)
}finally{await db.close()}
