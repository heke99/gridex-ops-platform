import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { projectSentEdielSourceState } from '@/lib/ediel/outbox/projectSentSources'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn(), from: vi.fn() } }))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const message = { id: id(1), company_id: id(2), environment: 'test' as const, direction: 'outbound' as const, raw_payload: "UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+SYNTHETIC+9+NA'" }
const hash = createHash('sha256').update(message.raw_payload, 'utf8').digest('hex')
const observedAt = '2026-09-30T12:00:00.000Z'
const projection = () => ({ status: 'source_projection', companyId: message.company_id, environment: message.environment, messageId: message.id, originalHash: hash, observedAt, authorizesProviderEntry: false })
// This declares only the native atomic projection result port. Source authority,
// clocks/row locks and stale ACK/business state are tested in the actual SQL harness.
beforeEach(() => { vi.clearAllMocks(); vi.mocked(supabaseService.rpc).mockResolvedValue({ data: projection(), error: null } as never) })
describe('atomic accepted-source projection consumer', () => {
  it('delegates the exact tenant/environment/actor/message/raw hash without caller clock or client updates', async () => {
    await projectSentEdielSourceState({ message, actorUserId: id(3), sentAt: observedAt })
    expect(supabaseService.rpc).toHaveBeenCalledExactlyOnceWith('ediel_project_accepted_source_state_v1', {
      p_company_id: message.company_id, p_environment: 'test', p_actor_user_id: id(3), p_message_id: message.id, p_expected_original_hash: hash,
    })
    expect(supabaseService.from).not.toHaveBeenCalled()
  })
  it('accepts only the returned frozen native clock and rejects caller clock substitution', async () => {
    await projectSentEdielSourceState({ message, actorUserId: id(3) })
    await expect(projectSentEdielSourceState({ message, actorUserId: id(3), sentAt: '2026-09-30T12:01:00Z' })).rejects.toThrow('dispatch_anchor_changed')
    expect(supabaseService.from).not.toHaveBeenCalled()
  })
  it.each([{ companyId: id(99) }, { environment: 'production' }, { messageId: id(99) }, { originalHash: 'f'.repeat(64) }, { observedAt: 'not-a-clock' }, { authorizesProviderEntry: true }, { status: 'entered' }])('holds an altered native result %j', async changed => {
    vi.mocked(supabaseService.rpc).mockResolvedValue({ data: { ...projection(), ...changed }, error: null } as never)
    await expect(projectSentEdielSourceState({ message, actorUserId: id(3) })).rejects.toThrow('frozen_source_projection_invalid')
    expect(supabaseService.from).not.toHaveBeenCalled()
  })
  it('propagates a native atomic hold without partial client projection writes', async () => {
    const error = { message: 'ediel_source_projection_owned_info_request_required' }
    vi.mocked(supabaseService.rpc).mockResolvedValue({ data: null, error } as never)
    await expect(projectSentEdielSourceState({ message, actorUserId: id(3) })).rejects.toEqual(error)
    expect(supabaseService.from).not.toHaveBeenCalled()
  })
  it.each([{ ...message, company_id: null }, { ...message, raw_payload: '' }, { ...message, direction: 'inbound' as const }])('holds incomplete source scope before the native effect', async invalid => {
    await expect(projectSentEdielSourceState({ message: invalid, actorUserId: id(3) })).rejects.toThrow('source_scope_required')
    expect(supabaseService.rpc).not.toHaveBeenCalled()
  })
})
