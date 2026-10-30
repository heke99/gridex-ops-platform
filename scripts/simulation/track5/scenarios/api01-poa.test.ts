// executionScope: ISOLATED_NATIVE
// masterplan-sim: API01.03
// Spår 5, API01.03 "Utgången/återkallad POA nekas". Kvalificerat orakel (samordningens beslut 2026-10-30 12:13Z):
//  1) partner-API:ts GET ska redovisa en utgången POA som utgången;
//  2) ett leverantörsbyte/en Ediel-begäran med utgången POA ska nekas.
// Normala ingångar: partner-API (POA via HTTP), /api/internal/customer-operations/cron (POA-utgångssvep),
// lib/ediel/flows/prodatSwitch.prepareAndQueueEdielZ03 (backendingång för Z03). Utgången skapas med kontrollerad
// klocka: valid_to sätts i det förflutna i DB, sedan kör appens eget svep. Bytesfixturen är repots
// scripts/helpers/ediel-normal-switch-native-fixture.ts @ 1c0c088c (deferOriginal: ingen Z03 skickas i fixturen).
import { beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, requireEnv, sim } from '../lib'
import { brief, createPartnerClient, partner, type PartnerClient } from '../lib/partner'
import { http, receipt } from '../lib/receipts'
import { createCompany, createCustomer } from '../lib/t5-world'

const SCOPES = ['partner_sites.write', 'partner_power_of_attorney.write', 'customer_power_of_attorney.read', 'customer_sites.read']

function minimalPdfBase64(label: string): string {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>']
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

async function sweep() {
  const res = await fetch(new URL('/api/internal/customer-operations/cron?limit=100', sim.appUrl), {
    method: 'POST', headers: { authorization: `Bearer ${requireEnv('CRON_SECRET')}` },
  })
  const text = await res.text()
  return { status: res.status, text }
}

describe('API01.03 utgången POA', () => {
  let A: string, key: PartnerClient, custRef = '', siteRef = '', poaRef = ''

  beforeAll(async () => {
    A = createCompany('Sim T5 POA bolag A')
    key = createPartnerClient(A, SCOPES)
    custRef = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'PoaKund')}'`)
    const s = await partner(key, 'POST', `customer/${custRef}/site`, { address: 'Poavägen 1', zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
    expect(s.status, brief(s)).toBe(201)
    siteRef = String((s.json as { entity_id: string }).entity_id)
    const p = await partner(key, 'POST', `customer/${custRef}/site/${siteRef}/powerofattorney`, { poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: minimalPdfBase64('poa'), file_extension: 'pdf' })
    expect(p.status, brief(p)).toBe(201)
    poaRef = String((p.json as { entity_id: string }).entity_id)
  }, 120_000)

  it('API01.03 partner-API:ts GET redovisar en utgången POA som utgången (båda läsvägarna)', async () => {
    psql(`update public.powers_of_attorney set valid_to = current_date - 1 where power_of_attorney_reference='${poaRef}'`)
    const sw = await sweep()
    expect(sw.status, sw.text.slice(0, 300)).toBe(200)
    const stored = psqlRows<{ status: string; valid_to: string }>(`select status, valid_to::text from public.powers_of_attorney where power_of_attorney_reference='${poaRef}'`)[0]
    const simple = await partner(key, 'GET', `customer/${custRef}/site/${siteRef}/powerofattorney`)
    const core = await partner(key, 'GET', `powers-of-attorney/${poaRef}`)
    receipt('API01.03', 'GET after expiry', { stored, sweep: http(sw.status, sw.text), simple: http(simple.status, simple.text),
      simpleHasStatus: /"status"/.test(simple.text), simpleHasValidTo: /"valid_to"/.test(simple.text),
      core: http(core.status, core.text), coreStatus: (core.json as { data?: { status?: string } } | null)?.data?.status ?? null })
    expect(stored.status, 'appens svep markerar POA:n som utgången').toBe('expired')
    expect(core.status, brief(core)).toBe(200)
    expect(core.text).toContain('"expired"')
    expect(simple.status, brief(simple)).toBe(200)
    expect(simple.text.includes('"expired"') || /"valid_to":"\d{4}-/.test(simple.text),
      `GET customer/{c}/site/{s}/powerofattorney redovisar inte utgången: ${simple.text.slice(0, 200)}`).toBe(true)
  })

  it('API01.03 leverantörsbyte (Z03) med utgången POA nekas; samma kedja med giltig POA godtas', async () => {
    // Appkod laddas dynamiskt (vitest löser '@' mot RUN_DIR); harnessens typkontroll följer inte in i appens typer.
    type Fixture = { companyId: string; actorUserId: string; switchId: string; routeId: string; powerOfAttorneyId: string }
    const fixtureModule = '@/scripts/helpers/ediel-normal-switch-native-fixture'
    const flowModule = '@/lib/ediel/flows/prodatSwitch'
    const { seedNormalSwitchNativeFixture } = await import(/* @vite-ignore */ fixtureModule) as { seedNormalSwitchNativeFixture: (i: { deferOriginal: true }) => Promise<Fixture> }
    const { prepareAndQueueEdielZ03 } = await import(/* @vite-ignore */ flowModule) as { prepareAndQueueEdielZ03: (i: Record<string, unknown>) => Promise<unknown> }
    const attempt = async (expire: boolean) => {
      const f = await seedNormalSwitchNativeFixture({ deferOriginal: true })
      if (expire) {
        psql(`update public.powers_of_attorney set valid_to = current_date - 1 where id='${f.powerOfAttorneyId}'`)
        const sw = await sweep()
        expect(sw.status).toBe(200)
      }
      const poa = psqlRows<{ status: string; valid_to: string }>(`select status, valid_to::text from public.powers_of_attorney where id='${f.powerOfAttorneyId}'`)[0]
      let outcome: { ok: boolean; error?: string; messageId?: string | null }
      try {
        const queued = await prepareAndQueueEdielZ03({ actorUserId: f.actorUserId, switchRequestId: f.switchId, communicationRouteId: f.routeId, environment: 'test' })
        outcome = { ok: true, messageId: (queued as { message?: { id?: string } } | null)?.message?.id ?? null }
      } catch (error) {
        outcome = { ok: false, error: (error as Error).message.slice(0, 200) }
      }
      const z03 = Number(psql(`select count(*) from public.ediel_messages where company_id='${f.companyId}'`))
      receipt('API01.03', expire ? 'Z03 expired POA' : 'Z03 valid POA (control)', { poa, outcome, edielMessages: z03 })
      return { outcome, z03 }
    }
    const control = await attempt(false)
    expect(control.outcome, 'kontroll: giltig POA ger Z03').toMatchObject({ ok: true })
    expect(control.z03).toBeGreaterThan(0)
    const expired = await attempt(true)
    expect(expired.outcome.ok, `Z03 skapades trots utgången POA: ${JSON.stringify(expired.outcome)}`).toBe(false)
    expect(expired.z03).toBe(0)
  }, 600_000)
})
