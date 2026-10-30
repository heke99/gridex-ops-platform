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
import { brief, createPartnerClient, partner, type PartnerClient } from '../lib/partner'
import { createAuthUser, createCompany, deleteAuthUser, grantAdmin, type T5User } from '../lib/t5-world'

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

  beforeAll(async () => {
    A = createCompany('Sim T5 API bolag A')
    B = createCompany('Sim T5 API bolag B')
    actorA = await createAuthUser('api-actor-a')
    grantAdmin(actorA.userId, A, ['billing_underlay.read'])
    try { offerA = await publishApiOffer(A, actorA.userId) } catch (e) { offerError = (e as Error).message }
    keyA = createPartnerClient(A, WRITE_SCOPES, { metadata: offerA ? { synthetic: true, partner_default_offer_reference: offerA.offerReference } : { synthetic: true } })
    keyB = createPartnerClient(B, WRITE_SCOPES)
  }, 180_000)
  afterAll(async () => { if (actorA) await deleteAuthUser(actorA.userId) })

  it('API01.01 giltig partner skapar kund, site och avtal; allt bundet till nyckelns bolag', async () => {
    const c = await partner(keyA, 'POST', 'customer', customerBody(1, 'Kund'))
    expect(c.status, brief(c)).toBe(201)
    custA = entity(c)
    const s = await partner(keyA, 'POST', `customer/${custA}/site`, siteBody(1))
    expect(s.status, brief(s)).toBe(201)
    siteA1 = entity(s)
    const rows = psqlRows<{ company_id: string; customer_reference: string; site_company: string; site_customer_ok: boolean }>(
      `select c.company_id, c.customer_reference, s.company_id site_company, s.customer_id = c.id site_customer_ok
         from public.customers c join public.customer_sites s on s.customer_id = c.id
        where c.customer_reference = '${custA}' and s.facility_reference = '${siteA1}'`)
    expect(rows).toEqual([{ company_id: A, customer_reference: custA, site_company: A, site_customer_ok: true }])

    expect(offerError, 'API-erbjudandefixturen').toBeNull()
    const before = companyCounts(A)
    const k = await partner(keyA, 'POST', 'contract', { customer: customerBody(2, 'Avtal'), site: siteBody(2), power_of_attorney: poaBody('avtal') })
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
    expect(custA && siteA1, 'kräver API01.01:s kund och site').toBeTruthy()
    const s2 = await partner(keyA, 'POST', `customer/${custA}/site`, siteBody(3))
    expect(s2.status, brief(s2)).toBe(201)
    siteA2 = entity(s2)
    const p1 = await partner(keyA, 'POST', `customer/${custA}/site/${siteA1}/powerofattorney`, poaBody('site1'))
    expect(p1.status, brief(p1)).toBe(201)
    const p2 = await partner(keyA, 'POST', `customer/${custA}/site/${siteA2}/powerofattorney`, poaBody('site2'))
    expect(p2.status, brief(p2)).toBe(201)
    const rows = psqlRows<{ ref: string; site_ref: string; customer_ref: string; company_id: string; same_site: boolean }>(
      `select p.power_of_attorney_reference ref, s.facility_reference site_ref, c.customer_reference customer_ref, p.company_id,
              p.site_id = p.customer_site_id same_site
         from public.powers_of_attorney p join public.customer_sites s on s.id = p.customer_site_id join public.customers c on c.id = p.customer_id
        where p.power_of_attorney_reference in ('${entity(p1)}','${entity(p2)}') order by s.facility_reference = '${siteA1}' desc`)
    expect(rows).toEqual([
      { ref: entity(p1), site_ref: siteA1, customer_ref: custA, company_id: A, same_site: true },
      { ref: entity(p2), site_ref: siteA2, customer_ref: custA, company_id: A, same_site: true },
    ])
    const g1 = await partner(keyA, 'GET', `customer/${custA}/site/${siteA1}/powerofattorney`)
    const g2 = await partner(keyA, 'GET', `customer/${custA}/site/${siteA2}/powerofattorney`)
    expect(g1.status, brief(g1)).toBe(200)
    expect(g2.status, brief(g2)).toBe(200)
    expect(g1.text).toContain(entity(p1)); expect(g1.text).not.toContain(entity(p2))
    expect(g2.text).toContain(entity(p2)); expect(g2.text).not.toContain(entity(p1))
    // Fel kombination kund/site från en annan kund nekas.
    const other = await partner(keyA, 'POST', 'customer', customerBody(4, 'Annan'))
    expect(other.status, brief(other)).toBe(201)
    const cross = await partner(keyA, 'POST', `customer/${entity(other)}/site/${siteA1}/powerofattorney`, poaBody('kors'))
    expect(cross.status, brief(cross)).toBe(404)
  })

  it('API01.03 utgången POA: observation av normal ingång (orakel kräver beslut, se FINDINGS)', async () => {
    expect(siteA1, 'kräver API01.02').toBeTruthy()
    const obs: Record<string, unknown> = {}
    // a) Partner-API:t har inget giltighetsfält: ett skickat valid_to i det förflutna.
    const withExpiry = await partner(keyA, 'POST', `customer/${custA}/site/${siteA1}/powerofattorney`, { ...poaBody('utgangen'), valid_to: '2020-01-01' })
    obs.postWithPastValidTo = { status: withExpiry.status, body: withExpiry.text.slice(0, 300) }
    // b) Befintlig POA görs utgången i DB (kontrollerad klocka: valid_to/expires_at i det förflutna) och läses via GET.
    const ref = psql(`select power_of_attorney_reference from public.powers_of_attorney where customer_site_id=(select id from public.customer_sites where facility_reference='${siteA1}') and status='signed' order by created_at limit 1`)
    psql(`update public.powers_of_attorney set valid_to = date '2020-01-01', valid_until = date '2020-01-01', expires_at = timestamptz '2020-01-01' where power_of_attorney_reference='${ref}'`)
    const g = await partner(keyA, 'GET', `customer/${custA}/site/${siteA1}/powerofattorney`)
    obs.getAfterExpiry = { status: g.status, body: g.text.slice(0, 600) }
    fs.mkdirSync(path.join(SIM_HOME, 'observations'), { recursive: true })
    fs.writeFileSync(path.join(SIM_HOME, 'observations', 'API01.03.json'), JSON.stringify(obs, null, 2))
    // Det som kan påstås utan beslut: läsningen är tenantbunden och läcker inte till B.
    const gB = await partner(keyB, 'GET', `customer/${custA}/site/${siteA1}/powerofattorney`)
    expect(gB.status, brief(gB)).toBe(404)
  })

  it('API01.04 samma Idempotency-Key ger samma svar och inga nya rader; ändrad payload ger 409', async () => {
    const key = randomUUID()
    const body = customerBody(5, 'Idem')
    const first = await partner(keyA, 'POST', 'customer', body, { idempotencyKey: key })
    expect(first.status, brief(first)).toBe(201)
    const before = companyCounts(A)
    const again = await partner(keyA, 'POST', 'customer', body, { idempotencyKey: key })
    expect([200, 201], brief(again)).toContain(again.status)
    expect(entity(again)).toBe(entity(first))
    expect(companyCounts(A)).toEqual(before)
    const changed = await partner(keyA, 'POST', 'customer', { ...body, last_name: 'Annan' }, { idempotencyKey: key })
    expect(changed.status, brief(changed)).toBe(409)
    expect(companyCounts(A)).toEqual(before)
    // Samma nyckel och payload för POA på samma site: ingen ny POA-rad.
    const pkey = randomUUID()
    const pb = poaBody('idem-poa')
    const p1 = await partner(keyA, 'POST', `customer/${custA}/site/${siteA2}/powerofattorney`, pb, { idempotencyKey: pkey })
    expect(p1.status, brief(p1)).toBe(201)
    const poas = companyCounts(A).poas
    const p2 = await partner(keyA, 'POST', `customer/${custA}/site/${siteA2}/powerofattorney`, pb, { idempotencyKey: pkey })
    expect([200, 201], brief(p2)).toContain(p2.status)
    expect(entity(p2)).toBe(entity(p1))
    expect(companyCounts(A).poas).toBe(poas)
    // Saknad Idempotency-Key på en skrivning nekas.
    const none = await partner(keyA, 'POST', 'customer', customerBody(6, 'Utan'), { idempotencyKey: null })
    expect(none.status, brief(none)).toBeGreaterThanOrEqual(400)
    expect(none.status).toBeLessThan(500)
    expect(companyCounts(A).customers).toBe(before.customers)
  })

  it('API01.05 fel tenant, scope eller nyckel nekas utan rader eller läckt data', async () => {
    const beforeA = companyCounts(A), beforeB = companyCounts(B)
    const readOnly = createPartnerClient(A, ['customer_profile.read'])
    const noScope = await partner(readOnly, 'POST', 'customer', customerBody(7, 'Scope'))
    expect(noScope.status, brief(noScope)).toBe(403)
    const tenant = await partner(keyA, 'POST', 'customer', { ...customerBody(8, 'Tenant'), company_id: B })
    expect(tenant.status, brief(tenant)).toBe(422)
    expect(tenant.text).toContain('tenant_selection_forbidden')
    const foreignGet = await partner(keyB, 'GET', `customer/${custA}`)
    expect(foreignGet.status, brief(foreignGet)).toBe(404)
    expect(foreignGet.text).not.toContain('Testgatan')
    const foreignSite = await partner(keyB, 'POST', `customer/${custA}/site`, siteBody(9))
    expect(foreignSite.status, brief(foreignSite)).toBe(404)
    const revoked = createPartnerClient(A, WRITE_SCOPES, { status: 'revoked' })
    const r1 = await partner(revoked, 'POST', 'customer', customerBody(10, 'Revoked'))
    expect(r1.status, brief(r1)).toBe(401)
    const expired = createPartnerClient(A, WRITE_SCOPES, { expiresAt: '2020-01-01T00:00:00Z' })
    const r2 = await partner(expired, 'POST', 'customer', customerBody(11, 'Expired'))
    expect(r2.status, brief(r2)).toBe(401)
    const anon = await partner(null, 'POST', 'customer', customerBody(12, 'Anon'))
    expect(anon.status, brief(anon)).toBe(401)
    expect(companyCounts(A)).toEqual(beforeA)
    expect(companyCounts(B)).toEqual(beforeB)
  })
})
