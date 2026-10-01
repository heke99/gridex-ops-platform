import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))
import { captureEdielTechnicalSyntaxAckEvidence, requireEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision } from '@/lib/ediel/ack/technicalSyntaxAuthority'
const envelope = { sender: ['REMOTE','14','SUB-R'], receiver: ['LOCAL','14','SUB-L'], interchangeReference: 'ORIGINAL-REFERENCE-LONG', uciReference: 'ORIGINAL-REFER', applicationReference: '', testIndicator: '1' }
const basis = { kind: 'technical_syntax_ack', version: 1, companyId: 'company', sourceMessageId: 'source', sourceHash: 'a'.repeat(64), environment: 'test', observedAt: '2026-09-30T12:00:00Z', syntaxAssessmentId: 'assessment', syntaxDecision: 'rejected', transportActorId: 'actor', transportEdielId: 'LOCAL', originalUNB: envelope }
describe('protected technical syntax authority adapters', () => {
 beforeEach(() => rpc.mockReset())
 it('captures a syntax-only rejection with lossless original parties and no business profile', async () => {
  rpc.mockResolvedValue({ data: basis, error: null })
  expect(await captureEdielTechnicalSyntaxAckEvidence('company','source')).toEqual(basis)
  expect(rpc).toHaveBeenCalledWith('ediel_capture_technical_syntax_ack_basis_v1',{p_company_id:'company',p_message_id:'source'})
 })
 it('reads the same immutable technical evidence through the separate protected read', async () => {
  rpc.mockResolvedValue({ data: basis, error: null }); await requireEdielTechnicalSyntaxAckEvidence('company','source')
  expect(rpc.mock.calls[0][0]).toBe('ediel_require_technical_syntax_ack_basis_v1')
 })
 it('holds absent historical evidence without inventing a business pack', async () => {
  rpc.mockResolvedValue({ data:null,error:{message:'ediel_historical_technical_ack_basis_unavailable'} })
  await expect(requireEdielTechnicalSyntaxAckEvidence('company','source')).rejects.toThrow('ediel_historical_technical_ack_basis_unavailable')
  expect(rpc).toHaveBeenCalledTimes(1)
 })
 it.each([
  {companyId:'other'}, {sourceMessageId:'other'}, {sourceHash:'fake'}, {syntaxDecision:'manual'},
  {originalUNB:{...envelope,uciReference:'WRONG'}}, {originalUNB:{...envelope,receiver:['OTHER','14']}},
  {originalUNB:{...envelope,testIndicator:'0'}}, {originalUNB:{...envelope,sender:['REMOTE',{}]}},
 ])('rejects mismatching or malformed protected physical scope %j', async patch => {
  rpc.mockResolvedValue({data:{...basis,...patch},error:null})
  await expect(requireEdielTechnicalSyntaxAckEvidence('company','source')).rejects.toThrow('ediel_technical_ack_basis_required')
 })
 it('reads only a technical endpoint projection and retains explicit no-business authority', async () => {
  const endpoint={kind:'technical_endpoint_only',companyId:'company',sourceMessageId:'source',sourceHash:'a'.repeat(64),environment:'test',transportEdielId:'LOCAL',originalUNB:envelope,authorizesBusinessEffect:false}
  rpc.mockResolvedValue({data:endpoint,error:null})
  expect(await readEdielTechnicalSourceEndpoint('source')).toEqual(endpoint)
  expect(rpc.mock.calls[0]).toEqual(['ediel_read_technical_source_endpoint_v1',{p_source_message_id:'source'}])
 })
 it('does not turn a technical endpoint into business authorization', async () => {
  rpc.mockResolvedValue({data:{kind:'technical_endpoint_only',companyId:'company',sourceMessageId:'source',sourceHash:'a'.repeat(64),environment:'test',transportEdielId:'LOCAL',originalUNB:envelope,authorizesBusinessEffect:true},error:null})
  await expect(readEdielTechnicalSourceEndpoint('source')).rejects.toThrow('ediel_technical_endpoint_unqualified')
 })
 it('records only the actual common syntax owner facet with an exact raw hash', async () => {
  rpc.mockResolvedValue({data:{syntaxAssessmentId:'assessment',scope:'canonical_syntax_only',authorizesBusinessEffect:false},error:null})
  await recordEdielTechnicalSyntaxDecision({companyId:'company',sourceMessageId:'source',sourceHash:'a'.repeat(64),syntaxDecision:'rejected',reasonCodes:['SYNTAX_INVALID']})
  expect(rpc.mock.calls[0][0]).toBe('ediel_record_technical_syntax_facet_v1')
  expect(JSON.parse(rpc.mock.calls[0][1].p_facts_text)).toEqual({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:'rejected',reasonCodes:['SYNTAX_INVALID']})
 })
})
