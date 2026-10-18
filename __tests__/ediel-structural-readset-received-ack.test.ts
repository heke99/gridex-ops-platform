import {expect,it} from 'vitest'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {renderContrl2Ediel2} from '@/lib/ediel/contrlEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {closureFixture} from './helpers/closureWireFixtures'
import {timelineScope,timelineSource,timelineBody,timelineReceipt} from './helpers/sourceDecisionTimelineFixtures'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

// Genuine received CONTRL/APERAK are recorded in the same received-source
// ledger as PRODAT. Like UTILTS they carry no structure, so they must not turn
// the structural universe into a global hold; physically unqualified bytes must.
const closure=closureFixture().wire
const TOKENS={CONTRL:'CONTRL:2:2:UN:EDIEL2',APERAK:'APERAK:D:96A:UN:E2SE6A'} as const
function ack(family:'CONTRL'|'APERAK',options:{environment?:'test'|'production';token?:string;unknown?:boolean;mutate?:(segment:string)=>string;extra?:string[]}={}){
  const source=closure.replace('BGM+Z05','BGM+Z09'),e=EdifactEnvelopeCodec.decode(source)
  let segments=family==='CONTRL'?renderContrl2Ediel2({source:{rawPayload:source},outcome:'positive'}).segments
    :renderAperakEdiel({source:{id:'00000000-0000-4000-8000-0000000000a1',messageFamily:'PRODAT',messageCode:'Z09',rawPayload:source},refs:{},externalReference:'EXT1',transactionReference:'TRN1',outcome:'positive'}).segments
  // Same uncorrelatable references as the native negative control.
  if(options.unknown)segments=segments.map(s=>s.startsWith('UCI+')?s.replace(/^(UCI\+)[^+]*/,'$1UNKNOWN'):s.startsWith('RFF+ACW:')?'RFF+ACW:UNKNOWN':s)
  if(options.mutate)segments=segments.map(options.mutate)
  if(options.extra)segments=[...segments,...options.extra]
  return EdifactEnvelopeCodec.encode({sender:e.receiver!,receiver:e.sender!,senderQualifier:e.receiverQualifier,receiverQualifier:e.senderQualifier,senderSubAddress:e.receiverSubAddress,receiverSubAddress:e.senderSubAddress,
    applicationReference:e.applicationReference,acknowledgementRequest:false,environment:options.environment??'test',interchangeReference:'IREF1',
    messages:[{messageReference:'MREF1',messageTypeToken:options.token??TOKENS[family],businessSegments:segments}]})
}
function read(raw:string,code:string){
  return inspectStructuralReadset(timelineScope,timelineReceipt(timelineBody([
    timelineSource({messageCode:'Z05',rawPayload:closure,payloadHash:evidenceHash(closure),assessments:[]}),
    timelineSource({sourceMessageId:'00000000-0000-4000-8000-0000000000e7',messageCode:code,rawPayload:raw,payloadHash:evidenceHash(raw),assessments:[]})])))
}
const intakeCode=(raw:string)=>parseEdifactPayload(raw).messageCode!
it.each(['CONTRL','APERAK'] as const)('a received %s, correlated or not, carries no structure and does not make the structural universe incomplete',family=>{
  for(const raw of [ack(family),ack(family,{unknown:true})]){
    const result=read(raw,intakeCode(raw))
    expect(result.timeline.status).toBe('inspected');expect(result.unresolvedSources).toBe(false)
    // The PRODAT closure in the same snapshot is still projected unchanged;
    // the ACK itself contributes no source, version or authority.
    expect(result.closureBlockers).toHaveLength(1);expect(result.versions).toEqual([])
    expect(result.sources.map(s=>s.sourceMessageId)).not.toContain('00000000-0000-4000-8000-0000000000e7')
  }
})
it.each(['CONTRL','APERAK'] as const)('a physically unqualified %s or a false recorded code stays a global hold',family=>{
  const raw=ack(family),code=intakeCode(raw)
  // False recorded code.
  expect(read(raw,'Z04').unresolvedSources).toBe(true)
  // Trailing garbage.
  expect(read(raw+'?',code).unresolvedSources).toBe(true)
  // Wrong UNT segment count and wrong UNZ message count.
  expect(read(raw.replace(/UNT\+(\d+)\+/,(_,n)=>`UNT+${Number(n)+1}+`),code).unresolvedSources).toBe(true)
  expect(read(raw.replace(/UNZ\+1\+/,'UNZ+2+'),code).unresolvedSources).toBe(true)
  // Two messages in one interchange are not one ACK.
  const twice=raw.replace(/UNZ\+1\+/,'UNZ+2+').replace(/(UNH\+[\s\S]*UNT\+[^']*')/,'$1$1')
  expect(read(twice,code).unresolvedSources).toBe(true)
  // A body the canonical ACK reader cannot classify (CONTRL UCI action,
  // APERAK BGM function) and, for APERAK, an ambiguous PRODAT/UTILTS profile.
  const wrongBody=ack(family,{mutate:family==='CONTRL'?s=>s.startsWith('UCI+')?s.replace(/\+1$/,'+9'):s:s=>s.startsWith('BGM+')?s.replace(/\+(27|34)$/,'+99'):s})
  expect(wrongBody).not.toBe(raw)
  expect(read(wrongBody,intakeCode(wrongBody)).unresolvedSources).toBe(true)
  if(family==='APERAK'){
    const ambiguous=ack(family,{token:'APERAK:D:04A:UN:E5SE5A'})
    expect(read(ambiguous,intakeCode(ambiguous)).unresolvedSources).toBe(true)
  }
  // Wrong environment.
  const production=ack(family,{environment:'production'})
  expect(read(production,intakeCode(production)).unresolvedSources).toBe(true)
})
it.each(['CONTRL','APERAK'] as const)('a PRODAT body relabelled as %s in UNH stays a global hold even when its BGM code matches the recorded code',family=>{
  // Physical family label plus normalized BGM code alone cannot bind an ACK body.
  const disguised=closure.replace(/UNH\+([^+']*)\+PRODAT:[^']*/,`UNH+$1+${TOKENS[family]}`)
  expect(disguised).not.toBe(closure);expect(disguised).toContain('BGM+Z05')
  const code=intakeCode(disguised)
  expect(code).toBe('Z05')
  expect(read(disguised,code).unresolvedSources).toBe(true)
})
it.each(['CONTRL','APERAK'] as const)('a valid %s carrying an extra PRODAT body (BGM/LIN/CCI) stays a global hold under the national ACK guide',family=>{
  // Correct UNT/UNZ counts and, for CONTRL, a syntactically valid UCI action 1:
  // only the existing body policy separates this hybrid from a genuine ACK.
  const prodatBody=closure.split("'").filter(segment=>/^(BGM|DTM|NAD|LIN|IDE|CCI|CAV|RFF)\+/.test(segment))
  const hybrid=ack(family,{extra:prodatBody})
  expect(hybrid).toContain('LIN+');expect(hybrid).toContain('CCI+')
  if(family==='CONTRL')expect(hybrid).toMatch(/UCI\+[^']*\+1'/)
  expect(read(hybrid,intakeCode(hybrid)).unresolvedSources).toBe(true)
})
