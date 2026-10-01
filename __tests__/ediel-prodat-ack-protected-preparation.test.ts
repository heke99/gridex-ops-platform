import {beforeEach,describe,expect,it,vi} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {composeProdatAperakText} from '@/lib/ediel/prodat/prodatAperakText'
import {resolveProdatAckMessageFunction} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({read:vi.fn(),build:vi.fn(),qualify:vi.fn()}))
vi.mock('@/lib/ediel/core/ackDraftSource',()=>({readExistingAckBeforeDraft:io.read}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.qualify}))
vi.mock('@/lib/ediel/ack',()=>({buildAckDraftForSource:io.build,getUtiltsAckTransactionTargets:()=>[]}))
import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft'
const original={id:'immutable-original',status:'failed',raw_payload:'immutable raw'} as EdielMessageRow
function source(lines:string[],code='Z04'){
 const raw=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',interchangeReference:'I',acknowledgementRequest:true,messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:[`BGM+${code}+D+9+AB`,'DTM+137:202609301200:203','DTM+ZZZ:1:805','NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE',...lines]}]})
 return {id:'source',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:code,raw_payload:raw,company_id:'company',environment:'test'} as EdielMessageRow
}
const lines=['LIN+1++OBJECT-A:::9','RFF+LI:OWN-A','LIN+2++OBJECT-B:::9','RFF+LI:OWN-B']
beforeEach(()=>{vi.clearAllMocks();io.read.mockResolvedValue(null);io.build.mockImplementation(()=>{throw new Error('fresh-render-must-not-run')})})
describe('P protected ACK preparation',()=>{
 it('reads the full physical P34 object set before any fresh renderer or guide',async()=>{
  io.read.mockImplementation(async p=>p.ackScope==='object'&&p.acknowledgedReferences.join(',')==='OWN-A,OWN-B'?original:null)
  expect(await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:source(lines),ackFamily:'APERAK',outcome:'positive'})).toEqual({kind:'existing',message:original})
  expect(io.read.mock.calls.map(([p])=>[p.ackScope,p.acknowledgedReferences])).toEqual([['message',undefined],['object',['OWN-A','OWN-B']]])
  expect(io.build).not.toHaveBeenCalled();expect(io.qualify).not.toHaveBeenCalled()
 })
 it('uses only the first own LI for repeated registers of the same object',async()=>{
  io.read.mockImplementation(async p=>p.ackScope==='object'?original:null)
  const multi=source(['LIN+1+1:1+OBJECT-A:::9','RFF+LI:FIRST','LIN+2+1:2+OBJECT-A:::9','MEA+AAE+ZZZ'])
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:multi,ackFamily:'APERAK',outcome:'positive'})).kind).toBe('existing')
  expect(io.read.mock.calls[1][0]).toMatchObject({ackScope:'object',acknowledgedReferences:['FIRST']})
 })
 it('reuses a true whole P27 negative before fresh source diagnostic qualification',async()=>{
  io.read.mockResolvedValue(original)
  expect(await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:source(lines,'BAD'),ackFamily:'APERAK',outcome:'negative'})).toEqual({kind:'existing',message:original})
  expect(io.read).toHaveBeenCalledTimes(1);expect(io.build).not.toHaveBeenCalled()
 })
 it('binds a qualified own error to its actual LI without borrowing another object',async()=>{
  const message=source(lines),wire=tokenizeEdifact(message.raw_payload!),group=prodatRegisterGroups(wire.segments,wire.una,'Z04').groups[1]
  const diagnostic=prodatFieldDiagnostic('213','missing',{rawSegments:wire.segments.map(t=>t.raw),una:wire.una,code:'Z04'},group.segments.map(t=>t.raw),'P:own213',group.lineIndex)
  if(diagnostic.kind!=='field')throw new Error('fixture own diagnostic missing')
  const text=composeProdatAperakText(diagnostic);if(text.kind!=='ready')throw new Error('fixture text unavailable')
  const own=diagnostic.occurrence,error={ercCode:'41',fieldCode:'213',text:text.text,prodatFieldDiagnostic:diagnostic,prodatAperakText:text,prodatOccurrence:own,referenceQualifier:'Z07',referenceNumber:own.objectId,lineItemReference:own.lineItemReference}
  io.read.mockImplementation(async p=>p.ackScope==='object'?original:null)
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:message,ackFamily:'APERAK',outcome:'negative',applicationErrors:[error]})).kind).toBe('existing')
  expect(io.read.mock.calls[1][0]).toMatchObject({ackScope:'object',acknowledgedReferences:['OWN-B']})
 })
 it('does not treat a missing or ambiguous own LI as whole-message coverage',async()=>{
  await expect(prepareSourceAckDraft({actorUserId:'actor',sourceMessage:source(['LIN+1++OBJECT-A:::9','RFF+LI:ONE','RFF+LI:TWO']),ackFamily:'APERAK',outcome:'positive'})).rejects.toThrow('own_line_reference_required')
  expect(io.read).toHaveBeenCalledTimes(1);expect(io.build).not.toHaveBeenCalled()
 })
 it('allows a selected own A response while rejected sibling B lacks its own LI',async()=>{
  const message=source(['LIN+1++OBJECT-A:::9','RFF+LI:OWN-A','LIN+2++OBJECT-B:::9']),wire=tokenizeEdifact(message.raw_payload!),index=wire.segments.find(t=>t.tag==='LIN')!.index
  io.read.mockImplementation(async p=>p.ackScope==='object'?original:null)
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:message,ackFamily:'APERAK',outcome:'positive',prodatAcknowledgementLineIndices:[index]})).kind).toBe('existing')
  expect(io.read.mock.calls[1][0]).toMatchObject({ackScope:'object',acknowledgedReferences:['OWN-A']})
  io.read.mockResolvedValue(null)
  await expect(prepareSourceAckDraft({actorUserId:'actor',sourceMessage:message,ackFamily:'APERAK',outcome:'positive'})).rejects.toThrow('own_line_reference_required')
 })
 it('projects fresh P34 object scope from the same physical source selector',async()=>{
  io.build.mockReturnValue({rawPayload:'fresh'})
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:source(lines),ackFamily:'APERAK',outcome:'positive'})).kind).toBe('draft')
  expect(io.build.mock.calls[0][0]).toMatchObject({ackScope:'object'})
 })
 it('projects a source-qualified fresh header rejection as P27/message',async()=>{
  const message=source(lines,'BAD'),wire=tokenizeEdifact(message.raw_payload!)
  const diagnostic=prodatFieldDiagnostic('202','invalid',{rawSegments:wire.segments.map(t=>t.raw),una:wire.una,code:'BAD'},[], 'PRODAT26A:§2.2:ALL:202',undefined,'header')
  if(diagnostic.kind!=='field')throw new Error('fixture diagnostic absent')
  const text=composeProdatAperakText(diagnostic);if(text.kind!=='ready')throw new Error('fixture text absent')
  const own=diagnostic.occurrence,error={ercCode:'42',fieldCode:'202',text:text.text,prodatFieldDiagnostic:diagnostic,prodatAperakText:text,prodatOccurrence:own,referenceQualifier:null,referenceNumber:null,lineItemReference:null}
  expect(resolveProdatAckMessageFunction({sourceWire:wire,hasProdatWire:true,messageCode:'BAD',outcome:'negative',applicationErrors:[error]})).toBe('27')
  io.build.mockReturnValue({rawPayload:'fresh'})
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:message,ackFamily:'APERAK',outcome:'negative',applicationErrors:[error]})).kind).toBe('draft')
  expect(io.build.mock.calls[0][0]).toMatchObject({ackScope:'message'})
 })
 it('keeps malformed-body CONTRL on the independent technical path',async()=>{
  io.read.mockResolvedValue(original)
  const malformed=source(lines);malformed.raw_payload+="FTX+AAI+++dangling?"
  expect((await prepareSourceAckDraft({actorUserId:'actor',sourceMessage:malformed,ackFamily:'CONTRL',outcome:'negative'})).kind).toBe('existing')
  expect(io.read.mock.calls[0][0]).toMatchObject({ackScope:'interchange'})
 })
})
