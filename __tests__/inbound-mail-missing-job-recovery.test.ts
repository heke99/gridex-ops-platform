// storeInboundEmail writes the mail row and its processing job separately. A
// run killed between the two (platform time limit, deploy) left a stored mail
// that every later poll deduplicated without a job, so it was never processed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  existing: null as null | { id: string; scope: string },
  mail: { processing_status: 'received', match_status: 'not_checked' } as Record<string, string>,
  jobs: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => undefined }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async (original) => ({
  ...(await original<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>()),
  findExistingInboundEmail: async () => io.existing,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Record<string, unknown> = {}
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'limit']) query[method] = () => query
  query.eq = (column: string, value: unknown) => { filters[column] = value; return query }
  query.insert = async (row: Record<string, unknown>) => { if (table === 'inbound_processing_jobs') io.inserted.push(row); return { error: null } }
  const rows = () => {
    if (table === 'inbound_processing_jobs') return io.jobs
    if (table !== 'inbound_email_messages') return []
    const row = { id: io.existing?.id, ...io.mail }
    return Object.entries(filters).every(([column, value]) => row[column as keyof typeof row] === value) ? [{ id: row.id }] : []
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve)
  return query
} } }))

import { storeInboundEmail } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const mail = { mailboxId: 'mb-1', companyId: null, environment: 'test', internetMessageId: '<m1@example.invalid>', rawEmail: 'Subject: x\r\n\r\nbody', rawEdifactPayload: null, attachments: [] } as never

beforeEach(() => { io.existing = null; io.mail = { processing_status: 'received', match_status: 'not_checked' }; io.jobs = []; io.inserted = [] })

describe('re-fetched inbound mail without a processing job', () => {
  it('creates the missing job for the same stored, never processed mail', async () => {
    io.existing = { id: 'mail-1', scope: 'mailbox' }
    await expect(storeInboundEmail(mail)).resolves.toEqual({ id: 'mail-1', deduped: true })
    expect(io.inserted).toEqual([expect.objectContaining({ inbound_email_message_id: 'mail-1', status: 'queued', payload: expect.objectContaining({ recoveredMissingJob: true }) })])
  })

  it('leaves a mail that already has a job alone', async () => {
    io.existing = { id: 'mail-1', scope: 'mailbox' }
    io.jobs = [{ id: 'job-1' }]
    await storeInboundEmail(mail)
    expect(io.inserted).toEqual([])
  })

  it('does not queue an already processed mail again when it is re-fetched unread', async () => {
    io.existing = { id: 'mail-1', scope: 'mailbox' }
    io.mail = { processing_status: 'received', match_status: 'parsed' }
    await expect(storeInboundEmail(mail)).resolves.toEqual({ id: 'mail-1', deduped: true })
    io.mail = { processing_status: 'manual_review', match_status: 'not_checked' }
    await storeInboundEmail(mail)
    expect(io.inserted).toEqual([])
  })

  it('does not create jobs for a business duplicate found across the company', async () => {
    io.existing = { id: 'mail-0', scope: 'company' }
    await storeInboundEmail(mail)
    expect(io.inserted).toEqual([])
  })
})
