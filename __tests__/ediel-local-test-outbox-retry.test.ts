// EDIEL03.01: unit boundary only; native clock/claim/concurrency require Main proof.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const ports=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),get:vi.fn(),transport:vi.fn(),readBuild:vi.fn(),createTransport:vi.fn(),archiveMime:vi.fn(),config:{provider:"strato",host:"127.0.0.1",port:55465,secure:true,user:"unit@example.invalid",password:"unit-only-not-a-credential",from:"unit@example.invalid",replyTo:"unit@example.invalid"},providerCalls:0,caCertificates:[] as string[]|undefined,selectedTls:{requireTLS:false,rejectUnauthorized:false,minVersion:null as string|null,ca:undefined as string[]|undefined},selected:{host:"",port:0,secure:false}}))
vi.mock('nodemailer',()=>({default:{createTransport:ports.createTransport}}))
vi.mock('node:tls',async importOriginal=>({...await importOriginal<typeof import('node:tls')>(),getCACertificates:()=>ports.caCertificates}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>ports.config,edielSmtpConfig:()=>ports.config}))
vi.mock('@/lib/ediel/transport/rawMimeArchive',()=>({archiveTransportRawMime:ports.archiveMime}))
vi.mock('node:fs/promises',()=>({readFile:ports.readBuild}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:ports.rpc,from:ports.from}}))

// Finite I/O ports only. These do not qualify native authorization or SMTP.
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:ports.get}))
vi.mock('@/lib/ediel/transport',()=>({sendEdielMessageViaSmtp:ports.transport}))
vi.mock('@/lib/ediel/transport/acceptedProjection',()=>({readAcceptedEdielTransportProjection:async()=>null}))
vi.mock('@/lib/tenant/operationPolicy',()=>({getTenantOperationDecision:async()=>({allowed:true})}))
vi.mock('@/lib/ediel/outbox/routeContract',()=>({evaluateEdielRouteContract:async()=>({ok:true,blocker:null,checks:[]})}))
vi.mock('@/lib/ediel/outbox/readinessGuard',()=>({getEdielOutboundReadinessBlocker:async()=>null}))
import {sendOutboxItem} from '@/lib/ediel/outbox/sendOutboxItem'
import {createGenericEdielAttemptGate,sendGenericFencedEdielEmail} from '@/lib/ediel/transport/outboundAttempt'
const observedAt='2026-11-11T12:00:00.000Z',notBefore='2026-11-11T12:01:00.000Z',deadline='2026-11-11T12:10:00.000Z'
function context(environment='test') {return {message:{id:'message',company_id:'company',environment,raw_payload:'original',communication_route_id:'route'} as EdielMessageRow,actorUserId:'actor',owner:{kind:'worker',outboxId:'outbox',sendAttemptId:'lease',workerId:'worker'} as const,mimeMode:'attachment',payload:Buffer.from('original'),encoding:'latin1'}}
const actual={from:'sender@example.invalid',to:'receiver@example.invalid',rfcMessageId:'<local>',mimeArchiveRef:'private-original',mimeSha256:'b'.repeat(64),mimeLength:123}
const refusal=()=>Object.assign(new Error('synthetic refusal'),{responseCode:451,command:'DATA'})
let receiptDelta:Record<string,unknown>,classification:string,observationFailure:boolean,enforceBuild:boolean,enforceEndpoint:boolean
const endpoint={version:1,provider:'strato',host:'127.0.0.1',port:55465,secure:true,requireTLS:true,rejectUnauthorized:true,minVersion:'TLSv1.2',servername:null,caTrustSha256:'5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f',fingerprint:'33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b'}
const archive={rfcMessageId:'<local>',mimeArchiveRef:'private-original',mimeSha256:'b'.repeat(64),mimeLength:123}
beforeEach(()=>{enforceEndpoint=false;ports.caCertificates=['SYNTHETIC PUBLIC CA ONLY'];ports.providerCalls=0;ports.config={provider:'strato',host:'127.0.0.1',port:55465,secure:true,user:'unit@example.invalid',password:'unit-only-not-a-credential',from:'unit@example.invalid',replyTo:'unit@example.invalid'};ports.createTransport.mockReset();ports.createTransport.mockImplementation(options=>{
 ports.selected={host:options.host,port:options.port,secure:options.secure}
 ports.selectedTls={requireTLS:options.requireTLS===true,rejectUnauthorized:options.tls?.rejectUnauthorized===true,minVersion:options.tls?.minVersion??null,ca:Array.isArray(options.tls?.ca)?[...options.tls.ca]:undefined}
 return {sendMail:async()=>{ports.providerCalls++;throw refusal()}}
});ports.archiveMime.mockReset();ports.archiveMime.mockResolvedValue(archive);enforceBuild=false;ports.readBuild.mockReset();ports.readBuild.mockResolvedValue('owned-local-build-v1\n');receiptDelta={};classification='explicit_negative';observationFailure=false;ports.rpc.mockReset();ports.rpc.mockImplementation(async (_name,{p_input:i})=>{
 if(enforceEndpoint&&['prepare','enter'].includes(i.action)&&(!i.serverSmtpEndpoint||Object.keys(i.serverSmtpEndpoint).length!==Object.keys(endpoint).length||!Object.entries(endpoint).every(([k,v])=>i.serverSmtpEndpoint[k]===v)))return {data:null,error:Object.assign(Error('local_wait_smtp_endpoint_mismatch'),{code:'55000'})}
 if(enforceBuild&&['prepare','enter'].includes(i.action)&&i.serverBuildSha256!=='c49d39cf18f31450b456d9e1406dd5b7e385848d5432a3b74b908c5a3293f5af')return {data:null,error:Object.assign(Error('local_wait_build_identity_mismatch'),{code:'55000'})}
 if(i.action!=='observe')return {data:{proceed:true},error:null}
 if(observationFailure)return {data:null,error:Error('lost commit response')}
 return {error:null,data:{classification,state:'observed',observedAt,localTestWait:{version:1,policyVersion:'local-test-4xx-v1',companyId:i.companyId,messageId:i.messageId,attemptId:i.attemptId,outboxId:'outbox',environment:'test',smtpCode:451,observedAt,notBefore,deadline,delaySeconds:60,...receiptDelta}}}
})})
async function failure(environment='test',error:unknown=refusal()) {const gate=createGenericEdielAttemptGate({to:actual.to,subject:'local'},context(environment));await gate.entry.beforeProviderCall(actual);return gate.fail(error)}
describe('committed LOCAL TEST refusal receipt, never client timer authority',()=>{
 it('surfaces native persisted due without turning definitive refusal into uncertainty',async()=>{
  await expect(failure()).rejects.toMatchObject({code:'ediel_local_test_retry_wait',notBefore,deadline})
 })
 it.each(['companyId','messageId','attemptId','outboxId','environment','policyVersion'])('rejects mismatched native %s',async key=>{receiptDelta={[key]:'foreign'};await expect(failure()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
 it.each([{notBefore:observedAt},{delaySeconds:0},{delaySeconds:3601},{deadline:notBefore},{smtpCode:550},{observedAt:'invalid'}])('fails closed on invalid wait receipt %j',async delta=>{receiptDelta=delta;await expect(failure()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
 it.each([1,3600])('accepts exact native bounded delay %s without scheduling a client retry',async seconds=>{receiptDelta={delaySeconds:seconds,notBefore:new Date(Date.parse(observedAt)+seconds*1000).toISOString(),deadline:'2026-11-11T14:00:00.000Z'};await expect(failure()).rejects.toMatchObject({code:'ediel_local_test_retry_wait'})})
 it('keeps production behavior even if a local-shaped receipt arrives',async()=>{await expect(failure('production')).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
 it('never retries on provider-text-only 4xx',async()=>{await expect(failure('test',Error('451 try later'))).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
 it('keeps unknown observation in reconciliation',async()=>{classification='unknown';await expect(failure()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
 it('keeps lost native response in reconciliation',async()=>{observationFailure=true;await expect(failure()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})})
})

it('real sender catch preserves the atomic native queue/due result without overwriting it',async()=>{
 const row:Record<string,unknown>={id:'outbox',company_id:'company',ediel_message_id:'message',environment:'test',status:'sending',locked_by:'worker',locked_at:new Date().toISOString(),current_send_attempt_id:'lease',attempts:1,send_attempt_count:1}
 ports.get.mockResolvedValue({...context().message,status:'ready'})
 ports.from.mockImplementation((table:string)=>{
  if(table==='ediel_send_locks'){const q={select:()=>q,eq:()=>q,limit:async()=>({data:[],error:null})};return q}
  if(table!=='ediel_outbox')throw Error('undeclared_unit_port')
  let patch:Record<string,unknown>|undefined;const filters:Array<[string,unknown]>=[]
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},update:(v:Record<string,unknown>)=>{patch=v;return q},maybeSingle:async()=>{
   if(!filters.every(([k,v])=>row[k]===v))return {data:null,error:null}
   if(patch)Object.assign(row,patch)
   return {data:{...row},error:null}
  }};return q
 })
 const native=ports.rpc.getMockImplementation()!
 ports.rpc.mockImplementation(async(...args)=>{const result=await native(...args);if(args[1].p_input.action==='observe')Object.assign(row,{status:'queued',locked_at:null,locked_by:null,last_error:'ediel_local_test_retry_wait'});return result})
 ports.transport.mockImplementation(()=>failure())
 await expect(sendOutboxItem({actorUserId:'actor',outboxItemId:'outbox',workerId:'worker',alreadyClaimed:true})).resolves.toEqual({status:'blocked',messageId:null,error:'ediel_local_test_retry_wait'})
 expect(row).toMatchObject({status:'queued',attempts:1,send_attempt_count:1,locked_at:null,locked_by:null,last_error:'ediel_local_test_retry_wait'})
})

describe('measured server build for native LOCAL prepare and entry',()=>{
 it('admits only the actual measured server build at both native boundaries',async()=>{
  enforceBuild=true
  await expect(failure()).rejects.toMatchObject({code:'ediel_local_test_retry_wait'})
  expect(ports.readBuild).toHaveBeenCalledTimes(2)
 })
 it('fails closed when the actual build file is missing',async()=>{
  enforceBuild=true;ports.readBuild.mockRejectedValue(Object.assign(Error('missing'),{code:'ENOENT'}))
  await expect(failure()).rejects.toMatchObject({code:'55000'})
  expect(ports.rpc.mock.calls.map(c=>c[1].p_input.action)).toEqual(['prepare'])
 })
 it('fails closed on a different build on the same database/boot',async()=>{
  enforceBuild=true;ports.readBuild.mockResolvedValue('different-local-build')
  await expect(failure()).rejects.toMatchObject({code:'55000'})
 })
 it('remeasures entry and denies a build change after successful prepare',async()=>{
  enforceBuild=true;ports.readBuild.mockResolvedValueOnce('owned-local-build-v1').mockResolvedValue('different-local-build')
  await expect(failure()).rejects.toMatchObject({code:'55000'})
  expect(ports.rpc.mock.calls.map(c=>c[1].p_input.action)).toEqual(['prepare','enter'])
 })
 it('does not read a build file or add a build pin for production',async()=>{
  await expect(failure('production')).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
  expect(ports.readBuild).not.toHaveBeenCalled()
  expect(ports.rpc.mock.calls.every(c=>!('serverBuildSha256' in c[1].p_input))).toBe(true)
 })
})

// Actual sendEdielEmail adapter and its same createTransport options, only the
// network/archive/native ports simulated. This is NOT real TLS/source proof.
const sendCaptured=()=>sendGenericFencedEdielEmail({raw:Buffer.from('SYNTHETIC MIME'),to:actual.to,envelopeFrom:actual.from},context())
describe('same-transporter LOCAL SMTP destination, never later environment state',()=>{
 it('allows a qualified captured endpoint and keeps all credential fields out of its witness',async()=>{
  enforceEndpoint=true
  await expect(sendCaptured()).rejects.toMatchObject({code:'ediel_local_test_retry_wait'})
  expect(ports.providerCalls).toBe(1)
  const binding=ports.rpc.mock.calls.find(c=>c[1].p_input.action==='prepare')![1].p_input.serverSmtpEndpoint
  expect(Object.keys(binding).sort()).toEqual(Object.keys(endpoint).sort())
  expect(JSON.stringify(binding).includes(ports.config.password)).toBe(false)
 })
 it.each([{host:'smtp.example.invalid'},{port:55466},{secure:false}])('denies changed actual destination %j before provider',async delta=>{
  enforceEndpoint=true;Object.assign(ports.config,delta)
  await expect(sendCaptured()).rejects.toMatchObject({code:'55000'})
  expect(ports.providerCalls).toBe(0)
 })
 it('denies a missing captured endpoint rather than trusting configuration metadata',async()=>{
  enforceEndpoint=true
  await expect(failure()).rejects.toMatchObject({code:'55000'})
  expect(ports.providerCalls).toBe(0)
 })
 it('does not replace captured unsafe OLD config with later qualified config',async()=>{
  enforceEndpoint=true;ports.config.host='smtp.example.invalid'
  ports.archiveMime.mockImplementationOnce(async()=>{ports.config.host='127.0.0.1';return archive})
  await expect(sendCaptured()).rejects.toMatchObject({code:'55000'})
  expect(ports.selected.host).toBe('smtp.example.invalid');expect(ports.providerCalls).toBe(0)
 })
 it('keeps qualified OLD transporter even if environment changes during archive await',async()=>{
  enforceEndpoint=true
  ports.archiveMime.mockImplementationOnce(async()=>{ports.config.host='smtp.example.invalid';return archive})
  await expect(sendCaptured()).rejects.toMatchObject({code:'ediel_local_test_retry_wait'})
  expect(ports.selected.host).toBe('127.0.0.1');expect(ports.providerCalls).toBe(1)
 })
 it('denies a registered LOCAL context if effective CA proof is unavailable',async()=>{
  enforceEndpoint=true;ports.caCertificates=[]
  await expect(sendCaptured()).rejects.toMatchObject({code:'55000'})
  expect(ports.providerCalls).toBe(0)
 })
 it('keeps the same actual CA options when default trust changes during archive await',async()=>{
  enforceEndpoint=true
  ports.archiveMime.mockImplementationOnce(async()=>{ports.caCertificates=['DIFFERENT SYNTHETIC PUBLIC CA'];return archive})
  await expect(sendCaptured()).rejects.toMatchObject({code:'ediel_local_test_retry_wait'})
  expect(ports.providerCalls).toBe(1)
  expect(ports.selectedTls).toEqual({requireTLS:true,rejectUnauthorized:true,minVersion:'TLSv1.2',ca:['SYNTHETIC PUBLIC CA ONLY']})
 })
 it('preserves production journal shape without LOCAL endpoint fields',async()=>{
  await expect(sendGenericFencedEdielEmail({raw:Buffer.from('SYNTHETIC MIME'),to:actual.to,envelopeFrom:actual.from},context('production'))).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
  expect(ports.rpc.mock.calls.every(c=>!('serverSmtpEndpoint' in c[1].p_input)&&!('localSmtpEndpoint' in (c[1].p_input.binding??{})))).toBe(true)
  expect(ports.selectedTls.ca).toBeUndefined()
 })
})
