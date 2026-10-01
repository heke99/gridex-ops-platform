/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL business proof. */
// Actual Action/new writer/projector; Auth and candidate reads are controlled.
// Exact canonical claim/account/event DDL, small typed parents, one real INSERT.
// No Auth/role/RLS/native/provider or complete production schema qualification.
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {resolve,dirname,relative} = require('node:path')
const ts = require('typescript')
const {PGlite} = require('@electric-sql/pglite')
const root=resolve(__dirname,'..'),schema=readFileSync(resolve(root,'supabase/schema.sql'),'utf8')
const id=n=>`ac100000-0000-4000-8000-${String(n).padStart(12,'0')}`
function table(name){
  const ddl=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl,'missing_canonical_ddl');return ddl
}
function constraint(name){
  const ddl=schema.match(new RegExp(`ALTER TABLE ONLY public\\.customer_portal_claims\\n    ADD CONSTRAINT ${name} [^;]+;`))?.[0]
  assert.ok(ddl,'missing_canonical_claim_constraint');return ddl
}
function modules(service){
  const cache=new Map()
  const load=path=>{
    if(cache.has(path))return cache.get(path)
    const exports={};cache.set(path,exports)
    const output=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
    const dependency=name=>{
      if(name==='server-only')return require('next/dist/compiled/server-only/empty.js')
      if(name==='@/lib/supabase/service')return{supabaseService:service}
      if(name==='@/lib/supabase/server')return{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:id(3),email:'attempt@example.invalid'}},error:null})}})}
      if(name==='next/cache')return{revalidatePath:()=>undefined}
      if(name==='@/lib/customer-portal/accountCompletion')return{AccountCompletionError:class extends Error{},completeNativePortalAccount:()=>{throw new Error('positive_completion_outside_attempt_proof')}}
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts')
      if(name.startsWith('.'))return load(relative(root,resolve(root,dirname(path),name+'.ts')))
      return require(name)
    }
    new Function('require','exports',output)(dependency,exports);return exports
  }
  return{action:load('lib/customer-portal/claim.ts').claimPortalCustomerAction,project:load('lib/customer-portal/adminProjection.ts').projectAdminPortalClaim}
}
async function fixture(){
  const db=new PGlite(),writes=[],errors=[]
  try{
    await db.exec(`create table public.companies(id uuid primary key);
      create table public.customers(id uuid primary key,company_id uuid not null references public.companies(id),unique(id,company_id));`)
    for(const name of ['customer_portal_claims','customer_portal_accounts','customer_portal_events'])await db.exec(table(name))
    for(const name of ['customer_portal_claims_pkey','customer_portal_claims_company_id_fkey','customer_portal_claims_customer_company_fk'])await db.exec(constraint(name))
    await db.exec(`insert into public.companies values('${id(1)}'),('${id(11)}');
      insert into public.customers values('${id(2)}','${id(1)}'),('${id(12)}','${id(11)}');
      insert into public.customer_portal_claims(id,company_id,customer_id,user_id,status,metadata)
      values('${id(20)}','${id(1)}','${id(2)}','${id(3)}','pending','{"historicalOpaque":true}'),
        ('${id(21)}','${id(11)}','${id(12)}','${id(13)}','approved','{"historicalOpaque":true}');
      insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,role,verified_identity_snapshot)
      values('${id(30)}','${id(1)}','${id(2)}','${id(3)}','billing','{"savedBefore":true}'),
        ('${id(31)}','${id(11)}','${id(12)}','${id(13)}','viewer','{"quietBefore":true}');
      insert into public.customer_portal_events(id,company_id,customer_id,user_id,event_type,payload)
      values('${id(40)}','${id(1)}','${id(2)}','${id(3)}','historical_event','{"original":true}'),
        ('${id(41)}','${id(11)}','${id(12)}','${id(13)}','quiet_event','{"quiet":true}');`)
    const candidate=(n,company)=>({id:id(n),company_id:id(company),customer_type:'private',first_name:'Wrong',last_name:'Name',full_name:'Wrong Name',
      email:'attempt@example.invalid',personal_number:'199001011234',customer_number:`SYN-${n}`,profile_revision:1,contact_revision:1})
    const readRows={companies:[{id:id(1),slug:'attempt-a'},{id:id(11),slug:'attempt-b'}],customers:[candidate(2,1),candidate(12,11)],customer_contacts:[],
      customer_sites:[{id:id(5),company_id:id(1),customer_id:id(2),facility_id:'735999000000001'},{id:id(15),company_id:id(11),customer_id:id(12),facility_id:'735999000000001'}],metering_points:[]}
    const service={from(name){
      const filters=[];let inserted=null,max=Infinity,columns='*',result
      const execute=async()=>{
        if(result)return result
        if(inserted){
          assert.equal(name,'customer_portal_claims','unexpected_other_write')
          const rows=Array.isArray(inserted)?inserted:[inserted],keys=Object.keys(rows[0]),args=[]
          assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)))
          assert.ok(rows.every(row=>JSON.stringify(Object.keys(row))===JSON.stringify(keys)))
          const sql=`insert into public.${name}(${keys.map(k=>'"'+k+'"').join(',')}) values `+rows.map(row=>'('+keys.map(key=>{
            const value=row[key];args.push(value!==null&&typeof value==='object'?JSON.stringify(value):value);return'$'+args.length
          }).join(',')+')').join(',')+' returning '+columns
          writes.push({count:rows.length,sql})
          try{return result={data:(await db.query(sql,args)).rows,error:null}}
          catch(error){errors.push(error);return result={data:null,error}}
        }
        assert.ok(name in readRows,'unexpected_unmodeled_read')
        return result={data:structuredClone(readRows[name].filter(row=>filters.every(fn=>fn(row))).slice(0,max)),error:null}
      }
      const q={select(value='*'){columns=value;return q},eq(key,value){filters.push(row=>row[key]===value);return q},
        in(key,values){filters.push(row=>values.includes(row[key]));return q},limit(value){max=value;return q},
        insert(value){inserted=value;return q},async maybeSingle(){const r=await execute();return{data:r.data?.[0]??null,error:r.error}},
        then(resolve,reject){return execute().then(resolve,reject)}}
      return q
    }}
    const {action,project}=modules(service)
    const graph=async()=>Object.fromEntries(await Promise.all(['customer_portal_claims','customer_portal_accounts','customer_portal_events'].map(async name=>
      [name,(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') rows from public.${name} t`)).rows[0].rows])))
    const run=async(overrides={})=>{
      const form=new FormData()
      for(const[key,value]of Object.entries({email:'attempt@example.invalid',personal_number:'199001011234',full_name:'Synthetic Attempt',
        installation_id:'735999000000001',company_slug:'',...overrides}))form.set(key,value)
      try{return{state:await action({ok:false,message:''},form),error:null}}catch(error){return{state:null,error}}
    }
    return{db,id,readRows,writes,errors,project,graph,run}
  }catch(error){await db.close();throw error}
}
module.exports={fixture}
