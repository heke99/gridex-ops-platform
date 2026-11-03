import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const engines = vi.hoisted(() => ({
  inbound: vi.fn(),
  full: vi.fn(),
  certificates: vi.fn(),
  apply: vi.fn(),
  routes: vi.fn(),
  recovery: vi.fn(),
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller', () => ({ runInboundEdielMailEngine: engines.inbound }))
vi.mock('@/lib/ediel/operations/actorAutoReadiness', () => ({
  runFullActorAutoReadiness: engines.full,
  refreshActorCertificateStatuses: engines.certificates,
  applyActorAutoSendReadiness: engines.apply,
  refreshRouteProfileProductionReadiness: engines.routes,
}))
const automationActor = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: automationActor.resolve }))
const syntheticActorId = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
vi.mock('@/lib/ediel/certificates/scheduledRefreshRecovery', () => ({ runScheduledCertificateRefreshRecovery: engines.recovery }))

import * as inbound from '@/app/api/internal/inbound-mail/cron/route'
import * as readiness from '@/app/api/cron/ediel/actor-readiness/route'

const methods = ['GET', 'POST'] as const
const routes = [
  { name: 'inbound mail', path: '/api/internal/inbound-mail/cron', handlers: inbound, dedicatedEnv: 'EDIEL_INBOUND_CRON_SECRET', dedicated: 'synthetic-inbound-secret' },
  { name: 'actor readiness', path: '/api/cron/ediel/actor-readiness', handlers: readiness, dedicatedEnv: 'EDIEL_ACTOR_READINESS_CRON_SECRET', dedicated: 'synthetic-readiness-secret' },
] as const
type Route = typeof routes[number]
type Method = typeof methods[number]
const schedulerSecret = 'synthetic-scheduler-secret'

function call(route: Route, method: Method, headers: Record<string, string> = {}, query = 'environment=production') {
  return route.handlers[method](new NextRequest(`https://synthetic.example.invalid${route.path}?${query}`, { method, headers }))
}

function expectNoWork() {
  for (const engine of Object.values(engines)) expect(engine).not.toHaveBeenCalled()
}

async function expectAccepted(route: Route, method: Method, headers: Record<string, string>) {
  const response = await call(route, method, headers)
  expect(response).toBeInstanceOf(NextResponse)
  expect(response.status).toBe(200)
  expect((await response.json()).ok).toBe(true)
  const worker = route.handlers === inbound ? engines.inbound : engines.full
  expect(worker).toHaveBeenCalledOnce()
}

beforeEach(() => {
  for (const name of ['CRON_SECRET', 'EDIEL_INBOUND_CRON_SECRET', 'EDIEL_ACTOR_READINESS_CRON_SECRET']) vi.stubEnv(name, undefined)
  for (const engine of Object.values(engines)) engine.mockReset().mockResolvedValue({ synthetic: true })
  automationActor.resolve.mockReset().mockResolvedValue(syntheticActorId)
})
afterEach(() => vi.unstubAllEnvs())

for (const route of routes) {
  describe(`${route.name} scheduler authentication`, () => {
    it.each(methods)('%s accepts the scheduler secret when it is the only configured secret', async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      await expectAccepted(route, method, { authorization: `Bearer ${schedulerSecret}` })
    })

    it.each(methods)('%s retains the route-specific secret when it is the only configured secret', async method => {
      vi.stubEnv(route.dedicatedEnv, route.dedicated)
      await expectAccepted(route, method, { 'x-cron-secret': route.dedicated })
    })

    it.each(methods)('%s accepts CRON_SECRET alongside a different dedicated secret', async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      vi.stubEnv(route.dedicatedEnv, route.dedicated)
      await expectAccepted(route, method, { authorization: `Bearer ${schedulerSecret}` })
    })

    it.each(methods)('%s retains the dedicated secret alongside a different CRON_SECRET', async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      vi.stubEnv(route.dedicatedEnv, route.dedicated)
      await expectAccepted(route, method, { authorization: `Bearer ${route.dedicated}` })
    })

    for (const blank of ['', '   ']) {
      it.each(methods)(`%s ignores a ${JSON.stringify(blank)} dedicated secret without masking CRON_SECRET`, async method => {
        vi.stubEnv('CRON_SECRET', schedulerSecret)
        vi.stubEnv(route.dedicatedEnv, blank)
        await expectAccepted(route, method, { authorization: `Bearer ${schedulerSecret}` })
      })
    }

    for (const headers of [
      { authorization: 'Bearer incorrect', 'x-cron-secret': schedulerSecret },
      { authorization: `Bearer ${schedulerSecret}`, 'x-cron-secret': 'incorrect' },
      { authorization: 'Basic incorrect', 'x-cron-secret': schedulerSecret },
      { authorization: 'Bearer ', 'x-cron-secret': schedulerSecret },
    ]) {
      it.each(methods)(`%s accepts either valid header independently: ${JSON.stringify(headers)}`, async method => {
        vi.stubEnv('CRON_SECRET', schedulerSecret)
        vi.stubEnv(route.dedicatedEnv, route.dedicated)
        await expectAccepted(route, method, headers)
      })
    }

    it.each(methods)('%s rejects missing, malformed and wrong credentials before validation or engine work', async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      vi.stubEnv(route.dedicatedEnv, route.dedicated)
      const deniedHeaders: Record<string, string>[] = [
        {},
        { authorization: 'Bearer wrong' },
        { 'x-cron-secret': 'incorrect' },
        { authorization: `bearer ${schedulerSecret}` },
        { authorization: 'Bearer ', 'x-cron-secret': '' },
        { authorization: `Bearer ${'x'.repeat(schedulerSecret.length)}` },
        { authorization: 'Bearer ééé' },
      ]
      for (const headers of deniedHeaders) {
        const response = await call(route, method, headers, 'environment=invalid&company_id=foreign-company')
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' })
        expectNoWork()
      }
    })

    it.each(methods)('%s fails closed when no nonblank secret is configured', async method => {
      for (const blank of [undefined, '', '   ']) {
        vi.stubEnv('CRON_SECRET', blank)
        vi.stubEnv(route.dedicatedEnv, blank)
        const response = await call(route, method, { authorization: `Bearer ${schedulerSecret}` })
        expect(response.status).toBe(401)
        expectNoWork()
      }
    })
  })
}

describe('actor readiness inherited secret compatibility', () => {
  for (const secret of [schedulerSecret, 'synthetic-inbound-secret', 'synthetic-readiness-secret']) {
    it.each(methods)(`%s accepts ${secret} when all three secrets are distinct`, async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      vi.stubEnv('EDIEL_INBOUND_CRON_SECRET', 'synthetic-inbound-secret')
      vi.stubEnv('EDIEL_ACTOR_READINESS_CRON_SECRET', 'synthetic-readiness-secret')
      await expectAccepted(routes[1], method, { 'x-cron-secret': secret })
    })
  }

  it.each(methods)('%s keeps the inherited inbound secret when the readiness secret is blank', async method => {
    vi.stubEnv('EDIEL_INBOUND_CRON_SECRET', 'synthetic-inbound-secret')
    vi.stubEnv('EDIEL_ACTOR_READINESS_CRON_SECRET', '   ')
    await expectAccepted(routes[1], method, { authorization: 'Bearer synthetic-inbound-secret' })
  })

  it.each(methods)('%s does not grant the readiness-only secret access to the inbound route', async method => {
    vi.stubEnv('EDIEL_ACTOR_READINESS_CRON_SECRET', 'synthetic-readiness-secret')
    vi.stubEnv('CRON_SECRET', schedulerSecret)
    const response = await call(routes[0], method, { authorization: 'Bearer synthetic-readiness-secret' })
    expect(response.status).toBe(401)
    expectNoWork()
  })
})

describe('authenticated request boundaries', () => {
  for (const environment of ['test', 'production']) {
    it.each(methods)(`inbound %s passes the explicit ${environment} environment without a tenant override`, async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      const response = await call(routes[0], method, { authorization: `Bearer ${schedulerSecret}` }, `environment=${environment}`)
      expect(response.status).toBe(200)
      expect(engines.inbound).toHaveBeenCalledExactlyOnceWith({ environment, mailboxId: null, force: false, sharedOnly: true, allowMissingMailboxConfig: true, actorUserId: syntheticActorId })
    })
  }

  it.each(methods)('inbound %s rejects missing or invalid environments before work', async method => {
    vi.stubEnv('CRON_SECRET', schedulerSecret)
    for (const query of ['', 'environment=', 'environment=invalid', 'environment=PRODUCTION']) {
      const response = await call(routes[0], method, { authorization: `Bearer ${schedulerSecret}` }, query)
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('invalid_environment')
      expectNoWork()
    }
  })

  for (const override of ['company_id', 'companyId']) {
    it.each(methods)(`inbound %s rejects ${override} before any mailbox work`, async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      const response = await call(routes[0], method, { authorization: `Bearer ${schedulerSecret}` }, `environment=production&${override}=foreign-company`)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('overrides är inte tillåtna')
      expectNoWork()
    })
  }

  for (const [mode, worker, runsRecovery] of [
    ['full', engines.full, true],
    ['certificates', engines.certificates, true],
    ['apply', engines.apply, false],
    ['route_profiles', engines.routes, false],
  ] as const) {
    it.each(methods)(`readiness %s keeps the ${mode} engine boundary`, async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      const response = await call(routes[1], method, { authorization: `Bearer ${schedulerSecret}` }, `mode=${mode}`)
      expect(response.status).toBe(200)
      expect((await response.json()).mode).toBe(mode)
      expect(worker).toHaveBeenCalledOnce()
      expect(engines.inbound).not.toHaveBeenCalled()
      if (runsRecovery) expect(engines.recovery).toHaveBeenCalledExactlyOnceWith({ limit: 50 })
      else expect(engines.recovery).not.toHaveBeenCalled()
    })
  }
})

describe('inbound cron automation actor', () => {
  it.each(methods)('inbound %s passes the resolved configured automation actor to the engine', async method => {
    vi.stubEnv('CRON_SECRET', schedulerSecret)
    const response = await call(routes[0], method, { authorization: `Bearer ${schedulerSecret}` })
    expect(response.status).toBe(200)
    expect(automationActor.resolve).toHaveBeenCalledOnce()
    expect(engines.inbound).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorUserId: syntheticActorId }))
  })

  for (const reason of ['ediel_actor_invalid_uuid', 'ediel_actor_missing_auth_user', 'ediel_actor_missing_profile_or_membership']) {
    it.each(methods)(`inbound %s fails closed without engine work on ${reason}`, async method => {
      vi.stubEnv('CRON_SECRET', schedulerSecret)
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      automationActor.resolve.mockRejectedValue(new Error(`${reason}: synthetic`))
      const response = await call(routes[0], method, { authorization: `Bearer ${schedulerSecret}` })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ ok: false, error: 'Ediel-automation saknar giltig systemaktör.', code: 'ediel_automation_actor_missing' })
      expectNoWork()
    })
  }

  it.each(methods)('inbound %s does not resolve the actor before authentication', async method => {
    vi.stubEnv('CRON_SECRET', schedulerSecret)
    const response = await call(routes[0], method, { authorization: 'Bearer wrong' })
    expect(response.status).toBe(401)
    expect(automationActor.resolve).not.toHaveBeenCalled()
    expectNoWork()
  })
})
