import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn(async () => ({
  companyId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  apiClientId: '33333333-3333-4333-8333-333333333333',
  permissions: ['cases.read'], client: { id: 'client' }, startedAt: Date.now(),
})) }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))
vi.mock('@/lib/staff-api/storageTarget', () => ({ assertStaffStorageTarget: vi.fn(), staffStorageProjectRef: vi.fn(() => 'piidsfebjqjmnepdpnas') }))
vi.mock('@/lib/staff-api/customers', () => ({}))
vi.mock('@/lib/customer-cases/db', () => ({}))
vi.mock('@/lib/customer-service/supportConversation', () => ({}))
vi.mock('@/lib/customer-service/supportApi', () => ({ toSupportApiError: (error: unknown) => error }))
vi.mock('@/lib/staff-api/cases', () => ({
  STAFF_CASE_PRIORITIES: [], STAFF_CASE_STATUSES: [],
  findStaffCase: vi.fn(async () => ({ id: 'case', customer_id: 'customer' })),
}))
vi.mock('@/lib/customer-service/supportAttachments', () => ({
  SUPPORT_ATTACHMENT_API_MAX_BYTES: 4 * 1024 * 1024, SUPPORT_ATTACHMENT_MIME_TYPES: [],
  downloadSupportAttachment: vi.fn(async () => ({
    row: { file_name: 'document.pdf', detected_mime_type: 'application/pdf', sha256: 'a'.repeat(64) },
    bytes: Buffer.from('%PDF-1.7\n%%EOF'),
  })),
}))

import { GET } from '@/app/api/v1/staff/cases/[reference]/attachments/[attachmentReference]/file/route'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'

beforeEach(() => vi.clearAllMocks())

describe('mounted Staff download request ID', () => {
  it.each(['client-correlation-123', 'invalid client id <script>'])('issues a server UUID and logs it for incoming %s', async incomingId => {
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/staff/cases/case/attachments/attachment/file', {
      headers: { 'x-request-id': incomingId },
    }), { params: Promise.resolve({ reference: 'case', attachmentReference: 'attachment' }) })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('%PDF-1.7\n%%EOF')
    const serverId = response.headers.get('x-request-id')
    expect(serverId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(serverId).not.toBe(incomingId)
    const logged = vi.mocked(logIntegrationApiRequest).mock.calls[0][0]
    expect(logged.requestId).toBe(serverId)
    if (incomingId === 'client-correlation-123') expect(logged.metadata?.client_request_id).toBe(incomingId)
    else expect(logged.metadata).not.toHaveProperty('client_request_id')
  })
})
