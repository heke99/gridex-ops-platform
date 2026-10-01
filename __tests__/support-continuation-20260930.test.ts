import { beforeEach, expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

const io = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), bucket: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, storage: { from: io.bucket } } }))
const companyId = '10000000-0000-4000-8000-000000000001', customerId = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001', attachmentId = '40000000-0000-4000-8000-000000000001'
const context = { companyId, customerId, actor: { kind: 'portal' as const,
  userId: '50000000-0000-4000-8000-000000000001', sessionId: '60000000-0000-4000-8000-000000000001' } }
const reference = publicReference('case', companyId, caseId)!
const objectKey = `${companyId}/${customerId}/${caseId}/${attachmentId}`
const reservation = { companyId, customerId, caseId, attachmentId, objectKey,
  phase: 'reserved', revision: 1, scanStatus: 'quarantined', replayed: false }
const row = { id: attachmentId, file_name: 'synthetic.txt', media_type: 'text/plain', byte_size: 3,
  scan_status: 'quarantined', created_at: '2026-09-30T20:00:00Z', visibility: 'customer' }
beforeEach(() => {
  io.rpc.mockReset()
  io.upload.mockReset().mockResolvedValue({ data: { path: objectKey }, error: null })
  io.bucket.mockReset().mockReturnValue({ upload: io.upload })
})

it.each([
  { ...row, visibility: 'internal' },
  { ...row, scan_status: 'clean' },
  { ...row, download_url: 'https://storage.example.invalid/client-selected-file' },
])('fails closed when a customer attachment projection contains internal content or an unconfigured release capability', async maliciousRow => {
  const { readSupportAttachments } = await import('@/lib/customer-cases/attachments')
  io.rpc.mockResolvedValue({ data: { items: [maliciousRow] }, error: null })
  await expect(readSupportAttachments(context, { reference })).rejects.toMatchObject({ code: 'support_attachment_unavailable', status: 503 })
  expect(io.upload).not.toHaveBeenCalled()
})

it('refuses a reservation owned by another customer before any byte upload', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  io.rpc.mockResolvedValue({ data: { ...reservation, customerId: caseId }, error: null })
  await expect(intakeSupportAttachment({ context, caseReference: reference, expectedRevision: 1,
    idempotencyKey: 'support-continuation-owner-check', file: new File(['abc'], 'synthetic.txt', { type: 'text/plain' }) }))
    .rejects.toMatchObject({ code: 'support_attachment_unavailable', status: 503 })
  expect(io.bucket).not.toHaveBeenCalled()
  expect(io.upload).not.toHaveBeenCalled()
})

it('does not acknowledge an upload when the current session is revoked between reserve and commit', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  io.rpc.mockResolvedValueOnce({ data: reservation, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'support_actor_forbidden', code: '42501' } })
  await expect(intakeSupportAttachment({ context, caseReference: reference, expectedRevision: 1,
    idempotencyKey: 'support-continuation-session-check', file: new File(['abc'], 'synthetic.txt', { type: 'text/plain' }) }))
    .rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(io.upload).toHaveBeenCalledTimes(1)
  expect(io.rpc.mock.calls.map(call => call[1].p_intake.stage)).toEqual(['reserve', 'commit'])
  for (const call of io.rpc.mock.calls) expect(call[1].p_context.sessionId).toBe(context.actor.sessionId)
  // Physical bytes may remain private after a refused commit; no accepted
  // customer attachment or scan intent is claimed by this adapter result.
})

it.each(['scan_status', 'verified', 'object_key'])('rejects a client-supplied %s in the actual multipart boundary', async field => {
  const { readSupportAttachmentForm } = await import('@/lib/customer-cases/attachments')
  const form = new FormData()
  form.append('file', new File(['abc'], 'synthetic.txt', { type: 'text/plain' }))
  form.append('expected_revision', '1')
  form.append(field, 'true')
  await expect(readSupportAttachmentForm(new Request('http://localhost/attachment', { method: 'POST', body: form })))
    .rejects.toMatchObject({ code: 'invalid_support_attachment', status: 422 })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('rejects duplicate files and revisions in multipart input before selecting any part', async () => {
  const { readSupportAttachmentForm } = await import('@/lib/customer-cases/attachments')
  for (const duplicate of ['file', 'expected_revision']) {
    const form = new FormData()
    const file = new File(['abc'], 'synthetic.txt', { type: 'text/plain' })
    form.append('file', file)
    form.append('expected_revision', '1')
    if (duplicate === 'file') form.append('file', file)
    else form.append('expected_revision', '2')
    await expect(readSupportAttachmentForm(new Request('http://localhost/attachment', { method: 'POST', body: form })))
      .rejects.toMatchObject({ code: 'invalid_support_attachment', status: 422 })
  }
  expect(io.rpc).not.toHaveBeenCalled()
})
