// The scheduled inbound-mail cron must run the engine as the configured Ediel
// automation actor: reception (createInboundEdielMessage) requires a real
// current actor, and without one every fetched Ediel e-mail failed with
// ediel_real_reception_actor_and_parse_required. Same contract as the outbox cron.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ engine: vi.fn(), actor: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller', () => ({ runInboundEdielMailEngine: mocks.engine }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: mocks.actor }))

import { POST } from '@/app/api/internal/inbound-mail/cron/route'

const actor = '7f1c2a9e-4b3d-4c1e-9a2b-5d6e7f8a9b0c'
const request = () => new NextRequest('https://ops.example.invalid/api/internal/inbound-mail/cron?environment=production',
  { method: 'POST', headers: { authorization: 'Bearer cron-secret-for-test' } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret-for-test'
  delete process.env.EDIEL_INBOUND_CRON_SECRET
  mocks.engine.mockResolvedValue({ mailboxesChecked: 1 })
})

describe('scheduled inbound-mail cron actor', () => {
  it('runs the inbound engine as the configured Ediel automation actor', async () => {
    mocks.actor.mockResolvedValue(actor)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.engine).toHaveBeenCalledTimes(1)
    expect(mocks.engine.mock.calls[0][0]).toMatchObject({ actorUserId: actor, environment: 'production', sharedOnly: true })
  })

  it('refuses with 503 and does not poll when no valid automation actor is configured', async () => {
    mocks.actor.mockRejectedValue(new Error('ediel_actor_invalid_uuid'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, code: 'ediel_automation_actor_missing' })
    expect(mocks.engine).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
