// reality-defects: F89, F90, F91 (the outbox cron records company-certified scope proofs before sending)
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ order: [] as string[], record: vi.fn(), process: vi.fn() }))
vi.mock('@/lib/ediel/companyCertifiedScopes', () => ({ recordCompanyCertifiedScopes: io.record }))
vi.mock('@/lib/ediel/outbox/processEdielOutbox', () => ({ processEdielOutbox: io.process }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: async () => 'automation-actor' }))

import { GET } from '@/app/api/ediel/outbox/process/route'

const call = (query = '') => GET(new NextRequest(`http://localhost/api/ediel/outbox/process${query}`, { headers: { authorization: 'Bearer cron-secret' } }))

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret'); io.order = []
  io.record.mockReset().mockImplementation(async () => { io.order.push('record'); return { status: 'ran', summary: { recorded: 1 } } })
  io.process.mockReset().mockImplementation(async () => { io.order.push('outbox'); return { claimed: 0, processed: 0, sent: 0, failed: 0, blocked: 0, deliveryUncertain: 0, results: [], stoppedBy: 'queue_empty' } })
})

it.each(['', '?environment=production'])('records scope proofs before the outbox runs (%s)', async query => {
  const body = await (await call(query)).json()
  expect(io.order).toEqual(['record', 'outbox'])
  expect(body).toMatchObject({ ok: true, scopeEvidence: { status: 'ran' } })
})

it('does not run for the test lane', async () => {
  const body = await (await call('?environment=test')).json()
  expect(io.order).toEqual(['outbox']); expect(io.record).not.toHaveBeenCalled()
  expect(body.scopeEvidence).toBeNull()
})

it('a failing recorder never stops the outbox (prescribed CONTRL/APERAK keep flowing)', async () => {
  io.record.mockRejectedValue(new Error('private'))
  const body = await (await call()).json()
  expect(io.process).toHaveBeenCalledTimes(1)
  expect(body).toMatchObject({ ok: true, scopeEvidence: { status: 'failed', reason: 'ediel_company_certified_scopes_failed' } })
})

it('an unauthorized call records nothing', async () => {
  const response = await GET(new NextRequest('http://localhost/api/ediel/outbox/process', { headers: { authorization: 'Bearer wrong' } }))
  expect(response.status).toBe(401); expect(io.record).not.toHaveBeenCalled()
})
