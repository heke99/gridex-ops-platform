import { beforeEach, expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

const io = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), download: vi.fn(), bucket: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, storage: { from: io.bucket } } }))
const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const attachmentId = '40000000-0000-4000-8000-000000000001'
const actor = { kind: 'portal' as const, userId: '50000000-0000-4000-8000-000000000001', sessionId: '60000000-0000-4000-8000-000000000001' }
const context = { companyId, customerId, actor }
const objectKey = `${companyId}/${customerId}/${caseId}/${attachmentId}`
const input = () => ({ context, caseReference: publicReference('case', companyId, caseId)!, expectedRevision: 1,
  idempotencyKey: 'support-file-request', file: new File(['%PDF-1.7\nSynthetic attachment\n'], 'invoice.pdf', { type: 'application/pdf' }) })
const result = (phase: 'reserved' | 'stored', replayed = false) => ({ companyId, customerId, caseId, attachmentId, objectKey,
  phase, revision: phase === 'stored' ? 2 : 1, scanStatus: 'quarantined', replayed })
beforeEach(() => {
  io.rpc.mockReset().mockResolvedValueOnce({ data: result('reserved'), error: null }).mockResolvedValueOnce({ data: result('stored'), error: null })
  io.bucket.mockReset().mockReturnValue({ upload: io.upload, download: io.download })
  io.upload.mockReset().mockResolvedValue({ data: { path: objectKey }, error: null })
  io.download.mockReset()
})

it('stores real validated bytes only in the private quarantine bucket and commits a quarantined scan request', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  const candidate = input()
  const accepted = await intakeSupportAttachment(candidate)
  expect(accepted).toEqual({ attachment_reference: publicReference('case_attachment', companyId, attachmentId), revision: 2, scan_status: 'quarantined', replayed: false })
  expect(io.bucket).toHaveBeenCalledWith('customer-support-quarantine')
  expect(Buffer.from(io.upload.mock.calls[0][1]).toString()).toContain('Synthetic attachment')
  expect(io.upload.mock.calls[0][2]).toMatchObject({ upsert: false, contentType: 'application/pdf' })
  expect(io.rpc.mock.calls.map(call => call[1].p_intake.stage)).toEqual(['reserve', 'commit'])
  expect(io.rpc.mock.calls[0][1].p_intake).toMatchObject({ fileName: 'invoice.pdf', mediaType: 'application/pdf', byteSize: candidate.file.size, visibility: 'customer' })
  expect(io.rpc.mock.calls[0][1].p_intake.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(accepted)).not.toContain('objectKey')
})

it('never uploads when current authority is denied and never claims success when storage fails', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  io.rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'support_actor_forbidden', code: '42501' } })
  await expect(intakeSupportAttachment(input())).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(io.upload).not.toHaveBeenCalled()
  io.rpc.mockReset().mockResolvedValue({ data: result('reserved'), error: null })
  io.upload.mockResolvedValue({ error: { message: 'private provider details', statusCode: '500' } })
  await expect(intakeSupportAttachment(input())).rejects.toMatchObject({ code: 'support_attachment_unavailable', status: 503 })
  expect(io.rpc).toHaveBeenCalledTimes(1)
})

it('does not create a second object or scan command when the accepted upload replays', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  io.rpc.mockReset().mockResolvedValue({ data: result('stored', true), error: null })
  expect(await intakeSupportAttachment(input())).toMatchObject({ scan_status: 'quarantined', replayed: true, revision: 2 })
  expect(io.upload).not.toHaveBeenCalled()
})

it('recovers a lost upload response only after hashing the exact existing private object', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  io.upload.mockResolvedValue({ error: { statusCode: '409' } })
  io.download.mockResolvedValue({ data: input().file, error: null })
  expect(await intakeSupportAttachment(input())).toMatchObject({ revision: 2, scan_status: 'quarantined' })
  io.rpc.mockReset().mockResolvedValue({ data: result('reserved'), error: null })
  io.download.mockResolvedValue({ data: new Blob(['Different bytes']), error: null })
  await expect(intakeSupportAttachment(input())).rejects.toMatchObject({ code: 'support_attachment_unavailable', status: 503 })
  expect(io.rpc).toHaveBeenCalledTimes(1)
})

it.each([
  new File(['<script>alert(1)</script>'], 'invoice.pdf', { type: 'application/pdf' }),
  new File(['evil'], 'page.html', { type: 'text/html' }),
  new File([new Uint8Array([0xff, 0, 0])], 'note.txt', { type: 'text/plain' }),
  new File([], 'empty.pdf', { type: 'application/pdf' }),
])('rejects unsupported, empty or spoofed file bytes before reservation or storage', async file => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  await expect(intakeSupportAttachment({ ...input(), file })).rejects.toMatchObject({ code: 'invalid_support_attachment', status: 422 })
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.upload).not.toHaveBeenCalled()
})

it('enforces byte limits and does not accept a client scanner outcome or storage path', async () => {
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' })
  await expect(intakeSupportAttachment({ ...input(), file: huge })).rejects.toMatchObject({ code: 'support_attachment_too_large', status: 413 })
  await expect(intakeSupportAttachment({ ...input(), clean: true, objectKey: 'foreign/path' } as Parameters<typeof intakeSupportAttachment>[0])).rejects.toMatchObject({ code: 'invalid_support_attachment', status: 422 })
  expect(io.rpc).not.toHaveBeenCalled()
})
