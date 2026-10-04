// Actual physical/recovery/journal regression, then actual protected technical
// LI allocator and source qualifier. Canonical admission/captured receipt ports
// remain finite declared fixtures; this is not authentic/native acceptance.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const migrations=new URL('../supabase/migrations/',import.meta.url)
const allocationSql=readFileSync(new URL('20261001141000_ediel_recovery_owned_missing_li_allocation.sql',migrations),'utf8')
const physicalScriptUrl=new URL('./ediel-recovery-physical-negative-scope-sql-regression.mjs',import.meta.url)
let physicalScript=readFileSync(physicalScriptUrl,'utf8')
const physicalMigration=readFileSync(process.env.EDIEL_PRODAT_PHYSICAL_OWNER_MIGRATION??new URL('20261001140000_ediel_inbound_prodat_physical_outcome_owner.sql',migrations),'utf8')
const provenance={physicalProbeSha256:createHash('sha256').update(physicalScript).digest('hex'),physicalMigrationSha256:createHash('sha256').update(physicalMigration).digest('hex'),recoveryScopeMigrationSha256:createHash('sha256').update(readFileSync(new URL('20261001140500_ediel_prodat_recovery_physical_negative_scope.sql',migrations))).digest('hex'),allocationMigrationSha256:createHash('sha256').update(allocationSql).digest('hex')}
physicalScript=physicalScript.replace(/new URL\('((?:\.\.\/|\.\/)[^']+)',import\.meta\.url\)/g,(_,name)=>`new URL(${JSON.stringify(new URL(name,physicalScriptUrl).href)})`)
const additions=String.raw`
 {
 const liBaseChecks=checks;
 const priorMetadata=await procIdentities();
 await db.exec('CREATE SCHEMA gridex_ediel_ack_replay;CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;');
 await db.exec(__ALLOCATION_SQL__);assert.deepEqual(await procIdentities(),priorMetadata);checks++;
 // Only NEW fixtures use the genuine own national field group. The preceding
 // physical fixtures are preserved; their free human text is not field226.
 const seedOwnedLi=async(n,label,objects,groups,ownRaw=null)=>{const sr=ownRaw??sourceWire(label,objects),ar=ackWire(label,groups).replaceAll('FTX+AAO+++226','FTX+AAO++226::260');await message(n,sr);await message(n+1,ar,'APERAK');await db.query('UPDATE public.ediel_messages SET message_sent_at=now() WHERE id=$1',[id(n)]);await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,id,company_id,environment,immutable_payload_hash,$2,NULL FROM public.ediel_messages WHERE id=$3",[id(n+1000),JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'}),id(n+1)]);const scopes=(await db.query('SELECT gridex_ack_authority.prodat_physical_outcomes_v1($1,$2,$3)b',[ar,sr,id(n)])).rows[0].b;await db.query("INSERT INTO gridex_ack_authority.source_correlations SELECT a.id,s.id,s.company_id,s.environment,'APERAK','negative','object',a.immutable_payload_hash,s.immutable_payload_hash,$3 FROM public.ediel_messages a,public.ediel_messages s WHERE a.id=$1 AND s.id=$2",[id(n+1),id(n),scopes]);await db.query('INSERT INTO gridex_ack_authority.applied_receipts VALUES($1,$2)',[id(n+1),{scopeOutcomes:scopes}]);await db.query('INSERT INTO gridex_ack_authority.prodat_physical_receipts(ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,scopes,source_projection_version) SELECT ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,scope_outcomes,gridex_ack_authority.prodat_physical_source_projection_version_v1() FROM gridex_ack_authority.source_correlations WHERE ack_message_id=$1',[id(n+1)]);return{n,label,sr,ar,scopes}};
 const serviceLi=async(fn)=>{await db.exec('SET ROLE service_role');try{return await fn()}finally{await db.exec('RESET ROLE')}};
 const allocate=(f,operation,input,actor=5,company=id(1))=>serviceLi(async()=> (await db.query('SELECT public.ediel_prepare_prodat_recovery_references_v1($1,$2,$3,$4,$5,$6)b',[company,id(f.n),id(f.n+1),id(operation),id(actor),input])).rows[0].b);
 const preparations=async()=> (await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_recovery_li_preparations')).rows[0].n;
 const privateColumns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='gridex_received_sources' AND table_name='prodat_recovery_li_preparations' ORDER BY ordinal_position")).rows.map(x=>x.column_name);assert(!privateColumns.some(x=>/raw|customer/.test(x)));assert(privateColumns.includes('input_payload_hash')&&privateColumns.includes('corrected_payload_hash'));checks++;
 const untouched=(await db.query('SELECT to_jsonb(m)b FROM public.ediel_messages m WHERE id IN($1,$2) ORDER BY id',[id(100),id(101)])).rows;
 const repairObject={point:'OWN-REPAIR'},good={point:'OWN-GOOD',li:'EXISTING-GOOD-LI'};
 const genuine=await seedOwnedLi(200,'OWN',[repairObject,good],[repairObject,{...good,positive:true}]);
 assert.equal((await db.query("SELECT jsonb_array_length(gridex_received_sources.missing_li_repair_scopes_v1($1,'test',$2,$3)) n",[id(1),id(201),id(200)])).rows[0].n,1);checks++;
 assert.equal((await db.query("SELECT jsonb_array_length(gridex_received_sources.missing_li_repair_scopes_v1($1,'test',$2,$3)) n",[id(1),id(101),id(100)])).rows[0].n,0);checks++;
 const input=sourceWire('OWN-CORRECTED',[repairObject]),clientInput=sourceWire('OWN-CORRECTED',[{...repairObject,li:'CALLER-CHOSEN'}]);
 await assert.rejects(prepare(5,202,200,201,input),/owned_li_preparation_required/);await assert.rejects(prepare(5,202,200,201,clientInput),/owned_li_preparation_required/);assert.equal(await preparations(),0);checks+=3;
 const made=await allocate(genuine,202,input);assert.equal(made.allocations.length,1);assert.match(made.allocations[0].reference,/^[A-Z0-9]{35}$/);assert.notEqual(made.allocations[0].reference,'CALLER-CHOSEN');assert.equal(made.actorUserId,id(5));checks++;
 const repaired=(await db.query("SELECT gridex_received_sources.prodat_recovery_wire_v1($1)->'objects' b",[made.correctedRawPayload])).rows[0].b;
 assert.deepEqual(repaired,[{point:repairObject.point,identityAgency:'9',customerIdentity:'5566778899',reason:'S17',li:made.allocations[0].reference}]);checks++;
 assert.deepEqual((await allocate(genuine,202,input)).allocations,made.allocations);assert.equal((await allocate(genuine,202,made.correctedRawPayload)).correctedRawPayload,made.correctedRawPayload);assert.equal(await preparations(),1);checks+=3;
 assert.equal((await prepare(5,202,200,201,made.correctedRawPayload)).rows[0].b.status,'authorized');await message(203,made.correctedRawPayload,'PRODAT',200,202);assert.deepEqual((await basis(5,202)).rows[0].b.allowedObjects,repaired);checks+=2;
 assert.deepEqual((await basis(4,202)).rows[0].b.allowedObjects,repaired);checks++;
 const mintedBinding=await binding(203,made.correctedRawPayload);await archive(203,mintedBinding);
 assert.equal((await journal(203,4,207,'prepare',{owner:{kind:'direct'},binding:mintedBinding})).rows[0].b.proceed,true);assert.equal((await journal(203,4,207,'enter')).rows[0].b.proceed,true);checks+=2;
 await db.query("UPDATE public.user_profiles SET user_status='inactive' WHERE id=$1",[id(4)]);await assert.rejects(journal(203,4,207,'enter'),/replay_scope_invalid/);checks++;await db.query("UPDATE public.user_profiles SET user_status='active' WHERE id=$1",[id(4)]);
 assert.equal((await journal(203,4,207,'observe',{result:{accepted:['peer@example.invalid'],rejected:[],messageId:'<allocated-fixture>'}})).rows[0].b.classification,'accepted');checks++;
 await assert.rejects(prepare(5,202,200,201,made.correctedRawPayload.replace(made.allocations[0].reference,'UNTRUSTED-NEW-LI')),/li_preparation_changed/);checks++;
 const replaced=await allocate(genuine,204,clientInput);assert(!replaced.correctedRawPayload.includes('CALLER-CHOSEN'));assert.equal((await db.query("SELECT count(*)::int n FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2($1))t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI'",[replaced.correctedRawPayload])).rows[0].n,1);assert.equal((await prepare(5,204,200,201,replaced.correctedRawPayload)).rows[0].b.status,'authorized');checks+=3;
 const noPreparation=async(fn)=>{const count=await preparations();await fn();assert.equal(await preparations(),count);checks++};
 await noPreparation(()=>assert.rejects(allocate(genuine,202,sourceWire('CHANGED',[repairObject])),/operation_conflict/));
 await noPreparation(()=>assert.rejects(allocate(genuine,205,sourceWire('WIDENED',[repairObject,good])),/source_held:corrected_exact_failed_scope_required/));
 await noPreparation(()=>assert.rejects(allocate(genuine,205,sourceWire('BUSINESS',[repairObject]).replace('CAV+S17','CAV+S21')),/source_held:corrected_exact_failed_scope_required/));
 await noPreparation(()=>assert.rejects(allocate(genuine,205,sourceWire('FOREIGN',[{point:'FOREIGN'}])),/query returned no rows|source_held/));
 await noPreparation(()=>assert.rejects(allocate(genuine,205,input,4),/execution_actor_forbidden/));
 await db.query('UPDATE public.company_memberships SET accepted_at=NULL WHERE user_id=$1',[id(5)]);await assert.rejects(allocate(genuine,202,input),/execution_actor_forbidden/);await assert.rejects(prepare(5,202,200,201,made.correctedRawPayload),/execution_actor_forbidden/);checks+=2;await db.query('UPDATE public.company_memberships SET accepted_at=now() WHERE user_id=$1',[id(5)]);
 await assert.rejects(allocate(genuine,202,input,5,id(2)),/execution_actor_forbidden/);checks++;
 await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'X' WHERE id=$1",[id(201)]);await assert.rejects(allocate(genuine,202,input),/receipt_changed|canonical_negative_ack_source_required/);await assert.rejects(basis(4,202),/source_context_held|receipt_changed/);checks+=2;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(201),genuine.ar]);
 await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'X' WHERE id=$1",[id(200)]);await assert.rejects(allocate(genuine,202,input),/receipt_changed|sealed_original_required/);await assert.rejects(basis(4,202),/receipt_changed|sealed_original_required/);checks+=2;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(200),genuine.sr]);
 const emptyHuman=(await allocate({n:100},206,sourceWire('HUMAN-ONLY',[{point:'BAD'}])));assert.deepEqual(emptyHuman.allocations,[]);assert.equal(await preparations(),2);checks++;
 // The framing producer preserves custom UNA, released separators/terminators
 // and CRLF bytes. Its real tokenizer owns the repaired actual UNT count.
 const customOwn={point:'CUSTOM'},custom=await seedOwnedLi(210,'CUSTOM',[customOwn],[customOwn]);
 const literal="FTX+AAO+++note?+plus?'term??release'";
 let customRaw=sourceWire('CUSTOM-CORRECTED',[customOwn]).replace('UNT+',literal+'UNT+');
 let customTokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1)b',[customRaw])).rows[0].b;
 const counted=customTokens.find(x=>x.tag==='UNT').index-customTokens.find(x=>x.tag==='UNH').index+1;
 customRaw=customRaw.replace(/UNT\+[0-9]+\+/,'UNT+'+counted+'+').replaceAll("'NAD","'\r\nNAD");
 customRaw='UNA:;.~ !'+customRaw.replaceAll('?','~').replaceAll('+',';').replaceAll("'",'!');
 customRaw=customRaw.replace('note~;plus','note~\r\n;plus')+'\r\n';
 const customMade=await allocate(custom,212,customRaw);assert(customMade.correctedRawPayload.startsWith('UNA:;.~ !'));assert(customMade.correctedRawPayload.includes('note~\r\n;plus~!term~~release!'));assert(customMade.correctedRawPayload.includes('!\r\nNAD'));assert(customMade.correctedRawPayload.endsWith('\r\n'));checks++;
 customTokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1)b',[customMade.correctedRawPayload])).rows[0].b;
 const actualUnt=customTokens.find(x=>x.tag==='UNT'),actualUnh=customTokens.find(x=>x.tag==='UNH');assert.equal(Number(actualUnt.elements[1][0]),actualUnt.index-actualUnh.index+1);assert.equal((await prepare(5,212,210,211,customMade.correctedRawPayload)).rows[0].b.status,'authorized');checks+=2;
 // Native first-register ownership keeps V6 omission on later registers.
 const registerBody=['UNH+S+PRODAT:D:97A:UN:E2SE6A','BGM+Z04+DOC-REGISTER+9','NAD+FR+LOCAL:160:SVK+++++++SE','NAD+DO+REMOTE:160:SVK+++++++SE','LIN+1++REGISTER:::9+1:1','NAD+UD+5566778899:SE1:260','CCI++Z13','CAV+S17','LIN+2++REGISTER:::9+1:2','NAD+UD+5566778899:SE1:260','CCI++Z13','CAV+S17'];
 const registerSource="UNB+UNOC:3+LOCAL:14+REMOTE:14+261001:1200+I-REGISTER++23-DDQ-PRODAT++++1'"+registerBody.join("'")+"'UNT+"+(registerBody.length+1)+"+S'UNZ+1+I-REGISTER'";
 const register=await seedOwnedLi(220,'REGISTER',[{point:'REGISTER'}],[{point:'REGISTER'}],registerSource);await db.query("UPDATE public.ediel_messages SET message_code='Z04' WHERE id=$1",[id(220)]);
 const registerInput=registerSource.replaceAll('DOC-REGISTER','DOC-REGISTER-CORRECTED').replaceAll('I-REGISTER','I-REGISTER-CORRECTED');
 const registerMade=await allocate(register,222,registerInput);assert.equal(registerMade.allocations.length,1);const registerGroups=(await db.query('SELECT gridex_ack_authority.prodat_physical_source_objects_v1($1)b',[registerMade.correctedRawPayload])).rows[0].b;assert.equal(registerGroups.length,1);assert.equal(registerGroups[0].registerLineIndices.length,2);checks++;
 const registerObjects=(await db.query("SELECT gridex_ack_authority.prodat_physical_recovery_wire_v1($1)->'objects' b",[registerMade.correctedRawPayload])).rows[0].b;assert.equal(registerObjects.filter(x=>'li' in x).length,1);assert.equal((await prepare(5,222,220,221,registerMade.correctedRawPayload)).rows[0].b.status,'authorized');checks+=2;
 assert.deepEqual((await db.query('SELECT to_jsonb(m)b FROM public.ediel_messages m WHERE id IN($1,$2) ORDER BY id',[id(100),id(101)])).rows,untouched);checks++;
 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.prodat_recovery_li_preparations'),/immutable/);await assert.rejects(db.exec('TRUNCATE gridex_received_sources.prodat_recovery_li_preparations'),/immutable/);checks+=2;
 for(const role of ['anon','authenticated']){assert.equal((await db.query("SELECT has_function_privilege($1,'public.ediel_prepare_prodat_recovery_references_v1(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);checks++}
 for(const fn of ['gridex_received_sources.missing_li_repair_scopes_v1(uuid,text,uuid,uuid)','gridex_received_sources.recovery_reference_wire_data_v1(text,text,text,text,text)','gridex_received_sources.render_owned_li_repair_v1(text,jsonb)','gridex_received_sources.apply_owned_li_repair_v1(uuid,uuid,uuid,uuid,text,jsonb)']){assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[fn])).rows[0].allowed,false);checks++}
 assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.prodat_recovery_li_preparations','INSERT') allowed")).rows[0].allowed,false);checks++;
 console.log(JSON.stringify({status:'PASS',checks,physicalBaseChecks:liBaseChecks,ownedLiChecks:checks-liBaseChecks,provenance:__ALLOC_PROVENANCE__,scope:'actual protected ERC41/226 LI allocation and actual common source/operation qualifier, caller reference replacement, first-register/V6 ownership, exact failed business subset, idempotence/conflict/rollback/current actor, lossless framing and metadata/ACL',authority:'Finite synthetic canonical admission/captured physical receipts. Actual source/journal/allocator bodies; authentic Supabase/concurrency/legal source/final-candidate qualification NOT_RUN.'}));
 }
`
const phase=additions.replace('__ALLOCATION_SQL__',()=>JSON.stringify(allocationSql)).replace('__ALLOC_PROVENANCE__',()=>JSON.stringify(provenance))
const marker=" console.log(JSON.stringify({status:'PASS',checks,baseChecks,physicalChecks:"
const catchMarker="}catch(error){console.error(JSON.stringify({status:'FAIL',checks,"
const splice=`composed.slice(0,composed.indexOf(${JSON.stringify(marker)}))+${JSON.stringify(phase)}+composed.slice(composed.indexOf(${JSON.stringify(catchMarker)},composed.indexOf(${JSON.stringify(marker)})))`
if(!physicalScript.includes("Buffer.from(composed).toString('base64')"))throw Error('Existing physical composition execution boundary changed')
physicalScript=physicalScript.replace("Buffer.from(composed).toString('base64')",()=>`Buffer.from(${splice}).toString('base64')`)
try{await import('data:text/javascript;base64,'+Buffer.from(physicalScript).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',message:error.message,code:error.code,where:error.where,stack:error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'composed-sql-test').split('\n').slice(0,4).join('\n')}));process.exitCode=1}
