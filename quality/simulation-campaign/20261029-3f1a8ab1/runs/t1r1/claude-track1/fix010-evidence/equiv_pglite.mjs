const { PGlite } = await import(process.env.APP_DIR + '/node_modules/@electric-sql/pglite/dist/index.js'); // APP_DIR = checkout of base 1c0c088c
import fs from 'node:fs';
const D=process.argv[2];
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_utilts_binding;`);
const old=fs.readFileSync(D+'/old_wire_tokens.sql','utf8').replace(/^--.*\n/,'');
await db.exec(old);
const neu=fs.readFileSync(D+'/new_wire_tokens.sql','utf8').replace('gridex_utilts_binding.wire_tokens_v1(p_raw text)','pg_temp.wire_tokens_new(p_raw text)').replace(/REVOKE.*$/m,'');
await db.exec(neu);
const cases=[];
for (const f of fs.readdirSync(process.env.APP_DIR+'/quality/audits/ediel-masterplan-v2/at-z13v-z14v-esco/canonical-observation-main-60b2c7a7')) cases.push(fs.readFileSync(process.env.APP_DIR+'/quality/audits/ediel-masterplan-v2/at-z13v-z14v-esco/canonical-observation-main-60b2c7a7/'+f,'latin1'));
const hdr="UNB+UNOC:3+7300009000001:14+7365565000001:14+261030:1200+REF1'UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+DOC1+9'NAD+MS+7300009000001::9'";
const syn=["","'","UNA:+.? '","UNA:+.? 'UNH+1'","UNA:+,? 'UNH+1+A?'B'","UNA*~.# 'UNH~1*x#~y'","UNA:+.?'","una:+.? 'UNH+1'","UNH+1","UNH+1''","  UNH+1'","UNH+1 '","UNH+1? '","UNH+1?","unh+1'","UNA'","LIN+1'".repeat(4097),"UNH+"+"x".repeat(4097)+"'","UNH"+"+a".repeat(129)+"'","UNH+"+"a:".repeat(129)+"'",
 hdr+"QTY+220:1?.5'MOA+?:?+??'UNT+5+1'UNZ+1+REF1'", "UNH+1'\r\nBGM+2'\nUNT+2'", "UNH+1'\rX'", "UNH+1+:+::+'", "UNH++++'", "?A'", "UNH+1'+'", "UNH+1':'"];
for (const n of [406,812,1624]) syn.push(hdr+Array.from({length:n-6},(_,i)=>i%3==0?`LIN+${i}'`:`QTY+220:${i}?.${i%10}:KWH'`).join('')+"UNT+1+1'UNZ+1+REF1'");
cases.push(...syn);
// fuzz
let seed=42;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
const alpha=["A","B","U","N","H","L","I","Q","T","Y","0","1",":","+","?","'"," ","\n","\r",",",".","*","~","é"];
for(let k=0;k<20000;k++){let s=rnd()<0.2?"UNA:+.? ":rnd()<0.1?"UNA*~,# ":"";const L=Math.floor(rnd()*60);for(let i=0;i<L;i++)s+=alpha[Math.floor(rnd()*alpha.length)];if(rnd()<0.5)s="UNH+"+s+"'";cases.push(s);}
let diff=0,nulls=0,nonnull=0;
for(const c of cases){const r=await db.query(`select md5(gridex_utilts_binding.wire_tokens_v1($1)::text) a, md5(pg_temp.wire_tokens_new($1)::text) b, gridex_utilts_binding.wire_tokens_v1($1) is null n`,[c]);
 const x=r.rows[0]; if(x.a!==x.b){diff++; if(diff<5) console.log('DIFF',JSON.stringify(c.slice(0,80)),x);} x.n?nulls++:nonnull++;}
console.log(JSON.stringify({compared:cases.length,diff,nulls,nonnull}));
for (const n of [406,812,1624]) { const c=syn[syn.length-3+[406,812,1624].indexOf(n)];
 for (const fn of ['gridex_utilts_binding.wire_tokens_v1','pg_temp.wire_tokens_new']) { await db.query(`select ${fn}($1)`,[c]); const t=performance.now(); for(let i=0;i<3;i++) await db.query(`select jsonb_array_length(${fn}($1))`,[c]); console.log(n,fn,((performance.now()-t)/3).toFixed(1)+' ms'); } }
