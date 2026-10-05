// masterplan: TR-10, AT-TR-10, SC-063
// Actual reader and GET route; explicitly finite auth/RPC response ports.
import {beforeEach, expect, it, vi} from 'vitest'
import {NextRequest} from 'next/server'
const mock = vi.hoisted(() => ({auth: vi.fn(), rpc: vi.fn()}))
vi.mock('@/lib/admin/apiGuards', () => ({requireAdminApiAccess: mock.auth}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {rpc: mock.rpc}}))
import {GET} from '@/app/api/ediel/messages/[messageId]/transport-copy/route'
import {readEdielTransportCopies} from '@/lib/ediel/transport/copy'
const companyId='11111111-1111-4111-8111-111111111111', actorUserId='22222222-2222-4222-8222-222222222222'
const messageId='33333333-3333-4333-8333-333333333333', attemptId='44444444-4444-4444-8444-444444444444'
const scope={companyId, actorUserId, messageId}
const tracking = () => ({caseId: actorUserId, companyId, messageId, environment:'test', lane:'generic_journal', attemptId,
  originalHash:'b'.repeat(64), mimeSha256:'a'.repeat(64), enteredAt:'2026-10-04T12:00:00Z', openedAt:'2026-10-04T12:00:01Z',
  reason:'entry_unresolved_after_lease', status:'needs_tracking', observedClassification:null, observedAt:null, authorizesResend:false, deliveryProven:false})
const response = (cases: unknown[] = [tracking()]) => ({data:{status:'held', companyId, messageId, environment:'test', copies:[],
  reconciliationCases: cases, blocker:'entered_mime_archive_binding_not_qualified', authorizesResend:false, deliveryProven:false}, error:null})
beforeEach(() => {vi.clearAllMocks(); mock.auth.mockResolvedValue({guard:{companyId,userId:actorUserId}}); mock.rpc.mockResolvedValue(response())})
it('GET exposes the case while the archive is held, without addresses, bytes or private archive identity', async () => {
  mock.rpc.mockResolvedValue(response([{...tracking(), recipient:'secret@example.invalid', payloadBase64:'secret', mimeArchiveRef:'storage://secret'}]))
  const result=await GET(new NextRequest(`https://example.invalid/api/ediel/messages/${messageId}/transport-copy`),{params:Promise.resolve({messageId})})
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store')
  const body=await result.json()
  expect(body).toMatchObject({status:'held', reconciliationCases:[{caseId:actorUserId, attemptId, status:'needs_tracking', authorizesResend:false, deliveryProven:false}]})
  expect(JSON.stringify(body)).not.toMatch(/secret|storage|companyId|recipient|payloadBase64/)
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('gridex_ediel_transport_copy_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_message_id:messageId})
})
it('a same-attempt observed acceptance is separate from the immutable case opening and does not prove delivery', async () => {
  mock.rpc.mockResolvedValue(response([{...tracking(),status:'outcome_observed',observedClassification:'accepted',observedAt:'2026-10-04T12:00:02Z'}]))
  expect((await readEdielTransportCopies(scope)).reconciliationCases[0]).toMatchObject({reason:'entry_unresolved_after_lease', status:'outcome_observed', observedClassification:'accepted', deliveryProven:false, authorizesResend:false})
})
it.each([
  {companyId: actorUserId}, {messageId:actorUserId}, {environment:'production'}, {attemptId:'forged'}, {originalHash:'wrong'},
  {enteredAt:''}, {openedAt:'2026-10-04T11:00:00Z'}, {reason:'caller_resolution'}, {status:'resolved_by_caller'},
  {status:'outcome_observed'}, {status:'needs_tracking',observedClassification:'accepted'}, {observedClassification:'delivered'},
  {authorizesResend:true}, {deliveryProven:true},
  {observedClassification:'unknown',observedAt:null}, {observedClassification:null,observedAt:'2026-10-04T12:00:02Z'},
])('rejects widened or inconsistent case authority %j', async fields => {
  mock.rpc.mockResolvedValue(response([{...tracking(),...fields}]))
  await expect(readEdielTransportCopies(scope)).rejects.toThrow('ediel_transport_reconciliation_invalid')
})
it.each(['duplicate','overflow'])('rejects unbounded/ambiguous case projection %s', async kind => {
  mock.rpc.mockResolvedValue(response(Array.from({length:kind==='duplicate'?2:51},tracking)))
  await expect(readEdielTransportCopies(scope)).rejects.toThrow('ediel_transport_reconciliation_invalid')
})
it('rejects two distinct case IDs for the same lane/attempt',async()=>{
  mock.rpc.mockResolvedValue(response([tracking(),{...tracking(),caseId:companyId}]))
  await expect(readEdielTransportCopies(scope)).rejects.toThrow('ediel_transport_reconciliation_invalid')
})
it('does not read after caller scope overrides and does not leak revoked-reader owner errors', async () => {
  expect((await GET(new NextRequest(`https://example.invalid/api/ediel/messages/${messageId}/transport-copy?companyId=${actorUserId}`),{params:Promise.resolve({messageId})})).status).toBe(400)
  expect(mock.rpc).not.toHaveBeenCalled()
  mock.rpc.mockResolvedValue({data:null,error:Error('secret private origin')})
  const result=await GET(new NextRequest(`https://example.invalid/api/ediel/messages/${messageId}/transport-copy`),{params:Promise.resolve({messageId})})
  expect(result.status).toBe(403); expect(await result.text()).not.toContain('secret')
})
