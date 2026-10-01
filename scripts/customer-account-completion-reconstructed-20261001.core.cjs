/* eslint-disable @typescript-eslint/no-require-imports -- Standalone PostgreSQL business harness. */
// Exact canonical table/normalizer DDL and actual exported Action/adapter/SQL.
// Company and Auth parent rows are deliberately small synthetic scaffolding;
// this is not native Auth, full Supabase replay, RLS or concurrent-connection proof.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { resolve, dirname, relative } = require('node:path')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const root = resolve(__dirname, '..')
const migration = '20261001094820_customer_account_completion_reconstructed.sql'
const id = n => `ab100000-0000-4000-8000-${String(n).padStart(12, '0')}`
const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
function table(name) {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl, 'missing_canonical_table:' + name)
  return ddl
}
function fn(name) {
  const ddl = schema.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0]
  assert.ok(ddl, 'missing_canonical_function:' + name)
  return ddl
}
function index(name){
  const ddl=schema.match(new RegExp(`CREATE UNIQUE INDEX ${name} ON public\\.[^;]+;`))?.[0]
  assert.ok(ddl,'missing_canonical_index:'+name);return ddl
}
function helper(file, name, tag) {
  const text = readFileSync(resolve(root, 'supabase/migrations', file), 'utf8')
  const match = text.match(new RegExp(`create (?:or replace )?function private\\.${name}\\([\\s\\S]*?\\$${tag}\\$;`))?.[0]
  assert.ok(match, 'missing_current_private_helper:' + name)
  return match
}
function client(db) {
  const errors = [], commands=[]
  const service = {
    from(name) {
      assert.ok(['companies','customers','customer_contacts','customer_sites','metering_points','customer_portal_accounts','customer_portal_claims','customer_portal_events'].includes(name))
      const where = [], values = []
      let columns = '*', limit = '', order = '', inserted = null, result
      const bind = value => '$' + values.push(value)
      const field = name => { assert.match(name, /^[a-z_][a-z_0-9]*$/); return '"' + name + '"' }
      const execute = async () => {
        if (result) return result
        try {
          if (inserted) {
            const keys = Object.keys(inserted)
            const args = keys.map(key => typeof inserted[key] === 'object' && inserted[key] !== null ? JSON.stringify(inserted[key]) : inserted[key])
            const r = await db.query(`insert into public.${name}(${keys.map(field).join(',')}) values(${keys.map((_,i) => '$'+(i+1)).join(',')}) returning to_jsonb(${name}) as row`, args)
            return result = { data: r.rows.map(r => r.row), error: null }
          }
          assert.match(columns, /^[a-z_0-9*,]+$/)
          const r = await db.query(`select to_jsonb(t) as row from (select ${columns} from public.${name}${where.length ? ' where '+where.join(' and ') : ''}${order}${limit}) t`, values)
          return result = { data: r.rows.map(r => r.row), error: null }
        } catch (error) { errors.push(error.code); return result = { data: null, error } }
      }
      const q = {
        select(value = '*') { columns = value; return q },
        eq(name, value) { where.push(field(name)+'='+bind(value)); return q },
        in(name, array) { where.push(array.length ? field(name)+' in ('+array.map(bind).join(',')+')' : 'false'); return q },
        or(filter) { where.push('('+filter.split(',').map(x => { const [name,value] = x.split('.eq.'); return field(name)+'='+bind(value) }).join(' or ')+')'); return q },
        order(name) { order = ' order by '+field(name); return q },
        limit(value) { assert.ok(Number.isSafeInteger(value)); limit=' limit '+value; return q },
        insert(value) { inserted=value; return q },
        async maybeSingle() { const r=await execute(); return { data:r.data?.[0]??null,error:r.error } },
        then(resolve,reject) { return execute().then(resolve,reject) },
      }
      return q
    },
    async rpc(name,args) {
      assert.equal(name,'gridex_complete_customer_portal_account_v1')
      commands.push(args.p_command)
      try { return { data:(await db.query('select public.gridex_complete_customer_portal_account_v1($1::jsonb) as result',[JSON.stringify(args.p_command)])).rows[0].result,error:null } }
      catch(error) { errors.push(error.code); errors.last=error; return { data:null,error } }
    },
  }
  return { service, errors, commands }
}
function action(service, baseline, actor) {
  const cache = new Map()
  const load = path => {
    if (cache.has(path)) return cache.get(path)
    const exports = {}; cache.set(path,exports)
    const source = baseline && path === 'lib/customer-portal/claim.ts' ? execFileSync('git',['show','0778df20:'+path],{cwd:root,encoding:'utf8'}) : readFileSync(resolve(root,path),'utf8')
    const output = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
    const dependency = name => {
      if (name==='server-only') return require('next/dist/compiled/server-only/empty.js')
      if (name==='next/cache') return {revalidatePath:()=>undefined}
      if (name==='@/lib/supabase/service') return {supabaseService:service}
      if (name==='@/lib/supabase/server') return {createSupabaseServerClient:async()=>({auth:{
        getUser:async()=>({data:{user:{id:id(3),email:'account@example.invalid'}},error:null}),
        getClaims:async()=>({data:{claims:{sub:id(3),session_id:actor.session}},error:null}),
      }})}
      if (name.startsWith('@/')) return load(name.slice(2)+'.ts')
      if (name.startsWith('.')) return load(relative(root,resolve(root,dirname(path),name+'.ts')))
      return require(name)
    }
    new Function('require','exports',output)(dependency,exports)
    return exports
  }
  return load('lib/customer-portal/claim.ts').claimPortalCustomerAction
}
async function fixture(options={}) {
  const db = new PGlite()
  try {
    await db.exec(`create role service_role bypassrls; create role anon; create role authenticated;
      create schema private; create schema auth; create schema extensions;
      create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create table public.companies(id uuid primary key,slug text,is_active boolean default true,status text default 'active');`)
    for (const name of ['canonical_json_sha256','gridex_new_public_resource_reference','gridex_normalize_personal_number','gridex_normalize_org_number','gridex_normalize_email','gridex_normalize_phone','gridex_normalize_facility_id','gridex_normalize_metering_point_id']) await db.exec(fn(name))
    for (const name of ['customers','customer_contacts','customer_sites','metering_points','customer_portal_accounts','customer_portal_claims','customer_portal_events']) await db.exec(table(name))
    await db.exec(`alter table public.customers add primary key(id); alter table public.customers add unique(company_id,id); alter table public.customers add unique(id,company_id);
      alter table public.customer_contacts add primary key(id);alter table public.customer_sites add primary key(id);alter table public.customer_sites add unique(company_id,id);alter table public.customer_sites add unique(company_id,customer_id,id);
      alter table public.metering_points add primary key(id);
      alter table public.customer_portal_accounts add primary key(id); alter table public.customer_portal_accounts add unique(company_id,id);
      alter table public.customer_portal_claims add primary key(id); alter table public.customer_portal_events add primary key(id);
      create unique index customer_portal_accounts_user_customer_uidx on public.customer_portal_accounts(user_id,customer_id) where user_id is not null and customer_id is not null;
      create unique index customer_portal_accounts_company_portal_user_uidx on public.customer_portal_accounts(company_id,portal_user_id) where portal_user_id is not null;
      alter table public.customer_portal_accounts add constraint customer_portal_accounts_company_customer_fkey foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict;
      alter table public.customer_portal_claims add constraint customer_portal_claims_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete set null;
      alter table public.customer_portal_events add constraint customer_portal_events_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete set null;`)
    for(const name of ['ux_customers_company_personal_number','ux_customers_company_org_number','customers_company_customer_number_uk','uq_customers_company_customer_reference',
      'ux_customer_sites_company_facility','customer_sites_company_public_reference_uidx','metering_points_company_meter_point_uk','metering_points_company_metering_point_uk','ux_metering_points_company_meter_id'])await db.exec(index(name))
    await db.exec(`alter table public.customer_contacts add foreign key(company_id,customer_id) references public.customers(company_id,id);
      alter table public.customer_sites add foreign key(company_id,customer_id) references public.customers(company_id,id);
      alter table public.metering_points add foreign key(company_id,customer_id) references public.customers(company_id,id);
      alter table public.metering_points add foreign key(company_id,site_id) references public.customer_sites(company_id,id);
      alter table public.metering_points add foreign key(company_id,customer_site_id) references public.customer_sites(company_id,id);
      alter table public.metering_points add foreign key(company_id,customer_id,site_id) references public.customer_sites(company_id,customer_id,id);`)
    for (const [file,name,tag] of [
      ['20260928164025_contact_actor_lock_privilege.sql','gridex_contact_actor_active_v1','helper'],
      ['20260930160000_support_case_atomic_commands.sql','gridex_support_session_active_v1','function'],
      ['20260930222346_invoice_verified_redelivery_decision.sql','gridex_invoice_redelivery_auth_email_v1','auth'],
    ]) await db.exec(helper(file,name,tag))
    await db.exec(`grant usage on schema public,private,extensions to service_role; grant select,insert,update,delete on all tables in schema public to service_role;
      grant execute on function private.gridex_contact_actor_active_v1(uuid),private.gridex_support_session_active_v1(uuid,uuid),private.gridex_invoice_redelivery_auth_email_v1(uuid) to service_role;
      insert into auth.users(id,email,email_confirmed_at) values('${id(3)}','account@example.invalid',clock_timestamp()-interval '1 day');
      insert into auth.sessions(id,user_id,not_after) values('${id(4)}','${id(3)}',clock_timestamp()+interval '1 day');
      insert into public.companies(id,slug) values('${id(1)}','synthetic-completion'),('${id(11)}','quiet-completion');
      insert into public.customers(id,company_id,first_name,last_name,full_name,personal_number,email,customer_number,status,profile_revision,contact_revision)
      values('${id(2)}','${id(1)}','Synthetic','Customer','Synthetic Customer','199001011234','account@example.invalid','SYN-COMP-1','active',2,3),
        ('${id(12)}','${id(11)}','Quiet','Customer','Quiet Customer','198001015678','quiet@example.invalid','QUIET-COMP-1','active',0,0);
      insert into public.customer_sites(id,company_id,customer_id,facility_id,site_revision,address_revision)
      values('${id(5)}','${id(1)}','${id(2)}','735999000000001',4,5),('${id(15)}','${id(11)}','${id(12)}','735999000000002',0,0);`)
    if (!options.baseline) {
      let sql=readFileSync(resolve(root,'supabase/migrations',migration),'utf8')
      // Explicit earlier reconstructed draft for fresh preservation RED only;
      // these are not historical lost bytes or production-schema acceptance.
      if(options.draftPreservation) {
        sql=sql.replace('values(v_company,v_customer,v_user,null,v_customer_row.customer_number','values(v_company,v_customer,v_user,v_user,v_customer_row.customer_number')
        sql=sql.replace('v_final_account.portal_user_id is not null or ','')
        const evidence=/v_verification:=[\s\S]*?;\n    v_event_payload/
        assert.match(sql,evidence,'missing_preservation_mutation_boundary')
        sql=sql.replace(evidence,"v_verification:=v_metadata->'match_snapshot';\n    v_event_payload")
      }
      await db.exec(sql)
    }
    await db.exec('set role service_role')
    const adapter = client(db), actor={session:id(4)},runAction=action(adapter.service,options.baseline,{get session(){return actor.session}})
    return {db,id,actor,errors:adapter.errors,commands:adapter.commands,
      admin:async sql=>{await db.exec('reset role');try{return await db.exec(sql)}finally{await db.exec('set role service_role')}},
      execute:async command=>(await db.query('select public.gridex_complete_customer_portal_account_v1($1::jsonb) result',[JSON.stringify(command)])).rows[0].result,
      graph:async()=>Object.fromEntries(await Promise.all(['customer_portal_accounts','customer_portal_claims','customer_portal_events'].map(async name=>[name,(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') rows from public.${name} t`)).rows[0].rows])).then(async entries=>[...entries,['receipts',(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') rows from private.customer_portal_account_completion_receipts t")).rows[0].rows]])),
      quiet:async()=>(await db.query(`select public.canonical_json_sha256(jsonb_build_object(
        'customers',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customers t where company_id='${id(11)}'),
        'contacts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_contacts t where company_id='${id(11)}'),
        'sites',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_sites t where company_id='${id(11)}'),
        'points',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.metering_points t where company_id='${id(11)}'),
        'accounts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_accounts t where company_id='${id(11)}'),
        'claims',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_claims t where company_id='${id(11)}'),
        'events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_events t where company_id='${id(11)}'))) hash`)).rows[0].hash,
      run:async(overrides={})=>{
      const form = new FormData()
      for(const [key,value] of Object.entries({email:'account@example.invalid',personal_number:'199001011234',full_name:'Synthetic Customer',installation_id:'735999000000001',company_slug:'synthetic-completion',...overrides})) form.set(key,value)
      try{return{state:await runAction({ok:false,message:''},form),error:null}}catch(error){return{state:null,error}}
    },count:async name=>(await db.query(`select count(*)::int as n from public.${name}`)).rows[0].n}
  } catch(error) { await db.close(); throw error }
}
module.exports = {fixture,id,migration}
