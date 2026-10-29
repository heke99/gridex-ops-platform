// SQL component ports only: synthetic PGlite, no hosted/native/provider credit.
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterEach,beforeEach,expect,it} from 'vitest'

const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const contract='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const request='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
let db:PGlite
let unfencedCallbacks:number
beforeEach(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 GRANT USAGE ON SCHEMA auth TO service_role;GRANT EXECUTE ON FUNCTION auth.role() TO service_role;
 CREATE TABLE public.companies(id uuid PRIMARY KEY);
 CREATE TABLE public.customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,signed_at timestamptz,signature_snapshot jsonb,document_sha256 text);
 CREATE TABLE public.customer_contract_signature_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,customer_contract_id uuid,used_at timestamptz);
 CREATE FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 INSERT INTO companies VALUES('${company}');
 INSERT INTO customer_contracts VALUES('${contract}','${company}','${customer}','signed',now(),jsonb_build_object('schema','gridex_online_contract_signature_v2','company_id','${company}','customer_id','${customer}','contract_id','${contract}','signature_request_id','${request}'),'${'a'.repeat(64)}');
 INSERT INTO customer_contract_signature_requests VALUES('${request}','${company}','${customer}','${contract}',now());`)
 await db.exec(readFileSync('supabase/migrations/20261009100000_ops_api_contract_confirmation_delivery_continuation.sql','utf8'))
 // Use the actual tenant-scoped key migration, not the superseded global
 // request key. The real native catalog exposed this missing fixture step.
 await db.exec(`CREATE TABLE public.platform_table_classification(table_name text PRIMARY KEY,kind text,rationale text,classified_by text)`)
 await db.exec(readFileSync('supabase/migrations/20261009220000_classify_contract_confirmation_deliveries.sql','utf8'))
 await db.exec(`INSERT INTO customer_contract_confirmation_deliveries(company_id,customer_contract_id,signature_request_id) VALUES('${company}','${contract}','${request}')`)
 await db.exec(`GRANT SELECT ON customer_contracts,customer_contract_signature_requests TO service_role;SET request.jwt.claim.role='service_role';SET ROLE service_role;`)
 // Execute the unfenced original old worker against the same fixture with
 // actual service BYPASSRLS. This is a counterexample, not a native claim.
 const old=await db.query(`UPDATE customer_contract_confirmation_deliveries SET next_attempt_at=clock_timestamp()+interval '10 minutes' WHERE signature_request_id='${request}' AND state='pending' AND next_attempt_at<=clock_timestamp() RETURNING id`)
 unfencedCallbacks=old.rows.length
 await db.exec(`RESET ROLE;UPDATE customer_contract_confirmation_deliveries SET next_attempt_at=now()-interval '1 second';`)
 const migration=readFileSync('supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql','utf8')
 const marker='-- Permanent confirmation runtime version fence.'
 if(migration.includes(marker))await db.exec(migration.slice(migration.indexOf(marker)))
 await db.exec(`SET ROLE service_role;`)
})
afterEach(async()=>{await db.close()})
async function advance(action:string,lease:string|null=null,hash:string|null=null,companyId=company){
 const r=await db.query<{result:{claimed?:boolean;advanced?:boolean;state:string;lease_until?:string;attempts:number}}>(
  'SELECT public.gridex_advance_contract_confirmation_v2($1::uuid,$2::uuid,$3::uuid,$4::text,$5::timestamptz,$6::text,$7::text) AS result',
  [companyId,contract,request,action,lease,hash,'synthetic failure'])
 return r.rows[0].result
}
it('blocks the old direct claim before any delivery callback, including a V2 receipt with no POA join',async()=>{
 expect(unfencedCallbacks).toBe(1)
 let callbacks=0
 try{await db.exec(`UPDATE customer_contract_confirmation_deliveries SET next_attempt_at=now()+interval '10 minutes' WHERE signature_request_id='${request}' AND state='pending' AND next_attempt_at<=now()`);callbacks++}catch(error){expect(String(error)).toContain('confirmation_v2_runtime_required')}
 expect(callbacks).toBe(0)
 await expect(db.exec(`UPDATE customer_contract_confirmation_deliveries SET attempts=attempts+1 WHERE signature_request_id='${request}'`)).rejects.toThrow('confirmation_v2_runtime_required')
})
it('does not authorize a direct update from the marker alone or from postgres without the scoped marker',async()=>{
 await db.exec(`SELECT set_config('gridex.confirmation_advance',jsonb_build_array(id,company_id,customer_contract_id,signature_request_id,'claim')::text,false) FROM customer_contract_confirmation_deliveries`)
 await expect(db.exec('UPDATE customer_contract_confirmation_deliveries SET attempts=1')).rejects.toThrow('confirmation_v2_runtime_required')
 await db.exec("SELECT set_config('gridex.confirmation_advance','',false);RESET ROLE")
 await expect(db.exec('UPDATE customer_contract_confirmation_deliveries SET attempts=1')).rejects.toThrow('confirmation_v2_runtime_required')
})
it('allows the genuine old V1 direct claim but refuses identity rebinding',async()=>{
 await db.exec(`RESET ROLE;UPDATE customer_contracts SET signature_snapshot=jsonb_set(signature_snapshot,'{schema}','"gridex_online_contract_signature_v1"');SET ROLE service_role;`)
 await db.exec(`UPDATE customer_contract_confirmation_deliveries SET next_attempt_at=now()+interval '10 minutes' WHERE signature_request_id='${request}'`)
 await expect(db.exec(`UPDATE customer_contract_confirmation_deliveries SET customer_contract_id=gen_random_uuid() WHERE signature_request_id='${request}'`)).rejects.toThrow('confirmation_binding_immutable')
 await db.exec(`UPDATE customer_contract_confirmation_deliveries SET next_attempt_at=now()-interval '1 second' WHERE signature_request_id='${request}'`)
 const legacy=await advance('claim');expect(legacy).toMatchObject({claimed:true,state:'pending',attempts:0})
 expect(await advance('queued',legacy.lease_until,'a'.repeat(64))).toMatchObject({advanced:true,state:'queued',attempts:1})
})
it('claims once and completes only the exact raw lease and archived hash; restores scoped authority',async()=>{
 const claim=await advance('claim');expect(claim).toMatchObject({claimed:true,state:'pending',attempts:0});expect(claim.lease_until).toEqual(expect.any(String))
 expect(await advance('claim')).toMatchObject({claimed:false,state:'pending'})
 expect(await advance('queued',null,'a'.repeat(64))).toMatchObject({advanced:false,state:'pending'})
 expect(await advance('queued','2000-01-01T00:00:00.000001Z','a'.repeat(64))).toMatchObject({advanced:false,state:'pending'})
 await expect(advance('queued',claim.lease_until,'b'.repeat(64))).rejects.toThrow('confirmation_document_hash_mismatch')
 expect(await advance('queued',claim.lease_until,'a'.repeat(64))).toMatchObject({advanced:true,state:'queued',attempts:1})
 expect(await advance('failed',claim.lease_until)).toMatchObject({advanced:false,state:'queued'})
 await expect(db.exec(`UPDATE customer_contract_confirmation_deliveries SET last_error='legacy takeover' WHERE signature_request_id='${request}'`)).rejects.toThrow('confirmation_v2_runtime_required')
 const marker=await db.query<{value:string}>("SELECT coalesce(current_setting('gridex.confirmation_advance',true),'') AS value");expect(marker.rows[0].value).toBe('')
})
it('rejects wrong tenant and damaged continuation without classifying it as legacy',async()=>{
 await expect(advance('claim',null,null,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).rejects.toThrow('confirmation_binding_invalid')
 await db.exec(`RESET ROLE;ALTER TABLE customer_contract_confirmation_deliveries DISABLE TRIGGER customer_contract_confirmation_runtime_guard_tg;UPDATE customer_contract_confirmation_deliveries SET customer_contract_id=gen_random_uuid();ALTER TABLE customer_contract_confirmation_deliveries ENABLE TRIGGER customer_contract_confirmation_runtime_guard_tg;SET ROLE service_role;`)
 await expect(advance('claim')).rejects.toThrow('confirmation_binding_invalid')
 await expect(db.exec('UPDATE customer_contract_confirmation_deliveries SET attempts=1')).rejects.toThrow('confirmation_binding_invalid')
})
it('claims only its company when the same request appears in an invalid foreign continuation',async()=>{
 const other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
 await db.exec(`RESET ROLE;INSERT INTO companies VALUES('${other}');
 INSERT INTO customer_contract_confirmation_deliveries(company_id,customer_contract_id,signature_request_id)
 VALUES('${other}','${contract}','${request}');SET ROLE service_role;`)
 const claim=await advance('claim');expect(claim).toMatchObject({claimed:true,attempts:0})
 await expect(advance('claim',null,null,other)).rejects.toThrow('confirmation_binding_invalid')
 const rows=await db.query<{company:string;attempts:number;leased:boolean}>(`SELECT company_id::text AS company,attempts,next_attempt_at>now()+interval '5 minutes' AS leased
 FROM customer_contract_confirmation_deliveries ORDER BY company_id`)
 expect(rows.rows).toEqual([{company,attempts:0,leased:true},{company:other,attempts:0,leased:false}])
})
it('computes retry limits from locked attempts and denies anon/authenticated RPC execution',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`RESET ROLE;SET request.jwt.claim.role='${role}';SET ROLE ${role}`)
  await expect(advance('claim')).rejects.toThrow('permission denied')
 }
 await db.exec("RESET ROLE;SET request.jwt.claim.role='service_role';SET ROLE service_role")
 const claim=await advance('claim');expect(await advance('failed',claim.lease_until)).toMatchObject({advanced:true,state:'pending',attempts:1})
 const retry=await db.query<{seconds:number}>('SELECT extract(epoch from next_attempt_at-updated_at)::float8 AS seconds FROM customer_contract_confirmation_deliveries');expect(retry.rows[0].seconds).toBe(300)
 await db.exec(`RESET ROLE;ALTER TABLE customer_contract_confirmation_deliveries DISABLE TRIGGER customer_contract_confirmation_runtime_guard_tg;UPDATE customer_contract_confirmation_deliveries SET attempts=7,next_attempt_at=now()-interval '1 second';ALTER TABLE customer_contract_confirmation_deliveries ENABLE TRIGGER customer_contract_confirmation_runtime_guard_tg;SET ROLE service_role`)
 const last=await advance('claim');expect(await advance('failed',last.lease_until)).toMatchObject({advanced:true,state:'failed',attempts:8})
 expect(await advance('claim')).toMatchObject({claimed:false,state:'failed'})
})
