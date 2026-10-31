// Adoption of the finance linear-time Ediel tokenizer and own-transaction
// decimal scans (simulation T1 finding 010; source commit
// c400f6959d8c279fb518b7199fe6e77da30409c4, files
// 20261020120000_ediel_wire_tokenizer_linear_time.sql and
// 20261024120000_g2_utilts_decimal_source_own_transaction_scans.sql).
//
// Main's current definitions are installed from supabase/schema.sql in PGlite
// with their schema.sql ACL, outputs are recorded, the adoption migration is
// applied, and the test proves: (a) the installed bodies are exactly the
// finance bodies, (b) owner/ACL/security/volatility/search_path are unchanged
// and no authenticated EXECUTE appears, (c) every output is identical for the
// same inputs, (d) the tokenizer is no longer quadratic (timings recorded,
// generous bound only).
//
// The wire-token case generation (synthetic edge cases, large UTILTS inputs
// and the seeded 20,000-case fuzz) is copied from T1's
// quality/simulation-campaign/20261029-3f1a8ab1/runs/t1r1/claude-track1/fix010-evidence/equiv_pglite.mjs
// on origin/claude/sim-20261029-track1 @ 14cc60cf5f221650102fab24dfe987242e418974.
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
// Adopted in order: g1 (finance 20261020120000), then g2 (finance 20261024120000).
const migrationPaths=['20261030120000_adopt_finance_ediel_wire_tokenizer_linear_time.sql',
 '20261030120100_adopt_finance_g2_utilts_decimal_source_own_transaction_scans.sql'].map(file=>resolve('supabase/migrations',file))
const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex')

const WIRE='gridex_utilts_binding.wire_tokens_v1(text)'
const BOUNDED='gridex_received_sources.wire_tokens_bounded_v1(text,integer)'
const ENVELOPE='gridex_ediel_technical_ack.envelope(text)'
const DECIMAL='gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'
const ADOPTED=[WIRE,BOUNDED,ENVELOPE,DECIMAL] as const
// prosrc sha256 on main (equal to the live T4 stack) and at the finance source.
const MAIN_BODY:Record<string,string>={
 [WIRE]:'fb9e5630532c15f982226d3173a0fa024ac121f02a64e90c5caed44e8f24c3bf',
 [BOUNDED]:'db791657589bb2856dedd1c6a95355afea2e491ae74bd25bb26f26273fccdeeb',
 [ENVELOPE]:'799a7375693cc586a5b17a082eb0e408753cb870688ceb4876a443fdf313369c',
 [DECIMAL]:'bb11ba59f76ee781cea7e456e237377bbdfd25802d6781e2277432883376115d',
}
const FINANCE_BODY:Record<string,string>={
 [WIRE]:'41821a488c2086917ce6b73319720d13215f623983a8a4ba52b405a9177a3f4f',
 [BOUNDED]:'3fcc2253a8fbf670080eec0179ea8857b0f959c7551933dbb09f410b2929333e',
 [ENVELOPE]:'cb1ee6eda31ddc0665d2f9e528bf1ab2c8d573237b138630d03aa2e1dbf82d02',
 [DECIMAL]:'ef375fac0ea02250db91baf4e437bbd3e7a931580710d7cbb814fca13a14d981',
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

// ---- inputs ------------------------------------------------------------
const fixtureDir=resolve('quality/audits/ediel-masterplan-v2/at-z13v-z14v-esco/canonical-observation-main-60b2c7a7')
const fixtures=readdirSync(fixtureDir).filter(f=>f.endsWith('.edi')).map(f=>readFileSync(resolve(fixtureDir,f),'latin1'))
const hdr="UNB+UNOC:3+7300009000001:14+7365565000001:14+261030:1200+REF1'UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+DOC1+9'NAD+MS+7300009000001::9'"
const large=(n:number)=>hdr+Array.from({length:n-6},(_,i)=>i%3==0?`LIN+${i}'`:`QTY+220:${i}?.${i%10}:KWH'`).join('')+"UNT+1+1'UNZ+1+REF1'"
function wireCases(){
 const cases:string[]=[...fixtures]
 const syn=["","'","UNA:+.? '","UNA:+.? 'UNH+1'","UNA:+,? 'UNH+1+A?'B'","UNA*~.# 'UNH~1*x#~y'","UNA:+.?'","una:+.? 'UNH+1'","UNH+1","UNH+1''","  UNH+1'","UNH+1 '","UNH+1? '","UNH+1?","unh+1'","UNA'","LIN+1'".repeat(4097),"UNH+"+"x".repeat(4097)+"'","UNH"+"+a".repeat(129)+"'","UNH+"+"a:".repeat(129)+"'",
  hdr+"QTY+220:1?.5'MOA+?:?+??'UNT+5+1'UNZ+1+REF1'","UNH+1'\r\nBGM+2'\nUNT+2'","UNH+1'\rX'","UNH+1+:+::+'","UNH++++'","?A'","UNH+1'+'","UNH+1':'"]
 for(const n of [406,812,1624])syn.push(large(n))
 cases.push(...syn)
 let seed=42;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
 const alpha=["A","B","U","N","H","L","I","Q","T","Y","0","1",":","+","?","'"," ","\n","\r",",",".","*","~","é"]
 for(let k=0;k<20000;k++){let s=rnd()<0.2?"UNA:+.? ":rnd()<0.1?"UNA*~,# ":"";const L=Math.floor(rnd()*60);for(let i=0;i<L;i++)s+=alpha[Math.floor(rnd()*alpha.length)];if(rnd()<0.5)s="UNH+"+s+"'";cases.push(s)}
 return cases
}
// Envelope-specific framing: UNB present/absent/duplicated, UNA advice,
// released terminators, CONTRL, tails, reference/identity bounds, multibyte.
function envelopeCases(wire:string[]){
 const unb=(ref:string,tail='')=>`UNB+UNOC:3+7300009000001:14+7365565000001:14+261030:1200+${ref}${tail}'`
 const body="UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+DOC1+9'UNT+3+1'UNZ+1+REF1'"
 const cases=[...fixtures,hdr+"UNT+5+1'UNZ+1+REF1'",unb('REF1')+body,'UNA:+.? \''+unb('REF1')+body,'UNA:+,? \''+unb('R?\'F')+body,
  'UNA*~.# \''+"UNB~UNOC*3~A~B~261030*1200~REF1'"+"UNH~1~UTILTS'",unb('REF1')+unb('REF2')+body,body+unb('REF1'),unb('REF1')+body+'UNB+UNOC:3+A',
  unb('REF1')+"UNH+1+CONTRL:D:3:UN'UNT+2+1'",unb('')+body,unb('R'.repeat(512))+body,unb('R'.repeat(513))+body,unb('REF1','++APP+++++1')+body,
  unb('REF1','++APP+++++2')+body,unb('REF1','++APP:X')+body,'UNB+UNOC:3+'+'A'.repeat(36)+'+B+261030:1200+REF1\''+body,unb('RÉF')+body,
  unb('REF1')+'BGM+é?\'é\''.repeat(50)+body,'  '+unb('REF1')+"'  '"+body,unb('REF1')+body+'TAIL',unb('REF1')+body.replace(/'/g,"'\r\n"),
  unb('REF1').replace("'","")+'?'+"'"+body,"UNH+1'"+unb('REF1'),unb('REF\u0001')+body,large(406),large(1624)]
 let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
 const alpha=["A","U","N","B","H","1",":","+","?","'"," ","\n","é","C","O","T","R","L"]
 for(let k=0;k<3000;k++){let s=rnd()<0.2?"UNA:+.? '":"";s+=unb('REF'+k);const L=Math.floor(rnd()*60);for(let i=0;i<L;i++)s+=alpha[Math.floor(rnd()*alpha.length)];cases.push(rnd()<0.7?s+"'":s)}
 return [...cases,...wire.filter((_,i)=>i%10===0)]
}
const boundedLines=[1,4,128,999999,0,1000000,-1,null] as const

// Decimal validation: UTILTS-like transactions (IDE/MEA/DTM/SEQ/QTY/STS) and
// items derived from them, plus seeded mutations of value, qualifier,
// quality, unit, count, disposition and contract observations.
type Item=Record<string,unknown>
function decimalCases(){
 let seed=1009;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
 const pick=<T,>(xs:readonly T[])=>xs[Math.floor(rnd()*xs.length)]
 const out:Array<{raw:string;item:Item;mark:string}>=[]
 const sc053="UNH+1+UTILTS'BGM+E66+DOC+9'IDE+24+SC053'MEA+AAZ++KWH'SEQ++1'QTY+136:NULL'STS+8+46'SEQ++2'QTY+136:0'STS+8+21'SEQ++3'QTY+220:123'UNT+11+1'"
 const sq=[{qualifier:'136',value:null,quality:'46',raw:'QTY+136:NULL'},{qualifier:'136',value:'0',quality:'21',raw:'QTY+136:0'},{qualifier:'220',value:'123',quality:null,raw:'QTY+220:123'}]
 const base={transactionId:'SC053',disposition:'accepted',unit:'KWH',quantities:sq,consumptionContract:{observations:[{sourceOrdinal:1,quantity:'0'}]}}
 for(const item of [base,{...base,quantities:[{...sq[0],quality:'21'},{...sq[1],quality:'46'},sq[2]]},{...base,quantities:sq.map(q=>({qualifier:q.qualifier,value:q.value,raw:q.raw}))},{...base,quantities:[{...sq[0],quality:null},sq[1],sq[2]]}])out.push({raw:sc053,item,mark:'.'})
 for(let k=0;k<1500;k++){
  const mark=rnd()<0.8?'.':',',code=pick(['E66','E31','E30','S01','S02','S05'] as const),unit=pick(['KWH','MWH','GWH','',null] as const)
  const txs=1+Math.floor(rnd()*3),target=Math.floor(rnd()*txs)
  let raw=`UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+${code}+DOC${k}+9'`,targetQuantities:Item[]=[]
  for(let t=0;t<txs;t++){
   raw+=`IDE+24+TX${t}'`
   if(unit!==null&&rnd()<0.9)raw+=`MEA+${rnd()<0.95?'AAZ':'AAE'}++${unit}'`
   if(rnd()<0.3)raw+=`DTM+354:${pick(['15:806','1:801','1:802','60:806'] as const)}'`
   const seqs=Math.floor(rnd()*4),quantities:Item[]=[]
   for(let s=0;s<seqs;s++){
    raw+=`SEQ++${s+1}'`
    if(rnd()<0.1)raw+=`MEA+${rnd()<0.5?'AAZ':'AAE'}++${rnd()<0.5?unit??'KWH':'MWH'}'`
    const qn=1+Math.floor(rnd()*3)
    for(let q=0;q<qn;q++){
     const qualifier=pick(['136','220','136','31'] as const),nul=qualifier!=='31'&&rnd()<0.15
     const value=nul?null:pick(['0','1','12.5','-3','1000.25','7'] as const)
     raw+=`QTY+${qualifier}:${value===null?'NULL':value.replace('.',mark)}${rnd()<0.05?':KWH':''}'`
     const sts=rnd()<0.6?pick(['46','21','56'] as const):null
     if(sts!==null)raw+=`STS+8+${sts}'`
     if(rnd()<0.1)raw+=`STS+8+${pick(['46','21'] as const)}'`
     quantities.push({qualifier,value,quality:sts,raw:'QTY'})
    }
   }
   if(t===target)targetQuantities=quantities
  }
  raw+=`UNT+9+1'`
  let quantities=targetQuantities.map(q=>({...q}))
  const m=rnd()
  if(m<0.1&&quantities.length)quantities[0].value=quantities[0].value===null?'0':'9'
  else if(m<0.2&&quantities.length)quantities[0].qualifier='220'
  else if(m<0.3&&quantities.length)quantities[quantities.length-1].quality=quantities[quantities.length-1].quality===null?'21':null
  else if(m<0.35)quantities=quantities.slice(1)
  else if(m<0.45)quantities=quantities.map(q=>Object.fromEntries(Object.entries(q).filter(([key])=>key!=='quality')))
  else if(m<0.5&&quantities.length)quantities[0].value='1..5'
  const observations=quantities.map((q,i)=>({sourceOrdinal:i,quantity:q.value})).filter(()=>rnd()<0.5)
  if(rnd()<0.1)observations.push({sourceOrdinal:99,quantity:'1'})
  out.push({raw,mark,item:{transactionId:rnd()<0.95?`TX${target}`:'MISSING',disposition:rnd()<0.95?'accepted':'rejected',
   unit:rnd()<0.9?unit:'KWH',quantities:rnd()<0.97?quantities:{},consumptionContract:{observations}}})
 }
 return out
}

// ---- harness -----------------------------------------------------------
type Meta={sig:string;owner:string;secdef:boolean;volatile:string;config:string[]|null;acl:string[]|null;rest:unknown}
let db:PGlite
const wire=wireCases(),envelope=envelopeCases(wire),decimal=decimalCases()
const before:Record<string,string[]>={},timings:Record<string,{before:number;after:number}>={}
let metaBefore:Meta[]=[]

async function meta():Promise<Meta[]>{
 return (await db.query<Meta>(`SELECT p.oid::regprocedure::text sig,pg_get_userbyid(p.proowner) owner,p.prosecdef secdef,p.provolatile volatile,
  p.proconfig config,p.proacl::text[] acl,to_jsonb(p)-'prosrc' rest FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY 1`,[ADOPTED])).rows
}
async function bodies(){
 const rows=(await db.query<{sig:string;prosrc:string}>(`SELECT oid::regprocedure::text sig,prosrc FROM pg_proc WHERE oid=ANY($1::regprocedure[])`,[ADOPTED])).rows
 return Object.fromEntries(rows.map(r=>[r.sig,digest(r.prosrc)]))
}
async function outputs(){
 const q=async(sql:string)=>(await db.query<{h:string}>(sql)).rows.map(r=>r.h)
 return {
  wire:await q(`SELECT coalesce(md5(gridex_utilts_binding.wire_tokens_v1(c)::text),'NULL') h FROM pg_temp.wc ORDER BY i`),
  bounded:await q(`SELECT coalesce(md5(gridex_received_sources.wire_tokens_bounded_v1(c,l)::text),'NULL') h FROM pg_temp.wc,pg_temp.bl WHERE i%7=0 OR length(c)>2000 ORDER BY i,l NULLS LAST`),
  envelope:await q(`SELECT coalesce(md5(gridex_ediel_technical_ack.envelope(c)::text),'NULL') h FROM pg_temp.ec ORDER BY i`),
  decimal:await q(`SELECT coalesce(gridex_utilts_binding.validate_decimal_source_v2(tokens,item,mark)::text,'NULL') h FROM pg_temp.dc ORDER BY i`),
 }
}
async function time(sql:string,param:string){
 await db.query(sql,[param]);const t=performance.now()
 for(let i=0;i<3;i++)await db.query(sql,[param])
 return (performance.now()-t)/3
}
const perfWire=large(3248),perfEnvelope="UNB+UNOC:3+A+B+261030:1200+REF1'"+"BGM+é?'é+ÅÄÖ'".repeat(3000)+"UNZ+1+REF1'"
async function measure(){
 return {
  wire:await time('SELECT jsonb_array_length(gridex_utilts_binding.wire_tokens_v1($1))',perfWire),
  bounded:await time('SELECT jsonb_array_length(gridex_received_sources.wire_tokens_bounded_v1($1,999999))',large(4000)),
  envelope:await time('SELECT gridex_ediel_technical_ack.envelope($1) IS NULL',perfEnvelope),
 }
}

beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner;
  CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_technical_ack;`)
 for(const name of ['gridex_utilts_binding.canonical_decimal_v2','gridex_utilts_binding.missing_source_quality_v2','gridex_utilts_binding.wire_tokens_v1',
  'gridex_utilts_binding.validate_decimal_source_v2','gridex_received_sources.wire_tokens_bounded_v1','gridex_ediel_technical_ack.envelope']){
  await db.exec(definition(name));await db.exec(aclStatements(name))
 }
 await db.exec(`CREATE TEMP TABLE wc(i int,c text);CREATE TEMP TABLE ec(i int,c text);CREATE TEMP TABLE dc(i int,raw text,item jsonb,mark text,tokens jsonb);CREATE TEMP TABLE bl(l int);`)
 await db.query('INSERT INTO pg_temp.bl SELECT unnest($1::int[])',[boundedLines])
 await db.query('INSERT INTO pg_temp.wc SELECT o-1,c FROM unnest($1::text[]) WITH ORDINALITY u(c,o)',[wire])
 await db.query('INSERT INTO pg_temp.ec SELECT o-1,c FROM unnest($1::text[]) WITH ORDINALITY u(c,o)',[envelope])
 await db.query('INSERT INTO pg_temp.dc(i,raw,item,mark) SELECT o-1,r,i::jsonb,m FROM unnest($1::text[],$2::text[],$3::text[]) WITH ORDINALITY u(r,i,m,o)',
  [decimal.map(d=>d.raw),decimal.map(d=>JSON.stringify(d.item)),decimal.map(d=>d.mark)])
 // Tokens are fixed by main's tokenizer so the decimal validator is compared on identical input.
 await db.exec('UPDATE pg_temp.dc SET tokens=gridex_utilts_binding.wire_tokens_v1(raw)')
 expect(await bodies()).toEqual(MAIN_BODY)
 metaBefore=await meta()
 Object.assign(before,await outputs())
 const old=await measure()
 for(const file of migrationPaths)await db.exec(readFileSync(file,'utf8'))
 const neu=await measure()
 for(const k of Object.keys(old) as Array<keyof typeof old>)timings[k]={before:old[k],after:neu[k]}
 console.log('finance tokenizer adoption timings (PGlite, ms, mean of 3):',JSON.stringify(timings))
},600_000)
afterAll(async()=>{await db?.close()})

describe('adopted finance Ediel tokenizer and decimal scan (T1/010)',()=>{
 it('installs exactly the finance bodies',async()=>{
  expect(await bodies()).toEqual(FINANCE_BODY)
 })
 it('preserves owner, ACL, SECURITY INVOKER, IMMUTABLE and search_path, adding no authenticated EXECUTE',async()=>{
  const after=await meta()
  expect(after).toEqual(metaBefore)
  const bySig=Object.fromEntries(after.map(m=>[m.sig,m]))
  expect(bySig[WIRE].acl).toEqual(['postgres=X/postgres'])
  expect(bySig[ENVELOPE].acl).toEqual(['postgres=X/postgres'])
  expect(bySig[DECIMAL].acl).toEqual(['postgres=X/postgres'])
  expect(bySig[BOUNDED].acl).toEqual(['postgres=X/postgres','gridex_ediel_retention_owner=X/postgres'])
  for(const m of after){
   expect(m.owner).toBe('postgres');expect(m.secdef).toBe(false);expect(m.volatile).toBe('i');expect(m.config).toEqual(['search_path=pg_catalog'])
   expect(m.acl?.some(entry=>/^(authenticated|anon|service_role)?=/.test(entry))).toBe(false)
  }
  const execute=(await db.query<{role:string;sig:string}>(`SELECT r.rolname role,p.oid::regprocedure::text sig FROM pg_proc p CROSS JOIN pg_roles r
   WHERE p.oid=ANY($1::regprocedure[]) AND r.rolname IN ('anon','authenticated','service_role') AND has_function_privilege(r.oid,p.oid,'EXECUTE')`,[ADOPTED])).rows
  expect(execute).toEqual([])
 })
 it('produces identical outputs for every recorded input',async()=>{
  const after=await outputs()
  for(const k of Object.keys(before) as Array<keyof typeof after>){
   expect(after[k].length).toBe(before[k].length)
   const diffs=after[k].map((h,i)=>h===before[k][i]?-1:i).filter(i=>i>=0)
   expect({fn:k,diffs:diffs.slice(0,5)}).toEqual({fn:k,diffs:[]})
  }
  // The corpus exercises both accepted and refused paths of every function.
  const count=(xs:string[],p:(h:string)=>boolean)=>xs.filter(p).length
  for(const k of ['wire','bounded','envelope'] as const){
   expect(count(after[k],h=>h==='NULL')).toBeGreaterThan(10);expect(count(after[k],h=>h!=='NULL')).toBeGreaterThan(10)
  }
  expect(count(after.decimal,h=>h==='true')).toBeGreaterThan(50);expect(count(after.decimal,h=>h==='false')).toBeGreaterThan(50)
  console.log('equivalence corpus:',JSON.stringify({wire:after.wire.length,bounded:after.bounded.length,envelope:after.envelope.length,
   decimal:after.decimal.length,decimalTrue:count(after.decimal,h=>h==='true'),envelopeNonNull:count(after.envelope,h=>h!=='NULL')}))
 },600_000)
 it('tokenizes a large wire in no more than linear-scale time (generous bound)',()=>{
  // Quadratic main bodies take several times longer on 3,000+ segments; the
  // bound only requires the adopted body to be clearly faster.
  expect(timings.wire.after*2).toBeLessThan(timings.wire.before)
  expect(timings.bounded.after*2).toBeLessThan(timings.bounded.before)
  expect(timings.envelope.after).toBeLessThan(timings.envelope.before*1.5)
 })
})
