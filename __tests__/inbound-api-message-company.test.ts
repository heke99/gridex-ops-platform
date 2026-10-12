import { beforeEach, describe, expect, it, vi } from 'vitest'
const reads = vi.hoisted(() => [] as Array<Record<string, string>>)
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  if (table !== 'ediel_messages') throw new Error('Unexpected downstream effect')
  const filters: Record<string, string> = {}
  const query = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query },
    maybeSingle: async () => { reads.push({ ...filters }); return { data: null, error: null } } }
  return query
} } }))
import { evaluateInboundEdielRequest } from '@/lib/ediel/inboundRequestAutomation'
beforeEach(() => { reads.length = 0 })
describe('Inbound API message authorization precedes payload evaluation and decisions', () => {
  it('filters the message by the authorized company before reading its source bytes', async () => {
    await expect(evaluateInboundEdielRequest({ companyId: 'authorized', messageId: 'foreign-message', forceManualReview: true })).rejects.toMatchObject({ status: 404, code: 'inbound_message_not_found' })
    expect(reads).toEqual([{ id: 'foreign-message', company_id: 'authorized' }])
  })
  it('rejects a missing trusted company before any database access', async () => {
    await expect(evaluateInboundEdielRequest({ companyId: '', messageId: 'message' })).rejects.toMatchObject({ status: 403 })
    expect(reads).toEqual([])
  })
})
