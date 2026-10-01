import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))
import { captureEdielTechnicalSyntaxAckEvidence, requireEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision, technicalSyntaxAckQualification, readPersistedEdielTechnicalContrlBasis } from '@/lib/ediel/ack/technicalSyntaxAuthority'
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
 it('requires the exact protected RPC object and freezes its nested physical envelope', async () => {
  rpc.mockResolvedValue({data:structuredClone(basis),error:null})
  const e=await requireEdielTechnicalSyntaxAckEvidence('company','source')
  expect(technicalSyntaxAckQualification({evidence:e,companyId:'company',environment:'test',sourceMessageId:'source'})).toBe(e)
  expect(technicalSyntaxAckQualification({evidence:{...e},companyId:'company',environment:'test'})).toBeNull()
  expect(technicalSyntaxAckQualification({evidence:e,companyId:'other',environment:'test'})).toBeNull()
  expect(Object.isFrozen(e.originalUNB.receiver)).toBe(true)
  expect(Object.isFrozen(e.originalUNB)).toBe(true)
 })
 it('qualifies actual persisted ACK/source atomically without caller pointer authority', async () => {
  const ack={id:'ack',company_id:'company',environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:'actual raw',related_message_id:'source'}
  rpc.mockResolvedValue({data:{version:1,ackMessage:ack,technicalSyntaxAckEvidence:structuredClone(basis)},error:null})
  const result=await readPersistedEdielTechnicalContrlBasis({companyId:'company',environment:'test',ackMessageId:'ack',expectedRawPayload:'actual raw'})
  expect(result.ackMessage).toEqual(ack)
  expect(technicalSyntaxAckQualification({evidence:result.evidence,companyId:'company',environment:'test',sourceMessageId:'source'})).toBe(result.evidence)
  expect(rpc.mock.calls[0]).toEqual(['ediel_read_persisted_technical_contrl_basis_v1',{p_company_id:'company',p_environment:'test',p_ack_message_id:'ack'}])
 })
 it('rejects persisted raw/pointer scope mismatch before qualifying its evidence', async () => {
  const e=structuredClone(basis)
  rpc.mockResolvedValue({data:{version:1,ackMessage:{id:'ack',company_id:'company',environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:'actual raw',related_message_id:'other'},technicalSyntaxAckEvidence:e},error:null})
  await expect(readPersistedEdielTechnicalContrlBasis({companyId:'company',environment:'test',ackMessageId:'ack',expectedRawPayload:'actual raw'})).rejects.toThrow('ediel_technical_ack_basis_required')
  expect(technicalSyntaxAckQualification({evidence:e,companyId:'company',environment:'test'})).toBeNull()
 })
 it('records only the actual common syntax owner facet with an exact raw hash', async () => {
  rpc.mockResolvedValue({data:{syntaxAssessmentId:'assessment',scope:'canonical_syntax_only',authorizesBusinessEffect:false},error:null})
  await recordEdielTechnicalSyntaxDecision({companyId:'company',sourceMessageId:'source',sourceHash:'a'.repeat(64),syntaxDecision:'rejected',reasonCodes:['SYNTAX_INVALID']})
  expect(rpc.mock.calls[0][0]).toBe('ediel_record_technical_syntax_facet_v1')
  expect(JSON.parse(rpc.mock.calls[0][1].p_facts_text)).toEqual({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:'rejected',reasonCodes:['SYNTAX_INVALID']})
 })
})
