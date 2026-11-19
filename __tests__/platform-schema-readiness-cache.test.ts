import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import {
  assertPlatformSchemaReady,
  invalidatePlatformSchemaReadinessCache,
  type PlatformSchemaReadinessEvidence,
  REQUIRED_PLATFORM_SCHEMA_VERSION,
} from '@/lib/platform/schemaReadiness'

const io = vi.hoisted(() => ({ readinessReads: 0, authCalls: 0, queuedResponses: [] as Promise<Response>[] }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  }) }
})

function readyResponse(overrides: PlatformSchemaReadinessEvidence = {}): Response {
  return Response.json([{
    is_ready: true,
    schema_version: REQUIRED_PLATFORM_SCHEMA_VERSION,
    schema_fingerprint: 'a'.repeat(64),
    blocking_issues: [],
    ...overrides,
  }])
}

function missingViewResponse(): Response {
  return Response.json({ code: 'PGRST205', message: 'Synthetic unavailable capability view' }, { status: 404 })
}

async function transport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin !== 'https://synthetic.invalid') throw new Error('Unexpected external network request')
  if (url.pathname === '/rest/v1/platform_runtime_readiness' && init?.method === 'GET') {
    expect(url.searchParams.get('id')).toBe('eq.true')
    io.readinessReads++
    return io.queuedResponses.shift() ?? readyResponse()
  }
  if (url.pathname === '/rest/v1/rpc/authenticate_integration_request_v1' && init?.method === 'POST') {
    io.authCalls++
    return Response.json([{
      auth_outcome: 'allowed', company_id: 'synthetic-company', client_id: 'fixture-client',
      client_status: 'active', tenant_status: 'active', scopes: ['customer_profile.read'],
    }])
  }
  if (url.pathname === '/rest/v1/integration_api_clients' && init?.method === 'PATCH') {
    return new Response(null, { status: 204 })
  }
  throw new Error(`Unexpected synthetic request ${url.pathname}`)
}

function holdReadiness(): (response: Response) => void {
  let complete!: (response: Response) => void
  io.queuedResponses.push(new Promise(resolve => { complete = resolve }))
  return complete
}

function authenticateFixture(withCredential = true) {
  return requireIntegrationApiAccess(new NextRequest('https://test.invalid/api/v1/customer/me', {
    headers: withCredential ? { authorization: 'Bearer synthetic-fixture-token' } : {},
  }), ['customer_profile.read'])
}

function waitForRead(count: number) {
  return vi.waitFor(() => expect(io.readinessReads).toBeGreaterThanOrEqual(count))
}

const yieldTurn = () => new Promise<void>(resolve => setImmediate(resolve))

beforeEach(() => {
  invalidatePlatformSchemaReadinessCache()
  io.readinessReads = 0
  io.authCalls = 0
  io.queuedResponses = []
})

afterEach(() => vi.restoreAllMocks())

describe('platform schema readiness cache', () => {
  it.each(['cold', 'expired'])('shares one %s load across four independent auth requests', async (state) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    if (state === 'expired') {
      await assertPlatformSchemaReady()
      clock.mockReturnValue(130_000)
    }
    const previousReads = io.readinessReads
    const finish = holdReadiness()
    const requests = Array.from({ length: 4 }, () => authenticateFixture())
    let results: Awaited<ReturnType<typeof authenticateFixture>>[]
    try {
      await waitForRead(previousReads + 1)
      await yieldTurn()
      expect(io.readinessReads).toBe(previousReads + 1)
      expect(io.authCalls).toBe(0)
    } finally {
      finish(readyResponse())
      results = await Promise.all(requests)
    }
    expect(results.every(result => result.ok)).toBe(true)
    expect(io.authCalls).toBe(4)
    await expect(authenticateFixture()).resolves.toMatchObject({ ok: true })
    expect(io.readinessReads).toBe(previousReads + 1)
    expect(io.authCalls).toBe(5)
  })

  it('keeps the 30-second TTL relative to the original read start', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const finish = holdReadiness()
    const firstRequest = assertPlatformSchemaReady()
    try {
      await waitForRead(1)
      clock.mockReturnValue(110_000)
    } finally {
      finish(readyResponse())
      await firstRequest
    }
    clock.mockReturnValue(129_999)
    await assertPlatformSchemaReady()
    expect(io.readinessReads).toBe(1)
    clock.mockReturnValue(130_000)
    await assertPlatformSchemaReady()
    expect(io.readinessReads).toBe(2)
  })

  it('shares an unavailable view result without authenticating, then retries', async () => {
    await expect(authenticateFixture(false)).resolves.toMatchObject({ ok: false, status: 401 })
    expect(io.readinessReads).toBe(0)
    const finish = holdReadiness()
    const first = authenticateFixture()
    const second = authenticateFixture()
    const gathering = Promise.all([first, second])
    try {
      await waitForRead(1)
      await yieldTurn()
    } finally {
      finish(missingViewResponse())
    }
    const results = await gathering
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, status: 503, errorCode: 'platform_schema_not_ready' })
    }
    expect(io.readinessReads).toBe(1)
    expect(io.authCalls).toBe(0)
    await expect(authenticateFixture()).resolves.toMatchObject({ ok: true })
    expect(io.readinessReads).toBe(2)
    expect(io.authCalls).toBe(1)
  })

  it('rejects a missing verification row and retries on the next call', async () => {
    io.queuedResponses.push(Promise.resolve(Response.json([])))
    await expect(assertPlatformSchemaReady()).rejects.toMatchObject({
      status: 503, code: 'platform_schema_not_ready', message: expect.stringContaining('ingen verifieringsrad'),
    })
    await expect(assertPlatformSchemaReady()).resolves.toBeUndefined()
    expect(io.readinessReads).toBe(2)
  })

  it('does not let a completed pre-invalidation read replace the newer cached row', async () => {
    const finishOld = holdReadiness()
    const old = assertPlatformSchemaReady().catch(error => error)
    try {
      await waitForRead(1)
      invalidatePlatformSchemaReadinessCache()
      await assertPlatformSchemaReady()
      expect(io.readinessReads).toBe(2)
    } finally {
      finishOld(readyResponse({ is_ready: false, blocking_issues: ['synthetic blocker'] }))
    }
    expect(await old).toMatchObject({ status: 503, code: 'platform_schema_not_ready' })
    await expect(assertPlatformSchemaReady()).resolves.toBeUndefined()
    expect(io.readinessReads).toBe(2)
  })

  it('does not let a rejected pre-invalidation read clear the newer pending read', async () => {
    const finishOld = holdReadiness()
    const old = assertPlatformSchemaReady().catch(error => error)
    await waitForRead(1)
    invalidatePlatformSchemaReadinessCache()
    const finishNew = holdReadiness()
    const current = assertPlatformSchemaReady()
    let follower: Promise<void> | undefined
    try {
      await waitForRead(2)
      finishOld(missingViewResponse())
      expect(await old).toMatchObject({ status: 503, code: 'platform_schema_not_ready' })
      follower = assertPlatformSchemaReady()
      await yieldTurn()
      expect(io.readinessReads).toBe(2)
    } finally {
      finishOld(missingViewResponse())
      finishNew(readyResponse())
      await Promise.all([current, follower])
    }
  })
})
