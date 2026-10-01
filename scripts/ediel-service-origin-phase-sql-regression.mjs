// Actual owner-local four-argument getter and unchanged three-argument SEND
// body. Current service-original qualification is an explicitly synthetic IO
// port here; no native replay, RLS, authentic source approval or activation.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
const check=(a,b)=>{assert.deepEqual(a,b);checks++}
const actual=readFileSync(new URL('../supabase/migrations/20261001062832_ediel_service_origin_recovery_execution_phase.sql',import.meta.url),'utf8')
const old=readFileSync(new URL('../supabase/migrations/20260930220932_ediel_source_read_send_permission_contract.sql',import.meta.url),'utf8')
const start=old.indexOf('CREATE OR REPLACE FUNCTION public.ediel_service_permission_message_basis_v1('),end=old.indexOf('END $$;',start)
const service=async(sql,params=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,params)}finally{await db.exec('RESET ROLE')}}
const read=(phase='prepare',actor=id(2),company=id(1),message=id(10))=>service('SELECT public.ediel_service_permission_message_basis_v1($1,$2,$3,$4) b',[company,message,actor,phase]).then(r=>r.rows[0].b)
const rejects=async(fn,expected)=>{await assert.rejects(fn,expected);checks++}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_service_permission;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,message_family text,message_code text,environment text,intent_id uuid);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE gridex_service_permission.origins(company_id uuid,message_id uuid UNIQUE,intent_id uuid,actor_user_id uuid,basis jsonb);
 CREATE TABLE public.permission_fixture(actor_id uuid,company_id uuid,permission text,PRIMARY KEY(actor_id,company_id,permission));
 CREATE TABLE public.source_current_fixture(company_id uuid,message_id uuid,current_basis bool);
 CREATE FUNCTION public.gridex_actor_has_company_permission(actor uuid,c uuid,p text)RETURNS bool LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT FROM public.permission_fixture WHERE actor_id=actor AND company_id=c AND permission=p)$$;
 CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(c uuid,m uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF NOT EXISTS(SELECT FROM public.source_current_fixture WHERE company_id=c AND message_id=m AND current_basis) THEN RAISE EXCEPTION 'DECLARED_CURRENT_SOURCE_HELD';END IF;END$$;
 CREATE FUNCTION gridex_service_permission.require_original_source_current_v1(c uuid,m uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM public.ediel_require_service_permission_origin_current_v1(c,m);END$$;
 REVOKE ALL ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`)
 await db.exec(old.slice(start,end+7))
 await db.exec('REVOKE ALL ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) TO service_role;')
 await db.exec(actual.slice(actual.indexOf('CREATE FUNCTION public.ediel_service_permission_message_basis_v1('),actual.lastIndexOf('COMMIT;')))
 await db.query("INSERT INTO user_profiles VALUES($1,'active'),($2,'inactive'),($3,'active'),($4,'active')",[id(2),id(3),id(4),id(5)])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now()),($1,$3,'active',true,now()),($1,$4,'active',true,now()),($1,$5,'active',true,now())",[id(1),id(2),id(3),id(4),id(5)])
 await db.query("INSERT INTO permission_fixture VALUES($1,$4,'communication.write'),($2,$4,'ediel.send'),($3,$4,'ediel_testing.write')",[id(2),id(4),id(5),id(1)])
 const basis={status:'authorized',companyId:id(1),code:'Z13',environment:'test',scopeBasisVersion:1}
 await db.query("INSERT INTO ediel_messages VALUES($1,$2,'outbound','PRODAT','Z13','test',$3),($4,$2,'outbound','PRODAT','Z13','test',$5)",[id(10),id(1),id(20),id(11),id(21)])
 await db.query('INSERT INTO gridex_service_permission.origins VALUES($1,$2,$3,$4,$5)',[id(1),id(10),id(20),id(3),basis])
 await db.query('INSERT INTO source_current_fixture VALUES($1,$2,true)',[id(1),id(10)])
 const before=JSON.stringify((await db.query('SELECT * FROM gridex_service_permission.origins')).rows)
 check(await read(),{basis,actorUserId:id(3),intentId:id(20)}) // inactive preparer is provenance only
 check(await read('send',id(4)),{basis,actorUserId:id(3),intentId:id(20)})
 await rejects(()=>read('send'),/forbidden/);await rejects(()=>read('prepare',id(4)),/forbidden/)
 await rejects(()=>read('prepare',id(5)),/forbidden/) // testing alone cannot create real service authority
 await rejects(()=>read('prepare',id(3)),/forbidden/)
 await rejects(()=>read(null),/phase_required/);await rejects(()=>read('forged'),/phase_required/)
 await rejects(()=>read('prepare',id(2),id(99)),/forbidden/)
 await rejects(()=>read('prepare',id(2),id(1),id(99)),/not_owned/)
 check(await read('prepare',id(2),id(1),id(11)),null) // actual no-service binding, not a parsed claim
 await db.exec("UPDATE source_current_fixture SET current_basis=false")
 await rejects(()=>read(),/DECLARED_CURRENT_SOURCE_HELD/)
 await db.exec("UPDATE source_current_fixture SET current_basis=true;UPDATE company_memberships SET accepted_at=NULL WHERE user_id='"+id(2)+"'")
 await rejects(()=>read(),/forbidden/)
 await db.query('UPDATE company_memberships SET accepted_at=now() WHERE user_id=$1',[id(2)])
 await db.query('UPDATE gridex_service_permission.origins SET intent_id=$1',[id(99)])
 await rejects(()=>read(),/basis_changed/)
 await db.query('UPDATE gridex_service_permission.origins SET intent_id=$1',[id(20)])
 await rejects(()=>service('SELECT public.ediel_service_permission_message_basis_v1($1,$2,$3)',[id(1),id(10),id(2)]),/forbidden/) // old three-arg remains SEND-only
 check((await service('SELECT public.ediel_service_permission_message_basis_v1($1,$2,$3) b',[id(1),id(10),id(4)])).rows[0].b,{basis,actorUserId:id(3),intentId:id(20)})
 await db.query('DELETE FROM permission_fixture WHERE actor_id=$1',[id(4)])
 await db.query("INSERT INTO permission_fixture VALUES($1,$2,'communication.send')",[id(4),id(1)])
 check((await read('send',id(4))).intentId,id(20))
 check(JSON.stringify((await db.query('SELECT * FROM gridex_service_permission.origins')).rows),before)
 check((await db.query("SELECT has_function_privilege('anon','public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid,text)','EXECUTE') b")).rows[0].b,false)
 check((await db.query("SELECT has_function_privilege('authenticated','public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid,text)','EXECUTE') b")).rows[0].b,false)
 check((await db.query("SELECT has_function_privilege('service_role','public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid,text)','EXECUTE') b")).rows[0].b,true)
 console.log(`${checks} actual service origin phase/ACL/read-only SQL mechanics passed; current source port is declared synthetic, native/authentic acceptance not run`)
}finally{await db.close()}
