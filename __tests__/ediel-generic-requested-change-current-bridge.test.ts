// masterplan: AT-Z06E-SUPPLIER, AT-Z09E-SUPPLIER
import {createHash} from 'node:crypto'
import {existsSync,readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {expect,it} from 'vitest'

// Actual production SQL wrapper/forward with explicitly declared generic,
// transport, recovery and certification source ports. These model records do
// not establish source authority; actual archive/review/original/send run native.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw='DECLARED exact generic original',hash=createHash('sha256').update(raw).digest('hex')
const forward=new URL('../supabase/migrations/20261006205800_ediel_generic_requested_change_current_bridge.sql',import.meta.url)
const signature='gridex_customer_life_events.require_current_v1(uuid,uuid,uuid,text)'
const baseline={source:'declared_current_generic',variant:'E',revision:1}
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE declared_owner;CREATE ROLE declared_reader;
 CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_negative_fixtures;CREATE SCHEMA gridex_ediel_transport;
 CREATE TABLE public.ediel_messages(id uuid,company_id uuid,direction text,raw_payload text,environment text,message_family text,message_code text,intent_id uuid,source_operation_id text,immutable_payload_hash text,immutable_rendered_at timestamptz,execution_context_snapshot jsonb);
 CREATE TABLE gridex_customer_life_events.originals(message_id uuid,company_id uuid);
 CREATE TABLE gridex_received_sources.prodat_recovery_messages(message_id uuid);
 CREATE TABLE gridex_requested_changes.events(id uuid,company_id uuid,variant text,event_kind text);
 CREATE TABLE gridex_requested_changes.origins(event_id uuid,company_id uuid,intent_id uuid,message_id uuid,payload_hash text,basis jsonb);
 CREATE TABLE public.declared_current_source(basis jsonb,write_actor uuid,send_actor uuid);
 CREATE TABLE public.declared_intent_state(qualified boolean);
 INSERT INTO public.declared_current_source VALUES('${JSON.stringify(baseline)}','${id(4)}','${id(5)}');
 INSERT INTO public.declared_intent_state VALUES(true);
 INSERT INTO public.ediel_messages VALUES('${id(2)}','${id(1)}','outbound','${raw}','test','PRODAT','Z09','${id(3)}','${id(6)}','${hash}',now(),'{}');
 INSERT INTO gridex_requested_changes.events VALUES('${id(6)}','${id(1)}','E','death');
 INSERT INTO gridex_requested_changes.origins VALUES('${id(6)}','${id(1)}','${id(3)}','${id(2)}','${hash}','${JSON.stringify(baseline)}');
 CREATE FUNCTION gridex_requested_changes.require_message_v1(m public.ediel_messages,actor uuid,permission text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE current_source public.declared_current_source%rowtype;basis jsonb;BEGIN
 SELECT * INTO current_source FROM public.declared_current_source;
 SELECT o.basis INTO basis FROM gridex_requested_changes.origins o WHERE o.intent_id=m.intent_id AND o.company_id=m.company_id;
 IF basis IS NULL OR current_source.basis IS DISTINCT FROM basis OR permission NOT IN('communication.write','communication.send')
 OR (permission='communication.write' AND actor NOT IN(current_source.write_actor,current_source.send_actor))
 OR (permission='communication.send' AND actor IS DISTINCT FROM current_source.send_actor)
 THEN RAISE EXCEPTION 'requested_change_original_current_source_required';END IF;
 RETURN basis;END$$;
 CREATE FUNCTION gridex_ediel_transport.require_message_intent_v1(m public.ediel_messages)RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN IF (SELECT qualified FROM public.declared_intent_state) IS NOT TRUE THEN RAISE EXCEPTION 'declared_transport_intent_required';END IF;END$$;
 CREATE FUNCTION gridex_customer_life_events.require_before_certification_v1(c uuid,mid uuid,actor uuid,phase text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN
 IF EXISTS(SELECT FROM gridex_customer_life_events.originals WHERE message_id=mid AND company_id=c) THEN RETURN jsonb_build_object('legacy','modern','phase',phase);END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages WHERE message_id=mid) THEN RETURN jsonb_build_object('legacy','recovery','phase',phase);END IF;
 IF EXISTS(SELECT FROM public.ediel_messages WHERE id=mid AND message_code='Z09' AND raw_payload='${raw}') THEN RAISE EXCEPTION 'customer_life_event_historical_source_unavailable';END IF;
 RETURN jsonb_build_object('legacy','other','phase',phase);END$$;
 CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(c uuid,mid uuid,code text)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"declared":"positive"}'::jsonb$$;
 CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(c uuid,mid uuid,code text)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"declared":"negative"}'::jsonb$$;
 CREATE FUNCTION gridex_customer_life_events.require_actor_v1(c uuid,actor uuid,phase text)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF actor IS DISTINCT FROM '${id(5)}'::uuid THEN RAISE EXCEPTION 'declared_certification_actor_required';END IF;END$$;
 CREATE FUNCTION gridex_negative_fixtures.assert_prepare_actor_v1(actor uuid,c uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF actor NOT IN('${id(4)}'::uuid,'${id(5)}'::uuid) THEN RAISE EXCEPTION 'declared_certification_actor_required';END IF;END$$;
 CREATE FUNCTION gridex_customer_life_events.certification_basis_v1(q jsonb,raw text)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"status":"authorized","source":"declared_certification"}'::jsonb$$;`)
 const source=readFileSync(new URL('../supabase/migrations/20261001032824_ediel_independently_classified_customer_event_test_sources.sql',import.meta.url),'utf8')
 const start=source.indexOf('CREATE FUNCTION gridex_customer_life_events.require_current_v1('),end=source.indexOf('END$$;',start)
 if(start<0||end<start)throw Error('actual_private_current_wrapper_required')
 await db.exec(source.slice(start,end+7))
 const publicSource=readFileSync(new URL('../supabase/migrations/20260930233247_ediel_customer_life_event_source_authority.sql',import.meta.url),'utf8')
 const publicStart=publicSource.indexOf('CREATE FUNCTION public.ediel_customer_life_event_message_basis_v1('),publicEnd=publicSource.indexOf('END $$;',publicStart)
 if(publicStart<0||publicEnd<publicStart)throw Error('actual_public_current_wrapper_required')
 await db.exec(publicSource.slice(publicStart,publicEnd+7))
 const publicBefore=(await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid)'::regprocedure`)).rows
 await db.exec(`ALTER FUNCTION ${signature} OWNER TO declared_owner;REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${signature} TO declared_reader;
 GRANT USAGE ON SCHEMA public,gridex_customer_life_events,gridex_requested_changes,gridex_received_sources,gridex_negative_fixtures,gridex_ediel_transport TO declared_owner;
 GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public,gridex_customer_life_events,gridex_requested_changes,gridex_received_sources TO declared_owner;`)
 const before=(await db.query(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='${signature}'::regprocedure`)).rows
 const legacy=(await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text)'::regprocedure`)).rows
 if(existsSync(forward))await db.exec(readFileSync(forward,'utf8'))
 expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid)'::regprocedure`)).rows).toEqual(publicBefore)
 expect((await db.query(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='${signature}'::regprocedure`)).rows).toEqual(before)
 expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text)'::regprocedure`)).rows).toEqual(legacy)
 return db
}
const call=(actor=5,phase:string|null='send',company=1)=>`SELECT gridex_customer_life_events.require_current_v1('${id(company)}','${id(2)}','${id(actor)}',${phase===null?'NULL':`'${phase}'`}) result`
async function state(db:PGlite){return(await db.query(`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m)) FROM public.ediel_messages m),'origins',(SELECT jsonb_agg(to_jsonb(o)) FROM gridex_requested_changes.origins o),'events',(SELECT jsonb_agg(to_jsonb(e)) FROM gridex_requested_changes.events e)) value`)).rows}
it.each([[4,'prepare'],[5,'send']] as const)('actual wrapper recognizes bound generic original with caller %s phase %s without competing classification or writes',async(actor,phase)=>{
 const db=await setup();try{const before=await state(db);expect((await db.query(call(actor,phase))).rows).toEqual([{result:null}]);expect(await state(db)).toEqual(before)}finally{await db.close()}
},20000)
it.each([['write-only sender',4,'send'],['foreign actor',9,'send'],['read phase',5,'read'],['unknown phase',5,'unexpected'],['null phase',5,null]] as const)('actual wrapper refuses %s without certification fallback',async(_label,actor,phase)=>{
 const db=await setup();try{
  await db.exec(`UPDATE public.ediel_messages SET execution_context_snapshot='{"sourceQualifiedPositiveFixtureWitnessId":"DECLARED"}'`)
  const before=await state(db);await expect(db.query(call(actor,phase))).rejects.toThrow(phase==='send'?'requested_change_original_current_source_required':'requested_change_execution_phase_required');expect(await state(db)).toEqual(before)
 }finally{await db.close()}
},20000)
it.each([
 ['revoked or drifted current source',"UPDATE public.declared_current_source SET basis='{}'"],
 ['absent current source','DELETE FROM public.declared_current_source'],
 ['foreign origin company',`UPDATE gridex_requested_changes.origins SET company_id='${id(9)}'`],
 ['foreign event company',`UPDATE gridex_requested_changes.events SET company_id='${id(9)}'`],
 ['different intent',`UPDATE gridex_requested_changes.origins SET intent_id='${id(9)}'`],
 ['different message',`UPDATE gridex_requested_changes.origins SET message_id='${id(9)}'`],
 ['missing event','DELETE FROM gridex_requested_changes.events'],
 ['different event kind',"UPDATE gridex_requested_changes.events SET event_kind='quarter_contract'"],
 ['different event variant',"UPDATE gridex_requested_changes.events SET variant='F',event_kind='quarter_contract'"],
 ['different event origin',`UPDATE gridex_requested_changes.origins SET event_id='${id(9)}'`],
 ['different event alias',`UPDATE public.ediel_messages SET source_operation_id='${id(9)}'`],
 ['changed raw',"UPDATE public.ediel_messages SET raw_payload='changed'"],
 ['changed origin hash',"UPDATE gridex_requested_changes.origins SET payload_hash=repeat('f',64)"],
 ['changed frozen hash',"UPDATE public.ediel_messages SET immutable_payload_hash=repeat('f',64)"],
 ['missing rendered time','UPDATE public.ediel_messages SET immutable_rendered_at=NULL'],
 ['unqualified intent','UPDATE public.declared_intent_state SET qualified=false'],
] as const)('actual wrapper refuses %s, including when a separate fixture selector exists',async(_label,mutation)=>{
 const db=await setup();try{
  await db.exec(mutation);await db.exec(`UPDATE public.ediel_messages SET execution_context_snapshot='{"sourceQualifiedPositiveFixtureWitnessId":"DECLARED"}'`)
  const before=await state(db);await expect(db.query(call())).rejects.toMatchObject({code:'P0001'});expect(await state(db)).toEqual(before)
 }finally{await db.close()}
},20000)
it('unlinked E34 retains historical refusal and foreign company retains message-scope refusal',async()=>{
 const db=await setup();try{await db.exec('DELETE FROM gridex_requested_changes.origins');await expect(db.query(call())).rejects.toThrow('customer_life_event_historical_source_unavailable');await expect(db.query(call(5,'send',9))).rejects.toThrow('customer_life_event_message_scope_required')}finally{await db.close()}
},20000)
it.each(['modern','recovery'] as const)('existing %s delegation retains its read phase',async(kind)=>{
 const db=await setup();try{
  await db.exec(kind==='modern'?`INSERT INTO gridex_customer_life_events.originals VALUES('${id(2)}','${id(1)}')`:`INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES('${id(2)}')`)
  expect((await db.query(call(4,'read'))).rows).toEqual([{result:{legacy:kind,phase:'read'}}])
 }finally{await db.close()}
},20000)
it.each(['positive','negative'] as const)('unlinked declared %s certification remains classified, distinct from generic original',async(kind)=>{
 const db=await setup();try{
  await db.exec(`DELETE FROM gridex_requested_changes.origins;UPDATE public.ediel_messages SET execution_context_snapshot='{"sourceQualified${kind==='positive'?'Positive':'Negative'}FixtureWitnessId":"DECLARED"}'`)
  expect((await db.query(call())).rows).toEqual([{result:{certification:true,basis:{status:'authorized',source:'declared_certification'},intentId:id(3)}}])
 }finally{await db.close()}
},20000)
it.each(['E64','E32'])('non-E original %s retains existing delegation',async(reason)=>{
 const db=await setup();try{
  await db.exec(`UPDATE gridex_requested_changes.events SET variant='${reason==='E64'?'F':'G'}',event_kind='${reason==='E64'?'quarter_contract':'method_contract'}';UPDATE gridex_requested_changes.origins SET basis=jsonb_set(basis,'{variant}','"${reason==='E64'?'F':'G'}"');UPDATE public.ediel_messages SET raw_payload='DECLARED ${reason}'`)
  expect((await db.query(call(4,'read'))).rows).toEqual([{result:{legacy:'other',phase:'read'}}])
 }finally{await db.close()}
},20000)
