import { readFileSync } from 'node:fs';
import { PGlite } from '../../../../node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid $$;
 CREATE TABLE companies(id uuid PRIMARY KEY,customer_number_prefix text,slug text,name text,metadata jsonb);
 CREATE TABLE customers(id uuid,company_id uuid,customer_number text,personal_number text,email text,status text,metadata jsonb,updated_at timestamptz,updated_by uuid);
 CREATE TABLE company_customer_number_sequences(company_id uuid PRIMARY KEY,prefix text,next_number bigint,updated_at timestamptz);
 ALTER TABLE customers ENABLE ROW LEVEL SECURITY; ALTER TABLE company_customer_number_sequences ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON customers TO authenticated; GRANT SELECT ON company_customer_number_sequences TO authenticated;
 INSERT INTO companies VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','VICTIM','victim','Synthetic victim','{}');
 INSERT INTO customers VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','VICTIM-100001',NULL,'victim@example.invalid','active','{}',now(),NULL);`);
 for(const sql of JSON.parse(readFileSync(new URL('./database-acl-inputs.json', import.meta.url),'utf8'))) await db.exec(sql);
 await db.exec(`REVOKE ALL ON FUNCTION public.gridex_next_customer_number(uuid) FROM PUBLIC;
 GRANT ALL ON FUNCTION public.gridex_next_customer_number(uuid) TO authenticated;
 REVOKE ALL ON FUNCTION public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) FROM PUBLIC;
 GRANT ALL ON FUNCTION public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) TO authenticated;
 -- Apply exact later convergence ACL statements after existing authenticated grants.
 REVOKE EXECUTE ON FUNCTION public.gridex_next_customer_number(uuid) FROM PUBLIC;
 REVOKE EXECUTE ON FUNCTION public.gridex_next_customer_number(uuid) FROM anon;
 GRANT EXECUTE ON FUNCTION public.gridex_next_customer_number(uuid) TO service_role;
 REVOKE EXECUTE ON FUNCTION public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) FROM PUBLIC;
 REVOKE EXECUTE ON FUNCTION public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) FROM anon;
 GRANT EXECUTE ON FUNCTION public.gridex_db4b_archive_customer_registry_row(text,text,boolean,text) TO service_role;
 SET ROLE authenticated;`);
 const hidden=(await db.query('SELECT count(*)::int AS count FROM customers')).rows;
 const count=(await db.query(`SELECT public.gridex_db4b_archive_customer_registry_row(NULL,'victim@example.invalid',false) AS result`)).rows;
 const reserved=(await db.query(`SELECT public.gridex_next_customer_number('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') AS reserved`)).rows;
 await db.exec('RESET ROLE');
 const state=(await db.query('SELECT next_number FROM company_customer_number_sequences')).rows;
 console.log(JSON.stringify({hidden,count,reserved,state}));
 if(hidden[0].count!==0||count[0].result.matched_customers!==1||reserved[0].reserved!=='VICTIM-100002'||Number(state[0].next_number)!==100003) throw Error('Unexpected probe result');
} finally { await db.close(); }
