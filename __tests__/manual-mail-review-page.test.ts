import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const { guard, db, queue, detail } = vi.hoisted(() => ({ guard: vi.fn(), db: vi.fn(), queue: vi.fn(), detail: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: db }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/inbound-mail/manualMailReviewQueue', () => ({ getManualMailReviewQueue: queue, getManualMailReviewDetail: detail, getManualMailReviewNames: async () => ({ companies: new Map(), customers: new Map() }), formatManualMailTime: (v: string) => v, manualMailReviewReasons: () => ['Behöver granskas'], object: (v: unknown) => v && typeof v === 'object' ? v : {} }))
import Page from '@/app/admin/mail-review/page'
import Detail from '@/app/admin/mail-review/[id]/page'
beforeEach(() => {
  vi.clearAllMocks(); guard.mockResolvedValue({ email: 'admin@example.test' }); db.mockResolvedValue({})
  queue.mockResolvedValue({ rows: [], page: 1, total: 0, hasMore: false, filters: {} })
})
it('authenticates before loading review data and renders tenant customer and date filters', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
  expect(guard.mock.invocationCallOrder[0]).toBeLessThan(db.mock.invocationCallOrder[0])
  expect(html).toContain('Mejlgranskning'); expect(html).toContain('name="tenant"'); expect(html).toContain('name="customer"'); expect(html).toContain('type="date"')
})
it('never reads queue data after denied platform access', async () => {
  guard.mockRejectedValue(new Error('denied'))
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('denied')
  expect(db).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled()
})
it('escapes originals and renders safe attachment descriptors without embedding original bytes', async () => {
  detail.mockResolvedValue({ id: 'mail-a', company_id: null, customer_id: null, request_id: null, subject: '<script>subject</script>', body_text: '<img onerror="bad()">', from_email: 'sender@example.test', received_at: '2026-10-19T00:00:00Z', extracted_payload: {}, correlation_evidence: { candidates: [{ companyId: 'candidate-a' }] }, attachmentDescriptors: [{ mimePart: 2, filename: 'info.pdf', contentType: 'application/pdf', sizeBytes: 16, sha256: 'a'.repeat(64), downloadable: true }] })
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }))
  expect(html).toContain('&lt;img'); expect(html).not.toContain('<script>subject')
  expect(html).toContain('/attachments/2'); expect(html).not.toContain('contentBase64'); expect(html).toContain('candidate-a')
})
