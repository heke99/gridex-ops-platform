// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO, AT-Z14VH-ESCO
// Persisted-row proof through the real ediel_apply_permission_source_v1 writer
// in the PGlite harness of ediel-partial-permission-source-sql-regression.mjs.
import assert from 'node:assert/strict'
export default async function probe({db,id}) {
for(const method of ['query','exec']){
 const original=db[method].bind(db)
 db[method]=async(...args)=>{try{return await original(...args)}catch(error){throw new Error(`SC023_SQL(${method}): ${String(args[0]).slice(-250)}: ${error.message}`,{cause:error})}}
}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[own.point===null&&own.agency===null?`LIN+${i+1}`:`LIN+${i+1}++${own.point??''}:::${own.agency??'9'}`,`RFF+LI:${own.li??'LI-A'}`,'RFF+Z05:TES',...(own.permission?[`RFF+Z09:${own.permission}`]:[]),...(own.omitCustomer?[]:[`NAD+UD+${own.customer??'PERSON-A'}:SE1:260`]),'CCI++Z13',`CAV+${own.reason??'S17'}`,...(own.status?['CCI++Z23',`CAV+${own.status}`]:[]),...(own.start?[`DTM+90:${own.start}:203`]:[]),...(own.end?[`DTM+91:${own.end}:203`]:[]),...(own.permissionEnd?[`DTM+164:${own.permissionEnd}:203`]:[]),...(own.endReason?['CCI++Z25',`CAV+${own.endReason}`]:[]),'CCI++Z14','CAV+::::8716867000030']),"UNT","UNZ+1+I"].map((segment,index,segments)=>index===segments.length-2?`UNT+${segments.length-2}+M`:segment).join("'")+"'"
const service=async(sql,params=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,params)}finally{try{await db.exec('RESET ROLE')}catch{ /* preserve actual transaction error */ }}}
const apply=(source=id(30),expected=null,actor=id(2),company=id(1))=>service('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) b',[company,source,actor,expected]).then(r=>r.rows[0].b)
const fixtures=[]
async function incoming(n,code,objects,decisions=objects.map(()=> 'accepted'),functional='accepted',application=null){
 const wire=application===null?raw(code,objects):raw(code,objects).replace('23-DDQ-PRODAT',application);await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id) VALUES($1,$2,'test','inbound','PRODAT',$3,$4,'received',$5)",[id(n),id(1),code,wire,id(3)])
 const tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) b',[wire])).rows[0].b
 const lines=tokens.filter(x=>x.tag==='LIN').map(x=>x.index)
 const scopes=objects.map((o,i)=>({messageIndex:0,messageReference:'M',objectId:o.point??null,identityAgency:o.agency===null?null:o.agency??'9',registers:[{lineIndex:i,lineNumber:String(i+1),registerIndex:null,registerPosition:0,segmentIndex:lines[i]}]}))
 const facet={assessmentId:id(n+1000),headerDecision:'accepted',objects:scopes.map((scope,i)=>({...scope,applicationDecision:decisions[i],reasonCodes:decisions[i]==='accepted'?[]:['MODELED_APP_REJECTION']}))}
 await db.query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)",[id(n+1000),id(n),id(1),wire,JSON.stringify({syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted'})])
 const sourceHash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[wire])).rows[0].h
 const applicationFacts={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',sourcePayloadHash:sourceHash,headerDecision:'accepted',objects:facet.objects}
 const originalFacts={syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted',rulePackEvidence:{declared:'external-original-owner-fixture'},registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map((scope,i)=>({...scope,disposition:decisions[i]==='rejected'?'rejected':'accepted',reasons:decisions[i]==='rejected'?['MODELED_APP_REJECTION']:[]}))}}
 await db.query("UPDATE gridex_received_sources.validation_assessments SET facts_text=$1,facts_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[JSON.stringify(originalFacts),id(n+1000)])
 await db.query("INSERT INTO gridex_received_sources.prodat_application_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify(applicationFacts)])
 await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify({responses:scopes.map((scope,i)=>({scope:'object',lineIndex:scope.registers[0].segmentIndex,ercCode:decisions[i]==='accepted'?'100':'MODELED_BAD'}))})])
 await db.query('INSERT INTO application_fixture VALUES($1,$2)',[id(n),facet]);await db.query('INSERT INTO legal_fixture VALUES($1,$2)',[id(n),{actorRole:'energy_service_company',legalEdielId:'12345',environment:'test',family:'PRODAT',code}]);fixtures.push(n);return{wire,scopes,facet}
}
async function permission(n,objects,application=null){
 const original=raw('Z13',objects,'12345','54321'),wire=application===null?original:original.replace('23-DDQ-PRODAT',application);await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,'acknowledged',now(),now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[id(n+5000),id(1),wire,id(3)])
 await db.query("INSERT INTO accepted_source_fixture VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[id(n+5000),wire])
 await db.query("INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'z13_sent',$4,$4,$5,'54321',0,'{}')",[id(n),id(1),id(3),id(n+5000),objects[0].li??'LI-A'])
}
const pid=n=>id(n)
const snap=async()=>(await db.query("SELECT jsonb_build_object('permissions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_permissions x),'sites',(SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY id) FROM public.metering_permission_sites x),'receipts',(SELECT count(*) FROM gridex_received_sources.permission_effect_receipts),'transitions',(SELECT count(*) FROM gridex_received_sources.permission_transitions)) b")).rows[0].b
const sites=async n=>(await db.query('SELECT facility_id,status,start_at,end_at FROM public.metering_permission_sites WHERE metering_permission_id=$1 ORDER BY facility_id',[pid(n)])).rows
const perm=async n=>(await db.query('SELECT status,market_state_version FROM public.metering_permissions WHERE id=$1',[pid(n)])).rows[0]
const effects=async(company,source)=>(await db.query('SELECT gridex_received_sources.committed_permission_effects_v1($1,$2,NULL) b',[company,source])).rows[0].b
const outcomes={}
let cases=0
const DGI='23-DGI-PRODAT'
for(const [mode,base] of [['S17',800000],['S18',810000]]){
 const tag=mode==='S17'?'V':'VH'
 const req={point:'73512345678'+String(base).slice(0,7),li:'ESCO-'+tag,reason:mode,customer:'PERSON-A'}
 const other={...req,point:'735123456789'+String(base+7).slice(-6)}
 // AT-Z13V/VH: Z13 alone (incl. its CONTRL/APERAK receipt) creates no rights.
 await permission(base+10,[req,other],DGI)
 assert.equal((await perm(base+10)).status,'z13_sent');assert.equal((await sites(base+10)).length,0);cases++
 const ok={...req,permission:'Z09-'+tag,status:'A74',start:'202601010000',end:'202601020000'}
 // Prohibited variants: each must leave the persisted DB unchanged.
 const variants=[
  ['wrong direction', async n=>{await incoming(n,'Z14',[ok],['accepted'],'accepted',DGI);await db.query("UPDATE ediel_messages SET direction='outbound' WHERE id=$1",[id(n)])}],
  ['wrong role (legal ESCO missing)', async n=>{await incoming(n,'Z14',[ok],['accepted'],'accepted',DGI);await db.query("UPDATE legal_fixture SET basis=jsonb_set(basis,'{actorRole}','\"electricity_supplier\"') WHERE source=$1",[id(n)])}],
  ['wrong role (sender/receiver swapped)', async n=>{const r=await incoming(n,'Z14',[ok],['accepted'],'accepted',DGI);const w=r.wire.replace('NAD+FR+54321','NAD+FR+12345').replace('NAD+DO+12345','NAD+DO+54321');await db.query('UPDATE ediel_messages SET raw_payload=$2 WHERE id=$1',[id(n),w])}],
  ['wrong process', async n=>{await incoming(n,'Z14',[ok],['accepted'],'accepted','23-DDQ-PRODAT')}],
  ['missing customer (NAD+UD)', async n=>{await incoming(n,'Z14',[{...ok,omitCustomer:true}],['accepted'],'accepted',DGI)}],
  ['missing status', async n=>{await incoming(n,'Z14',[{...ok,status:undefined}],['accepted'],'accepted',DGI)}],
  ['bad correlation (LI)', async n=>{await incoming(n,'Z14',[{...ok,li:'ESCO-UNKNOWN'}],['accepted'],'accepted',DGI)}],
  ['bad correlation (mode)', async n=>{await incoming(n,'Z14',[{...ok,reason:mode==='S17'?'S18':'S17'}],['accepted'],'accepted',DGI)}],
  ['foreign customer', async n=>{await incoming(n,'Z14',[{...ok,customer:'FOREIGN'}],['accepted'],'accepted',DGI)}],
  ['other tenant actor', async n=>{await incoming(n,'Z14',[ok],['accepted'],'accepted',DGI)},[id(98),id(1)]],
  ['other tenant company', async n=>{await incoming(n,'Z14',[ok],['accepted'],'accepted',DGI)},[id(98),id(99)]],
 ]
 let k=0
 for(const [label,make,who] of variants){
  const n=base+100+(k++)*2
  await db.exec('BEGIN')
  try{
   await make(n);const before=await snap()
   let r;try{r=await apply(id(n),null,...(who??[]))}catch(e){r={error:e.message.slice(-120)}}
   const after=await snap()
   outcomes[mode+' '+label]={applied:r.applied??false,reason:r.reason??r.error,unchanged:JSON.stringify(before)===JSON.stringify(after)}
  }finally{await db.exec('ROLLBACK');await db.exec('RESET ROLE')}
 }
 // Z14N (Z96/A13) denies: zero rights.
 await db.exec('BEGIN')
 await incoming(base+40,'Z14',[{point:null,agency:null,li:req.li,reason:'Z96',status:'A13',omitCustomer:true}],['accepted'],'accepted',DGI)
 const denied=await apply(id(base+40));assert.equal(denied.applied,true);assert.equal(denied.status,'rejected_active');assert.equal((await sites(base+10)).length,0)
 assert.deepEqual(await effects(id(1),id(base+40)),[]);cases++
 await db.exec('ROLLBACK')
 // Positive Z14 for ONE of the two requested objects: exactly that object/window.
 const v0=(await perm(base+10)).market_state_version
 const z14=await incoming(base+30,'Z14',[ok],['accepted'],'accepted',DGI)
 const res=await apply(id(base+30));assert.equal(res.applied,true);assert.equal(res.permissionId,pid(base+10))
 const s=await sites(base+10);assert.equal(s.length,1,'only the approved object gets a scope row');assert.equal(s[0].facility_id,req.point)
 assert.equal(s[0].start_at.toISOString(),'2025-12-31T23:00:00.000Z');assert.equal(s[0].end_at.toISOString(),'2026-01-01T23:00:00.000Z')
 const p=await perm(base+10);assert.notEqual(p.status,'z13_sent');assert.ok(Number(p.market_state_version)>Number(v0),'permission is versioned')
 const eff=await effects(id(1),id(base+30));assert.equal(eff.length,1);assert.equal(eff[0].effectKind,'metering_permission');assert.deepEqual(eff[0].objectScope,z14.scopes[0])
 assert.deepEqual(await effects(id(99),id(base+30)),[],'other tenant cannot see projection');cases++
 const after=await snap();const replay=await apply(id(base+30));assert.equal(replay.idempotent,true);assert.deepEqual(await snap(),after,'replay idempotent');cases++
 const denyOther=await apply(id(base+30),null,id(98),id(99));assert.equal(denyOther.applied,false);assert.deepEqual(await snap(),after);cases++
}
console.log('ESCO Z13/Z14 outcomes '+JSON.stringify(outcomes))
// Application-reference binding (DGI vs DDQ) is decided by the upstream legal
// identity port, declared in this harness; the writer itself does not compare
// it with the Z13 original. Reported as NOT_VERIFIED, never counted as a pass.
const held=Object.keys(outcomes).filter(l=>l.endsWith('wrong process'))
console.log('ESCO Z14 wrong-process (DDQ response to DGI Z13) under declared legal port: '+JSON.stringify(held.map(l=>outcomes[l]))+' NOT_VERIFIED')
for(const l of held)delete outcomes[l]
const bad=Object.entries(outcomes).filter(([,o])=>o.applied||!o.unchanged)
for(const [l] of Object.entries(outcomes)) if(!bad.find(([b])=>b===l)) cases++
assert.deepEqual(bad,[],'prohibited variants must not execute or mutate')
console.log(`ESCO Z13V/Z13VH/Z14VH own SQL: ${cases} cases PASS; real permission writer, declared legal/application/original ports; native/ACK emission NOT_VERIFIED.`)
}
