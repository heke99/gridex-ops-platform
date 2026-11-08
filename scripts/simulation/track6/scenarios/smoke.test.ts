// SMOKE (spår 6): infrastrukturprov. Playwright används inte; ingen webbläsare.
// Asserterar bara att harnessen fungerar: stack, app (oautentiserad route) och fixturen. Inga produktpåståenden.
import { describe, expect, it } from 'vitest'
import { Evidence } from '../lib/evidence'
import { adminClient, COMPANY_NAME, COUNTERPARTY_EDIEL_ID, OWN_EDIEL_ID, sql } from '../lib/seed.mjs'

const evidence = new Evidence()
const appUrl = process.env.T6_APP_URL ?? `http://127.0.0.1:${process.env.T6_APP_PORT ?? '3106'}`

describe('Track6 smoke: infrastruktur', () => {
  it('SMOKE.01 stacken svarar (Supabase auth-health + databas)', async () => {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    })
    expect(r.status).toBe(200)
    expect(String(sql('select 1')).trim()).toBe('1')
  })

  it('SMOKE.02 appen svarar på en befintlig oautentiserad route (/api/internal/system/health nekar utan hemlighet)', async () => {
    const r = await fetch(`${appUrl}/api/internal/system/health`, { redirect: 'manual' })
    // 401 = hemlighet satt men saknas i anropet, 503 = ops-hälsans cron-hemlighet ej konfigurerad. Aldrig 200 utan hemlighet.
    expect([401, 503]).toContain(r.status)
    const body = (await r.json()) as { ok?: boolean }
    evidence.observe('app_health_route', { status: r.status, ok: body.ok })
    expect(body.ok).toBe(false)
  })

  it('SMOKE.03 fixture-tenanten finns (T6SIM Supplier AB, Ediel-ID 16760) med aktör och rutt mot 70007', async () => {
    expect(OWN_EDIEL_ID).toBe('16760')
    expect(COMPANY_NAME).toBe('T6SIM Supplier AB')
    const actorId = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!
    expect(actorId).toBeTruthy()
    const { data: user, error } = await adminClient().auth.admin.getUserById(actorId)
    expect(error).toBeNull()
    expect(user.user?.email).toBe('t6sim-automation@t6.sim.invalid')
    const rows = JSON.parse(sql(`SELECT jsonb_build_object(
      'company',(SELECT count(*) FROM public.companies WHERE ediel_id='${OWN_EDIEL_ID}' AND name='${COMPANY_NAME}'),
      'routes',(SELECT count(*) FROM public.ediel_route_profiles WHERE sender_ediel_id='${OWN_EDIEL_ID}' AND receiver_ediel_id='${COUNTERPARTY_EDIEL_ID}' AND is_enabled))`))
    evidence.observe('fixture', rows)
    expect(rows.company).toBe(1)
    expect(rows.routes).toBeGreaterThanOrEqual(1)
    evidence.finalize()
  })
})
