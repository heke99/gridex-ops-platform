// Actual new PostgreSQL read owner + canonical table declarations/relations.
// Defaults for public references are a typed synthetic fixture boundary only.
// No native Auth/RLS/session/provider or ordinary-role exercise is performed.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')
const root = resolve(__dirname,'..')
const schema = readFileSync(resolve(root,'supabase/schema.sql'),'utf8')
const migration = readFileSync(resolve(root,'supabase/migrations/20261001114832_customer_registry_full_corpus_u07.sql'),'utf8')
const tables = ['customers','customer_sites','metering_points','customer_contracts','powers_of_attorney']
const tableSQL = tables.map(name => {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl,`actual canonical ${name} declaration required`)
  return ddl
}).join('\n')
const normalizers = ['email','phone','personal_number','org_number','facility_id','metering_point_id'].map(name => {
  const match = schema.match(new RegExp(`CREATE FUNCTION public\\.gridex_normalize_${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0]
  assert.ok(match,`actual canonical ${name} normalizer required`)
  return match
}).join('\n')
const constraints = [...schema.matchAll(/ALTER TABLE ONLY public\.([a-z_]+)\n\s+ADD CONSTRAINT [\s\S]*?;/g)]
  .filter(match => tables.includes(match[1]))
const keys = constraints.filter(match => / ADD CONSTRAINT \w+ (PRIMARY KEY|UNIQUE) /.test(match[0])).map(match => match[0]).join('\n')
const uniqueIndexes = [...schema.matchAll(/CREATE UNIQUE INDEX \w+ ON public\.([a-z_]+) [^;]+;/g)]
  .filter(match => tables.includes(match[1])).map(match => match[0]).join('\n')
const foreignKeys = constraints.filter(match => /FOREIGN KEY/.test(match[0]) &&
  new RegExp(`REFERENCES public\\.(?:${tables.join('|')}|companies)\\(`).test(match[0])).map(match => match[0]).join('\n')
const companyA='10000000-0000-4000-8000-000000000001'
const companyB='10000000-0000-4000-8000-000000000002'
const id=index=>`20000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`
const signature='public.gridex_customer_registry_page_v1(uuid,text,text,text,text,text,boolean,integer,integer)'

async function fixture(size=1) {
  const db=new PGlite()
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create table public.companies(id uuid primary key);
    create function public.gridex_new_public_resource_reference(text) returns text
      language sql volatile as 'select $1 || gen_random_uuid()::text';
    ${normalizers}\n${tableSQL}\n${keys}\n${uniqueIndexes}\n${foreignKeys}
    insert into public.companies values('${companyA}'),('${companyB}');
    insert into public.customers(id,company_id,first_name,last_name,full_name,customer_number,status,billing_profile_revision,created_at)
    select ('20000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'${companyA}',
      'Other',n::text,'Other '||n,'C-'||n,'active',3,'2026-09-01T00:00:00Z'::timestamptz+n*interval '1 second'
    from generate_series(1,${size}) n;
    ${migration}`)
  return db
}
async function read(db,options={}) {
  const input={company:companyA,query:'',status:'all',contract:'all',type:'all',flag:'all',exclude:false,page:1,size:100,...options}
  return (await db.query(`select public.gridex_customer_registry_page_v1($1::uuid,$2,$3,$4,$5,$6,$7,$8::integer,$9::integer) as result`,
    [input.company,input.query,input.status,input.contract,input.type,input.flag,input.exclude,input.page,input.size])).rows[0].result
}
async function withDB(size,fn) { const db=await fixture(size);try{await fn(db)}finally{await db.close()} }

test('actual complete customer corpus finds oldest literal value and continues full eleven-page counts',async()=>withDB(1001,async db=>{
  await db.exec(`update public.customers set customer_number='OLD-EXACT' where id='${id(1)}'`)
  let result=await read(db,{query:'old-exact'})
  assert.deepEqual(result.rows.map(row=>row.id),[id(1)])
  assert.equal(result.total,1);assert.equal(result.counts.all,1)
  await db.exec(`update public.customers set full_name='Shared corpus'`)
  result=await read(db,{query:'Shared corpus',page:11})
  assert.deepEqual(result.rows.map(row=>row.id),[id(1)])
  assert.equal(result.total,1001);assert.equal(result.totalPages,11);assert.equal(result.counts.active,1001)
  const offEnd=await read(db,{query:'Shared corpus',page:12})
  assert.deepEqual(offEnd.rows,[]);assert.equal(offEnd.total,1001)
}))

test('complete stored site and contract relations exceed1000 without lost flags or invented no-contract',async()=>withDB(2,async db=>{
  await db.exec(`insert into public.customer_sites(id,company_id,customer_id,status,grid_owner_id)
    select ('20000000-0000-4000-8000-'||lpad(to_hex(10000+n),12,'0'))::uuid,'${companyA}','${id(2)}','active','${id(4000)}'
      from generate_series(1,1000) n;
    insert into public.customer_sites(id,company_id,customer_id,status,grid_owner_id) values
      ('${id(12001)}','${companyA}','${id(1)}','active','${id(4000)}'),('${id(12002)}','${companyA}','${id(1)}','active','${id(4000)}');
    insert into public.customer_contracts(id,company_id,customer_id,status)
    select ('20000000-0000-4000-8000-'||lpad(to_hex(20000+n),12,'0'))::uuid,'${companyA}','${id(2)}','draft'
      from generate_series(1,1001) n;
    insert into public.customer_contracts(id,company_id,customer_id,status) values('${id(22002)}','${companyA}','${id(1)}','draft');`)
  const sites=await read(db,{flag:'multi_site'})
  assert.deepEqual(sites.rows.map(row=>[row.id,row.site_count]),[[id(2),1000],[id(1),2]])
  assert.equal(sites.total,2)
  const noContract=await read(db,{contract:'none'})
  assert.deepEqual(noContract.rows,[]);assert.equal(noContract.total,0);assert.equal(noContract.counts.all,2)
}))

test('query/type/flag chip universe precedes selected status and contract; oldest facts still participate',async()=>withDB(1001,async db=>{
  await db.exec(`update public.customers set customer_type='business',full_name='Count scope',status='blocked' where id='${id(1)}';
    update public.customers set customer_type='business',full_name='Count scope' where id='${id(1001)}';
    insert into public.customer_sites(company_id,customer_id,status,grid_owner_id)
    select '${companyA}',c.id,'active','${id(4000)}' from public.customers c cross join generate_series(1,2)
      where c.id in ('${id(1)}','${id(1001)}');`)
  const result=await read(db,{query:'Count scope',type:'business',flag:'multi_site',status:'active',contract:'none'})
  assert.deepEqual(result.rows.map(row=>row.id),[id(1001)])
  assert.equal(result.total,1);assert.equal(result.counts.all,2);assert.equal(result.counts.active,1);assert.equal(result.counts.blocked,1)
}))

test('latest contract state and UUID ties are resolved before page and exact totals',async()=>withDB(3,async db=>{
  await db.exec(`update public.customers set created_at='2026-09-01T00:00:00.123456Z';
    insert into public.customer_contracts(id,company_id,customer_id,status,created_at) values
      ('${id(30001)}','${companyA}','${id(1)}','signed','2026-09-20T00:00:00Z'),
      ('${id(30002)}','${companyA}','${id(2)}','active','2026-09-20T00:00:00Z'),
      ('${id(30003)}','${companyA}','${id(3)}','signed','2026-09-20T00:00:00Z'),
      ('${id(30004)}','${companyA}','${id(3)}','terminated','2026-09-20T00:00:00Z');`)
  const signed=await read(db,{contract:'signed',size:1})
  assert.deepEqual(signed.rows.map(row=>row.id),[id(1)]);assert.equal(signed.total,1);assert.equal(signed.counts.all,3)
  const closed=await read(db,{contract:'closed',size:1})
  assert.deepEqual(closed.rows.map(row=>row.id),[id(3)])
  const first=await read(db,{query:'Other',size:1})
  const second=await read(db,{query:'Other',size:1,page:2})
  assert.deepEqual(first.rows.map(row=>row.id),[id(3)]);assert.deepEqual(second.rows.map(row=>row.id),[id(2)])
}))

test('literal punctuation and separate fields keep their actual text semantics',async()=>withDB(3,async db=>{
  await db.query(`update public.customers set full_name=$1 where id=$2`,["literal_%(,).'value",id(1)])
  await db.exec(`update public.customers set full_name='literalX-any-value' where id='${id(2)}';
    update public.customers set full_name='Alpha',company_name='Beta' where id='${id(3)}';`)
  assert.deepEqual((await read(db,{query:"_%(,).'"})).rows.map(row=>row.id),[id(1)])
  assert.deepEqual((await read(db,{query:'Alpha Beta'})).rows,[])
}))

test('legitimate foreign graph and null-company floor do not create facts; null point owner uses exact own site',async()=>withDB(1,async db=>{
  await db.exec(`insert into public.customers(id,company_id,full_name,status) values('${id(2)}','${companyB}','Foreign','active'),('${id(3)}',null,'Null company','active');
    insert into public.customer_sites(id,company_id,customer_id,status,grid_owner_id) values
      ('${id(40001)}','${companyA}','${id(1)}','active','${id(4000)}'),('${id(40002)}','${companyB}','${id(2)}','active','${id(4000)}');
    insert into public.metering_points(id,company_id,customer_id,site_id,status) values
      ('${id(40003)}','${companyA}',null,'${id(40001)}','active'),('${id(40004)}','${companyB}','${id(2)}','${id(40002)}','active');
    insert into public.customer_contracts(id,company_id,customer_id,status) values('${id(40005)}','${companyA}','${id(1)}','draft');
    insert into public.powers_of_attorney(company_id,customer_id,site_id,metering_point_id,contract_id,status)
      values('${companyA}','${id(1)}','${id(40001)}','${id(40003)}','${id(40005)}','signed');`)
  const result=await read(db,{flag:'ready_for_switch'})
  assert.deepEqual(result.rows.map(row=>row.id),[id(1)]);assert.equal(result.rows[0].metering_point_count,1)
  assert.equal((await read(db,{company:null})).total,2)
  assert.equal(result.rows[0].possible_duplicate,null);assert.equal(result.rows[0].consolidated_invoice,null)
}))

test('both legitimate nullable point aliases are discovered before a searched owner graph is qualified',async()=>withDB(2,async db=>{
  await db.exec(`update public.customers set full_name='Alpha selected' where id='${id(1)}';
    insert into public.customer_sites(id,company_id,customer_id,status) values
      ('${id(50001)}','${companyA}','${id(1)}','active'),('${id(50002)}','${companyA}','${id(2)}','active');
    insert into public.metering_points(company_id,customer_id,site_id,customer_site_id,status)
      values('${companyA}',null,'${id(50002)}','${id(50001)}','active');`)
  // Actual canonical MATCH SIMPLE FKs admit null customer_id and both valid
  // same-company site references. The read policy must hold conflicting aliases.
  await assert.rejects(read(db,{query:'Alpha selected'}),error=>error.code==='55000')
}))

test('unsupported facts and malformed parameters are explicit errors, never successful empty results',async()=>withDB(1,async db=>{
  for(const flag of ['possible_duplicate','consolidated_invoice']) await assert.rejects(read(db,{flag}),error=>error.code==='55000')
  for(const options of [{page:0},{size:101},{status:'unknown'},{type:'unknown'},{contract:'unknown'},{flag:'unknown'}]) {
    await assert.rejects(read(db,options),error=>error.code==='22023')
  }
}))

test('complete point and authorization relations exceed1000 without losing the last customer facts',async()=>withDB(2,async db=>{
  await db.exec(`insert into public.customer_sites(id,company_id,customer_id,status,grid_owner_id) values
      ('${id(60001)}','${companyA}','${id(1)}','active','${id(4000)}'),('${id(60002)}','${companyA}','${id(2)}','active','${id(4000)}');
    insert into public.metering_points(company_id,customer_id,site_id,status)
      select '${companyA}','${id(2)}','${id(60002)}','active' from generate_series(1,1001);
    insert into public.metering_points(company_id,customer_id,site_id,status) values('${companyA}',null,'${id(60001)}','active');
    insert into public.powers_of_attorney(company_id,customer_id,status)
      select '${companyA}','${id(2)}','draft' from generate_series(1,1001);
    insert into public.powers_of_attorney(company_id,customer_id,status) values('${companyA}','${id(1)}','signed');`)
  const all=await read(db)
  assert.deepEqual(all.rows.map(row=>[row.id,row.metering_point_count,row.has_signed_power_of_attorney]),[[id(2),1001,false],[id(1),1,true]])
  const ready=await read(db,{flag:'ready_for_switch'})
  assert.deepEqual(ready.rows.map(row=>row.id),[id(1)]);assert.equal(ready.counts.all,1)
}))

test('legitimate owned contract alias disagreement is unavailable rather than a no-contract or signed fact',async()=>withDB(1,async db=>{
  await db.exec(`insert into public.customer_sites(id,company_id,customer_id,status) values
      ('${id(61001)}','${companyA}','${id(1)}','active'),('${id(61002)}','${companyA}','${id(1)}','active');
    insert into public.customer_contracts(company_id,customer_id,site_id,customer_site_id,status)
      values('${companyA}','${id(1)}','${id(61001)}','${id(61002)}','signed');`)
  await assert.rejects(read(db,{contract:'none'}),error=>error.code==='55000')
  await assert.rejects(read(db,{contract:'signed'}),error=>error.code==='55000')
}))

test('hidden/test/archive predicates retain actual count and output universes',async()=>withDB(5,async db=>{
  await db.exec(`update public.customers set full_name='Visible';
    update public.customers set is_test_data=true where id='${id(2)}';
    update public.customers set source='ediel_portal_test' where id='${id(3)}';
    update public.customers set source='other_test' where id='${id(4)}';
    update public.customers set status='archived' where id='${id(5)}';`)
  assert.deepEqual((await read(db,{query:'Visible',exclude:true})).rows.map(row=>row.id),[id(1)])
  assert.deepEqual((await read(db,{query:'Visible',status:'archived',exclude:true})).rows.map(row=>row.id),[id(5)])
  assert.deepEqual((await read(db,{query:'Visible',flag:'test_customers',exclude:true})).rows.map(row=>row.id),[id(4),id(2)])
}))

test('read-only catalog/data and service-only declared execution remain unchanged by complete reads',async()=>withDB(1001,async db=>{
  const snapshot=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${tables.map(table=>`'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.${table} t)`).join(',')}) as value`)).rows)
  const before=await snapshot()
  const catalog=(await db.query(`select p.provolatile,p.prosecdef,p.proconfig,
    has_function_privilege('service_role','${signature}','EXECUTE') as service,
    has_function_privilege('anon','${signature}','EXECUTE') as anon,
    has_function_privilege('authenticated','${signature}','EXECUTE') as ordinary
    from pg_proc p where p.oid='${signature}'::regprocedure`)).rows[0]
  assert.equal(catalog.provolatile,'s');assert.equal(catalog.prosecdef,false)
  assert.deepEqual(catalog.proconfig,['search_path=pg_catalog, public'])
  assert.equal(catalog.service,true);assert.equal(catalog.anon,false);assert.equal(catalog.ordinary,false)
  const result=await read(db,{query:'Other',size:100});assert.equal(result.rows.length,100);assert.equal(result.total,1001)
  assert.equal(await snapshot(),before)
}))
