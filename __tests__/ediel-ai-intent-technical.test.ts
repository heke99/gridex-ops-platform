import {describe,expect,it} from 'vitest'
import {evaluateIntentValidation} from '@/lib/ediel/intent/intentEngine'
import {AI_LIST_SOURCE_PROFILE} from '@/lib/ediel/aiListFormat'
import type {CreateAiListMessageIntentInput} from '@/lib/ediel/intent/types'
const input:CreateAiListMessageIntentInput={companyId:'00000000-0000-4000-8000-000000000001',environment:'test',messageFamily:'AI_LIST',messageCode:'AI',businessProcess:'reconciliation',direction:'outbound',senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'',interchangeReference:'',messageReference:'',transactionReference:null,routeProfileId:'00000000-0000-4000-8000-000000000002',communicationRouteId:'00000000-0000-4000-8000-000000000003',customerId:'00000000-0000-4000-8000-000000000004',customerSiteId:'00000000-0000-4000-8000-000000000005',idempotencyKey:'actual-ai-request',payload:{owner:'ai-list-export-request-v1',fromDate:'2026-10-01',toDate:'2026-11-01',sourceSha256:AI_LIST_SOURCE_PROFILE.sourceSha256,technicalVersion:AI_LIST_SOURCE_PROFILE.technicalVersion,requestId:'actual-request'}}
describe('actual technical AI intent metadata',()=>{
 it('represents absent EDIFACT envelope refs and needs its own source-qualified technical request',()=>{
  expect(evaluateIntentValidation(input)).toMatchObject({ok:true,checks:{required_metadata:true,ai_no_edifact_references:true,ai_technical_request:true}})
 })
 it('rejects every fabricated EDIFACT ref even when all request metadata is valid',()=>{
  for(const field of ['applicationReference','interchangeReference','messageReference','transactionReference'])expect(evaluateIntentValidation({...input,[field]:'FABRICATED'}).ok).toBe(false)
 })
 it('does not treat arbitrary parsed rows, BI, missing customer or impossible source dates as an AI request',()=>{
  for(const invalid of [{...input,messageCode:'BI'},{...input,customerId:null},{...input,payload:{details:[{customer:'claimed'}]}},{...input,payload:{...input.payload,fromDate:'2026-02-30'}},{...input,payload:{...input.payload,sourceSha256:'a'.repeat(64)}}])expect(evaluateIntentValidation(invalid as unknown as CreateAiListMessageIntentInput).ok).toBe(false)
 })
})
