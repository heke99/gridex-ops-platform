// Smoke: stacken, appen, admin-fixturen och en skyddad /api/internal-route. Inga scenario-ID:n (TERM kommer senare).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminFixture, loginSession, psql, removeAdminFixtureUser, sim, type AdminFixture, type AppSession } from '../lib'

const PROTECTED = '/api/internal/billing/period-locks?billing_month=2026-01'

describe('SMOKE harness', () => {
  let fixture: AdminFixture
  let session: AppSession

  beforeAll(async () => {
    fixture = await createAdminFixture()
  }, 60_000)
  afterAll(async () => { if (fixture) await removeAdminFixtureUser(fixture) })

  it('SMOKE.01 DB nås och basens schema finns', () => {
    expect(psql('select 1')).toBe('1')
    expect(psql(`select to_regclass('public.companies') is not null and to_regclass('public.company_memberships') is not null`)).toBe('t')
  })

  it('SMOKE.02 appen svarar på /', async () => {
    const res = await fetch(sim.appUrl + '/', { redirect: 'manual' })
    expect(res.status).toBeLessThan(500)
  })

  it('SMOKE.03 lokala motparter och mail svarar', async () => {
    expect((await fetch(sim.counterpartUrl + '/__health')).status).toBe(200)
    expect((await fetch(sim.mailHttpUrl + '/')).status).toBeLessThan(500)
  })

  it('SMOKE.04 anonymt anrop mot skyddad internal-route nekas (401)', async () => {
    const res = await fetch(sim.appUrl + PROTECTED, { redirect: 'manual' })
    expect(res.status).toBe(401)
  })

  it('SMOKE.05 admin-fixture loggar in med riktig cookie-session', async () => {
    session = await loginSession(fixture.email, fixture.password, { companyId: fixture.companyId })
    expect(session.userId).toBe(fixture.userId)
  })

  it('SMOKE.06 inloggad admin når skyddad internal-route (2xx, annars kontrollerat 4xx; aldrig 401/5xx)', async () => {
    const res = await session.fetch(PROTECTED)
    const text = await res.text()
    expect([200, 400, 403, 404], `status ${res.status}: ${text.slice(0, 300)}`).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(() => JSON.parse(text)).not.toThrow()
  })
})
