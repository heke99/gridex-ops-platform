// simulation: TERM01.01, TERM01.02, TERM01.03, TERM01.04, TERM01.05
// Bindningstid och slutdatum för kundavtal. Oraklet räknas här med en egen ren datumfunktion
// (inte appens lifecycle.ts/commitment.ts). Läsvägar: adminsidan /admin/customers/[id]?tab=contracts via HTTP
// med riktig admin-cookie-session, och DB-raden i customer_contracts.
// Ingen webbläsare (Playwright) används: ren HTTP + psql. Auth/JWT = real tid; affärsdatum = explicita parametrar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loginSession, psql, psqlRows, removeAdminFixtureUser, type AppSession } from '../lib'
import {
  createSignedContract, createTermTenant, psqlExpectError, rowHash, stockholmToday,
  type SignedContractFixture, type TermTenant, type CreateSignedContractInput,
} from '../lib/term-fixture'

// ---------- Oberoende orakel: ren kalenderaritmetik på YYYY-MM-DD (ingen Date, ingen app-kod) ----------
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysIn = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1])
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function parseIso(iso: string) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d } }
/** Start + n kalendermånader, dag klampas till målmånadens sista dag. Resultatet är det EXKLUSIVA bindningsslutet. */
export function oracleAddMonths(iso: string, months: number): string {
  const { y, m, d } = parseIso(iso)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`
}
/** Dagen före (sista bundna dag när slutet är exklusivt). */
export function oracleDayBefore(iso: string): string {
  const { y, m, d } = parseIso(iso)
  if (d > 1) return `${pad(y, 4)}-${pad(m)}-${pad(d - 1)}`
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y
  return `${pad(py, 4)}-${pad(pm)}-${pad(daysIn(py, pm))}`
}
/** Dagar sedan 0000-03-01 (proleptisk gregoriansk, Hinnants civil-algoritm); för dagsdifferenser. */
function ordinal(iso: string): number {
  let { y, m, d } = parseIso(iso)
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400); const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
}
const dayDiff = (a: string, b: string) => ordinal(a) - ordinal(b)

// ---------- Läsning av adminsidan ----------
const MONTHS = (() => {
  const map = new Map<string, number>()
  for (let i = 0; i < 12; i += 1) {
    for (const style of ['short', 'long'] as const) {
      const name = new Intl.DateTimeFormat('sv-SE', { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 15)))
      map.set(name.replace(/\.$/, '').toLowerCase(), i + 1)
    }
  }
  return map
})()
const DATE_TOKEN = String.raw`(?:—|\d{1,2}\s+[^\s\d]+\s+\d{4}(?:\s+\d{2}:\d{2})?)`

function pageText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/[   ]/g, ' ')
}
function svDateToIso(token: string | undefined): string | null {
  if (!token || token.trim() === '—') return null
  const m = /(\d{1,2})\s+([^\s\d]+?)\.?\s+(\d{4})/.exec(token)
  if (!m) throw new Error(`oläsbart datum på sidan: ${token}`)
  const month = MONTHS.get(m[2].replace(/\.$/, '').toLowerCase())
  if (!month) throw new Error(`okänd månad på sidan: ${m[2]}`)
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`
}
function grab(text: string, re: RegExp, what: string): string {
  const m = re.exec(text)
  if (!m) throw new Error(`fält saknas på adminsidan: ${what}`)
  return m[1]
}

type ShownContract = {
  summaryStart: string | null; summarySlut: string | null
  detailStart: string | null; explicitSlut: string | null; aktuelltSlutdatum: string | null; nextRenewal: string | null
  currentTermEnd: string | null; bindingMonthsText: string; bindingActive: 'Ja' | 'Nej'; autoRenewText: string
}

async function readShown(session: AppSession, customerId: string): Promise<ShownContract> {
  const res = await session.fetch(`/admin/customers/${customerId}?tab=contracts`)
  const html = await res.text()
  expect(res.status, `admin-sidan svarade ${res.status}: ${html.slice(0, 200)}`).toBe(200)
  const t = pageText(html)
  const summary = new RegExp(String.raw`Start\s+(${DATE_TOKEN})\s*·\s*Slut\s+(${DATE_TOKEN})`).exec(t)
  if (!summary) throw new Error('fält saknas på adminsidan: "Start … · Slut …" (är kundens avtalsflik renderad?)')
  const term = new RegExp(String.raw`Nuvarande avtalsperiod\s+(${DATE_TOKEN})\s*→\s*(${DATE_TOKEN})`).exec(t)
  return {
    summaryStart: svDateToIso(summary[1]), summarySlut: svDateToIso(summary[2]),
    detailStart: svDateToIso(grab(t, new RegExp(String.raw`Start:\s*(${DATE_TOKEN})`), 'Start:')),
    explicitSlut: svDateToIso(grab(t, new RegExp(String.raw`Explicit slut:\s*(${DATE_TOKEN})`), 'Explicit slut')),
    aktuelltSlutdatum: svDateToIso(grab(t, new RegExp(String.raw`Aktuellt slutdatum:\s*(${DATE_TOKEN})`), 'Aktuellt slutdatum')),
    nextRenewal: svDateToIso(grab(t, new RegExp(String.raw`Nästa förlängning:\s*(${DATE_TOKEN})`), 'Nästa förlängning')),
    currentTermEnd: term ? svDateToIso(term[2]) : null,
    bindingMonthsText: grab(t, /Bindningstid:\s*(\S+)\s*mån/, 'Bindningstid').trim(),
    bindingActive: grab(t, /Bindning aktiv nu\s+(Ja|Nej)/, 'Bindning aktiv nu') as 'Ja' | 'Nej',
    autoRenewText: grab(t, /Auto renew:\s*(Ja|Nej)/, 'Auto renew'),
  }
}

type DbContract = {
  id: string; status: string; binding_months: number | null; notice_months: number | null
  starts_at: string | null; ends_at: string | null; signed_at: string | null; monthly_fee_sek: number | null
  contract_price_snapshot_id: string | null; auto_renew_enabled: boolean
}
function readDb(contractId: string): DbContract {
  const rows = psqlRows<DbContract>(`select id,status,binding_months,notice_months,starts_at,ends_at,signed_at,monthly_fee_sek,contract_price_snapshot_id,auto_renew_enabled from public.customer_contracts where id='${contractId}'`)
  expect(rows).toHaveLength(1)
  return rows[0]
}

// ---------- Gemensam uppsättning ----------
let tenant: TermTenant
let session: AppSession
const observations: Record<string, unknown>[] = []

async function signed(input: Partial<CreateSignedContractInput> & Pick<CreateSignedContractInput, 'bindingMonths' | 'startsAt'>): Promise<SignedContractFixture> {
  return createSignedContract(tenant, { contractType: 'variable_hourly', noticeMonths: 1, priceArea: 'SE3', ...input })
}

/** Binding > 0: DB-rad, sidans visning och bindningsstatus mot oraklet; registrerar vilken konvention appen visar. */
async function assertBindingEnd(scenario: string, f: SignedContractFixture, bindingMonths: number, startsAt: string, expectedExclusive: string) {
  const db = readDb(f.contractId)
  expect(db).toMatchObject({ status: 'signed', binding_months: bindingMonths, notice_months: 1, starts_at: startsAt })
  expect(db.signed_at, 'signed_at ska vara satt').toBeTruthy()
  const lastBoundDay = oracleDayBefore(expectedExclusive)
  const convStored = db.ends_at === null ? 'derived_on_read' : db.ends_at === expectedExclusive ? 'exclusive' : db.ends_at === lastBoundDay ? 'inclusive' : 'other'
  expect(['derived_on_read', 'exclusive', 'inclusive'], `ends_at i DB (${db.ends_at}) avviker från båda konventionerna (${expectedExclusive} / ${lastBoundDay})`).toContain(convStored)

  const shown = await readShown(session, f.customerId)
  // Tidszonskontroll: appen formaterar med serverns lokala tid. Visad start mot DB-start avslöjar dagsförskjutning.
  const tzShift = dayDiff(shown.detailStart!, startsAt)
  expect(Math.abs(tzShift), `visad start ${shown.detailStart} vs DB ${startsAt}`).toBeLessThanOrEqual(1)
  const fix = (iso: string | null) => (iso === null ? null : shiftDays(iso, -tzShift))
  const slut = fix(shown.summarySlut)
  const current = fix(shown.aktuelltSlutdatum)
  expect(slut, 'Slut (sammanfattning) och Aktuellt slutdatum ska visa samma dag').toBe(current)
  expect(fix(shown.currentTermEnd), 'Nuvarande avtalsperiod slut ska stämma med Aktuellt slutdatum').toBe(current)
  const convention = current === expectedExclusive ? 'exclusive' : current === lastBoundDay ? 'inclusive' : 'other'
  observations.push({ scenario, startsAt, bindingMonths, expectedExclusive, lastBoundDay, shownSlut: shown.summarySlut, shownAktuellt: shown.aktuelltSlutdatum, tzShift, convention, dbEndsAt: db.ends_at, storedConvention: convStored })
  console.info(`[${scenario}] app visar ${current} (${convention}); exklusivt orakel ${expectedExclusive}, sista bundna dag ${lastBoundDay}, tzShift ${tzShift}, DB ends_at ${db.ends_at}`)
  expect(['exclusive', 'inclusive'], `appen visar ${current}: varken ${expectedExclusive} (exklusivt) eller ${lastBoundDay} (sista bundna dag)`).toContain(convention)
  expect(shown.bindingMonthsText).toBe(String(bindingMonths))
  const today = stockholmToday()
  expect(shown.bindingActive, `bindning aktiv nu mot exklusivt slut ${expectedExclusive} och idag ${today}`).toBe(today < expectedExclusive ? 'Ja' : 'Nej')
  return { convention, shown }
}
function shiftDays(iso: string, delta: number): string {
  // Egen kalenderstegning (±1 dag räcker för tidszonskorrigering).
  let cur = iso
  for (let i = 0; i < Math.abs(delta); i += 1) {
    if (delta < 0) cur = oracleDayBefore(cur)
    else {
      const { y, m, d } = parseIso(cur)
      cur = d < daysIn(y, m) ? `${pad(y, 4)}-${pad(m)}-${pad(d + 1)}` : m === 12 ? `${pad(y + 1, 4)}-01-01` : `${pad(y, 4)}-${pad(m + 1)}-01`
    }
  }
  return cur
}

describe('TERM01 bindningstid och slutdatum', () => {
  beforeAll(async () => {
    tenant = await createTermTenant()
    session = await loginSession(tenant.admin.email, tenant.admin.password, { companyId: tenant.companyId })
  }, 120_000)
  afterAll(async () => {
    console.info(`TERM01 observationer: ${JSON.stringify(observations)}`)
    if (tenant) await removeAdminFixtureUser(tenant.admin)
  })

  it('TERM01.01 tillsvidare utan bindningsslut (binding_months 0 och null)', async () => {
    for (const bindingMonths of [0, null] as const) {
      const f = await signed({ bindingMonths, startsAt: '2026-11-01' })
      const db = readDb(f.contractId)
      expect(db).toMatchObject({ status: 'signed', binding_months: bindingMonths, starts_at: '2026-11-01', ends_at: null, auto_renew_enabled: false })
      expect(db.signed_at).toBeTruthy()
      const shown = await readShown(session, f.customerId)
      expect(shown.summarySlut, `Slut visas för binding ${bindingMonths}`).toBeNull()
      expect(shown.aktuelltSlutdatum, `Aktuellt slutdatum för binding ${bindingMonths}`).toBeNull()
      expect(shown.explicitSlut).toBeNull()
      expect(shown.currentTermEnd).toBeNull()
      expect(shown.nextRenewal, 'ingen förnyelse').toBeNull()
      expect(shown.autoRenewText).toBe('Nej')
      expect(shown.bindingActive).toBe('Nej')
      expect(shown.bindingMonthsText).toBe(bindingMonths === null ? '—' : '0')
    }
  })

  it('TERM01.02 12 månader från 2026-11-01 upphör vid 2027-11-01 (exklusivt)', async () => {
    const f = await signed({ bindingMonths: 12, startsAt: '2026-11-01' })
    expect(oracleAddMonths('2026-11-01', 12)).toBe('2027-11-01')
    expect(oracleDayBefore('2027-11-01')).toBe('2027-10-31')
    await assertBindingEnd('TERM01.02', f, 12, '2026-11-01', '2027-11-01')
  })

  it('TERM01.03 24 månader från 2026-11-15 upphör vid 2028-11-15 (exklusivt)', async () => {
    const f = await signed({ bindingMonths: 24, startsAt: '2026-11-15' })
    expect(oracleAddMonths('2026-11-15', 24)).toBe('2028-11-15')
    await assertBindingEnd('TERM01.03', f, 24, '2026-11-15', '2028-11-15')
  })

  const clampCases: { name: string; start: string; months: number; expected: string }[] = [
    { name: 'TERM01.04 skottdag 2028-02-29 + 12 -> 2029-02-28', start: '2028-02-29', months: 12, expected: '2029-02-28' },
    { name: 'TERM01.04 skottdag 2028-02-29 + 24 -> 2030-02-28', start: '2028-02-29', months: 24, expected: '2030-02-28' },
    { name: 'TERM01.04 månadsslut 2027-01-31 + 12 -> 2028-01-31', start: '2027-01-31', months: 12, expected: '2028-01-31' },
  ]
  for (const c of clampCases) {
    it(c.name, async () => {
      expect(oracleAddMonths(c.start, c.months)).toBe(c.expected)
      const f = await signed({ bindingMonths: c.months, startsAt: c.start })
      await assertBindingEnd('TERM01.04', f, c.months, c.start, c.expected)
    })
  }

  it('TERM01.04 binding_months=1: 2027-01-31 + 1 -> 2027-02-28 (om 1 accepteras)', async (ctx) => {
    expect(oracleAddMonths('2027-01-31', 1)).toBe('2027-02-28')
    let f: SignedContractFixture
    try {
      f = await signed({ bindingMonths: 1, startsAt: '2027-01-31' })
    } catch (error) {
      const message = String((error as Error).message)
      if (/binding_months|check constraint|23514/i.test(message)) { console.info(`[TERM01.04] binding_months=1 nekas av fixturen/DB: ${message.slice(0, 200)}`); ctx.skip(); return }
      throw error
    }
    await assertBindingEnd('TERM01.04', f, 1, '2027-01-31', '2027-02-28')
  })

  describe('TERM01.05 signerat avtal är oföränderligt', () => {
    let f: SignedContractFixture
    const fixture = async () => (f ??= await signed({ bindingMonths: 12, startsAt: '2026-11-01', monthlyFeeSek: 59 }))

    it('TERM01.05 UPDATE av monthly_fee_sek / binding_months / ends_at / contract_price_snapshot_id nekas med 55000', async () => {
      const c = await fixture()
      // Avtalspris/månadsavgift: raden (59) och snapshotens värde ska stämma före försöken.
      expect(Number(c.sources.contractRow.monthly_fee_sek)).toBe(59)
      expect(c.sources.snapshotMonthlyFeeSek, 'snapshot_json.monthly_fee_sek').toBe(59)
      const before = rowHash('customer_contracts', c.contractId)
      const updates: Record<string, string> = {
        monthly_fee_sek: 'monthly_fee_sek = coalesce(monthly_fee_sek,0) + 1',
        binding_months: 'binding_months = coalesce(binding_months,0) + 1',
        ends_at: `ends_at = date '2099-12-31'`,
        contract_price_snapshot_id: 'contract_price_snapshot_id = NULL',
      }
      for (const [column, set] of Object.entries(updates)) {
        const err = psqlExpectError(`UPDATE public.customer_contracts SET ${set} WHERE id='${c.contractId}';`)
        expect(err, `UPDATE ${column} på signerat avtal lyckades (borde nekas)`).not.toBeNull()
        expect(err!.sqlstate, err!.raw).toBe('55000')
        expect(err!.message).toBe(`signed_customer_contract_immutable:${column}`)
      }
      expect(rowHash('customer_contracts', c.contractId), 'avtalsraden ska vara oförändrad').toBe(before)
    })

    it('TERM01.05 contract_price_snapshots UPDATE/DELETE nekas och snapshotraden är oförändrad', async () => {
      const c = await fixture()
      const before = rowHash('contract_price_snapshots', c.priceSnapshotId)
      const upd = psqlExpectError(`UPDATE public.contract_price_snapshots SET public_price_text='tamper' WHERE id='${c.priceSnapshotId}';`)
      expect(upd, 'UPDATE på snapshot lyckades').not.toBeNull()
      expect(upd!.message, upd!.raw).toMatch(/immutable/i)
      const del = psqlExpectError(`DELETE FROM public.contract_price_snapshots WHERE id='${c.priceSnapshotId}';`)
      expect(del, 'DELETE på snapshot lyckades').not.toBeNull()
      expect(del!.message, del!.raw).toMatch(/immutable/i)
      console.info(`[TERM01.05] snapshot UPDATE -> ${upd!.sqlstate}, DELETE -> ${del!.sqlstate}`)
      expect(rowHash('contract_price_snapshots', c.priceSnapshotId)).toBe(before)
      expect(psql(`select count(*) from public.contract_price_snapshots where id='${c.priceSnapshotId}'`)).toBe('1')
    })

    it('TERM01.05 ändringsflöde finns', () => {
      // rg i RUN_DIR (lib/app/components/supabase/migrations) gav inget flöde för att ändra villkor på ett signerat
      // KUNDavtal; "ny avtalsversion" i UI-texterna gäller erbjudandemallen (contract_offer_versions). Här en DB-probe.
      const found = psqlRows<{ kind: string; name: string }>(`
        select 'function' kind, proname::text as name from pg_proc where pronamespace='public'::regnamespace
          and proname ~* 'customer_contract' and proname ~* '(amend|supersede|renegotiat|change_terms|new_version)'
        union all
        select 'table', relname::text from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')
          and relname ~* 'customer_contract' and relname ~* '(amend|supersede|renegotiat|version)'`)
      if (found.length === 0) throw new Error('steg saknas: inget ändringsflöde')
      console.info(`[TERM01.05] möjliga ändringsobjekt: ${JSON.stringify(found)}`)
    })
  })

  it('TERM01.OBS trg_gridex_customer_contracts_auto_renew_guard och gridex_add_months_timestamptz (observation, ej orakel)', () => {
    const trigger = psqlRows(`select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgname='trg_gridex_customer_contracts_auto_renew_guard' and not tgisinternal`)
    const addMonths = psqlRows(`select oid::regprocedure::text as sig from pg_proc where proname='gridex_add_months_timestamptz'`)
    const guardFn = psqlRows(`select oid::regprocedure::text as sig from pg_proc where proname='gridex_customer_contracts_auto_renew_guard'`)
    const guardUsers = psqlRows(`select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgfoid in (select oid from pg_proc where proname='gridex_customer_contracts_auto_renew_guard') and not tgisinternal`)
    console.info(`[TERM01.OBS] ${JSON.stringify({ trigger_trg_gridex_customer_contracts_auto_renew_guard: trigger, function_gridex_add_months_timestamptz: addMonths, function_auto_renew_guard: guardFn, triggers_using_guard_function: guardUsers })}`)
    expect(true).toBe(true)
  })
})
