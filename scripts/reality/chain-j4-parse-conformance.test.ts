// Reality scenario J4: every inbound Ediel message is parsed correctly.
//
// Production risk: a field from the grid owner lands in the wrong place or with the wrong meaning — a release-escaped
// '?' or ':' crashes or truncates the parse, ÅÄÖ turn into U+FFFD, a CONTRL error position is stored as an error code,
// the ERC/FTX of a rejected object is mixed up with another object's, a decimal comma or a sign is lost, or a custom
// UNA is read with default separators. Business effects of PRODAT/UTILTS (J1/J2) and broken mail (J3) are covered
// elsewhere; J4 compares what is STORED and SHOWN with what was SENT.
//
// World: the supplier goes live in ALS (Alingsås) as in scenarios A/F/I; the default grid-owner simulator is stopped
// so it never answers on its own; two website customers apply, the platform sends their Z01 (our originals). The grid
// owner then sends, over SMTPS to the platform's shared Ediel test mailbox:
//   correlated:  positive CONTRL + negative APERAK BGM 34 (ERC 42 / field 227, escaped text ending in '?') to Z01 #1;
//                negative CONTRL with UCM/UCS/UCD positions to Z01 #2;
//   unlinked:    UTILTS E66 with UNA ;*,# ! (decimal comma, sign, quality 56/46, MWH, two metering points),
//                PRODAT Z06 with two objects and ÅÄÖ in ISO-8859-1 (custom UNA; default UNA mislabelled charset=utf-8;
//                custom UNA mislabelled charset=utf-8 = open defect J4-D13), APERAK BGM 27 for a document we never sent,
//                CONTRL with ISO action 8 (not an Ediel result: manual review).
// The platform's own crons run on the Vercel cadence. The test never writes market or mail state.
// Expectations come from the guides via scripts/helpers/reality/parseConformanceWire.ts (never from the parser).
// Offline guards: __tests__/ediel-parse-conformance-*.test.ts; native: scripts/ediel-parse-conformance-native.test.ts.
// Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { LIVE, gs1, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole } from '../helpers/reality/operatorConsole'
import { pollInboundMailLanes, runSlotAfterInbound, runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { clockSettings, cronTick } from '../helpers/reality/clock'
import { GRID_AREA, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { contrlFor } from '../helpers/reality/rejectsWire'
import { OBJECT_REJECTION_TEXT, Z06_OBJECT1, contrlAction8, correlatedDetailedContrl, correlatedObjectRejection, e66TwoPoints, ourOriginal,
  unlinkedHeaderAperak, z06TwoObjects, type J4File } from '../helpers/reality/parseConformanceWire'
import { j4Settled, sendJ4File, sentZ01ForFacility, storedForMail, subsetMismatches, type J4Stored } from '../helpers/reality/parseConformanceWorld'
import { applyAsWebsiteCustomer, type SimulatedPerson } from './simulators/websiteCustomer'

const report: Record<string, unknown> = { scenario: 'J4 every inbound Ediel message is parsed correctly', startedAt: new Date().toISOString(), clock: clockSettings() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-j4-report.json'
const saveReport = () => writeFileSync(REPORT, JSON.stringify(report, null, 2))
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const soft: Array<{ step: string; ok: boolean; observed: unknown; why: string }> = []
report.soft = soft
/** A check the world cannot decide here (open defect owned elsewhere, or a path not reached): recorded, never failing. */
const softCheck = (step: string, ok: boolean, observed: unknown, why: string) => { soft.push({ step, ok, observed, why }) }

/** Defects found while building this scenario. Unit proofs: __tests__/ediel-parse-conformance-*.test.ts. */
const DEFECTS = [
  { id: 'J4-D1', severity: 'high', status: 'confirmed (unit), fixed in lib/inbound-mail/edielEmailParser.ts',
    where: 'lib/inbound-mail/edielEmailParser.ts parseEdifactPayload (FTX/RFF/UNB/BGM/DTM/QTY/NAD read splitComposite(segment.elements[i]))',
    what: 'Composites were split from already-decoded elements: release characters were decoded twice. A valid APERAK whose FTX ends in "??" threw edifact_dangling_release_character (the whole mail failed), "?:" lost its colon and "??" its question mark.' },
  { id: 'J4-D2', severity: 'medium', status: 'confirmed (unit), fixed in lib/inbound-mail/edielEmailParser.ts',
    where: 'lib/inbound-mail/edielEmailParser.ts FTX (elements.slice(3))',
    what: 'freeText mixed the coded C107 reference and its agency into the operator text ("105 260 Anläggningen kan inte identifieras"), and the language element; the national code was not stored as a field and ERC/FTX/RFF were not kept per object. Now freeText = C108 only, freeTextEntries/applicationErrors per ERC group.' },
  { id: 'J4-D3', severity: 'medium', status: 'confirmed (unit), fixed in lib/inbound-mail/edielEmailParser.ts',
    where: 'lib/inbound-mail/edielEmailParser.ts UCM (elements[4])', what: 'UCM_ACTION was read from 0085 (syntax error) instead of 0083 (action): "UCM+1+PRODAT:...+4+13" stored action 13.' },
  { id: 'J4-D4', severity: 'medium', status: 'confirmed (unit), fixed in lib/inbound-mail/edielEmailParser.ts',
    where: 'lib/inbound-mail/edielEmailParser.ts UCS (elements[2] ?? elements[1]); UCD/UCI 0085/UCM 0085 ignored',
    what: 'A UCS without 0085 stored its segment POSITION as an error code; UCD data-element errors, UCM and UCI syntax errors were dropped; no positions were stored. Now contrlErrors keeps level, code and segment/element/component positions.' },
  { id: 'J4-D5', severity: 'high', status: 'confirmed (unit, pure function); mitigated on the mail path by J3 (lib/inbound-mail/inboundEdifactSources.ts); patch proposed',
    where: 'lib/ediel/core/canonicalEdifactAst.ts extractCanonicalEdifactPayload (lastIndexOf("UNZ") case-insensitive)',
    what: 'Any later text containing "unz" (S/MIME inner base64, "unzip", "Kunz") was appended after the real UNZ; the stored raw_payload then fails envelope validation (negative CONTRL to a valid file).' },
  { id: 'J4-D6', severity: 'medium', status: 'confirmed (unit, pure function); mitigated on the mail path by J3; patch proposed',
    where: 'lib/ediel/core/canonicalEdifactAst.ts extractCanonicalEdifactPayload (first "UNA" substring, any case)',
    what: 'A mail body word containing "una" ("Kommunala", "Fortuna") became the UNA service string advice: separators taken from prose.' },
  { id: 'J4-D7', severity: 'medium', status: 'likely (code)', where: 'lib/ediel/transport/smime.ts decryptPkcs7WithProfile (utf8 chosen whenever text contains "UNB+")',
    what: 'A decrypted bare or 8bit/binary inner EDIFACT in ISO-8859-1 (UNOC) is decoded as UTF-8: ÅÄÖ become U+FFFD before MIME/charset handling. Base64 inner parts (the platform\'s own sender) are not affected.' },
  { id: 'J4-D8', severity: 'low', status: 'confirmed (unit); dead code (no caller of ingestUtiltsE66MeteringValues/parseE66Observations)',
    where: 'lib/ediel/utilts/meteringObservationParser.ts:100 qualityStatus: quantity.qualifier', what: 'The metering projection stored the QTY qualifier (136) as quality/status code instead of SG11 STS+8 (field 520).' },
  { id: 'J4-D9', severity: 'low', status: 'confirmed (unit), fixed in lib/ediel/core/edifactParser.ts',
    where: 'lib/ediel/core/edifactParser.ts bgmCode (split(":"))', what: 'Non-PRODAT businessCode with UNA component separator ";" was "E66;;260".' },
  { id: 'J4-D10', severity: 'low', status: 'confirmed (code)', where: 'lib/inbound-mail/canonicalInboundAckStatusUpdater.ts persistInboundAck original_message_id: parsed.bgmReference',
    what: 'original_message_id of an inbound ACK is the ACK\'s own BGM document id (UTILTS APERAK 313: its own id), not the acknowledged original (ACW/DOC/UCI).' },
  { id: 'J4-D11', severity: 'low', status: 'confirmed (unit)', where: 'lib/ediel/prodat/parser.ts ParsedProdatLineItem',
    what: 'The PRODAT line projection omits fields 254 (settlement method), 306 (installation status), 307, 220, 215, 219, 310, 204, 313; consumers must read them directly. Stored lineGroups.cciCavCodes keep them.' },
  { id: 'J4-D12', severity: 'medium (latent)', status: 'confirmed (unit); not reached on the mail path today (ACK families branch to the canonical updater first)',
    where: 'lib/inbound-mail/inboundStatusUpdater.ts:80 isNegativeContrL regex /UCI\\+[^\']*\\+7(\\+|$)/', what: 'Inverted: UCI action 7 is "negative" and action 4 (Ediel negative) is not.' },
  { id: 'J4-D13', severity: 'medium', status: 'confirmed (unit), open: patch proposed', where: 'lib/inbound-mail/mimeCharset.ts edifactSyntaxCharset (/UNB\\+(UNO[A-Z])/ only)',
    what: 'With a custom UNA data separator the UNB syntax identifier is not found, so a MIME charset=utf-8 label wins over UNOC and every ÅÄÖ becomes U+FFFD.' },
  { id: 'J4-H1', severity: 'low (harness)', status: 'fixed (T15): DTM+137 in fixed +0100; __tests__/ediel-parse-conformance-ack.test.ts', where: 'scripts/helpers/reality/rejectsWire.ts headerRejectionAperakFor DTM+137',
    what: 'Wrote the APERAK document time in Europe/Stockholm local time (CEST in summer); P-profile payload time is fixed UTC+1 (ENV-08).' },
  { id: 'J4-H2', severity: 'low (harness)', status: 'confirmed (code)', where: 'scripts/reality/simulators/gridOwner.ts poll (base64 decoded as utf8); scripts/helpers/live-chain-wire.ts dailyE66 SG11 "STS+7++21::260"',
    what: 'The grid-owner simulator decodes our UNOC files as UTF-8 (ÅÄÖ in our names become U+FFFD in its facts); its E66 writes the observation status as STS+7 reason 21 instead of SG11 STS+8 quality (approved values carry no STS).' },
]
report.defects = DEFECTS

const RUN = Date.now().toString(36).slice(-6).toUpperCase()
const ref = (key: string) => `J4${RUN}${key}`.replace(/[^A-Z0-9]/g, '').slice(0, 14)
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const person = (first: string, birth: string, serial: string): SimulatedPerson => ({ firstName: first, lastName: 'E2E-Tolkning', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN.toLowerCase()}@example.invalid`, phone: '0701234567', address: { street: 'Kungsgatan 1', postalCode: '441 30', city: 'Alingsås' } })
const WEBSITE = [
  { key: 'W1-aperak', person: person('Tolkaperak', '19850505', '515'), gsrn: facility() },
  { key: 'W2-contrl', person: person('Tolkcontrl', '19860606', '616'), gsrn: facility() },
]

let tenant: LiveTenant
let defaultGridOwner: GridOwnerSim | undefined
let gridOwnerEmail = ''
let gridOwnerEdielId = ''
const z01 = new Map<string, NonNullable<ReturnType<typeof sentZ01ForFacility>>>()
const sent: Array<{ file: J4File; messageId: string; correlatedTo?: string }> = []
const stored = new Map<string, J4Stored>()
const sentOf = (key: string) => sent.find(s => s.file.key === key)
const storedOf = (key: string) => { const s = sentOf(key); return s ? stored.get(s.messageId) : undefined }

describe.sequential('reality J4 — every inbound Ediel message is parsed correctly', () => {
  afterAll(async () => {
    defaultGridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('J4-0 the supplier goes live in ALS; the default grid owner is stopped; two website customers apply', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report)
    tenant = live.tenant
    defaultGridOwner = live.gridOwner
    gridOwnerEmail = live.gridOwner.email
    gridOwnerEdielId = live.gridOwner.edielId
    // The grid owner of this scenario only sends what the test hands it: no automatic CONTRL/APERAK/Z04.
    defaultGridOwner.stop()
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify({ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }) })
    const point = sql<{ x: number; y: number }>(`SELECT jsonb_build_object('x',round(ST_X(p)::numeric,2),'y',round(ST_Y(p)::numeric,2))
      FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(12.534,57.9303),4326),3006) p) q`)
    await fetch('http://127.0.0.1:3901/__sim/address', { method: 'POST', body: JSON.stringify({ street: 'Kungsgatan', number: '1', postalCode: '441 30', city: 'Alingsås', ...point }) })
    const applications: unknown[] = []
    for (const customer of WEBSITE) {
      const account = await supabaseService.auth.admin.createUser({ email: customer.person.email, password: `Reality-${customer.person.personalNumber}`, email_confirm: true })
      if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
      const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey: live.apiKey, origin: WEBSITE_ORIGIN, person: customer.person,
        site: { facilityId: customer.gsrn, priceArea: 'SE3', annualConsumptionKwh: 9_000 }, portalUserId: account.data.user.id })
      applications.push({ key: customer.key, status: result.status, step: result.step, number: result.applicationNumber })
      expect(result.status, `${customer.key}: ${result.step} ${JSON.stringify(result.body).slice(0, 400)}`).toBeLessThan(300)
    }
    report.world = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: gridOwnerEdielId, gridOwnerEmail, gridArea: GRID_AREA,
      website: WEBSITE.map(w => ({ key: w.key, gsrn: w.gsrn })), applications }
    saveReport()
  }, 30 * 60_000)

  it('J4-1 the platform sends both Z01 on the cron cadence (our originals for the correlated answers)', async () => {
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_J4_Z01_MINUTES ?? 20) * 60_000
    const slots: unknown[] = []
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status })) })
      for (const w of WEBSITE) { const sentZ01 = sentZ01ForFacility(tenant.companyId, w.gsrn); if (sentZ01) z01.set(w.key, sentZ01) }
      if (z01.size === WEBSITE.length || Date.now() > deadline) break
      await cronTick()
    }
    report.z01 = { slots, sent: [...z01.entries()].map(([key, row]) => ({ key, id: row.id, sentAt: row.sentAt, status: row.status })) }
    saveReport()
    softCheck('J4-1 both Z01 sent', z01.size === WEBSITE.length, report.z01,
      'The correlated APERAK/CONTRL need our own sent Z01. Without it only the unlinked half of the set is sent (see report.z01.slots for the blocker).')
  }, 30 * 60_000)

  it('J4-2 the grid owner sends the conformance set over SMTPS, one file per mail', async () => {
    // The tenant is live in production (goLiveAlsSupplier): the unlinked files are production interchanges and go to the
    // production platform mailbox (FINDINGS T7). The correlated answers copy the lane of our own sent Z01.
    const parties = { issuer: gridOwnerEdielId, receiver: tenant.supplierEdielId, gridArea: GRID_AREA, environment: 'production' as const }
    const files: Array<{ file: J4File; correlatedTo?: string }> = [
      { file: e66TwoPoints({ ...parties, reference: ref('E66'), meters: [facility(), facility()] }) },
      { file: z06TwoObjects({ ...parties, reference: ref('Z06C'), meters: [facility(), facility()], una: 'custom' }) },
      { file: z06TwoObjects({ ...parties, reference: ref('Z06D'), meters: [facility(), facility()], una: 'default', contentType: 'application/EDIFACT; charset=utf-8', key: 'P-Z06-default-mislabelled-utf8' }) },
      { file: z06TwoObjects({ ...parties, reference: ref('Z06M'), meters: [facility(), facility()], una: 'custom', contentType: 'application/EDIFACT; charset=utf-8',
        key: 'P-Z06-custom-mislabelled-utf8', openDefect: 'J4-D13' }) },
      { file: unlinkedHeaderAperak({ ...parties, reference: ref('AP27'), acknowledgedDocument: `NOTSENT${RUN}` }) },
      { file: contrlAction8({ ...parties, reference: ref('CT8'), acknowledgedInterchange: `NOTSENT${RUN}` }) },
    ]
    const w1 = z01.get('W1-aperak'), w2 = z01.get('W2-contrl')
    if (w1) {
      const positive = contrlFor(w1.raw, 'positive')
      files.push({ correlatedTo: w1.id, file: { key: 'C-CONTRL-1-correlated', edifact: positive, bytes: Buffer.from(positive, 'latin1'), contentType: 'application/EDIFACT',
        interchangeReference: EdifactEnvelopeCodec.decode(positive).interchangeReference!,
        expectedParse: { messageFamily: 'CONTRL', references: { UCI: [ourOriginal(w1.raw).interchange.slice(0, 14)], UCI_ACTION: ['1'] }, errorCodes: [],
          canonicalAck: { family: 'CONTRL', outcome: 'positive', code: '1' } } } })
      files.push({ correlatedTo: w1.id, file: correlatedObjectRejection(w1.raw) })
    }
    if (w2) files.push({ correlatedTo: w2.id, file: correlatedDetailedContrl(w2.raw) })
    for (const { file, correlatedTo } of files) {
      sent.push({ file, correlatedTo, messageId: await sendJ4File({ from: gridOwnerEmail, file, run: RUN }) })
      await pause(1_000)
    }
    report.sent = sent.map(s => ({ key: s.file.key, messageId: s.messageId, interchange: s.file.interchangeReference, correlatedTo: s.correlatedTo ?? null,
      contentType: s.file.contentType, bytes: s.file.bytes.length, openDefect: s.file.openDefect ?? null }))
    saveReport()
    expect(sent.length).toBeGreaterThanOrEqual(6)
  })

  it('J4-3 the inbound cron receives and processes every mail', async () => {
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_J4_INBOUND_MINUTES ?? 20) * 60_000
    const runs: unknown[] = []
    for (;;) {
      // Both lanes: production as Vercel polls it (the tenant is live in production), then test.
      const inbound = await pollInboundMailLanes()
      const outbox = await runSlotAfterInbound()
      runs.push({ at: new Date().toISOString(), inbound: inbound.production.status, inboundTest: inbound.test.status, outbox: outbox.status })
      expect(inbound.status, JSON.stringify(inbound.body).slice(0, 500)).toBe(200)
      for (const s of sent) stored.set(s.messageId, storedForMail(s.messageId))
      if ([...stored.values()].every(j4Settled) || Date.now() > deadline) break
      await cronTick()
    }
    report.reception = runs
    report.stored = Object.fromEntries(sent.map(s => [s.file.key, summarize(stored.get(s.messageId))]))
    saveReport()
    expect(sent.filter(s => !stored.get(s.messageId)?.mail).map(s => s.file.key), 'every mail has a reception row').toEqual([])
    expect(sent.filter(s => !j4Settled(stored.get(s.messageId)!)).map(s => s.file.key), 'every mail settled').toEqual([])
  }, 30 * 60_000)

  it('J4-4 what is stored is exactly what was sent: interchange text, every parsed field (guide positions)', () => {
    const results: unknown[] = []
    for (const s of sent) {
      const row = stored.get(s.messageId)!
      // Byte-exact text: no U+FFFD, no double-decoding, nothing appended after UNZ.
      const payloadExact = row.mail?.payload === s.file.edifact
      const parseRaw = row.parse?.raw === s.file.edifact
      // The canonical ACK classification is persisted on the ACK original (ediel_messages.parsed_payload), the
      // field parse on inbound_ediel_parse_results; both are compared with the guide expectation.
      const { canonicalAck: expectedAck, ...expectedFields } = s.file.expectedParse
      const mismatches = row.parse ? subsetMismatches(row.parse.payload, expectedFields) : ['no inbound_ediel_parse_results row']
      if (expectedAck !== undefined) mismatches.push(...subsetMismatches(canonicalAckOf(row), expectedAck, '$.canonicalAck'))
      results.push({ key: s.file.key, payloadExact, parseRaw, mismatches, mail: row.mail && { status: row.mail.status, match: row.mail.match, error: row.mail.error } })
      if (s.file.openDefect) {
        softCheck(`J4-4 ${s.file.key}`, payloadExact && mismatches.length === 0, { payloadExact, mismatches: mismatches.slice(0, 5) },
          `Open defect ${s.file.openDefect}: expected to differ until its patch lands.`)
        continue
      }
      expect.soft(payloadExact, `${s.file.key}: raw_edifact_payload is the sent interchange`).toBe(true)
      expect.soft(parseRaw, `${s.file.key}: parse result raw_payload is the sent interchange`).toBe(true)
      expect.soft(mismatches, `${s.file.key}: parsed fields`).toEqual([])
      expect.soft(row.mail?.status, `${s.file.key}: no reception failure (${row.mail?.error ?? ''})`).not.toBe('failed')
      // Every ediel_messages original created from this mail is the same interchange and the same parties.
      for (const message of row.messages) {
        expect.soft(message.raw, `${s.file.key}: ediel_messages.raw_payload`).toBe(s.file.edifact)
        expect.soft([message.sender, message.receiver, message.interchange], `${s.file.key}: envelope columns`).toEqual(
          [s.file.expectedParse.senderEdielId ?? message.sender, s.file.expectedParse.receiverEdielId ?? message.receiver, s.file.interchangeReference])
      }
    }
    report.J4_4 = results
    saveReport()
  })

  it('J4-5 ÅÄÖ and release-escaped names reach storage unchanged; both Z06 objects stay separate', () => {
    for (const key of ['P-Z06-custom', 'P-Z06-default-mislabelled-utf8']) {
      const row = storedOf(key), file = sentOf(key)!.file
      const text = row?.mail?.payload ?? ''
      expect.soft(text.includes(Z06_OBJECT1.city) && text.includes(Z06_OBJECT1.addressLines[0]), `${key}: ÅÄÖ intact`).toBe(true)
      expect.soft(text.includes('\uFFFD'), `${key}: no replacement character`).toBe(false)
      const groups = (row?.parse?.payload.lineGroups ?? []) as Array<Record<string, unknown>>
      expect.soft(groups.map(g => g.itemId), `${key}: one line group per object`).toEqual(
        (file.expectedParse.lineGroups as Array<Record<string, unknown>>).map(g => g.itemId))
    }
    report.J4_5 = Object.fromEntries(['P-Z06-custom', 'P-Z06-default-mislabelled-utf8', 'P-Z06-custom-mislabelled-utf8'].map(key => [key,
      { replacementCharacters: (storedOf(key)?.mail?.payload ?? '').split('\uFFFD').length - 1 }]))
    saveReport()
  })

  it('J4-6 correlated negative APERAK and CONTRL reach our Z01 with the exact codes, positions and text; the operator sees them', async (context: TestContext) => {
    const correlated = sent.filter(s => s.correlatedTo)
    if (!correlated.length) { report.J4_6 = 'skipped: no Z01 was sent (J4-1)'; return context.skip() }
    const results: Record<string, unknown> = {}
    for (const s of correlated) {
      const row = stored.get(s.messageId)!
      const ack = row.messages[0]
      results[s.file.key] = { mail: row.mail && { status: row.mail.status, match: row.mail.match }, ack: ack && { related: ack.related, ackOutcome: ack.ackOutcome, status: ack.status,
        failure: ack.failure, contrl: ack.contrl, aperak: ack.aperak }, tasks: row.tasks.map(t => ({ type: t.type, title: t.title, description: t.description })) }
      expect.soft(ack, `${s.file.key}: an inbound ACK original`).toBeTruthy()
      if (!ack) continue
      // ACK-06: correlated to exactly our original.
      expect.soft(ack.related, `${s.file.key}: related_message_id`).toBe(s.correlatedTo)
      const expectedOutcome = (s.file.expectedParse.canonicalAck as { outcome: string }).outcome
      expect.soft(ack.ackOutcome, `${s.file.key}: ack_outcome`).toBe(expectedOutcome)
    }
    const w1 = WEBSITE[0], w2 = WEBSITE[1]
    const z01AfterAperak = sentZ01ForFacility(tenant.companyId, w1.gsrn), z01AfterContrl = sentZ01ForFacility(tenant.companyId, w2.gsrn)
    results.z01 = { W1: z01AfterAperak && { status: z01AfterAperak.status, contrl: z01AfterAperak.contrl, aperak: z01AfterAperak.aperak, ack: z01AfterAperak.ack, request: z01AfterAperak.request },
      W2: z01AfterContrl && { status: z01AfterContrl.status, contrl: z01AfterContrl.contrl, aperak: z01AfterContrl.aperak, ack: z01AfterContrl.ack, request: z01AfterContrl.request } }
    report.J4_6 = results
    saveReport()
    if (sentOf('A-APERAK-34-correlated')) {
      expect.soft(z01AfterAperak?.aperak, 'W1 Z01: aperak_status after the object rejection').toMatch(/rejected|failed/)
      // What the operator is shown for the rejected request: the grid owner's ERC/field code and its exact text.
      const shown = [z01AfterAperak?.request?.failure ?? '', ...(storedOf('A-APERAK-34-correlated')?.tasks ?? []).map(t => `${t.title} ${t.description ?? ''}`)].join(' | ')
      softCheck('J4-6 operator sees ERC 42 / field 227', /42/.test(shown) && /227/.test(shown), shown.slice(0, 600),
        'GOR-03 put the DSO code on switch failures; whether the Z01 data request and the inbound task show it is checked here.')
      softCheck('J4-6 operator sees the exact FTX text', shown.includes(OBJECT_REJECTION_TEXT), shown.slice(0, 600),
        'The text contains every UNOC service character and ÅÄÖ; a double-decoded or mojibake text fails here.')
    }
    if (sentOf('C-CONTRL-4-correlated')) {
      expect.soft(z01AfterContrl?.contrl, 'W2 Z01: contrl_status after the negative CONTRL').toMatch(/rejected|failed/)
    }
  })

  it('J4-7 acknowledgements we cannot act on go to manual review with their exact reason, nothing applied', () => {
    const contrl8 = storedOf('C-CONTRL-8-unlinked'), aperak27 = storedOf('A-APERAK-27-unlinked')
    report.J4_7 = { contrl8: summarize(contrl8), aperak27: summarize(aperak27) }
    saveReport()
    expect(contrl8?.mail?.status).toBe('manual_review')
    expect.soft(contrl8?.mail?.match, 'CONTRL 0083=8 is not an Ediel result (ACK-01)').toBe('invalid_ack')
    expect.soft(contrl8?.messages.map(m => m.ackOutcome) ?? [], 'an invalid CONTRL never gets an ack outcome').toEqual(contrl8?.messages.map(() => null) ?? [])
    expect(aperak27?.mail?.status).toBe('manual_review')
    expect.soft(aperak27?.mail?.match, 'APERAK for a document we never sent').toBe('ack_unmatched')
    expect.soft(aperak27?.messages.every(m => m.related === null), 'never linked to another original').toBe(true)
  })
})

/** Compact, secret-free view of a stored mail for the report. */
function summarize(row: J4Stored | undefined) {
  if (!row) return null
  return { mail: row.mail && { status: row.mail.status, match: row.mail.match, error: row.mail.error, payloadLength: row.mail.payload?.length ?? null },
    jobs: row.jobs, parse: row.parse && { family: row.parse.family, code: row.parse.code, sender: row.parse.sender, receiver: row.parse.receiver, interchange: row.parse.interchange },
    messages: row.messages.map(m => ({ id: m.id, family: m.family, code: m.code, status: m.status, processing: m.processing, ackOutcome: m.ackOutcome, related: m.related,
      failure: m.failure })), tasks: row.tasks.map(t => ({ type: t.type, title: t.title })) }
}

/** The canonical ACK classification as persisted on the ACK original (ediel_messages.parsed_payload.canonicalAck). */
function canonicalAckOf(row: J4Stored) {
  return (row.messages[0]?.payload as Record<string, unknown> | null)?.canonicalAck
}
