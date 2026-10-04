import {it,expect,vi} from 'vitest'
const {preflight}=vi.hoisted(()=>({preflight:vi.fn(()=>({blocking:false,issues:[]}))}))
// Mechanical reference-allocation probe only. National guide/producer evidence
// is deliberately outside this fixture; the actual send preflight stays intact.
vi.mock('@/lib/ediel/core/messageBuilder',()=>({preflightEdielPayload:preflight}))
import {buildEdifactEnvelope} from '@/lib/ediel/messages'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
it('preserves preallocated intent UNB and UNH references through the actual shared codec and preflight',()=>{
 const result=buildEdifactEnvelope({senderEdielId:'12345',receiverEdielId:'54321',interchangeReference:'ABCDEF12345678',messageReference:'INTENT-MESSAGE',applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,testFlag:1,messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',segments:['BGM+Z03+DOC+9']})
 expect(result).toMatchObject({interchangeReference:'ABCDEF12345678',messageReference:'INTENT-MESSAGE'})
 expect(EdifactEnvelopeCodec.decode(result.raw).interchangeReference).toBe('ABCDEF12345678')
 expect(validateEdifactEnvelope(result.raw).syntaxOk).toBe(true)
 expect(result.raw).toContain("UNH+INTENT-MESSAGE+");expect(result.raw).toContain("UNT+3+INTENT-MESSAGE'");expect(result.raw).toContain("UNZ+1+ABCDEF12345678'")
 expect(preflight).toHaveBeenCalledWith(expect.objectContaining({rawPayload:result.raw,mode:'send'}))
})
it('rejects a supplied empty interchange instead of silently reallocating it',()=>{
 expect(()=>buildEdifactEnvelope({senderEdielId:'12345',receiverEdielId:'54321',interchangeReference:'',messageReference:'INTENT-MESSAGE',acknowledgementRequest:true,testFlag:1,messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',segments:['BGM+Z03+DOC+9']})).toThrow()
})
