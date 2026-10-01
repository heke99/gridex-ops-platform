import { beforeEach, expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'
import type { DomainEventRow } from '@/lib/events/domainEvents'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), email: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/email/emailEvents', () => ({ triggerEmailEvent: io.email }))

import { publishCustomerCase } from '@/lib/customer-cases/publication'
import { readCustomerSupportPage } from '@/lib/customer-cases/customerRead'
import { buildPublicWebhookPayload } from '@/lib/integrations/webhooks'
import { notifyCustomerForLifecycleEvent } from '@/lib/customer-notifications/notificationOrchestrator'
import { publicSupportStaffReference } from '@/lib/customer-cases/supportStaffAttribution'

const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const staffId = '40000000-0000-4000-8000-000000000001'
const sessionId = '50000000-0000-4000-8000-000000000001'
const publicationId = '60000000-0000-4000-8000-000000000001'
const messageId = '70000000-0000-4000-8000-000000000001'
const at = '2026-10-01T01:00:00Z'
const privateNote = 'PRIVATE_NOTE_SYNTHETIC_20261001'
const phoneBody = 'Explicitly authored synthetic phone summary'
const caseReference = publicReference('case', companyId, caseId)!
const actor = { kind: 'ops' as const, userId: staffId, sessionId }
const readingCustomer = { kind: 'portal' as const, userId: '80000000-0000-4000-8000-000000000001',
  sessionId: '90000000-0000-4000-8000-000000000001' }
const publicationInput = { companyId, customerId, caseId, actorUserId: staffId, actor,
  expectedRevision: 1, title: 'Customer-visible synthetic summary', body: phoneBody,
  status: 'open' as const, channel: 'phone' as const }
const publication = () => ({ id: publicationId, company_id: companyId, customer_id: customerId,
  customer_case_id: caseId, revision: 2, public_title: publicationInput.title, public_body: phoneBody,
  public_status: 'open', channel: 'phone', author_user_id: staffId, published_at: at })
const currentCase = () => ({ id: caseId, case_reference: caseReference, title: publicationInput.title,
  status: 'open', revision: 5, created_at: at, updated_at: at })

beforeEach(() => {
  vi.clearAllMocks()
  io.from.mockImplementation(() => { throw new Error('pure_projection_must_not_read_database') })
})

it('hands an explicitly authored phone summary and actual staff/channel to the current publication boundary', async () => {
  io.rpc.mockResolvedValue({ data: publication(), error: null })
  expect(await publishCustomerCase(publicationInput)).toMatchObject({ author_user_id: staffId,
    channel: 'phone', revision: 2, public_body: phoneBody })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_support_case_publication_v1', {
    p_context: { companyId, customerId, mode: 'ops', actorUserId: staffId, sessionId, clientId: null, subject: null },
    p_publication: { operation: 'publish', caseId, title: publicationInput.title, body: phoneBody,
      status: 'open', expectedRevision: 1, channel: 'phone' },
  })
  expect(JSON.stringify(io.rpc.mock.calls)).not.toContain(privateNote)
})

it.each([{ revision: 1 }, { channel: 'ops' }])('does not confirm a stale or differently labelled publication result: %j', async changes => {
  io.rpc.mockResolvedValue({ data: { ...publication(), ...changes }, error: null })
  await expect(publishCustomerCase(publicationInput)).rejects.toMatchObject({ code: 'support_result_invalid', status: 503 })
})

it('projects the current published phone summary with its saved staff identity, not the reading customer', async () => {
  // This memory boundary uses exactly the current SQL read projection shape.
  // It does not execute SQL/Auth or claim that a raw note is customer-visible.
  io.rpc.mockResolvedValueOnce({ data: publication(), error: null })
  const saved = await publishCustomerCase(publicationInput)
  io.rpc.mockResolvedValue({ data: { caseId, case: currentCase(), items: [{ id: messageId,
    body: saved.public_body, author_kind: 'staff', actor_user_id: saved.author_user_id, channel: saved.channel, revision: 5, created_at: at }] }, error: null })
  const page = await readCustomerSupportPage({ companyId, customerId, actor: readingCustomer }, { reference: caseReference })
  expect(page.case).toMatchObject({ case_reference: caseReference, revision: 5 })
  expect(page.items).toHaveLength(1)
  expect(page.items[0]).toMatchObject({ body: phoneBody, author_kind: 'staff', channel: 'phone', revision: 5 })
  expect(JSON.stringify(page.items)).not.toContain(privateNote)
  expect(JSON.stringify(page.items)).not.toContain(staffId)
  expect(page.items[0]).toHaveProperty('author_reference', publicReference('support_staff', companyId, saved.author_user_id))
  expect(page.items[0]).not.toHaveProperty('actor_user_id')
  expect(page.items[0]).not.toHaveProperty('author_user_id')
})

it('rejects a mixed private-note field instead of silently including it in the customer message DTO', async () => {
  io.rpc.mockResolvedValue({ data: { caseId, case: currentCase(), items: [{ id: messageId,
    body: phoneBody, author_kind: 'staff', channel: 'phone', revision: 5, created_at: at,
    internal_note: privateNote }] }, error: null })
  await expect(readCustomerSupportPage({ companyId, customerId, actor: readingCustomer }, { reference: caseReference }))
    .rejects.toMatchObject({ code: 'support_result_invalid', status: 503 })
})

it('registered public webhook projection drops unrelated internal note/phone draft text', () => {
  const event = { id: publicationId, company_id: companyId, event_type: 'customer.updated',
    aggregate_type: 'customer', aggregate_id: customerId, subject_customer_id: customerId,
    actor_user_id: staffId, source: 'synthetic_projection', event_version: 1, idempotency_key: null,
    payload: { customer_reference: 'CUSTOMER-SYNTHETIC', status: 'active',
      internal_note: privateNote, phone_draft: privateNote, next_action: privateNote },
    occurred_at: at, created_at: at } satisfies DomainEventRow
  const projected = buildPublicWebhookPayload(event, 'synthetic-organization')
  expect(projected.data).toEqual({ customer_reference: 'CUSTOMER-SYNTHETIC', status: 'active' })
  expect(JSON.stringify(projected)).not.toContain(privateNote)
  expect(io.from).not.toHaveBeenCalled()
})

it('does not pretend the lifecycle notifier implements the unmatched support outbox topic', async () => {
  expect(await notifyCustomerForLifecycleEvent({ companyId, customerId,
    eventType: 'customer.support.changed', sourceEventId: publicationId, payload: { internal_note: privateNote } }))
    .toEqual({ queued: false, eventKey: null, skippedReason: 'event_not_mapped' })
  expect(io.email).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
})

it('records the support topic as unmatched by the exported webhook projector rather than inventing a consumer', () => {
  const event = { id: publicationId, company_id: companyId, event_type: 'customer.support.changed',
    aggregate_type: 'customer_case', aggregate_id: caseId, subject_customer_id: customerId,
    actor_user_id: staffId, source: 'synthetic_projection_only', event_version: 1, idempotency_key: null,
    payload: { messageId, revision: 5, internal_note: privateNote }, occurred_at: at, created_at: at } satisfies DomainEventRow
  expect(() => buildPublicWebhookPayload(event, 'synthetic-organization'))
    .toThrow('webhook_event_type_not_registered:customer.support.changed')
  expect(io.from).not.toHaveBeenCalled()
})

it('keeps two actual saved staff authors distinct and stable across repeated projections', async () => {
  const otherStaffId = '41000000-0000-4000-8000-000000000001'
  const references = [] as Array<string | null>
  for (const savedActor of [staffId, otherStaffId, staffId]) {
    io.rpc.mockResolvedValueOnce({ data: { ...publication(), author_user_id: savedActor }, error: null })
    const saved = await publishCustomerCase({ ...publicationInput, actorUserId: savedActor, actor: { ...actor, userId: savedActor } })
    io.rpc.mockResolvedValue({ data: { caseId, case: currentCase(), items: [{ id: messageId,
      body: saved.public_body, author_kind: 'staff', actor_user_id: saved.author_user_id, channel: saved.channel, revision: 5, created_at: at }] }, error: null })
    const page = await readCustomerSupportPage({ companyId, customerId, actor: readingCustomer }, { reference: caseReference })
    const item = page.items[0] as { author_reference: string | null }
    references.push(item.author_reference)
    expect(item.author_reference).toBe(publicReference('support_staff', companyId, savedActor))
    expect(item.author_reference).not.toBe(publicReference('support_staff', companyId, readingCustomer.userId))
  }
  expect(references[0]).not.toBe(references[1]); expect(references[2]).toBe(references[0])
})

it.each([null, undefined])('preserves unknown historical staff author as null (%s)', async storedActor => {
  io.rpc.mockResolvedValue({ data: { caseId, case: currentCase(), items: [{ id: messageId,
    body: phoneBody, author_kind: 'staff', ...(storedActor === undefined ? {} : { actor_user_id: storedActor }),
    channel: 'phone', revision: 5, created_at: at }] }, error: null })
  const page = await readCustomerSupportPage({ companyId, customerId, actor: readingCustomer }, { reference: caseReference })
  expect(page.items[0]).toHaveProperty('author_reference', null)
})

it('pure staff attribution exposes neither customer identity nor personal fields and uses the existing scoped reference', () => {
  expect(publicSupportStaffReference(companyId, 'staff', staffId)).toBe(publicReference('support_staff', companyId, staffId))
  expect(publicSupportStaffReference('11000000-0000-4000-8000-000000000001', 'staff', staffId))
    .not.toBe(publicSupportStaffReference(companyId, 'staff', staffId))
  expect(publicSupportStaffReference(companyId, 'customer', readingCustomer.userId)).toBeNull()
  expect(publicSupportStaffReference(companyId, 'staff', null)).toBeNull()
  expect(publicSupportStaffReference(companyId, 'staff', 'Unknown historical author')).toBeNull()
})
