import { describe, expect, it } from 'vitest'
import { contrlSourceEnvelope, renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { buildContrlDraft } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'

const sender = 'S+Å:1', receiver = 'R?Ö:2', ref = "I+Ä?'1"
function raw(alternate = false) {
  return EdifactEnvelopeCodec.encode({ sender, receiver, senderQualifier:'ZZ', receiverQualifier:'ZZ', senderSubAddress:'SUB:+', receiverSubAddress:"DEST?'",
    interchangeReference:ref, environment:'test', acknowledgementRequest:true, applicationReference:'23-DDQ-PRODAT',
    ...(alternate ? {una:{componentDataElementSeparator:'*',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'}} : {}),
    messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z01+DOC+9+NA']}] })
}
describe('CONTRL physical original envelope across rendering and draft adapter', () => {
  it.each([false,true])('preserves decoded original identities and escapes canonical UCI with alternative UNA=%s', alternate => {
    const result=renderContrl2Ediel2({source:{rawPayload:raw(alternate),interchangeReference:'LOCAL-WRONG',id:'LOCAL-ID'},parsedInterchangeReference:'LOCAL-OVERRIDE',outcome:'negative'})
    const wire=tokenizeEdifact(result.segments[0]+"'"),uci=wire.segments[0]
    expect(segmentComposite(uci,1,wire.una)).toEqual([ref])
    expect(segmentComposite(uci,2,wire.una)).toEqual([sender,'ZZ','SUB:+'])
    expect(segmentComposite(uci,3,wire.una)).toEqual([receiver,'ZZ',"DEST?'"])
    expect(segmentComposite(uci,4,wire.una)).toEqual(['4'])
  })
  it.each(['',"UNH+M+PRODAT:D:97A:UN:E2SE6A'",raw()+"UNB+UNOC:3+S+R+260930:1200+I'"])('holds an unqualified original instead of inventing/truncating correlation %s', payload => {
    expect(()=>contrlSourceEnvelope(payload)).toThrow(/CONTRL kräver/)
  })
  it('uses only the source-prescribed first14 UCI projection and retains the full original',()=>{
    const payload=raw().replace("I?+Ä???'1","REFERENCE-LONGER-THAN14")
    const result=renderContrl2Ediel2({source:{rawPayload:payload},outcome:'negative'})
    expect(result.diagnostics.originalInterchangeReference).toBe('REFERENCE-LONGER-THAN14')
    expect(segmentComposite(tokenizeEdifact(result.segments[0]+"'").segments[0],1,tokenizeEdifact(result.segments[0]+"'").una)).toEqual(['REFERENCE-LONG'])
  })
  it('keeps a parseable negative count response attached to the original technical interchange', () => {
    expect(renderContrl2Ediel2({source:{rawPayload:raw(true).replace('UNT;3;M','UNT;99;M')},outcome:'negative'}).diagnostics.originalInterchangeReference).toBe(ref)
  })
  it('routes the actual CONTRL draft using the same physical original technical parties', () => {
    const source={id:'00000000-0000-4000-8000-000000000001',company_id:null,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z01',raw_payload:raw(true),environment:'test',test_flag:1,
      sender_ediel_id:'LOCAL-S',receiver_ediel_id:'LOCAL-R',sender_sub_address:'LOCAL-SUB',receiver_sub_address:'LOCAL-DEST',sender_email:'synthetic-s@example.invalid',receiver_email:'synthetic-r@example.invalid',application_reference:'23-DDQ-PRODAT',parsed_payload:{interchangeReference:'WRONG'}} as unknown as EdielMessageRow
    const draft=buildContrlDraft({sourceMessage:source,outcome:'negative'})
    const envelope=EdifactEnvelopeCodec.decode(draft.rawPayload)
    expect([envelope.sender,envelope.receiver,envelope.senderSubAddress,envelope.receiverSubAddress]).toEqual([receiver,sender,"DEST?'",'SUB:+'])
    const uci=envelope.segments.find(s=>s.tag==='UCI')!
    expect(segmentComposite(uci,1,envelope.una)).toEqual([ref])
    expect(draft.senderEdielId).toBe(receiver);expect(draft.receiverEdielId).toBe(sender)
  })
})
