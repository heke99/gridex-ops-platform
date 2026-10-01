// Bounded embedded mechanics. Positive grants and historical owner rows below
// are declared fixtures, not authentic originals or native concurrent evidence.
import fs from 'node:fs'
import assert from 'node:assert/strict'
if (!process.env.PGLITE_MODULE_URL) throw Error('PGLITE_MODULE_URL required')
const { PGlite } = await import(process.env.PGLITE_MODULE_URL)
const db = new PGlite(), id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++ }
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA gridex_prodat_object_batch;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE SCHEMA gridex_bilateral_prodat;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_duplicate_responses;
 CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_profiles(id uuid,user_status text);
 CREATE TABLE public.permissions(id uuid DEFAULT gen_random_uuid(),key text UNIQUE,is_active boolean DEFAULT true);
 CREATE TABLE public.roles(id uuid,key text,name text);
 CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
 CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
 CREATE TABLE public.company_memberships(user_id uuid,company_id uuid,status text,is_active boolean);
 CREATE TABLE public.companies(id uuid,is_active boolean,status text);
 CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
 CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.declared_positive_grants(actor uuid,company uuid,permission text);
 CREATE FUNCTION public.gridex_get_user_permissions_in_company(a uuid,c uuid) RETURNS text[] LANGUAGE sql AS $$SELECT coalesce(array_agg(permission),ARRAY[]::text[]) FROM public.declared_positive_grants WHERE actor=a AND company=c$$;
 CREATE TABLE public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,related_message_id uuid);
 CREATE TABLE gridex_ack_authority.declared_originals(id uuid,source_id uuid,family text,status text,message jsonb);
 CREATE TABLE gridex_ack_authority.declared_delay(milliseconds int);
 CREATE TABLE gridex_ack_authority.source_correlations(ack_message_id uuid,source_message_id uuid,company_id uuid,environment text,ack_family text,ack_outcome text);
 CREATE TABLE gridex_ack_authority.applied_receipts(ack_message_id uuid,result jsonb,captured_at timestamptz);
 CREATE FUNCTION gridex_ack_authority.read_committed_v1(c uuid,e text,a uuid,u uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind','exact_receipt','sourceMessageId',s.source_message_id,'companyId',s.company_id,'environment',s.environment,'ackFamily',s.ack_family,'result',r.result)
  FROM gridex_ack_authority.source_correlations s JOIN gridex_ack_authority.applied_receipts r USING(ack_message_id) WHERE s.ack_message_id=a$$;
 CREATE TABLE gridex_ediel_duplicate_responses.declared_consumed_ids(id uuid);
 CREATE FUNCTION gridex_prodat_object_batch.require_service_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;END$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION gridex_bilateral_prodat.lock_source_receipts_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION gridex_ediel_duplicate_responses.is_duplicate_ack_v1(a uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM gridex_ediel_duplicate_responses.declared_consumed_ids WHERE id=a)$$;
 CREATE FUNCTION gridex_ack_authority.read_outbound_originals_v1(s uuid,f text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE answer jsonb;wait_ms int;BEGIN
  SELECT milliseconds INTO wait_ms FROM gridex_ack_authority.declared_delay;IF wait_ms>0 THEN PERFORM pg_sleep(wait_ms/1000.0);END IF;
  SELECT jsonb_build_object('version',1,'sourceMessageId',m.id,'companyId',m.company_id,'environment',m.environment,'originals',coalesce((SELECT jsonb_agg(jsonb_build_object('status',o.status,'message',o.message)) FROM gridex_ack_authority.declared_originals o WHERE o.source_id=s AND o.family=f),'[]')) INTO answer FROM public.ediel_messages m WHERE m.id=s;
  RETURN answer;END$$;
 INSERT INTO auth.users VALUES('${id(1)}',NULL,NULL);
 INSERT INTO public.user_profiles VALUES('${id(1)}','active');
 INSERT INTO public.companies VALUES('${id(2)}',true,'active');
 INSERT INTO public.company_memberships VALUES('${id(1)}','${id(2)}','active',true);
 INSERT INTO public.permissions(key) VALUES('communication.read'),('communication.write'),('communication.send');
 INSERT INTO public.declared_positive_grants VALUES('${id(1)}','${id(2)}','communication.send');
 INSERT INTO public.ediel_messages VALUES('${id(3)}','${id(2)}','test','inbound','PRODAT',NULL);`)
 const original = fs.readFileSync('supabase/migrations/20261001004953_ediel_current_company_permission_denies.sql','utf8')
 await db.exec(original.match(/create or replace function public\.gridex_actor_has_company_permission\([\s\S]*?\$function\$;/i)[0])
 const originalOid = (await db.query("SELECT 'public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure::oid id")).rows[0].id
 await db.exec(fs.readFileSync('supabase/migrations/20261001125000_ediel_current_permission_clock_and_business_ack_status_read.sql','utf8'))
 check((await db.query("SELECT 'public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure::oid id")).rows[0].id, originalOid)
 check((await db.query("SELECT provolatile FROM pg_proc WHERE oid='public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure")).rows[0].provolatile,'v')
 for (const role of ['anon','authenticated']) check((await db.query("SELECT has_function_privilege($1,'public.ediel_read_business_ack_status_v1(uuid,uuid,uuid,text,text)','EXECUTE') ok",[role])).rows[0].ok,false)
 const read = async (company=id(2),environment='test') => {
  await db.exec('SET ROLE service_role')
  try { return (await db.query('SELECT public.ediel_read_business_ack_status_v1($1::uuid,$2::uuid,$3::uuid,NULL,$4) result',[id(3),id(1),company,environment])).rows[0].result }
  finally { await db.exec('RESET ROLE') }
 }
 await assert.rejects(read(),/reader_required/);checks++
 await db.exec(`INSERT INTO public.declared_positive_grants VALUES('${id(1)}','${id(2)}','communication.read')`)
 check((await read()).messages,[])
 const row = n => ({ id:id(n), company_id:id(2), environment:'test', direction:'outbound',message_family:'APERAK',related_message_id:id(3),status:'failed' })
 for (const [n,status] of [[4,'qualified'],[5,'qualified'],[6,'held']]) await db.query('INSERT INTO gridex_ack_authority.declared_originals VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb)',[id(n),id(3),'APERAK',status,JSON.stringify(row(n))])
 await db.exec(`INSERT INTO gridex_ediel_duplicate_responses.declared_consumed_ids VALUES('${id(5)}')`)
 check((await read()).messages.map(m=>m.id),[id(4)])
 check((await read()).heldOriginalIds,[id(6)])
 // Actual native ownership, rather than the mutable public relation, binds
 // the projection. No original row is rewritten by this status reader.
 await db.exec(`UPDATE gridex_ack_authority.declared_originals SET message=message||'{"related_message_id":null}' WHERE id='${id(4)}'`)
 check((await read()).messages[0].related_message_id,id(3))
 check((await db.query(`SELECT message->'related_message_id' relation FROM gridex_ack_authority.declared_originals WHERE id='${id(4)}'`)).rows[0].relation,null)
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${id(20)}','${id(2)}','test','outbound','PRODAT',NULL),('${id(21)}','${id(2)}','test','inbound','APERAK',NULL);
 INSERT INTO gridex_ack_authority.source_correlations VALUES('${id(21)}','${id(20)}','${id(2)}','test','APERAK','negative');`)
 const snapshot={id:id(20),company_id:id(2),environment:'test',direction:'outbound',aperak_status:'received'}
 await db.query('INSERT INTO gridex_ack_authority.applied_receipts VALUES($1,$2::jsonb,clock_timestamp())',[id(21),JSON.stringify({sourceMessage:snapshot,sourceAccepted:false,finalAckReached:true,wholeSourceRejected:false})])
 await db.exec('SET ROLE service_role')
 const outgoing=(await db.query('SELECT public.ediel_read_business_ack_status_v1($1,$2,$3,NULL,\'test\') result',[id(20),id(1),id(2)])).rows[0].result
 await db.exec('RESET ROLE')
 check(outgoing.sourceReceipt.sourceAccepted,false)
 check(outgoing.sourceSnapshot,snapshot)
 check(outgoing.messages[0].ack_outcome,'negative')
 check(outgoing.messages[0].related_message_id,id(20))
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${id(22)}','${id(2)}','test','inbound','CONTRL',NULL);
 INSERT INTO gridex_ack_authority.source_correlations VALUES('${id(22)}','${id(20)}','${id(2)}','test','CONTRL','positive');`)
 const later={...snapshot,contrl_status:'received'}
 await db.query("INSERT INTO gridex_ack_authority.applied_receipts VALUES($1,$2::jsonb,clock_timestamp()+interval '1 hour')",[id(22),JSON.stringify({sourceMessage:later,sourceAccepted:false,finalAckReached:true,wholeSourceRejected:false})])
 await db.exec('SET ROLE service_role')
 const filtered=(await db.query("SELECT public.ediel_read_business_ack_status_v1($1,$2,$3,'APERAK','test') result",[id(20),id(1),id(2)])).rows[0].result
 await db.exec('RESET ROLE')
 check(filtered.messages.map(m=>m.id),[id(21)])
 check(filtered.sourceSnapshot,later)
 check(filtered.sourceReceipt.ackMessageId,id(22))
 // No sequence exists for equal timestamps: conflicting latest snapshots
 // hold the aggregate rather than choosing a positive tie by UUID.
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${id(23)}','${id(2)}','test','inbound','APERAK',NULL);
 INSERT INTO gridex_ack_authority.source_correlations VALUES('${id(23)}','${id(20)}','${id(2)}','test','APERAK','positive');`)
 await db.query('INSERT INTO gridex_ack_authority.applied_receipts SELECT $1,$2::jsonb,captured_at FROM gridex_ack_authority.applied_receipts WHERE ack_message_id=$3',[id(23),JSON.stringify({sourceMessage:{...later,status:'acknowledged'},sourceAccepted:true,finalAckReached:true,wholeSourceRejected:false}),id(22)])
 await db.exec('SET ROLE service_role')
 const tied=(await db.query("SELECT public.ediel_read_business_ack_status_v1($1,$2,$3,NULL,'test') result",[id(20),id(1),id(2)])).rows[0].result
 await db.exec('RESET ROLE')
 check(tied.sourceSnapshot,null)
 check(tied.sourceReceipt,null)
 check(tied.heldOriginalIds,[id(23)])
 await assert.rejects(read(id(9)),/tenant_required/);checks++
 await assert.rejects(read(id(2),'production'),/source_required/);checks++
 await db.exec(`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour'`)
 await assert.rejects(read(),/reader_required/);checks++
 await db.exec('UPDATE auth.users SET banned_until=NULL')
 await db.exec(`INSERT INTO public.user_permission_overrides VALUES('${id(1)}','${id(2)}',true,'deny','communication.read',clock_timestamp()+interval '200 milliseconds',NULL);INSERT INTO gridex_ack_authority.declared_delay VALUES(100)`)
 // First guard is after one 100ms read; final guard follows three more reads.
 await assert.rejects(read(),/reader_required/);checks++
 await db.exec('DELETE FROM public.user_permission_overrides;DELETE FROM gridex_ack_authority.declared_delay')
 await db.exec("UPDATE public.permissions SET is_active=false WHERE key='communication.read'")
 await assert.rejects(read(),/reader_required/);checks++
 await db.exec(`INSERT INTO public.admin_users VALUES('${id(1)}',true,'super_admin')`)
 await assert.rejects(read(),/reader_required/);checks++
 await db.exec("UPDATE public.permissions SET is_active=true WHERE key='communication.read'")
 check((await read()).messages.map(m=>m.id),[id(4)])
 await db.exec('UPDATE public.user_profiles SET user_status=\'inactive\'')
 await assert.rejects(read(),/reader_required/);checks++
 console.log(`PASS ${checks} bounded current-reader/native-status mechanics; authentic concurrent/source evidence pending`)
} finally { await db.close() }
