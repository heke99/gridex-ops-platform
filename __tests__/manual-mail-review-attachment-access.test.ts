import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
const { access, from, maybeSingle } = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: access, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from } }))
import { GET } from '@/app/api/admin/mail-review/[id]/attachments/[part]/route'
const id = '11111111-1111-4111-8111-111111111111'
const bytes = Buffer.from('<script>unsafe()</script>')
const attachment = () => ({ mimePart: 4, filename: 'a\r\nX-Evil: yes.html', contentType: 'text/html', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentBase64: bytes.toString('base64') })
const run = () => GET(new Request('https://example.test'), { params: Promise.resolve({ id, part: '4' }) })
beforeEach(() => {
  vi.clearAllMocks(); access.mockResolvedValue({ guard: { isPlatformAdmin: true } })
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle }
  from.mockReturnValue(q); maybeSingle.mockResolvedValue({ data: { id, attachments: [attachment()] }, error: null })
})
it('denies tenant admins before querying attachment bytes', async () => {
  access.mockResolvedValue({ guard: { isPlatformAdmin: false } })
  expect((await run()).status).toBe(403); expect(from).not.toHaveBeenCalled()
})
it('returns verified original bytes only as a private sandboxed download', async () => {
  const response = await run()
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  expect(response.headers.get('content-disposition')).toContain('attachment;')
  expect(response.headers.get('content-disposition')).not.toMatch(/[\r\n]/)
  expect(response.headers.get('content-security-policy')).toContain('sandbox')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it.each(['hash','size','base64','duplicate'])('rejects corrupt original %s', async problem => {
  const a = attachment()
  if (problem === 'hash') a.sha256 = '0'.repeat(64)
  if (problem === 'size') a.sizeBytes += 1
  if (problem === 'base64') a.contentBase64 = '!!!'
  maybeSingle.mockResolvedValue({ data: { id, attachments: problem === 'duplicate' ? [a,a] : [a] }, error: null })
  expect((await run()).status).toBe(422)
})
