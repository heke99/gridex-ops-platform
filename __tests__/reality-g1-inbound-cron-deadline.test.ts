// reality-defects: G-1 (scenario G: the inbound-mail cron declared no maxDuration and one run took 315 s)
// The scheduled inbound-mail route declares its platform limit and hands the
// engine a deadline ahead of it, so the held-UTILTS resume (a whole file per
// source, 2-3 minutes) never starts work that would outlive the function.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ engine: vi.fn(), actor: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller', () => ({ runInboundEdielMailEngine: mocks.engine }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: mocks.actor }))

import { POST, maxDuration } from '@/app/api/internal/inbound-mail/cron/route'

const request = () => new NextRequest('https://ops.example.invalid/api/internal/inbound-mail/cron?environment=production',
  { method: 'POST', headers: { authorization: 'Bearer cron-secret-for-test' } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret-for-test'
  delete process.env.EDIEL_INBOUND_CRON_SECRET
  mocks.actor.mockResolvedValue('7f1c2a9e-4b3d-4c1e-9a2b-5d6e7f8a9b0c')
  mocks.engine.mockResolvedValue({ mailboxesChecked: 1 })
})
afterEach(() => { vi.useRealTimers() })

describe('G-1: inbound-mail cron route deadline', () => {
  it('declares a platform limit no longer than the 5-minute cron cadence', () => {
    expect(maxDuration).toBe(300)
  })

  it('passes the engine a deadline that leaves a reserve before maxDuration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T08:42:57.000Z'))
    const response = await POST(request())
    expect(response.status).toBe(200)
    const deadlineAt = mocks.engine.mock.calls[0][0].deadlineAt as number
    expect(deadlineAt).toBe(Date.parse('2026-10-24T08:42:57.000Z') + 270_000)
    expect(deadlineAt).toBeLessThan(Date.now() + maxDuration * 1000)
  })
})
