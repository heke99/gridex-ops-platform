import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))
import { captureEdielSourceRulePackEvidence, captureFreshEdielSourceRulePackEvidence, requireEdielSourceRulePackEvidence } from '@/lib/ediel/core/sourceRulePackEvidence'
const basis = {
  rulePackId: '00000000-0000-0000-0000-000000000001', messageProfileId: '00000000-0000-0000-0000-000000000002',
  profileKey: 'DB:OWN:E73', version: 'opaque-original', sourceHash: 'a'.repeat(64),
  snapshot: { profileKey: 'DB:OWN:E73', profileVersionId: '00000000-0000-0000-0000-000000000002', version: 'opaque-original', checksum: 'a'.repeat(64) },
}
describe('protected original rule pack evidence adapters', () => {
  beforeEach(() => rpc.mockReset())
  it('reads original protected evidence with exact tenant/source and opaque version', async () => {
    rpc.mockResolvedValue({ data: basis, error: null })
    expect(await requireEdielSourceRulePackEvidence('company', 'source')).toEqual(basis)
    expect(rpc).toHaveBeenCalledWith('ediel_require_source_rule_pack_basis_v1', { p_company_id: 'company', p_message_id: 'source' })
  })
  it('uses the prospective capture RPC separately from read', async () => {
    rpc.mockResolvedValue({ data: basis, error: null })
    await captureEdielSourceRulePackEvidence('company', 'source')
    expect(rpc.mock.calls[0][0]).toBe('ediel_capture_source_rule_pack_basis_v1')
  })
  it('keeps absent historical basis held without fallback or second RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'ediel_historical_rule_pack_basis_unavailable' } })
    await expect(requireEdielSourceRulePackEvidence('company', 'old')).rejects.toThrow('ediel_historical_rule_pack_basis_unavailable')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects a snapshot mismatching the protected selected profile', async () => {
    rpc.mockResolvedValue({ data: { ...basis, snapshot: { ...basis.snapshot, profileVersionId: 'forged' } }, error: null })
    await expect(requireEdielSourceRulePackEvidence('company', 'source')).rejects.toThrow('ediel_source_rule_pack_basis_required')
  })
  it('exposes historical classification without creating authority', async () => {
    rpc.mockResolvedValue({ data: { status: 'historical' }, error: null })
    expect(await captureFreshEdielSourceRulePackEvidence('company', 'old')).toEqual({ status: 'historical' })
  })
  it('propagates fresh capture errors instead of treating them as historical', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'new named source mismatch' } })
    await expect(captureFreshEdielSourceRulePackEvidence('company', 'fresh')).rejects.toThrow('ediel_source_rule_pack_basis_required')
  })
})
