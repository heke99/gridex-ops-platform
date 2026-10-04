// masterplan: TR-02, AT-TR-02
// Actual retained journal owner with explicit finite admission/archive ports.
// Not native replay, source approval, DSN delivery or production authority.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
let base=readFileSync(new URL('./ediel-transport-journal-sql-regression.mjs',import.meta.url),'utf8')
const marker=' console.log(`PASS ${checks} targeted PostgreSQL transport journal checks;'
assert.equal(base.split(marker).length,2)
const proof=String.raw`
 const {smtpResultEvidence,smtpErrorEvidence}=await import(new URL('../lib/ediel/transport/smtpEvidence.ts',import.meta.url))
 // The retained observation body is unchanged by later admission wrappers.
 // Fixtures do not qualify those independent upstream wrappers or source facts.
 let transportChecks=0
 const report=async run=>{await run();transportChecks++}
 const cases=[
  {e:smtpResultEvidence({accepted:[binding.to],rejected:[],messageId:'<provider-queue>',response:'250 2.0.0 Ok: queued as OBSERVED-QUEUE'}),classification:'accepted',smtpCode:250,queueId:'OBSERVED-QUEUE'},
  {e:smtpResultEvidence({accepted:[binding.to],rejected:[],response:'250 Message accepted'}),classification:'accepted',smtpCode:250,queueId:null},
  ...[450,550].map(code=>({e:smtpErrorEvidence(Object.assign(new Error('Synthetic rejection'),{code:'EMESSAGE',command:'DATA',responseCode:code,response:code+' Exact rejection bytes'})),classification:'explicit_negative',smtpCode:code,queueId:null})),
  {e:smtpErrorEvidence(Object.assign(new Error('Synthetic lost DATA response'),{code:'ETIMEDOUT',command:'DATA'})),classification:'unknown',smtpCode:null,queueId:null},
 ]
 for(const [index,c] of cases.entries())await report(async()=>{
  const mid=uid(30+index),aid=uid(50+index),scope={companyId:company,environment:'test',messageId:mid,actorUserId:actor,attemptId:aid}
  const rpc=async(action,extra={})=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.gridex_ediel_transport_attempt_v1($1) r',[{...scope,action,...extra}])).rows[0].r}finally{await db.exec('RESET ROLE')}}
  await db.query("INSERT INTO public.ediel_messages SELECT $1,company_id,environment,direction,message_standard,raw_payload,immutable_rendered_at,immutable_payload_hash,communication_route_id,receiver_email,'Z13' FROM public.ediel_messages WHERE id=$2",[mid,message])
  await db.query('INSERT INTO public.ediel_message_payloads SELECT company_id,$1,encrypted_payload_ref,payload_kind,metadata FROM public.ediel_message_payloads WHERE ediel_message_id=$2',[mid,message])
  const originals=(await db.query('SELECT to_jsonb(m) v FROM public.ediel_messages m ORDER BY id')).rows
  assert.equal((await rpc('prepare',{owner:{kind:'direct'},binding})).proceed,true)
  assert.equal((await rpc('enter')).proceed,true)
  assert.equal((await rpc('observe',{result:c.e})).classification,c.classification)
  const saved=(await db.query('SELECT id,company_id,message_id,binding,classification,provider_result,entered_at,observed_at FROM gridex_ediel_transport.attempts WHERE id=$1',[aid])).rows[0]
  assert.deepEqual(saved.provider_result,c.e)
  assert.equal(saved.provider_result.smtpCode,c.smtpCode);assert.equal(saved.provider_result.queueId,c.queueId)
  assert.equal(saved.id,aid);assert.equal(saved.message_id,mid);assert.equal(saved.company_id,company)
  assert.deepEqual(saved.binding,binding);assert.ok(saved.entered_at&&saved.observed_at)
  assert.deepEqual((await db.query('SELECT to_jsonb(m) v FROM public.ediel_messages m ORDER BY id')).rows,originals)
  const retained=(await db.query('SELECT to_jsonb(a) v FROM gridex_ediel_transport.attempts a WHERE id=$1',[aid])).rows[0].v
  await rpc('observe',{result:c.e})
  assert.deepEqual((await db.query('SELECT to_jsonb(a) v FROM gridex_ediel_transport.attempts a WHERE id=$1',[aid])).rows[0].v,retained)
  const retry=await rpc('prepare',{owner:{kind:'direct'},binding,attemptId:uid(70+index)})
  assert.equal(retry.proceed,false);assert.equal(retry.classification,c.classification)
  assert.equal((await db.query('SELECT count(*) n FROM gridex_ediel_transport.attempts WHERE message_id=$1',[mid])).rows[0].n,1)
 })
 console.log('TR-02 retained SMTP ledger: '+transportChecks+' checks PASS; finite upstream admission/archive, NOT native/delivery approval')
`
base=base.replace(marker,()=>proof+marker)
const temp=fileURLToPath(new URL('./.ediel-tr02-ledger.tmp.mjs',import.meta.url));writeFileSync(temp,base)
try{const r=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(r.error)throw r.error;process.exitCode=r.status??1}finally{unlinkSync(temp)}
