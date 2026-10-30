// Billing source bases once per source (simulation T1 finding 010/007).
// Migrations: 20261030120200_billing_source_bases_once_per_source.sql (port of
// finance c400f695 G-6, 20261024130000) and
// 20261030130500_billing_source_linear_accumulation.sql.
//
// Main's current definitions of every rewritten function are installed from
// supabase/schema.sql in PGlite with their ACL. The test proves:
// (a) guards: the migrations apply only to the exact pre-images, refuse a
//     changed body and keep owner/ACL/SECURITY DEFINER/search_path; the new
//     helpers have no grants;
// (b) equivalence: with the same fixture data, basis_v1, basis_before_precision_v1
//     and gridex_read_billing_source_values_v1 return the same output (or the same
//     error) before and after, and bases_v1 equals the one-value wrappers;
// (c) grouping: one read calls stored_contract_v1 once per (source, transaction);
// (d) the read grows linearly with the number of values (generous bound).
//
// The leaf authorities the billing basis reads (stored contract, rule pack,
// physical observation, decimal rules, value locks) are fixture functions
// here; the rewritten functions themselves are the real ones.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {describe,expect,it} from 'vitest'

const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
const G6=readFileSync(resolve('supabase/migrations/20261030120200_billing_source_bases_once_per_source.sql'),'utf8')
const LINEAR=readFileSync(resolve('supabase/migrations/20261030130500_billing_source_linear_accumulation.sql'),'utf8')
const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex')

const SC='gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'
const BBP='gridex_billing_source.basis_before_precision_v1(uuid,uuid)'
const BASIS='gridex_billing_source.basis_v1(uuid,uuid)'
const READ='gridex_read_billing_source_values_v1(uuid,uuid[])'
const STORE='gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'
const BASES='gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)'
const ENTRY='gridex_billing_source.basis_entry_v1(jsonb)'
const REWRITTEN=[SC,BBP,BASIS,READ,STORE] as const
const PRE:Record<string,string>={
 [SC]:'63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c',
 [BBP]:'d1965eb86c40723593accc3c1249ec382091bde14a4f6a3b84adc3daf4db2644',
 [BASIS]:'cf5325a4fa00b070ca0be113354497f818d308c2c482371a91d2668f724f69de',
 [READ]:'3d1a829f6b04f93ae332a3ee35168e8c15efdbb0861ef65266b5fb6bc5634b50',
 [STORE]:'c775d57fec0c980ddc31fff632b3595971250071d54fe2be76ff65b6eb3217a3',
}
const AFTER_G6:Record<string,string>={
 [SC]:'741c06ad69d76bf639390bbeb4f78507cccbf39c3f0869d54e4db2032c5154d1',
 [BBP]:'70f24d94162cd04b82a886230edb5abea551b4e9715a3b3d83037159c4ce2e25',
 [BASIS]:'d2a211ec8b87ca1e403e49de57046cf8b171c7d89d5f900e638ef6f9526d7d50',
 [READ]:'f7cdbd917f7c956e7acd168576e98671afc91456d29e02f0c550b1fc84df5be5',
 [STORE]:'ba59faf05e9c807608147eca6b6c36cbac8ec84ab18974e19dd3477c3c15e7f5',
 [BASES]:'fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2',
 [ENTRY]:'7f60d5609b5f2c9ce8b726d7c0b5f4831be234f36306bcf833598622ed0c5c3b',
}
const AFTER_LINEAR:Record<string,string>={...AFTER_G6,
 [READ]:'f4ebfdf958b4023cc44bc2c8f5894e6efbe877926dee24f689afaf5ca8585a19',
 [BASES]:'de8da5591fead1ff5ba0d63ed07579f0a10434ac3b3829cb3d820e65202b578e',
}

function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('actual_function_missing:'+name)
 const rest=schema.slice(start),delimiter=rest.match(/AS (\$[^$]*\$)/)?.[1]
 if(!delimiter)throw Error('actual_function_body_missing:'+name)
 const end=rest.indexOf(delimiter+';',rest.indexOf(delimiter)+delimiter.length)
 if(end<0)throw Error('actual_function_end_missing:'+name)
 return rest.slice(0,end+delimiter.length+1)
}
function aclStatements(name:string){
 return schema.split('\n').filter(line=>/^(REVOKE|GRANT) .* ON FUNCTION /.test(line)&&line.includes(' ON FUNCTION '+name+'(')).join('\n')
}

// ---- fixture ------------------------------------------------------------
const C='11111111-1111-4111-8111-111111111111',C2='22222222-2222-4222-8222-222222222222'
const MP='33333333-3333-4333-8333-333333333333',CU='44444444-4444-4444-8444-444444444444'
const uuid=(prefix:string,i:number):string=>`${prefix}${i.toString(16).padStart(12,'0')}`.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5')
// Sources: kind decides the leaf authority outcome for every value of that source.
type Kind='ok'|'contract_error'|'rules_unavailable'|'not_utilts'|'semantics'|'decimal_rules'|'contract_mismatch'
const KINDS:Kind[]=['ok','ok','contract_error','rules_unavailable','not_utilts','semantics','decimal_rules','contract_mismatch']

async function setup(db:PGlite){
 await db.exec(`SET check_function_bodies=off;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE SCHEMA extensions;CREATE SCHEMA gridex_billing_source;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_received_sources;
  CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS 'SELECT sha256($1)';
  CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
  CREATE TABLE public.metering_values(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,value_kwh numeric,period_start timestamptz,period_end timestamptz,
   direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,is_current boolean,revision_status text,raw_payload jsonb);
  CREATE TABLE public.normalized_metering_values(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,source_metering_value_id uuid,source_message_id uuid,
   source_transaction_reference text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,product_code text,register_code text,
   raw_payload jsonb,revision_status text,revision_number int,supply_period_id uuid,billing_status text,billing_gate_status text);
  CREATE TABLE public.fx_source(id uuid PRIMARY KEY,kind text);
  CREATE TABLE public.fx_contract(source_id uuid,tx text,contract jsonb);
  CREATE TABLE public.fx_calls(fn text,arg text);`)
 for(const name of ['gridex_utilts_binding.canonical_decimal_v2','gridex_utilts_binding.wire_tokens_v1','gridex_utilts_binding.stored_contract_v1',
  'gridex_billing_source.basis_before_precision_v1','gridex_billing_source.basis_v1','gridex_billing_source.lock_values_v1','public.gridex_read_billing_source_values_v1','public.gridex_store_billing_underlay']){
  await db.exec(definition(name));await db.exec(aclStatements(name))
 }
 // Leaf authorities (fixtures; lock_values_v1 above is main's real one). Signatures are main's.
 await db.exec(`
  CREATE FUNCTION gridex_ediel_source_rules.require_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
  BEGIN IF (SELECT kind FROM public.fx_source WHERE id=p_message_id)='rules_unavailable' THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable'; END IF;
   RETURN jsonb_build_object('version','fixture','source',p_message_id); END$$;
  CREATE FUNCTION gridex_billing_source.observation_v1(tokens jsonb,tx text,ordinal integer,decimal_mark text DEFAULT '.') RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE q jsonb; BEGIN IF tokens IS NULL THEN RETURN NULL; END IF;
   SELECT t INTO q FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='QTY' AND t#>>'{elements,1,2}'=tx||':'||ordinal;
   IF q IS NULL THEN RETURN NULL; END IF;
   RETURN jsonb_build_object('quantityKwh',q#>>'{elements,1,1}','periodStart','2026-09-01T00:00:00Z','periodEnd','2026-09-01T00:15:00Z','messageCode','E66',
    'quantityType',q#>>'{elements,1,0}','applicationReference','23-DDQ-E66-T','productCode','8716867000030','registerCode',null,'quality',null); END$$;
  CREATE FUNCTION gridex_utilts_binding.decimal_rules_v1(tokens jsonb,tx text,decimal_mark text DEFAULT '.') RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
  BEGIN IF tokens IS NULL THEN RETURN NULL; END IF;
   RETURN jsonb_build_object('guide',CASE WHEN tx LIKE 'DR%' THEN '["unit"]'::jsonb ELSE '[]'::jsonb END,'functional','[]'::jsonb); END$$;`)
}
// Real stored_contract_v1 is installed for the guard; the behaviour runs use this fixture of its outcome.
const STORED_FIXTURE=`CREATE OR REPLACE FUNCTION gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_transaction text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path TO 'pg_catalog','public','extensions' AS $$
 DECLARE c jsonb; BEGIN INSERT INTO public.fx_calls VALUES('stored_contract',p_source||'/'||p_transaction);
  IF (SELECT kind FROM public.fx_source WHERE id=p_source)='contract_error' THEN RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
  SELECT contract INTO c FROM public.fx_contract WHERE source_id=p_source AND tx=p_transaction;
  IF c IS NULL THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
  RETURN c; END$$;`

async function seed(db:PGlite,sources:number,perTx:number,txs=2,kinds=KINDS){
 const values:string[]=[]
 for(let si=0;si<sources;si++){
  const sid=uuid('a0000000000000000000',si+1),kind=kinds[si%kinds.length],company=si===sources-1&&sources>2?C2:C
  let raw=`UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+DOC${si}+9'`
  for(let t=0;t<txs;t++){const tx=(kind==='decimal_rules'?'DR':'TX')+t;raw+=`IDE+24+${tx}'`;for(let o=0;o<perTx;o++)raw+=`QTY+${kind==='semantics'?'220':'136'}:${o}.5:${tx}?:${o}'`}
  raw+=`UNT+9+1'`
  await db.query('INSERT INTO public.ediel_messages VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[sid,company,'test','inbound',kind==='not_utilts'?'PRODAT':'UTILTS','E66',raw,'received'])
  await db.query('INSERT INTO public.fx_source VALUES($1,$2)',[sid,kind])
  for(let t=0;t<txs;t++){
   const tx=(kind==='decimal_rules'?'DR':'TX')+t,observations=[]
   for(let o=0;o<perTx;o++)observations.push({sourceOrdinal:o,ordinal:o,unit:'kWh',quantity:`${o}.5`,periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-09-01T00:15:00Z',
    direction:'consumption',quality:null,productCode:'8716867000030',registerCode:null})
   const contract={metering:{capability:'write',meteringPointId:MP,customerId:CU},observations}
   await db.query('INSERT INTO public.fx_contract VALUES($1,$2,$3)',[sid,tx,contract])
   for(let o=0;o<perTx;o++){
    const id=uuid('b'+si.toString(16).padStart(3,'0')+t+'000000000000000',o+1),mv=uuid('c'+si.toString(16).padStart(3,'0')+t+'000000000000000',o+1)
    const own=kind==='contract_mismatch'&&o===0?{...contract,observations:[]}:contract
    const payload={consumptionContract:own,edielMessageId:sid,sourceOrdinal:o}
    await db.query(`INSERT INTO public.metering_values VALUES($1,$2,$3,$4,$5,'2026-09-01T00:00:00Z','2026-09-01T00:15:00Z','consumption',null,$6,$7,true,'current',$8)`,[mv,company,CU,MP,`${o}.5`,sid,tx,payload])
    await db.query(`INSERT INTO public.normalized_metering_values VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-01T00:00:00Z','2026-09-01T00:15:00Z','kWh','consumption',null,'8716867000030',null,$9,'current',1,null,'billable','eligible')`,
     [id,company,CU,MP,mv,sid,tx,`${o}.5`,payload])
    values.push(id)
   }
  }
 }
 return values.sort()
}

async function capture(db:PGlite,sql:string,params:unknown[]){
 try{const r=await db.query<{r:unknown}>(sql,params);return JSON.stringify(r.rows[0].r)}
 catch(e){const x=e as {code?:string;message?:string};return `ERR ${x.code} ${x.message}`}
}
async function observe(db:PGlite,company:string,values:string[]){
 const out:Record<string,string[]|string>={basis:[],before:[]}
 for(const v of [...values,uuid('dead0000000000000000',1)]){
  (out.basis as string[]).push(await capture(db,'SELECT gridex_billing_source.basis_v1($1,$2) r',[company,v]))
  ;(out.before as string[]).push(await capture(db,'SELECT gridex_billing_source.basis_before_precision_v1($1,$2) r',[company,v]))
 }
 await db.exec('SET ROLE service_role')
 out.read=await capture(db,'SELECT public.gridex_read_billing_source_values_v1($1,$2) r',[company,values])
 out.readMissing=await capture(db,'SELECT public.gridex_read_billing_source_values_v1($1,$2) r',[company,[...values,uuid('dead0000000000000000',1)]])
 out.readNull=await capture(db,'SELECT public.gridex_read_billing_source_values_v1($1,$2) r',[company,[null]])
 await db.exec('RESET ROLE')
 return out
}
type Meta={sig:string;owner:string;secdef:boolean;config:string[]|null;acl:string[]|null;rest:Record<string,unknown>}
async function meta(db:PGlite,sigs:readonly string[]){
 return (await db.query<Meta>(`SELECT p.oid::regprocedure::text sig,pg_get_userbyid(p.proowner) owner,p.prosecdef secdef,p.proconfig config,p.proacl::text[] acl,to_jsonb(p)-'prosrc' rest
  FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY 1`,[sigs])).rows
}
async function bodyHashes(db:PGlite,sigs:readonly string[]){
 const rows=(await db.query<{sig:string;prosrc:string}>('SELECT oid::regprocedure::text sig,prosrc FROM pg_proc WHERE oid=ANY($1::regprocedure[])',[sigs])).rows
 return Object.fromEntries(rows.map(r=>[r.sig.replace(/^public\./,''),digest(r.prosrc)]))
}
const key=(sig:string)=>sig.replace(/^public\./,'')
async function scCalls(db:PGlite){return Number((await db.query<{n:number}>(`SELECT count(*)::int n FROM public.fx_calls WHERE fn='stored_contract'`)).rows[0].n)}

describe('billing source bases once per source (20261030120200, 20261030130500)',()=>{
 it('applies only to the exact pre-images and keeps owner, ACL, security and configuration',async()=>{
  const db=new PGlite();await setup(db)
  expect(await bodyHashes(db,REWRITTEN)).toEqual(Object.fromEntries(REWRITTEN.map(s=>[key(s),PRE[s]])))
  const before=await meta(db,REWRITTEN)
  await db.exec(G6)
  expect(await bodyHashes(db,[...REWRITTEN,BASES,ENTRY])).toEqual(Object.fromEntries([...REWRITTEN,BASES,ENTRY].map(s=>[key(s),AFTER_G6[s]])))
  await db.exec(LINEAR)
  expect(await bodyHashes(db,[...REWRITTEN,BASES,ENTRY])).toEqual(Object.fromEntries([...REWRITTEN,BASES,ENTRY].map(s=>[key(s),AFTER_LINEAR[s]])))
  const after=await meta(db,REWRITTEN)
  expect(after.map(m=>({...m,rest:{...m.rest,prosrc:undefined}}))).toEqual(before.map(m=>({...m,rest:{...m.rest,prosrc:undefined}})))
  for(const m of await meta(db,[BASES,ENTRY])){expect(m.owner).toBe('postgres');expect(m.secdef).toBe(false);expect(m.acl).toEqual(['postgres=X/postgres'])}
  // Only service_role keeps EXECUTE on the public entry points; no new grantee anywhere.
  for(const m of after)expect((m.acl??[]).every(a=>/^(postgres|service_role)=X\/postgres$/.test(a))).toBe(true)
  await db.close()
 },120000)

 it('refuses a changed pre-image and a second application',async()=>{
  const db=new PGlite();await setup(db)
  await db.exec(definition('gridex_utilts_binding.stored_contract_v1').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('utilts_consumption_raw_conflict','utilts_consumption_raw_conflict_x'))
  await expect(db.exec(G6)).rejects.toThrow(/g6_billing_source_basis_rule_source_changed:gridex_utilts_binding\.stored_contract_v1/)
  await db.exec('ROLLBACK')
  await expect(db.exec(LINEAR)).rejects.toThrow(/function gridex_billing_source\.bases_v1|does not exist/)
  await db.close()
  const again=new PGlite();await setup(again);await again.exec(G6)
  await again.exec('DISCARD TEMP')
  await expect(again.exec(G6)).rejects.toThrow(/function "bases_v1" already exists/)
  await again.exec('ROLLBACK')
  await again.exec(LINEAR)
  await again.exec('DISCARD TEMP')
  await expect(again.exec(LINEAR)).rejects.toThrow(/billing_source_linear_accumulation_source_changed/)
  await again.close()
 },120000)

 it('returns identical bases, errors and reads; bases_v1 equals the one-value wrappers; one stored contract per (source, transaction)',async()=>{
  const db=new PGlite();await setup(db)
  await db.exec(STORED_FIXTURE)
  const values=await seed(db,9,3)
  const company2=(await db.query<{id:string}>('SELECT id FROM public.normalized_metering_values WHERE company_id=$1 ORDER BY id',[C2])).rows.map(r=>r.id)
  const own=values.filter(v=>!company2.includes(v))
  const before=await observe(db,C,own),beforeOther=await capture(db,'SELECT gridex_billing_source.basis_v1($1,$2) r',[C,company2[0]])
  await db.exec('DELETE FROM public.fx_calls')
  await db.exec('SET ROLE service_role');await capture(db,'SELECT public.gridex_read_billing_source_values_v1($1,$2) r',[C,own]);await db.exec('RESET ROLE')
  const oldCalls=await scCalls(db)
  // Restore main's exact stored_contract_v1 so the guard holds, migrate, then reinstate the fixture.
  await db.exec(definition('gridex_utilts_binding.stored_contract_v1').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
  await db.exec(G6);await db.exec(LINEAR);await db.exec(STORED_FIXTURE)
  const after=await observe(db,C,own),afterOther=await capture(db,'SELECT gridex_billing_source.basis_v1($1,$2) r',[C,company2[0]])
  expect(after).toEqual(before)
  expect(afterOther).toBe(beforeOther)
  // Another company's value yields no basis (main: P0002 inside basis_before_precision_v1 is mapped to its NULL basis).
  expect(beforeOther).toBe('null')
  expect((before.basis as string[]).at(-1)).toBe('null')
  expect((before.basis as string[]).some(b=>b.includes('"qualified":true'))).toBe(true)
  for(const reason of ['billing_source_semantics_mismatch','ediel_historical_rule_pack_basis_unavailable','billing_source_standard_decimal_or_unit_basis_required','billing_source_binding_unavailable'])
   expect((before.basis as string[]).some(b=>b.includes(reason))).toBe(true)
  expect(before.readNull).toMatch(/^ERR 22023/)
  expect(before.readMissing).toMatch(/^ERR P0002/)
  // bases_v1 element-wise equals the one-value wrappers, with and without precision.
  for(const precision of [true,false]){
   const many=(await db.query<{r:unknown[]}>('SELECT gridex_billing_source.bases_v1($1,$2,$3,true) r',[C,own,precision])).rows[0].r
   const single:unknown[]=[]
   for(const v of own)single.push((await db.query<{r:unknown}>(`SELECT gridex_billing_source.${precision?'basis_v1':'basis_before_precision_v1'}($1,$2) r`,[C,v])).rows[0].r)
   expect(many.map(e=>(e as {b?:unknown}).b??null)).toEqual(single)
  }
  await db.exec('DELETE FROM public.fx_calls')
  await db.exec('SET ROLE service_role');await capture(db,'SELECT public.gridex_read_billing_source_values_v1($1,$2) r',[C,own]);await db.exec('RESET ROLE')
  const groups=(await db.query<{n:number}>(`SELECT count(DISTINCT n.source_message_id||'/'||n.source_transaction_reference)::int n FROM public.normalized_metering_values n
   JOIN public.fx_source s ON s.id=n.source_message_id WHERE n.id=ANY($1::uuid[]) AND s.kind NOT IN ('not_utilts','contract_error')`,[own])).rows[0].n
  // A raising stored contract rolls back its own fx_calls row, so only completed calls are counted.
  expect(oldCalls).toBeGreaterThan(groups)
  expect(await scCalls(db)).toBe(groups)
  await db.close()
 },300000)

 it('grows linearly with the number of values in one read',async()=>{
  const db=new PGlite();await setup(db);await db.exec(G6);await db.exec(LINEAR);await db.exec(STORED_FIXTURE)
  const values=await seed(db,2,600,1,['ok'])
  const time=async(ids:string[])=>{
   await db.exec('SET ROLE service_role')
   const t=performance.now();const r=await db.query<{n:number}>('SELECT jsonb_array_length(public.gridex_read_billing_source_values_v1($1,$2)) n',[C,ids]);const ms=performance.now()-t
   await db.exec('RESET ROLE');expect(r.rows[0].n).toBe(ids.length);return ms
  }
  await time(values.slice(0,50))
  const small=await time(values.slice(0,150)),large=await time(values.slice(0,600))
  console.info(`read 150 values ${small.toFixed(0)} ms, 600 values ${large.toFixed(0)} ms`)
  // Linear: ~4x. Quadratic accumulation would be ~16x; the bound is generous for CI noise.
  expect(large/small).toBeLessThan(10)
  await db.close()
 },300000)
})
