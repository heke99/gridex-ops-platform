import { randomBytes,randomUUID } from 'node:crypto'
import { createClient,type SupabaseClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,expect,it,vi } from 'vitest'
import { proofSql,quote } from './customer-read-proof-native'

// Prepared only. The cookie transport/cache boundary is controlled; identity
// calls are genuine local GoTrue, and Action/RPC/DDL/triggers are unchanged.
// No Auth/session rows, verified claims or database clocks are manufactured.
const holder=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{
  if(!holder.client)throw new Error('owned_current_session_not_ready')
  return holder.client
}}))
vi.mock('next/cache',()=>({revalidatePath:()=>undefined}))
import { supabaseService } from '@/lib/supabase/service'
import { claimPortalCustomerAction } from '@/lib/customer-portal/claim'

const company=randomUUID(),customer=randomUUID(),site=randomUUID(),tag=randomUUID().slice(0,8)
const email=`native-account-${tag}@example.invalid`,password=randomBytes(24).toString('base64url')
const slug=`native-account-${tag}`,pn='199001011234',facility='735999000000001'
let userId='',creatingSession='',quietBaseline=''
const sessions:SupabaseClient[]=[]
const originalFetch=globalThis.fetch
function localClient(){
  if(process.env.CI!=='true'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error('account_completion_disposable_local_only')
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  sessions.push(client);return client
}
async function login(){
  const client=localClient();const signed=await client.auth.signInWithPassword({email,password})
  if(signed.error||signed.data.user?.id!==userId)throw new Error('owned_gotrue_login_failed')
  const [claims,current]=await Promise.all([client.auth.getClaims(),client.auth.getUser()])
  const session=claims.data?.claims.session_id
  if(claims.error||current.error||current.data.user?.id!==userId||claims.data?.claims.sub!==userId||
    typeof session!=='string'||! /^[0-9a-f-]{36}$/i.test(session))throw new Error('owned_verified_session_failed')
  return{client,session}
}
function form(){
  const data=new FormData()
  for(const[key,value]of Object.entries({email,personal_number:pn,full_name:'Synthetic Native Account',installation_id:facility,company_slug:slug}))data.set(key,value)
  return data
}
async function attempt(){
  try{return{state:await claimPortalCustomerAction({ok:false,message:''},form()),redirect:false}}
  catch(error){if((error as{digest?:string}).digest?.startsWith('NEXT_REDIRECT;'))return{state:null,redirect:true};throw error}
}
type Graph={accounts:Array<Record<string,unknown>>;claims:Array<Record<string,unknown>>;events:Array<Record<string,unknown>>;receipts:Array<Record<string,unknown>>}
function graph():Graph{return proofSql(`select jsonb_build_object(
  'accounts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_accounts t where company_id=${quote(company)}),
  'claims',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_claims t where company_id=${quote(company)}),
  'events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.customer_portal_events t where company_id=${quote(company)}),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.customer_portal_account_completion_receipts t where company_id=${quote(company)}));`)}
function wholeOtherPublicHash():string{
  // Hash canonical PostgreSQL text before JSON parsing, including every public
  // financial table and rows lacking company_id. Only our expected account /
  // claim / event rows are excluded. All original and foreign rows stay covered.
  return proofSql(`create temp table native_account_snapshot(name text primary key,hash text);
    do $snapshot$ declare r record;v_hash text;v_filter text;begin
      for r in select tablename from pg_tables where schemaname='public' order by tablename loop
        v_filter:='';
        if r.tablename in('customer_portal_accounts','customer_portal_claims','customer_portal_events') then
          v_filter:=' where company_id is distinct from '||quote_literal(${quote(company)}::uuid);
        end if;
        execute format('select encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E''\\n'' order by to_jsonb(t)::text),''''),''utf8''),''sha256''),''hex'') from public.%I t%s',r.tablename,v_filter) into v_hash;
        insert into native_account_snapshot values(r.tablename,v_hash);
      end loop;
    end $snapshot$;
    select to_jsonb(public.canonical_json_sha256(jsonb_object_agg(name,hash))) from native_account_snapshot;`)
}
beforeAll(async()=>{
  vi.stubGlobal('fetch',async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
    const url=new URL(input instanceof Request?input.url:String(input))
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='54321'||url.username||url.password)throw new Error('account_native_nonlocal_transport_denied')
    return originalFetch(input,{...init,redirect:'error'})
  })
  localClient() // Refuse non-disposable status before seeding or Auth transport.
  const created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true})
  if(created.error||!created.data.user)throw new Error('owned_gotrue_user_failed')
  userId=created.data.user.id
  proofSql(`insert into public.companies(id,name,slug,status,is_active) values(${quote(company)},'Synthetic Native Account',${quote(slug)},'active',true);
    insert into public.customers(id,company_id,customer_number,first_name,last_name,full_name,personal_number,email,customer_type,status)
    values(${quote(customer)},${quote(company)},${quote(`NATIVE-ACCOUNT-${tag}`)},'Synthetic','Native Account','Synthetic Native Account',${quote(pn)},${quote(email)},'private','active');
    insert into public.customer_sites(id,company_id,customer_id,facility_id) values(${quote(site)},${quote(company)},${quote(customer)},${quote(facility)});
    select to_jsonb(count(*)) from public.customer_sites where id=${quote(site)};`)
  const current=await login();holder.client=current.client;creatingSession=current.session
  quietBaseline=wholeOtherPublicHash()
})
it.each(['customer_portal_claims','customer_portal_events'])('a real late %s fault rolls back the whole intended link',async table=>{
  const fn=`native_account_failure_${tag}`,trigger=`native_account_failure_${tag}`
  const before=graph()
  try{
    proofSql(`create function private.${fn}() returns trigger language plpgsql as $failure$ begin raise exception 'owned_native_account_late_fault' using errcode='P0001'; end $failure$;
      create trigger ${trigger} before insert on public.${table} for each row when(new.company_id=${quote(company)}::uuid) execute function private.${fn}();
      select to_jsonb(true);`)
    expect((await attempt()).state).toMatchObject({ok:false});expect(graph()).toEqual(before)
    expect(wholeOtherPublicHash()).toBe(quietBaseline)
  }finally{
    proofSql(`drop trigger if exists ${trigger} on public.${table};drop function if exists private.${fn}();select to_jsonb(true);`)
  }
})
it('genuine concurrent same-user current-session Actions create one account/approved claim/event/receipt',async()=>{
  const results=await Promise.all([attempt(),attempt()]);expect(results.every(r=>r.redirect)).toBe(true)
  const g=graph();for(const rows of Object.values(g))expect(rows).toHaveLength(1)
  expect(g.accounts[0]).toMatchObject({company_id:company,customer_id:customer,user_id:userId,portal_user_id:null,role:'owner',status:'active',is_active:true})
  expect(g.claims[0]).toMatchObject({company_id:company,customer_id:customer,user_id:userId,status:'approved'})
  expect(g.events[0]).toMatchObject({company_id:company,customer_id:customer,user_id:userId,event_type:'portal_account_verified'})
  expect(g.receipts[0].creating_session_id).toBe(creatingSession)
  expect(JSON.stringify(g)).not.toContain(pn)
  expect(wholeOtherPublicHash()).toBe(quietBaseline)
})
it('a genuine new login reuses stored completion without old-session authority or duplicate history',async()=>{
  const before=graph(),next=await login();expect(next.session).not.toBe(creatingSession);holder.client=next.client
  expect((await attempt()).redirect).toBe(true);expect(graph()).toEqual(before)
  expect(wholeOtherPublicHash()).toBe(quietBaseline)
})
afterAll(async()=>{
  try{
  for(const client of sessions){const ended=await client.auth.signOut({scope:'local'});if(ended.error)throw new Error('owned_local_session_cleanup_failed')}
  if(userId){
    // Retain the company and any trigger-seeded published legal children,
    // alongside immutable ID/hash-only receipts, until stack disposal. Ordinary
    // company deletion can cascade into the canonical published-legal guard.
    // No trigger, publication, provenance or role is weakened for cleanup.
    proofSql(`delete from public.customer_portal_events where company_id=${quote(company)};
      delete from public.customer_portal_claims where company_id=${quote(company)};
      delete from public.customer_portal_accounts where company_id=${quote(company)};
      delete from public.customer_sites where id=${quote(site)} and company_id=${quote(company)};
      delete from public.customers where id=${quote(customer)} and company_id=${quote(company)};
      select to_jsonb(count(*)) from public.customers where id=${quote(customer)};`)
    const removed=await supabaseService.auth.admin.deleteUser(userId)
    if(removed.error)throw new Error('owned_gotrue_cleanup_failed')
  }
  }finally{vi.unstubAllGlobals()}
})
