// Compose the actual recovery phase/journal regression and the actual inbound
// physical receipt projection/read/getter bodies. Canonical admission and
// receipt capture are declared finite synthetic ports; no authentic ingress,
// Supabase, issuer, concurrency or final-candidate qualification is claimed.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const migrations=new URL('../supabase/migrations/',import.meta.url)
const read=name=>readFileSync(new URL(name,migrations),'utf8')
const physicalPath=process.env.EDIEL_PRODAT_PHYSICAL_OWNER_MIGRATION??new URL('20261001140000_ediel_inbound_prodat_physical_outcome_owner.sql',migrations)
const physical=readFileSync(physicalPath,'utf8')
const recoveryPatch=read('20261001140500_ediel_prodat_recovery_physical_negative_scope.sql')
const part=(sql,name)=>{const start=sql.indexOf(`CREATE FUNCTION ${name}`),end=sql.indexOf('$$;',start)+3;if(start<0||end<=start)throw Error(`Actual function missing: ${name}`);return sql.slice(start,end)}
const block=(sql,startLabel,endLabel)=>{const start=sql.indexOf(startLabel),end=sql.indexOf(endLabel,start)+endLabel.length;if(start<0||end<start)throw Error(`Actual composition missing: ${startLabel}`);return sql.slice(start,end)}
const actualBodies=[
 part(read('20260923135706_ediel_utilts_consumption_binding_v1.sql'),'gridex_utilts_binding.wire_tokens_v1'),
 ...['wire_v1','source_match_v1'].map(n=>part(read('20260930170932_ediel_inbound_ack_source_atomic_authority.sql'),`gridex_ack_authority.${n}`)),
 part(read('20260930231746_ediel_native_prodat_ack_immutable_scope.sql'),'gridex_ediel_ack_guide.prodat_outcomes_v1'),
 ...['prodat_physical_scope_key_v1','prodat_physical_source_projection_version_v1','prodat_physical_source_objects_v1'].map(n=>part(physical,`gridex_ack_authority.${n}`)),
 block(physical,'DO $scope_projection$','END$scope_projection$;'),
 ...['prodat_physical_outcomes_v1','prodat_physical_receipt_v1'].map(n=>part(physical,`gridex_ack_authority.${n}`)),
 block(physical,'DO $physical_recovery$','END$physical_recovery$;'),
 part(physical,'gridex_ack_authority.prodat_correction_objects_v1')
].join('\n')
const provenance={base:'scripts/ediel-prodat-recovery-phase-regression.mjs',physicalMigrationSha256:createHash('sha256').update(physical).digest('hex'),recoveryMigrationSha256:createHash('sha256').update(recoveryPatch).digest('hex')}
let base=readFileSync(new URL('./ediel-prodat-recovery-phase-regression.mjs',import.meta.url),'utf8')
const marker=' console.log(JSON.stringify({checks,status:'
const stop=base.indexOf(marker);if(stop<0)throw Error('Existing phase regression output boundary changed')
base=base.slice(0,stop)
base=base.replace('new URL(`../supabase/migrations/${name}`,import.meta.url)',`new URL(name,${JSON.stringify(migrations.href)})`)
const phase=String.raw`
 const baseChecks=checks;
 await db.exec('CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_ack_guide;ALTER TABLE public.ediel_messages ADD message_sent_at timestamptz;ALTER TABLE gridex_ack_authority.source_correlations ADD PRIMARY KEY(ack_message_id);CREATE TABLE gridex_ack_authority.applied_receipts(ack_message_id uuid PRIMARY KEY,result jsonb);CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION \'immutable physical receipt\';END$$;');
 await db.exec(__TABLE_SQL__);
 await db.exec(__ACTUAL_BODIES__);
 await db.exec('REVOKE ALL ON FUNCTION gridex_ack_authority.prodat_physical_scope_key_v1(uuid,int,text),gridex_ack_authority.prodat_physical_source_projection_version_v1(),gridex_ack_authority.prodat_physical_source_objects_v1(text),gridex_ack_authority.prodat_physical_scoped_outcomes_v1(text,text),gridex_ack_authority.prodat_physical_recovery_wire_v1(text),gridex_ack_authority.prodat_physical_outcomes_v1(text,text,uuid),gridex_ack_authority.prodat_physical_receipt_v1(uuid,text,uuid,uuid),gridex_ack_authority.prodat_correction_objects_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role');
 const procIdentities=async()=> (await db.query("SELECT oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN('gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,'public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,'gridex_received_sources.qualify_established_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) ORDER BY oid")).rows;
 const beforeIdentity=await procIdentities();
 const sourceWire=(label,objects)=>{const body=['UNH+S+PRODAT:D:97A:UN:E2SE6A','BGM+Z13+DOC-'+label+'+9','NAD+FR+LOCAL:160:SVK+++++++SE','NAD+DO+REMOTE:160:SVK+++++++SE',...objects.flatMap((o,i)=>['LIN+'+(i+1)+'++'+o.point+':::'+ (o.agency??'9'),...(o.li?['RFF+LI:'+o.li]:[]),'NAD+UD+5566778899:SE1:260','CCI++Z13','CAV+S17'])];return 'UNB+UNOC:3+LOCAL:14+REMOTE:14+261001:1200+I-'+label+'++23-DDQ-PRODAT++++1\''+body.join('\'')+'\'UNT+'+(body.length+1)+'+S\'UNZ+1+I-'+label+'\''};
 const ackWire=(label,groups)=>{const body=['UNH+A+APERAK:D:96A:UN:E2SE6A','BGM+APERAK+ACK-'+label+'+34','RFF+ACW:DOC-'+label,'NAD+FR+REMOTE:160:SVK+++++++SE','NAD+DO+LOCAL:160:SVK+++++++SE',...groups.flatMap(o=>['ERC+'+(o.positive?'100':'41')+'::260',...(o.positive?[]:['FTX+AAO+++226']),'RFF+Z07:'+o.point,...(o.li?['RFF+LI:'+o.li]:[])])];return 'UNB+UNOC:3+REMOTE:14+LOCAL:14+261001:1201+A-'+label+'++23-DDQ-PRODAT++++1\''+body.join('\'')+'\'UNT+'+(body.length+1)+'+A\'UNZ+1+A-'+label+'\''};
 // These fixtures declare prior canonical admission and receipt capture. The
 // stored physical scopes themselves come from the unchanged actual raw owner.
 const seedPhysical=async(n,label,objects,groups,sourceRaw=null)=>{const sr=sourceRaw??sourceWire(label,objects),ar=ackWire(label,groups);await message(n,sr);await message(n+1,ar,'APERAK');await db.query('UPDATE public.ediel_messages SET message_sent_at=now() WHERE id=$1',[id(n)]);await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,id,company_id,environment,immutable_payload_hash,$2,NULL FROM public.ediel_messages WHERE id=$3",[id(n+1000),JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'}),id(n+1)]);const scopes=(await db.query('SELECT gridex_ack_authority.prodat_physical_outcomes_v1($1,$2,$3) b',[ar,sr,id(n)])).rows[0].b;await db.query("INSERT INTO gridex_ack_authority.source_correlations SELECT a.id,s.id,s.company_id,s.environment,'APERAK','negative','object',a.immutable_payload_hash,s.immutable_payload_hash,$3 FROM public.ediel_messages a,public.ediel_messages s WHERE a.id=$1 AND s.id=$2",[id(n+1),id(n),scopes]);await db.query('INSERT INTO gridex_ack_authority.applied_receipts VALUES($1,$2)',[id(n+1),{scopeOutcomes:scopes}]);await db.query('INSERT INTO gridex_ack_authority.prodat_physical_receipts(ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,scopes,source_projection_version) SELECT ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,scope_outcomes,gridex_ack_authority.prodat_physical_source_projection_version_v1() FROM gridex_ack_authority.source_correlations WHERE ack_message_id=$1',[id(n+1)]);return{n,label,sr,ar,scopes}};
 const physicalObjects=f=>db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3) b",[id(1),id(f.n+1),id(f.n)]);
 const correction=(f,op,objects,ref='NEW-'+op)=>prepare(5,op,f.n,f.n+1,sourceWire(ref,objects));
 const failed={point:'BAD'},positive={point:'GOOD',li:'REAL-LI'};
 const mixed=await seedPhysical(100,'MIX',[failed,positive],[failed,{...positive,positive:true}]);
 const projectionVersion=(await db.query('SELECT gridex_ack_authority.prodat_physical_source_projection_version_v1() v')).rows[0].v;
 assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_physical_receipt_v1($1,'test',$2,$3) b",[id(1),id(101),id(100)])).rows[0].b.sourceProjectionVersion,projectionVersion);checks++;
 const expected=(await db.query("SELECT gridex_received_sources.prodat_recovery_wire_v1($1)->'objects' b",[sourceWire('CORRECTED',[failed])])).rows[0].b;
 assert.deepEqual((await physicalObjects(mixed)).rows[0].b,expected);assert.equal('li' in expected[0],false);checks+=2;
 // RED: unchanged source owner rejects an absent LI even with a qualified
 // physical object receipt. GREEN below changes only that scope selection.
 const red=(await correction(mixed,102,[failed])).rows[0].b;assert.equal(red.status,'held');assert.equal(red.reason,'source_supported_negative_aperak_scope_required');checks++;
 await db.exec(__RECOVERY_PATCH__);
 assert.deepEqual(await procIdentities(),beforeIdentity);checks++;
 const made=(await correction(mixed,102,[failed])).rows[0].b;assert.equal(made.status,'authorized');assert.equal(made.kind,'aperak_correction');assert.equal((await correction(mixed,102,[failed])).rows[0].b.operationId,made.operationId);checks+=2;
 await message(103,sourceWire('NEW-102',[failed]),'PRODAT',100,102);
 const qualified=(await basis(5,102)).rows[0].b;assert.deepEqual(qualified.allowedObjects,expected);assert.equal(qualified.sourceOriginMessageId,id(100));checks++;
 const negativePair=[{point:'Z-FAILED'},{point:'A-FAILED'}];
 const multiple=await seedPhysical(130,'MULTI',negativePair,negativePair);
 assert.equal((await correction(multiple,132,negativePair)).rows[0].b.status,'authorized');checks++;
 const noMint=async(test)=>{const before=(await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_recovery_operations')).rows[0].n;await test();assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_recovery_operations')).rows[0].n,before);checks++};
 for(const objects of [[failed,positive],[positive],[{...failed,li:'FAKE-LI'}],[{...failed,point:'FOREIGN'}],[{...failed,agency:'89'}]])await noMint(async()=>{const held=(await correction(mixed,104,objects)).rows[0].b;assert.equal(held.status,'held');assert.equal(held.reason,'corrected_exact_failed_scope_required')});
 await noMint(async()=>{const held=(await correction(mixed,104,[failed],'MIX')).rows[0].b;assert.equal(held.status,'held');assert.equal(held.reason,'negative_aperak_new_bgm_required')});
 await noMint(async()=>{await assert.rejects(prepare(4,104,mixed.n,mixed.n+1,sourceWire('DENIED',[failed])),/execution_actor_forbidden/)});
 const onlyPositive=await seedPhysical(110,'POS',[positive],[{...positive,positive:true}]);assert.deepEqual((await physicalObjects(onlyPositive)).rows[0].b,[]);await noMint(async()=>{const held=(await correction(onlyPositive,112,[positive])).rows[0].b;assert.equal(held.status,'held');assert.equal(held.reason,'negative_aperak_own_object_required')});checks++;
 // A NULL actual getter means no new physical receipt; preserve genuine old LI.
 await message(120,raw('LEGACY'));await acknowledge(120,121,['A']);assert.equal((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3) b",[id(1),id(121),id(120)])).rows[0].b,null);assert.equal((await prepare(5,122,120,121,raw('LEGACY-NEW',['A']))).rows[0].b.status,'authorized');checks+=2;
 await assert.rejects(db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'production',$2,$3)",[id(1),id(101),id(100)]),/receipt_changed/);await assert.rejects(db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)",[id(999),id(101),id(100)]),/receipt_changed/);await assert.rejects(db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)",[id(1),id(101),id(120)]),/receipt_changed/);checks+=3;
 await db.query('UPDATE gridex_ack_authority.applied_receipts SET result=\'{"scopeOutcomes":[]}\' WHERE ack_message_id=$1',[id(101)]);await assert.rejects(physicalObjects(mixed),/receipt_changed/);await assert.rejects(basis(5,102),/receipt_changed/);checks+=2;await db.query('UPDATE gridex_ack_authority.applied_receipts SET result=$2 WHERE ack_message_id=$1',[id(101),{scopeOutcomes:mixed.scopes}]);
 await db.query('UPDATE public.ediel_messages SET raw_payload=raw_payload||\'X\' WHERE id=$1',[id(101)]);assert.equal((await correction(mixed,104,[failed])).rows[0].b.reason,'canonical_negative_ack_source_required');await assert.rejects(basis(5,102),/source_context_held/);checks+=2;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(101),mixed.ar]);
 await db.query('UPDATE public.ediel_messages SET raw_payload=raw_payload||\'X\' WHERE id=$1',[id(100)]);await assert.rejects(correction(mixed,104,[failed]),/sealed_original_required/);await assert.rejects(basis(5,102),/sealed_original_required/);checks+=2;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(100),mixed.sr]);
 await db.query("UPDATE gridex_ack_authority.source_correlations SET ack_outcome='positive' WHERE ack_message_id=$1",[id(101)]);assert.equal((await correction(mixed,104,[failed])).rows[0].b.reason,'qualified_negative_ack_source_required');await assert.rejects(basis(5,102),/source_context_held/);checks+=2;await db.query("UPDATE gridex_ack_authority.source_correlations SET ack_outcome='negative' WHERE ack_message_id=$1",[id(101)]);
 // A future owner projection cannot silently reinterpret an older receipt.
 // Simulate only that explicit current-version boundary in this private DB.
 const originalVersionOwner=(await db.query("SELECT pg_get_functiondef('gridex_ack_authority.prodat_physical_source_projection_version_v1()'::regprocedure) d")).rows[0].d;
 await db.exec("CREATE OR REPLACE FUNCTION gridex_ack_authority.prodat_physical_source_projection_version_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT '{\"DECLARED future projection\":\"different version\"}'::jsonb$$;");
 await assert.rejects(physicalObjects(mixed),/physical_projection_version_unavailable/);await assert.rejects(basis(5,102),/physical_projection_version_unavailable/);checks+=2;await db.exec(originalVersionOwner);
 await assert.rejects(db.exec("UPDATE gridex_ack_authority.prodat_physical_receipts SET scopes='[]'"),/immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ack_authority.prodat_physical_receipts'),/immutable/);checks+=2;
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)','gridex_ack_authority.prodat_correction_objects_v1(uuid,text,uuid,uuid)','gridex_ack_authority.prodat_physical_source_projection_version_v1()','gridex_ack_authority.prodat_physical_source_objects_v1(text)','gridex_ack_authority.prodat_physical_scoped_outcomes_v1(text,text)','gridex_ack_authority.prodat_physical_recovery_wire_v1(text)']){assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn])).rows[0].allowed,false);checks++}
 console.log(JSON.stringify({status:'PASS',checks,baseChecks,physicalChecks:checks-baseChecks,provenance:__PROVENANCE__,scope:'actual recovery source/operation/current execution/journal plus actual physical projection/receipt/getter; missing LI remains absent, positives excluded, legacy LI preserved, exact subset and source/actor/hash/receipt rejection, metadata/ACL retained',authority:'Finite synthetic canonical admission and receipt capture. Separate actual incoming-owner script is required; authentic Supabase/concurrency/final-candidate acceptance NOT_RUN.'}));
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message,code:error.code,where:error.where,detail:error.detail}));process.exitCode=1}finally{await db.close()}
`
const tableStart=physical.indexOf('CREATE TABLE gridex_ack_authority.prodat_physical_receipts(')
const tableEnd=physical.indexOf('CREATE FUNCTION gridex_ack_authority.prodat_physical_scope_key_v1')
if(tableStart<0||tableEnd<=tableStart)throw Error('Actual physical receipt storage boundary changed')
const composed=base+phase.replace('__TABLE_SQL__',()=>JSON.stringify(physical.slice(tableStart,tableEnd))).replace('__ACTUAL_BODIES__',()=>JSON.stringify(actualBodies)).replace('__RECOVERY_PATCH__',()=>JSON.stringify(recoveryPatch)).replace('__PROVENANCE__',()=>JSON.stringify(provenance))
try{await import('data:text/javascript;base64,'+Buffer.from(composed).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',message:error.message,stack:error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'composed-sql-test')}));process.exitCode=1}
