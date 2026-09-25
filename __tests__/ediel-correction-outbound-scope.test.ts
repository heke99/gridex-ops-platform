import { beforeEach, expect, it, vi } from 'vitest'
import { closureFixture } from './helpers/closureWireFixtures'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({
  provider: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/email/sendEdielEmail', () => ({
  sendEdielEmail: async (_input: unknown, entry?: { beforeProviderCall: (binding: Record<string, unknown>) => Promise<void> }) => {
    await entry?.beforeProviderCall({ mode: 'attachment', from: 'sender@example.invalid', to: 'receiver@example.invalid' })
    io.provider()
    return { accepted: ['receiver@example.invalid'], rejected: [], messageId: 'synthetic' }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  // This is the old SQL result for a stale non-Z08 row code and a malformed
  // raw Z08 body. The real SQL boundary is exercised by the native companion.
  io.rpc.mockResolvedValue({ data: { scoped: false }, error: null })
})

it('holds a potential Z08 before SMTP when the database does not scope its original', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture({ reason: 'Z25' }).wire.replace('BGM+Z05', 'BGM+Z08').slice(0, -1)
  const message = {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z01', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).rejects.toThrow('outbound_dispatch_scope_mismatch')
  expect(io.provider).not.toHaveBeenCalled()
})

it('keeps a valid non-Z08 outbound PRODAT on its existing SMTP lane', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture().wire.replace('BGM+Z05', 'BGM+Z03')
  const message = {
    id: '00000000-0000-4000-8000-000000000004', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).resolves.toMatchObject({ accepted: ['receiver@example.invalid'] })
  expect(io.provider).toHaveBeenCalledOnce()
})
