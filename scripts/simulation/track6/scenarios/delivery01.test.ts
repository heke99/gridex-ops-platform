// sim: DELIVERY01.01-.05
// DELIVERY01 (spår 6): fakturaleverans i Nordfin-filen. Playwright används inte (appens HTTP-ingångar och serveråtgärder postas som no-JS-formulär).
// Kedja per kund: offert -> publicering -> avtal -> signering -> Z03 -> Z04 L -> aktivering -> spot -> fyra UTILTS E66 (28-31 oktober) med 24 timvärden vardera ->
// generate-underlay -> prepare -> godkänn -> fakturafil (nordfin) -> XML. Allt i testmiljön (environment test), appmiljö
// GRIDEX_INVOICE_DELIVERY_RESOLVER läses ur privata SIM_HOME/env/track6.json; förväntat värde `shared` (produktionsinställningen).
// Ursprung för kopierad kod: se lib/chain/*.ts (spår 1 ba065053/3ea5cd2b, spår 4 766f4963).
// ERSÄTTNINGSSTEG (raw SQL / in-process) står i stegnamn och i observationen "ERSÄTTNINGSSTEG: … verifierar inte …".
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { afterAll, describe, expect, it, vi, type TestContext } from 'vitest'
import { Evidence } from '../lib/evidence'
import { B1, B2, CUSTOMER_SPECS, NEW_C1_INVOICE_EMAIL, S1, buildCustomerChain, importAndLockSpot, type CustomerChain, type CustomerSpec } from '../lib/chain/customerChain'
import {
  changeBillingProfileAfterApproval, downloadInvoiceFile, enableNordfinProvider, exportItemsFor, filesFor, generateUnderlay, parseNordfinXml, prepareInvoices,
  readinessSurfaces, revisionsFor, runBillingAction, runItemsFor, underlaysFor, type FlowLog,
} from '../lib/chain/billingFlow'
import { appUrl, sha256Hex, TIMINGS } from '../lib/chain/runtime'
import { SUBSTITUTIONS, substitutionObservation } from '../lib/chain/substitutions'
import { DELIVERY01_BILLING_MONTH, DELIVERY01_E66_DAYS, DELIVERY01_START_DATE } from '../lib/chain/synthetic'

// The native seed signs the contract inside seedNormalSwitchNativeFixture. This wrapper lets the chain choose the contract's
// invoice_delivery_method on the DRAFT contract just before signing (see installDeliveryMethodHook). Behaviour is otherwise unchanged.
vi.mock('@/lib/ediel/testing/invoiceTestContractLifecycle', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ediel/testing/invoiceTestContractLifecycle')>()
  return {
    ...actual,
    signInvoiceTestContractCanonically: async (input: Parameters<typeof actual.signInvoiceTestContractCanonically>[0]) => {
      await globalThis.__t6BeforeSign?.(input)
      return actual.signInvoiceTestContractCanonically(input)
    },
  }
})

type Key = CustomerSpec['key']
const KEYS: Key[] = ['C1', 'C2', 'C3', 'C4']
const BILLED: Key[] = ['C1', 'C2', 'C3']
const SALT = 1
const evidence = new Evidence()
const hour = 3_600_000
const LONG = 2 * hour

const S = {
  ok: new Set<string>(),
  chains: {} as Partial<Record<Key, CustomerChain>>,
  providerLog: {} as Partial<Record<Key, FlowLog[]>>,
  runItemsAtApproval: {} as Partial<Record<Key, Array<Record<string, unknown>>>>,
  fileId: {} as Partial<Record<Key, string>>,
  xml: {} as Partial<Record<Key, string>>,
  revisionsBeforeChange: 0,
  changeApplied: false,
}

/** Skip (not fail) a step whose dependency did not complete; the reason is written to the report observations. */
function needs(ctx: TestContext, ...deps: string[]): void {
  const missing = deps.filter(dep => !S.ok.has(dep))
  if (missing.length === 0) return
  const reason = `skipped: förutsättning saknas (${missing.join(', ')}) — se föregående setup-steg`
  evidence.observe(`skip:${ctx.task.name}`, reason)
  ctx.skip(reason)
}

function appEnvFileValue(name: string): string | null {
  const file = `${process.env.T6_SIM_HOME ?? ''}/env/track6.json`
  if (!process.env.T6_SIM_HOME || !existsSync(file)) return null
  const values = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  return typeof values[name] === 'string' ? values[name] : null
}

/** Reads the app log (last 600 kB) for the block `[ctx] failed { traceId: '<id>', code: '<db/pg code>', error: '<message>' }` of a 5xx trace_id. Never written raw to evidence. */
function appLogErrorForTrace(traceId: string | null): { traceId: string; code: string | null; error: string | null } | null {
  const file = `${process.env.T6_SIM_HOME ?? ''}/logs/app.log`
  if (!traceId || !process.env.T6_SIM_HOME || !existsSync(file)) return null
  const size = statSync(file).size, length = Math.min(size, 600_000), fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length); readSync(fd, buffer, 0, length, size - length)
    const text = buffer.toString('utf8'), at = text.lastIndexOf(traceId)
    if (at < 0) return null
    const block = text.slice(at, at + 600)
    return { traceId, code: /code:\s*'([^']*)'/.exec(block)?.[1] ?? null, error: /error:\s*'([^']*)'/.exec(block)?.[1] ?? null }
  } finally { closeSync(fd) }
}

const rowFor = (rows: Array<Record<string, unknown>>) => rows[0] as Record<string, unknown> | undefined

describe('Track6 DELIVERY01: fakturaleverans (e-post/post/adress) i Nordfin-filen', () => {
  afterAll(() => {
    evidence.observe('ERSÄTTNINGSSTEG', SUBSTITUTIONS.map(substitutionObservation))
    evidence.observe('stegtider_ms', TIMINGS)
    evidence.observe('scope', { billingMonth: DELIVERY01_BILLING_MONTH, supplyStart: DELIVERY01_START_DATE, e66Days: DELIVERY01_E66_DAYS, hourlyValuesPerCustomer: 96, messagesPerCustomer: 4, note31: 'dag 31 ligger i framtiden relativt stackens klocka', environment: 'test', provider: 'nordfin',
      note: 'Ett eget syntetiskt bolag per kund (nativa seeden skapar bolag + Ediel-ID); T6SIM 16760 används inte av kedjan.' })
    evidence.finalize()
  })

  it('DELIVERY01 setup: harness-förutsättningar (appmiljö GRIDEX_INVOICE_DELIVERY_RESOLVER, app, datum)', async () => {
    const fromFile = appEnvFileValue('GRIDEX_INVOICE_DELIVERY_RESOLVER')
    evidence.observe('app_env_GRIDEX_INVOICE_DELIVERY_RESOLVER', { envFile: fromFile ?? '(inte satt)', testProcess: process.env.GRIDEX_INVOICE_DELIVERY_RESOLVER ?? '(inte satt)' })
    evidence.observe('klocka', { now: new Date().toISOString(), start: DELIVERY01_START_DATE, month: DELIVERY01_BILLING_MONTH })
    const health = await fetch(`${appUrl()}/api/internal/system/health`, { redirect: 'manual' })
    evidence.observe('app_health_status', health.status)
    expect([401, 503]).toContain(health.status)
    // The coordinator's private JSON must declare GRIDEX_INVOICE_DELIVERY_RESOLVER=shared. With `legacy` the invoice-review snapshot ignores the
    // customer billing profile (lib/billing/effectiveInvoiceDelivery.ts:157-185), so DELIVERY01 would not test the production configuration.
    if (fromFile?.trim().toLowerCase() !== 'shared' && process.env.T6_DELIVERY_ALLOW_LEGACY !== '1') {
      throw new Error('HARNESSFEL: GRIDEX_INVOICE_DELIVERY_RESOLVER är inte `shared` i appens privata env (SIM_HOME/env/track6.json). Samordnarens JSON ska ange GRIDEX_INVOICE_DELIVERY_RESOLVER=shared. (T6_DELIVERY_ALLOW_LEGACY=1 kör ändå, men resultatet gäller då inte produktionsinställningen.)')
    }
    S.ok.add('precondition')
  })

  for (const key of KEYS) {
    const spec = CUSTOMER_SPECS[key]
    it(`DELIVERY01 setup ${key} (${spec.label}): bolag, avtal ${spec.deliveryMethod}, Z03/Z04, aktivering, kundprofil och 4 E66 (dygn 28-31, 24 timvärden vardera) (ERSÄTTNINGSSTEG: nativ seed, syntetisk Z04, direktinmatad UTILTS, kundprofil via psql)`, async ctx => {
      needs(ctx, 'precondition')
      const chain = await buildCustomerChain(spec, SALT)
      S.chains[key] = chain
      evidence.save(`chain/${key}.json`, { ...chain, session: { userId: chain.session.userId, companyId: chain.session.companyId } })
      evidence.observe(`${key}_chain`, { companyId: chain.companyId, customerId: chain.customerId, timingsMs: chain.timingsMs, effective: chain.effective, gate: chain.gate, e66: { values: chain.e66.values, persistMs: chain.e66.persistMs, ingestMs: chain.e66.ingestMs, perMessage: chain.e66.messages.map(m => ({ day: m.day, totalMs: m.totalMs, persistMs: m.persistMs, ingestMs: m.ingestMs, rawSha256: m.rawSha256, receivedAt: m.receivedAt, receivedAtClamped: m.receivedAtClamped, documentDate: m.documentDate, documentDateClamped: m.documentDateClamped, runtime: m.runtime })) } })
      // Fixture premises for the oracles below (not product claims): a separate billing address only matters when the contract does not say "same as site".
      expect(chain.effective.contractBillingAddressSameAsSite, 'contract.billing_address_same_as_site must be false').toBe(false)
      expect(chain.e66.values).toBe(96)
      // Gate precondition (visible in the report): every E66 interval starts at or after market_start_at.
      if (chain.gate.marketStartAt && chain.gate.firstIntervalStart) expect(Date.parse(chain.gate.firstIntervalStart)).toBeGreaterThanOrEqual(Date.parse(chain.gate.marketStartAt))
      S.ok.add(`chain:${key}`)
    }, LONG)
  }

  it('DELIVERY01 setup: spotpriser SE3 2026-09 (importer + lock-month över HTTP; ERSÄTTNINGSSTEG: syntetisk spotkälla)', async ctx => {
    needs(ctx, 'chain:C1')
    const result = await importAndLockSpot(S.chains.C1!.session, 'SE3', SALT)
    evidence.observe('spot', result)
    S.ok.add('spot')
  }, LONG)

  for (const key of KEYS) {
    it(`DELIVERY01 setup ${key}: fakturaleverantör nordfin/test, ClientId och utskick (UI-åtgärder; ERSÄTTNINGSSTEG endast om en åtgärd avvisas)`, async ctx => {
      needs(ctx, `chain:${key}`)
      const chain = S.chains[key]!
      const result = await enableNordfinProvider(chain.session, chain.companyId, `T6${key}CLIENT`)
      S.providerLog[key] = result.log
      evidence.observe(`${key}_provider`, result)
      expect(result.final).toMatchObject({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test', invoice_export_enabled: true })
      expect(result.clientId).toBe(`T6${key}CLIENT`)
      S.ok.add(`provider:${key}`)
    }, LONG)
  }

  for (const key of KEYS) {
    it(`DELIVERY01 setup ${key}: generate-underlay (N=96 timvärden i 4 meddelanden, leverans från 2026-10-28, vintertid)`, async ctx => {
      needs(ctx, `chain:${key}`, 'spot')
      const chain = S.chains[key]!
      const res = await generateUnderlay(chain.session)
      const traceId = (res.body as { trace_id?: string } | null)?.trace_id ?? null
      const logged = res.status >= 500 ? appLogErrorForTrace(traceId) : null
      const timeout57014 = logged?.code === '57014'
      evidence.observe(`${key}_generate_underlay`, { status: res.status, ms: res.ms, valuesInMonth: 96, body: res.body ?? res.text.slice(0, 300), appLog: logged })
      if (res.status >= 500) {
        evidence.observe('BLOCKED_BY', timeout57014 ? 'claude-track1/010 (57014 statement timeout i generate-underlay)' : `generate-underlay HTTP ${res.status}: app-logg ${JSON.stringify(logged)}`)
        throw new Error(`${timeout57014 ? 'BLOCKED_BY claude-track1/010' : 'generate-underlay misslyckades'}: HTTP ${res.status} efter ${res.ms} ms med 96 värden; trace ${traceId}; db-kod ${logged?.code ?? '?'} ${logged?.error ?? ''}`)
      }
      expect(res.status).toBe(200)
      const underlays = underlaysFor(chain.companyId)
      evidence.save(`underlays/${key}.json`, underlays)
      expect(underlays.length, 'billing_underlays for the company').toBeGreaterThanOrEqual(1)
      S.ok.add(`underlay:${key}`)
    }, LONG)
  }

  for (const key of KEYS) {
    it(`DELIVERY01 setup ${key}: prepare (POST /api/internal/invoice-exports/create)`, async ctx => {
      needs(ctx, `provider:${key}`, `underlay:${key}`)
      const chain = S.chains[key]!
      const res = await prepareInvoices(chain.session, chain.companyId)
      evidence.save(`prepare/${key}.json`, { status: res.status, ms: res.ms, body: res.body })
      evidence.observe(`${key}_prepare`, { status: res.status, ms: res.ms, body: res.body })
      expect(res.status, JSON.stringify(res.body)?.slice(0, 300)).toBe(200)
      S.ok.add(`prepare:${key}`)
    }, LONG)
  }

  it('DELIVERY01.04 C4 (ingen faktura-e-post, ingen faktureringsadress, billing_address_same_as_site false): blockerad av beredskapen — kod invoice_distribution_missing/invoice_recipient_missing via normal yta, ingen faktura förbereds', async ctx => {
    needs(ctx, 'prepare:C4')
    const chain = S.chains.C4!
    const codes = ['invoice_distribution_missing', 'invoice_recipient_missing']
    const underlays = underlaysFor(chain.companyId)
    const underlay = rowFor(underlays)
    const items = exportItemsFor(chain.companyId)
    const surfaces = await readinessSurfaces(chain.session, chain.companyId, codes)
    evidence.save('delivery01.04/C4-underlay.json', underlays)
    evidence.observe('C4_readiness', { underlay: underlay && { status: underlay.status, readiness_status: underlay.readiness_status, invoice_readiness_status: underlay.invoice_readiness_status, billing_block_reason: underlay.billing_block_reason },
      itemsPrepared: items.length, surfaces,
      codeSurface: 'Kodens enda producent är evaluateBillingMonthInvoiceReadiness (lib/billing/invoiceReadiness.ts:299), vars enda anropare är createInvoiceExportRun (lib/integrations/billing/invoiceExportCore.ts:53, Capway); ingen route anropar den och nordfin-flödet prepare -> godkänn -> fil gör det inte. Ytorna ovan är därför det närmaste som kan observeras.' })
    expect(underlay, 'C4 has a billing underlay').toBeTruthy()
    // Closest normal observable: C4 must not be prepared for review/approval.
    expect(items, 'C4 must not be prepared as an invoice (invoice_export_items)').toEqual([])
    expect(underlay!.status === 'validated' && underlay!.readiness_status === 'ready', `C4 underlay must be blocked, was ${String(underlay!.status)}/${String(underlay!.readiness_status)}`).toBe(false)
    const found = [...surfaces.page.codesFound, ...surfaces.underlayRowCodes]
    expect(found.length, `blocker code (${codes.join(' | ')}) visible on /admin/billing or the underlay row; found: ${JSON.stringify(found)}`).toBeGreaterThan(0)
  }, LONG)

  for (const key of BILLED) {
    it(`DELIVERY01 setup ${key}: godkänn (approveAndSendReadyInvoicesAction) och spara frysta mottagaruppgifter per post`, async ctx => {
      needs(ctx, `prepare:${key}`)
      const chain = S.chains[key]!
      const result = await runBillingAction(chain.session, 'approve')
      const items = exportItemsFor(chain.companyId)
      const runItems = runItemsFor(chain.companyId)
      S.runItemsAtApproval[key] = runItems
      evidence.save(`approval/${key}-action.json`, result)
      evidence.save(`approval/${key}-export-items.json`, items)
      evidence.save(`approval/${key}-run-items-at-approval.json`, runItems)
      evidence.observe(`${key}_approval`, { action: { status: result.status, location: result.location }, items: items.map(i => ({ status: i.status, approval: (i.approval as { status?: string } | null)?.status })),
        snapshot: runItems.map(r => ({ invoice_email: r.invoice_email, invoice_recipient: r.invoice_recipient, invoice_address_snapshot: r.invoice_address_snapshot })) })
      expect(items.length).toBe(1)
      expect((items[0].approval as { status?: string } | null)?.status).toBe('approved')
      S.ok.add(`approved:${key}`)
    }, LONG)
  }

  it('DELIVERY01.05 C1: faktureringsprofilen ändras EFTER godkännandet (e-post -> faktura-c1-ny, adress -> B2) och customer_billing_profile_revisions loggar ändringen (ERSÄTTNINGSSTEG billing-profile-change: psql, ingen normal ingång finns för adressen)', async ctx => {
    needs(ctx, 'approved:C1')
    const chain = S.chains.C1!
    const before = revisionsFor(chain.companyId, chain.customerId)
    S.revisionsBeforeChange = before.length
    changeBillingProfileAfterApproval(chain.customerId, chain.companyId, { invoiceEmail: NEW_C1_INVOICE_EMAIL, street: B2.street, postalCode: B2.postalCode, city: B2.city })
    S.changeApplied = true
    S.ok.add('profile-changed')
    const after = revisionsFor(chain.companyId, chain.customerId)
    evidence.save('delivery01.05/C1-revisions-before.json', before)
    evidence.save('delivery01.05/C1-revisions-after.json', after)
    expect(after.length, 'one new revision row').toBe(before.length + 1)
    const last = after[after.length - 1]
    expect(last).toMatchObject({ invoice_email: NEW_C1_INVOICE_EMAIL, billing_street: B2.street, billing_postal_code: B2.postalCode, billing_city: B2.city })
    expect(last.changed_fields as string[]).toEqual(expect.arrayContaining(['invoice_email', 'billing_street', 'billing_postal_code', 'billing_city']))
    // The history still holds the value that was current at approval (B1 and the old email): the log is append-only.
    expect(before[before.length - 1]).toMatchObject({ invoice_email: CUSTOMER_SPECS.C1.invoiceEmail, billing_street: B1.street })
  })

  for (const key of BILLED) {
    it(`DELIVERY01 setup ${key}: skapa fakturafil nordfin (createInvoiceFileAction${key === 'C1' ? ', efter profiländringen' : ''}) och hämta XML (GET /admin/billing/invoice-files/<id>)`, async ctx => {
      needs(ctx, `approved:${key}`)
      if (key === 'C1') needs(ctx, 'profile-changed')
      const chain = S.chains[key]!
      const created = await runBillingAction(chain.session, 'createFile')
      evidence.save(`file/${key}-create-action.json`, created)
      expect(created.fileError, `file_error=${created.fileError}`).toBeNull()
      expect(created.fileId, `redirect ${created.location}`).toBeTruthy()
      S.fileId[key] = created.fileId!
      const downloaded = await downloadInvoiceFile(chain.session, created.fileId!)
      expect(downloaded.status).toBe(200)
      const xml = downloaded.bytes
      const path = evidence.save(`xml/${key}.xml`, xml)
      S.xml[key] = downloaded.text
      const files = filesFor(chain.companyId)
      evidence.save(`file/${key}-invoice_export_files.json`, files)
      evidence.observe(`${key}_nordfin_xml`, { fileId: created.fileId, bytes: xml.length, sha256: sha256Hex(xml), contentType: downloaded.contentType, path, rowsSha256: files[0]?.rows_sha256, provider: files[0]?.provider })
      expect(files.length).toBe(1)
      expect(files[0].provider).toBe('nordfin')
      S.ok.add(`xml:${key}`)
    }, LONG)
  }

  it('DELIVERY01.01 C1: XML <CustomerEmail> är faktura-c1@t6.sim.invalid (frusen, == snapshot vid godkännande), inte kontaktadressen och inte den nya adressen', ctx => {
    needs(ctx, 'xml:C1', 'approved:C1')
    expect(S.changeApplied, 'profile must have been changed before the file was created (DELIVERY01.05 step)').toBe(true)
    const invoices = parseNordfinXml(S.xml.C1!)
    expect(invoices.length).toBe(1)
    const snapshot = S.runItemsAtApproval.C1![0].invoice_email
    evidence.observe('DELIVERY01.01', { xmlCustomerEmail: invoices[0].email, snapshotAtApproval: snapshot })
    expect(invoices[0].email).toBe('faktura-c1@t6.sim.invalid')
    expect(invoices[0].email).toBe(snapshot)
    expect(invoices[0].email).not.toBe(CUSTOMER_SPECS.C1.contactEmail)
    expect(invoices[0].email).not.toBe(NEW_C1_INVOICE_EMAIL)
  })

  it('DELIVERY01.02 C1: XML Customeradress/ZipCode/City == faktureringsadress B1 och Facility FacilityAddress/FacilityZipCode/FacilityCity == anläggningsadress S1 (skilda adresser)', ctx => {
    needs(ctx, 'xml:C1')
    const [inv] = parseNordfinXml(S.xml.C1!)
    evidence.observe('DELIVERY01.02', { customer: { address: inv.address, zip: inv.zip, city: inv.city }, facility: inv.facility })
    expect(B1).not.toEqual(S1)
    expect({ address: inv.address, zip: inv.zip, city: inv.city }).toEqual({ address: B1.street, zip: B1.postalCode, city: B1.city })
    expect(inv.facility).toEqual({ address: S1.street, zip: S1.postalCode, city: S1.city })
  })

  it('DELIVERY01.03 C3 (papper, ingen faktura-e-post): XML <Delivery> är PRINT', ctx => {
    needs(ctx, 'xml:C3')
    const [inv] = parseNordfinXml(S.xml.C3!)
    evidence.observe('DELIVERY01.03_C3', { delivery: inv.delivery, email: inv.email, effective: S.chains.C3!.effective })
    expect(inv.email ?? '').toBe('')
    expect(inv.delivery).toBe('PRINT')
  })

  it('DELIVERY01.03 C2 (invoice_delivery_method paper men faktura-e-post finns): orakel "pappersval ger PRINT" — FALLERAR om XML säger EMAIL (nordfinInvoiceXml.ts:79 använder bara row.email)', ctx => {
    needs(ctx, 'xml:C2')
    const chain = S.chains.C2!
    const [inv] = parseNordfinXml(S.xml.C2!)
    const method = chain.effective.snapshotInvoiceDeliveryMethod
    evidence.observe('DELIVERY01.03_C2', { delivery: inv.delivery, email: inv.email, snapshotInvoiceDeliveryMethod: method, hook: chain.effective.deliveryMethodHook })
    if (method !== 'paper') {
      const reason = `skipped: harness kunde inte etablera invoice_delivery_method=paper i avtalets prissnapshot (effektivt: ${method ?? 'null'}; ${chain.effective.deliveryMethodHook})`
      evidence.observe('skip:DELIVERY01.03_C2', reason)
      ctx.skip(reason)
    }
    if (inv.delivery === 'EMAIL') evidence.observe('PRODUKTFYND_KANDIDAT_DELIVERY01.03', 'Avtalet har invoice_delivery_method=paper men Nordfin-XML har <Delivery>EMAIL</Delivery> eftersom kunden har faktura-e-post: val av papper ignoreras (lib/billing/nordfinInvoiceXml.ts:79).')
    expect(inv.email).toBe(CUSTOMER_SPECS.C2.invoiceEmail)
    expect(inv.delivery, 'paper choice yields PRINT').toBe('PRINT')
  })

  it('DELIVERY01.04 C4 förekommer aldrig i invoice_export_items (approved/candidates), billing_export_run_items eller filrader', ctx => {
    needs(ctx, 'prepare:C4')
    const chain = S.chains.C4!
    const items = exportItemsFor(chain.companyId), runItems = runItemsFor(chain.companyId), files = filesFor(chain.companyId)
    evidence.save('delivery01.04/C4-absence.json', { items, runItems, files })
    evidence.observe('DELIVERY01.04_absence', { invoice_export_items: items.length, billing_export_run_items: runItems.length, invoice_export_files: files.length })
    expect(items.filter(i => (i.approval as { status?: string } | null)?.status === 'approved')).toEqual([])
    expect(items).toEqual([])
    expect(runItems).toEqual([])
    expect(files).toEqual([])
    // And C4's identity is in no other customer's file rows either.
    for (const key of BILLED) {
      const other = S.chains[key]
      if (!other) continue
      const rows = JSON.stringify(filesFor(other.companyId))
      expect(rows.includes(chain.customerId) || rows.includes(CUSTOMER_SPECS.C4.fullName) || rows.includes(CUSTOMER_SPECS.C4.contactEmail), `${key} file rows mention C4`).toBe(false)
    }
  })

  it('DELIVERY01.05 C1: filens innehåll har fortfarande B1 och gamla faktura-e-posten efter profiländringen (fil-rader och XML)', ctx => {
    needs(ctx, 'xml:C1', 'approved:C1')
    expect(S.changeApplied).toBe(true)
    const chain = S.chains.C1!
    const [inv] = parseNordfinXml(S.xml.C1!)
    const files = filesFor(chain.companyId)
    const rows = JSON.stringify(files[0]?.rows ?? null)
    const live = revisionsFor(chain.companyId, chain.customerId)
    evidence.observe('DELIVERY01.05', { xml: { email: inv.email, address: inv.address, zip: inv.zip, city: inv.city }, liveRevisionCount: live.length, revisionsBeforeChange: S.revisionsBeforeChange })
    expect(inv.email).toBe('faktura-c1@t6.sim.invalid')
    expect({ address: inv.address, zip: inv.zip, city: inv.city }).toEqual({ address: B1.street, zip: B1.postalCode, city: B1.city })
    expect(S.xml.C1).not.toContain(NEW_C1_INVOICE_EMAIL)
    expect(S.xml.C1).not.toContain(B2.street)
    expect(rows).not.toContain(NEW_C1_INVOICE_EMAIL)
    expect(rows).not.toContain(B2.street)
    // The change really is live on the customer (so the file differs from the live profile, not from an unchanged one).
    expect(live[live.length - 1]).toMatchObject({ invoice_email: NEW_C1_INVOICE_EMAIL, billing_street: B2.street })
  })
})
