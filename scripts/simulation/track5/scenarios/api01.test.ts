// executionScope: ISOLATED_NATIVE
// masterplan-sim: API01.01-.05
// Spår 5, API01: partner-API:t (app/api/partner/v1/[[...path]]) via HTTP med riktiga nycklar och Idempotency-Key.
// Orakel: definitionsbeskrivningen per ID (original sha 96518c18…) tillämpad på spårets egna bolag A/B. DB-readback
// med psql. Nyckel-, bolags- och erbjudandefixtur är backendersättning (se lib/partner.ts, lib/api01-offer.ts).
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, SIM_HOME } from '../lib'
import { publishApiOffer, type ApiOffer } from '../lib/api01-offer'
import { brief, createPartnerClient, partner, type PartnerClient, type PartnerResponse } from '../lib/partner'
import { loginViaUi } from '../lib/auth01-jar'
import { http, receipt, sha256 } from '../lib/receipts'
import { callServerAction } from '../lib/server-action'
import { createAuthUser, createCompany, createCustomer, deleteAuthUser, grantAdmin, type T5User } from '../lib/t5-world'

const rec = (id: string, step: string, r: PartnerResponse, extra: Record<string, unknown> = {}) =>
  receipt(id, step, { ...http(r.status, r.text), requestId: r.headers.get('x-request-id'), entityId: (r.json as { entity_id?: unknown } | null)?.entity_id ?? null, errorCode: (r.json as { error?: { code?: unknown } } | null)?.error?.code ?? null, ...extra })

const WRITE_SCOPES = ['partner_customers.write', 'partner_sites.write', 'partner_power_of_attorney.write', 'partner_contracts.write',
  'customer_profile.read', 'customer_sites.read', 'customer_power_of_attorney.read']

/** Minimal, strukturellt giltig PDF (header, katalog, sida, xref med riktiga offset, startxref, %%EOF). */
function minimalPdfBase64(label: string): string {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>`]
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1').toString('base64')
}

/** Syntetiskt personnummer med giltig Luhn-kontrollsiffra (19 + YYMMDD + 3 siffror + kontroll). */
function syntheticPersonnummer(seed: number): string {
  const base = `9001${String(10 + (seed % 18)).padStart(2, '0')}${String(900 + (seed % 99)).padStart(3, '0')}`
  let sum = 0
  for (let i = 0; i < base.length; i++) {
    let d = Number(base[i]) * (i % 2 === 0 ? 2 : 1)
    if (d > 9) d -= 9
    sum += d
  }
  return `19${base}${(10 - (sum % 10)) % 10}`
}

const customerBody = (seed: number, label: string) => ({
  first_name: 'Sim', last_name: label, soc_id: syntheticPersonnummer(seed), customer_type: 'PRIVATE',
  invoice_address: 'Testgatan 1', zip_code: '12345', city: 'Teststad', country: 'SE',
  email: `t5-${label.toLowerCase()}-${seed}@example.invalid`, cell_phone: '0701234567',
})
const siteBody = (n: number) => ({ address: `Simvägen ${n}`, zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
const poaBody = (label: string) => ({ poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: minimalPdfBase64(label), file_extension: 'pdf' })

const countRows = (table: string, companyId: string) => Number(psql(`select count(*) from public.${table} where company_id='${companyId}'`))
const companyCounts = (companyId: string) => ({
  customers: countRows('customers', companyId), sites: countRows('customer_sites', companyId),
  poas: countRows('powers_of_attorney', companyId), contracts: countRows('customer_contracts', companyId),
})
const entity = (r: { json: unknown }) => String((r.json as { entity_id?: unknown } | null)?.entity_id ?? '')

describe('API01 partner-API', () => {
  let A: string, B: string
  let actorA: T5User
  let keyA: PartnerClient, keyB: PartnerClient
  let offerA: ApiOffer | null = null
  let offerError: string | null = null
  let custA = '', siteA1 = '', siteA2 = ''
  // Kund skapad som fixtur (SQL) så att site/POA-oraklen prövas oberoende av fynd 001 (POST customer ger 500).
  let fixtureCustA = '', fixtureCustA2 = ''

  beforeAll(async () => {
    A = createCompany('Sim T5 API bolag A')
    B = createCompany('Sim T5 API bolag B')
    actorA = await createAuthUser('api-actor-a')
    grantAdmin(actorA.userId, A, ['contracts.create', 'contracts.create_version', 'contracts.publish', 'pricing.write', 'pricing.publish'])
    try { offerA = await publishApiOffer(A, actorA.userId) } catch (e) { offerError = (e as Error).message }
    keyA = createPartnerClient(A, WRITE_SCOPES, { metadata: offerA ? { synthetic: true, partner_default_offer_reference: offerA.offerReference } : { synthetic: true } })
    keyB = createPartnerClient(B, WRITE_SCOPES)
    fixtureCustA = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'ApiFixtur')}'`)
    fixtureCustA2 = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'ApiFixtur2')}'`)
  }, 180_000)
  afterAll(async () => { if (actorA) await deleteAuthUser(actorA.userId) })

  it('API01.01 giltig partner skapar kund via POST customer (2xx, bunden till nyckelns bolag)', async () => {
    const c = await partner(keyA, 'POST', 'customer', customerBody(1, 'Kund'))
    rec('API01.01', 'POST customer', c)
    expect(c.status, brief(c)).toBe(201)
    custA = entity(c)
    expect(psql(`select company_id from public.customers where customer_reference='${custA}'`)).toBe(A)
  })

  it('API01.01 giltig partner skapar site via POST customer/{id}/site, bunden till kund och bolag', async () => {
    const s = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(1))
    rec('API01.01', 'POST site', s, { customerRef: fixtureCustA })
    expect(s.status, brief(s)).toBe(201)
    siteA1 = entity(s)
    const rows = psqlRows<{ company_id: string; customer_reference: string; site_company: string; site_customer_ok: boolean }>(
      `select c.company_id, c.customer_reference, s.company_id site_company, s.customer_id = c.id site_customer_ok
         from public.customers c join public.customer_sites s on s.customer_id = c.id
        where c.customer_reference = '${fixtureCustA}' and s.facility_reference = '${siteA1}'`)
    expect(rows).toEqual([{ company_id: A, customer_reference: fixtureCustA, site_company: A, site_customer_ok: true }])
  })

  it('API01.01 giltig partner skapar avtal via POST contract; kund, site, POA och avtal bundna till bolaget', async () => {
    expect(offerError, 'API-erbjudandefixturen').toBeNull()
    const before = companyCounts(A)
    const k = await partner(keyA, 'POST', 'contract', { customer: customerBody(2, 'Avtal'), site: siteBody(2), power_of_attorney: poaBody('avtal') })
    rec('API01.01', 'POST contract', k, { offerFixture: offerError ? 'failed' : 'published' })
    expect(k.status, brief(k)).toBe(201)
    const out = k.json as { entity_id: string; customer: { entity_id: string }; site: { entity_id: string }; power_of_attorney: { entity_id: string } | null }
    const contract = psqlRows<{ company_id: string; customer_company: string; site_company: string; site_of_customer: boolean }>(
      `select k.company_id, c.company_id customer_company, s.company_id site_company, s.customer_id = c.id site_of_customer
         from public.customer_contracts k join public.customers c on c.id = k.customer_id join public.customer_sites s on s.id = k.site_id
        where k.customer_contract_reference = '${out.entity_id}'`)
    expect(contract).toEqual([{ company_id: A, customer_company: A, site_company: A, site_of_customer: true }])
    expect(out.power_of_attorney?.entity_id, 'POA i avtalssvaret').toBeTruthy()
    const after = companyCounts(A)
    expect(after.contracts - before.contracts).toBe(1)
    expect(countRows('customer_contracts', B)).toBe(0)
  })

  it('API01.02 två sites hos samma kund får varsin POA bunden till rätt site och kund', async () => {
    // Självständigt steg: båda sites skapas här (inget beroende på API01.01).
    const s1 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(31))
    expect(s1.status, brief(s1)).toBe(201)
    const s2 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(32))
    expect(s2.status, brief(s2)).toBe(201)
    const site1 = entity(s1)
    siteA2 = entity(s2)
    rec('API01.02', 'POST site1', s1, { customerRef: fixtureCustA }); rec('API01.02', 'POST site2', s2, { customerRef: fixtureCustA })
    const p1 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${site1}/powerofattorney`, poaBody('site1'))
    expect(p1.status, brief(p1)).toBe(201)
    const p2 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`, poaBody('site2'))
    expect(p2.status, brief(p2)).toBe(201)
    rec('API01.02', 'POST poa site1', p1, { site: site1 }); rec('API01.02', 'POST poa site2', p2, { site: siteA2 })
    // Readback: sitens egen kund (customer_sites.customer_id) och POA:ns kund/site, var för sig.
    const rows = psqlRows<{ ref: string; site_ref: string; site_customer_ref: string; poa_customer_ref: string; company_id: string; site_company: string; same_site: boolean }>(
      `select p.power_of_attorney_reference ref, s.facility_reference site_ref, sc.customer_reference site_customer_ref,
              pc.customer_reference poa_customer_ref, p.company_id, s.company_id site_company, p.site_id = p.customer_site_id same_site
         from public.powers_of_attorney p
         join public.customer_sites s on s.id = p.customer_site_id
         join public.customers sc on sc.id = s.customer_id
         join public.customers pc on pc.id = p.customer_id
        where p.power_of_attorney_reference in ('${entity(p1)}','${entity(p2)}') order by s.facility_reference = '${site1}' desc`)
    receipt('API01.02', 'db-readback', { rows, substitution: 'kund skapad som SQL-fixtur (fynd 001)' })
    expect(rows).toEqual([
      { ref: entity(p1), site_ref: site1, site_customer_ref: fixtureCustA, poa_customer_ref: fixtureCustA, company_id: A, site_company: A, same_site: true },
      { ref: entity(p2), site_ref: siteA2, site_customer_ref: fixtureCustA, poa_customer_ref: fixtureCustA, company_id: A, site_company: A, same_site: true },
    ])
    const g1 = await partner(keyA, 'GET', `customer/${fixtureCustA}/site/${site1}/powerofattorney`)
    const g2 = await partner(keyA, 'GET', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`)
    rec('API01.02', 'GET poa site1', g1); rec('API01.02', 'GET poa site2', g2)
    expect(g1.status, brief(g1)).toBe(200)
    expect(g2.status, brief(g2)).toBe(200)
    expect(entity(g1)).toBe(entity(p1))
    expect(entity(g2)).toBe(entity(p2))
    // Fel kombination kund/site från en annan kund nekas.
    const cross = await partner(keyA, 'POST', `customer/${fixtureCustA2}/site/${site1}/powerofattorney`, poaBody('kors'))
    rec('API01.02', 'POST poa cross-customer', cross)
    expect(cross.status, brief(cross)).toBe(404)
  })

  // API01.03 prövas mot det kvalificerade oraklet i scenarios/api01-poa.test.ts.

  it('API01.04 samma Idempotency-Key ger samma svar och inga nya rader; ändrad payload ger 409', async () => {
    // Site-skrivning (fungerar på basen; POST customer blockeras av fynd 001 och prövas i API01.01).
    const key = randomUUID()
    const body = siteBody(5)
    const first = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, body, { idempotencyKey: key })
    expect(first.status, brief(first)).toBe(201)
    const before = companyCounts(A)
    const again = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, body, { idempotencyKey: key })
    expect([200, 201], brief(again)).toContain(again.status)
    expect(entity(again)).toBe(entity(first))
    expect(sha256(again.text), 'återspelad svarskropp').toBe(sha256(first.text))
    rec('API01.04', 'site first', first, { idempotencyKey: 'K1' }); rec('API01.04', 'site replay', again, { idempotencyKey: 'K1' })
    expect(companyCounts(A)).toEqual(before)
    const changed = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, { ...body, address: 'Annan väg 9' }, { idempotencyKey: key })
    expect(changed.status, brief(changed)).toBe(409)
    rec('API01.04', 'site changed payload', changed, { idempotencyKey: 'K1' })
    expect(companyCounts(A)).toEqual(before)
    // Samma nyckel och payload för POA på samma site: ingen ny POA-rad och samma referens.
    const pkey = randomUUID()
    const pb = poaBody('idem-poa')
    const p1 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`, pb, { idempotencyKey: pkey })
    expect(p1.status, brief(p1)).toBe(201)
    const poas = companyCounts(A).poas
    const p2 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${siteA2}/powerofattorney`, pb, { idempotencyKey: pkey })
    expect([200, 201], brief(p2)).toContain(p2.status)
    expect(entity(p2)).toBe(entity(p1))
    expect(sha256(p2.text)).toBe(sha256(p1.text))
    rec('API01.04', 'poa first', p1, { idempotencyKey: 'K2' }); rec('API01.04', 'poa replay', p2, { idempotencyKey: 'K2' })
    expect(companyCounts(A).poas).toBe(poas)
    // Samma nyckel mot en annan site återspelar inte den första sitens POA.
    const p3 = await partner(keyA, 'POST', `customer/${fixtureCustA}/site/${siteA1}/powerofattorney`, pb, { idempotencyKey: pkey })
    expect(p3.status, brief(p3)).toBe(409)
    rec('API01.04', 'poa same key other site', p3, { idempotencyKey: 'K2' })
    expect(companyCounts(A).poas).toBe(poas)
    // Saknad Idempotency-Key på en skrivning nekas utan rad.
    const none = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, siteBody(6), { idempotencyKey: null })
    expect(none.status, brief(none)).toBeGreaterThanOrEqual(400)
    expect(none.status).toBeLessThan(500)
    rec('API01.04', 'site without key', none)
    expect(companyCounts(A).sites).toBe(before.sites)
    receipt('API01.04', 'counts', { before, after: companyCounts(A), notVerified: 'kund- och avtalsskrivningar (fynd 001)' })
  })

  it('API01.05 fel tenant eller för bred scope nekas utan rader eller läckt data', async () => {
    const beforeA = companyCounts(A), beforeB = companyCounts(B)
    // Begäran utöver nyckelns scope nekas.
    const readOnly = createPartnerClient(A, ['customer_profile.read'])
    const noScope = await partner(readOnly, 'POST', `customer/${fixtureCustA}/site`, siteBody(7))
    rec('API01.05', 'write beyond scope', noScope)
    expect(noScope.status, brief(noScope)).toBe(403)
    expect(noScope.text).toContain('api_scope_missing')
    // Fel tenant: tenantväljare i kroppen och främmande resurser.
    const tenant = await partner(keyA, 'POST', `customer/${fixtureCustA}/site`, { ...siteBody(8), company_id: B })
    rec('API01.05', 'tenant selector in body', tenant)
    expect(tenant.status, brief(tenant)).toBe(422)
    expect(tenant.text).toContain('tenant_selection_forbidden')
    const fixtureEmail = psql(`select email from public.customers where customer_reference='${fixtureCustA}'`)
    const foreignGet = await partner(keyB, 'GET', `customer/${fixtureCustA}`)
    rec('API01.05', 'foreign customer read', foreignGet)
    expect(foreignGet.status, brief(foreignGet)).toBe(404)
    expect(foreignGet.text).toContain('customer_not_found')
    expect(fixtureEmail).toMatch(/@example\.invalid$/)
    expect(foreignGet.text).not.toContain(fixtureEmail)
    const foreignSite = await partner(keyB, 'POST', `customer/${fixtureCustA}/site`, siteBody(9))
    rec('API01.05', 'foreign customer write', foreignSite)
    expect(foreignSite.status, brief(foreignSite)).toBe(404)
    expect(foreignSite.text).toContain('customer_not_found')
    // Ogiltiga nycklar.
    const revoked = createPartnerClient(A, WRITE_SCOPES, { status: 'revoked' })
    const r1 = await partner(revoked, 'POST', `customer/${fixtureCustA}/site`, siteBody(10))
    rec('API01.05', 'revoked key', r1)
    expect([401, 403], brief(r1)).toContain(r1.status)
    expect(r1.text).toMatch(/api_client_(inactive|revoked)|invalid_api_token/)
    const expired = createPartnerClient(A, WRITE_SCOPES, { expiresAt: '2020-01-01T00:00:00Z' })
    const r2 = await partner(expired, 'POST', `customer/${fixtureCustA}/site`, siteBody(11))
    rec('API01.05', 'expired key', r2)
    expect([401, 403], brief(r2)).toContain(r2.status)
    expect(r2.text).toMatch(/api_client_expired|api_client_inactive|invalid_api_token|expired/)
    const anon = await partner(null, 'POST', `customer/${fixtureCustA}/site`, siteBody(12))
    rec('API01.05', 'no key', anon)
    expect(anon.status, brief(anon)).toBe(401)
    expect(anon.text).toContain('missing_api_token')
    expect(companyCounts(A)).toEqual(beforeA)
    expect(companyCounts(B)).toEqual(beforeB)
  })

  it('API01.05 för bred scope vid utfärdande: plattformens behörighetsändring tar bort okända och jokerscopes', async () => {
    const platform = await createAuthUser('api-platform')
    try {
      psql(`INSERT INTO public.admin_users(user_id,role,is_active) VALUES('${platform.userId}','platform_admin',true);`)
      const target = createPartnerClient(A, ['customer_profile.read', 'partner_customers.write'])
      const s = await loginViaUi(platform.email, platform.password, '/admin/platform/api-clients')
      const form = new FormData()
      form.set('clientId', target.id)
      for (const scope of ['*', 'admin.everything', 'customer_profile.read']) form.append('scopes', scope)
      form.set('allowedOrigins', 'https://partner.example.com')
      const result = await callServerAction({ userId: '', cookieHeader: s.cookieHeader(), fetch: s.fetch }, {
        route: '/admin/platform/api-clients', filename: 'app/admin/platform/api-clients/actions.ts',
        exportedName: 'updateIntegrationApiClientPermissionsAction', args: [form] })
      const stored = psqlRows<{ scopes: string[]; status: string; launch_ready: boolean }>(
        `select scopes, status, launch_ready from public.integration_api_clients where id='${target.id}'`)[0]
      receipt('API01.05', 'platform permission update', { httpStatus: result.httpStatus, threw: result.threw, stored })
      expect(result.threw, result.excerpt).toBe(false)
      expect(stored.scopes).not.toContain('*')
      expect(stored.scopes).not.toContain('admin.everything')
      expect(stored.scopes).toContain('customer_profile.read')
      expect(stored.scopes, 'ändringen sparades (partner_customers.write togs bort)').not.toContain('partner_customers.write')
      // Ändrade behörigheter kräver ny go-live; nyckeln nekas tills dess.
      expect(stored.launch_ready).toBe(false)
      const after = await partner(target, 'GET', `customer/${fixtureCustA}`)
      rec('API01.05', 'key after permission change', after)
      expect([401, 403], brief(after)).toContain(after.status)
    } finally {
      await deleteAuthUser(platform.userId)
    }
  })
})
