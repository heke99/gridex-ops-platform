import {describe,expect,it} from 'vitest'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import type {EdielMessageRow} from '@/lib/ediel/types'
const raw="UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+I++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+UNKNOWN+D+9+AB'UNT+3+M'UNZ+1+I'"
function source(patch:Partial<EdielMessageRow>={}){return {id:'source',company_id:'company',environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'UNKNOWN',raw_payload:raw,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',status:'received',syntax_check_status:'not_checked',...patch} as EdielMessageRow}
describe('shared canonical syntax owner reads actual bytes',()=>{
 it('ignores mutable local failed/syntax/report projections on valid wire',()=>{const result=resolveCanonicalRuntimeDecision(source({status:'failed',syntax_check_status:'failed',failure_reason:'old local failure',validation_report:{utiltsRuntime:{validation:{syntaxOk:false,classification:'syntax_error'}}}}));expect(result.syntaxDecision).toBe('accepted');expect(result.issues.some(i=>i.code==='syntax_check_failed'||i.code==='message_failed')).toBe(false)})
 it('rejects broken wire despite mutable positive runtime/status projection',()=>{const result=resolveCanonicalRuntimeDecision(source({raw_payload:raw.replace('UNT+3+M','UNT+99+M'),syntax_check_status:'passed',validation_report:{utiltsRuntime:{validation:{syntaxOk:true,classification:'accepted'}}}}));expect(result.syntaxDecision).toBe('rejected');expect(result.applicationDecision).toBe('not_applicable')})
})
