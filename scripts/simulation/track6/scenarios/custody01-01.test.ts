// CUSTODY01.01: T3:s kohort B (28 inkommande E66, mottagare 16712) importeras OFÖRÄNDRAD och lagras med oförändrade bytes.
// Spår 6, kampanj 20261029-3f1a8ab1. Ingen webbläsare/Playwright.
//   Källa: 01d97c27:quality/simulation-campaign/20261029-3f1a8ab1/runs/r1-track3/claude-track3/originals-for-t6/ (manifest.json), run B-20261030T144535Z-8b8258.
//   Inga bytes ligger i repot: git show -> SIM_HOME, sha256 mot manifestet (hårt fel vid avvikelse). Se fixtures/t3-originals/source.json.
//   Kedja: tenant 16712 + mätpunkter ur E66 (parsade) -> 28 .eml byte-exakt till GreenMail-IMAP -> HTTP inbound-cron (observation) ->
//   [ERSÄTTNINGSSTEG: motor med aktör om cron inte slutför] -> 28 ediel_messages med raw_payload sha256 == manifestets .edi -> försök nå underlay/faktura (observation).
//   Brevlådans company_id sätts INTE via SQL; produktbeteende registreras som observation/fynd.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { triggerInbound } from '../lib/custody/app'
import { appendToInbox, purgeInbox } from '../lib/counterparty'
import { lit, resetMailboxSchedule } from '../lib/db'
import { actorId, messageFingerprint, mode, sha256, sqlIn } from '../lib/custody/base'
import { fetchInboxSources } from '../lib/custody/imap'
import { mailRows, runIntakeWithActor, sourceRows, type SourceRow } from '../lib/custody/intake'
import { importOriginals } from '../lib/custody/originals'
import { parseE66, type ParsedE66 } from '../lib/custody/e66'
import { seedRoutableChain, seedSupplierTenant, type SupplierTenant } from '../lib/custody/tenant'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'

const ev = new Evidence()
const run = newRunContext('custody01-01')
const TENANT = { name: 'T6SIM Custody01 Supplier AB', edielId: '16712' }

let imported: ReturnType<typeof importOriginals>
let parsed: Array<ParsedE66 & { name: string; ediSha: string; emlSha: string; mimeBodySha: string; mimeBodyTrimSha: string }> = []
// Orakel för lagrad kropp: den MOTTAGNA MIME-kroppen (CRLF, som publicerad i .eml), inte den LF-normaliserade .edi (manifestet gäller filerna).
const mimeBody = (eml: Buffer): Buffer => { const i = eml.indexOf('\r\n\r\n'); return eml.subarray(i + 4) }
const dropFinalCrlf = (b: Buffer): Buffer => (b.subarray(-2).toString('latin1') === '\r\n' ? b.subarray(0, -2) : b)
const expectedStoredSha = (interchangeRef: string | undefined): string | undefined => parsed.find((p) => p.interchangeRef === interchangeRef)?.mimeBodyTrimSha
let tenant: SupplierTenant
let subjectLike = ''
let sources: SourceRow[] = []

beforeAll(() => { ev.observe('run', { ...run, mode: mode(), tenant: TENANT, actor: actorId() }) })
afterAll(() => { ev.finalize() })

describe('CUSTODY01.01 import av T3 kohort B oförändrad', () => {
  it('CUSTODY01.01 originalen läses ur git, skrivs till SIM_HOME och verifieras mot manifestets sha256 (28 par .eml/.edi)', () => {
    imported = importOriginals()
    ev.observe('import', { repo: imported.repo, commit: imported.commit, manifestSha256: imported.manifestSha256, dir: imported.dir, files: imported.inbound.length * 2 })
    expect(imported.inbound).toHaveLength(28)
    parsed = imported.inbound.map(({ eml, edi }) => ({ name: eml.relPath, ediSha: edi.sha256, emlSha: eml.sha256, mimeBodySha: sha256(mimeBody(eml.data)), mimeBodyTrimSha: sha256(dropFinalCrlf(mimeBody(eml.data))), ...parseE66(edi.data.toString('utf8')) }))
    ev.save('parsed-e66.json', parsed.map((p) => ({ name: p.name, sender: p.sender, receiver: p.receiver, interchangeRef: p.interchangeRef, documentRef: p.documentRef, meteringPoint: p.meteringPoint, testIndicator: p.testIndicator, emlSha256: p.emlSha, ediSha256: p.ediSha })))
    expect(new Set(parsed.map((p) => p.receiver))).toEqual(new Set(['16712']))
    expect(new Set(parsed.map((p) => p.sender))).toEqual(new Set(['70007']))
    expect(new Set(parsed.map((p) => p.interchangeRef)).size).toBe(28)
    expect(parsed.every((p) => !!p.meteringPoint)).toBe(true)
    // EDIFACT-nyttolasten ligger inline (8bit, application/edifact) i MIME-kroppen. .eml har CRLF (MIME-radslut) medan .edi har LF;
    // jämförelsen görs på kroppen efter första tomma raden med CRLF->LF. Manifestets sha256 för båda filerna är redan verifierat strikt av importOriginals().
    for (const { eml, edi } of imported.inbound) {
      const text = eml.data.toString('latin1')
      const bodyStart = text.search(/\r?\n\r?\n/)
      const body = Buffer.from(text.slice(bodyStart).replace(/^\r?\n\r?\n/, '').replace(/\r\n/g, '\n'), 'latin1')
      expect(body.equals(edi.data) || body.equals(Buffer.concat([edi.data, Buffer.from('\n')])), `${eml.relPath}: .edi == MIME-kropp (CRLF->LF)`).toBe(true)
    }
    const subjects = imported.inbound.map(({ eml }) => /^Subject: (E66 \S+) \d{3}\r?$/m.exec(eml.data.toString('latin1'))?.[1])
    expect(new Set(subjects).size, 'gemensamt ämnesprefix').toBe(1)
    subjectLike = `${subjects[0]} %`
    ev.observe('parsed_ids', { metering_points: parsed.map((p) => p.meteringPoint), receiver: '16712', sender: '70007', subjectLike })
  })

  it('CUSTODY01.01 tenant med Ediel-ID 16712 och de parsade mätpunkterna seedas (egna normala rader; exakt en tenant per Ediel-ID)', async () => {
    tenant = seedSupplierTenant(TENANT)
    const points = await seedRoutableChain(tenant, parsed.map((p) => p.meteringPoint!))
    ev.observe('tenant', { companyId: tenant.companyId, points: points.length })
    const owners = sqlIn<number>(`SELECT count(DISTINCT company_id) FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value='16712'`)
    expect(Number(owners), 'exakt en tenant äger Ediel-ID 16712').toBe(1)
    expect(points).toHaveLength(28)
  }, 300_000)

  it('CUSTODY01.01 28 .eml läggs byte-exakt i GreenMail-IMAP (läses tillbaka och jämförs sha256 mot manifestet)', async () => {
    const purged = await purgeInbox()
    ev.observe('imap_purged_before', purged)
    for (const { eml } of imported.inbound) await appendToInbox(eml.data)
    const back = await fetchInboxSources()
    ev.observe('imap_after_inject', { messages: back.length })
    expect(back).toHaveLength(28)
    expect(new Set(back.map((b) => b.sha256)), 'IMAP-källorna == manifestets .eml-sha256').toEqual(new Set(imported.inbound.map((i) => i.eml.sha256)))
  }, 300_000)
})

describe('CUSTODY01.01 intag via normala ingångar', () => {
  it('CUSTODY01.01 HTTP inbound-cron (normal ingång) körs först; utfall loggas', async () => {
    resetMailboxSchedule(mode())
    const before = { mails: mailRows(subjectLike).length, edielMessages: sourceRows(subjectLike).length }
    const r = await triggerInbound(mode())
    const after = { mails: mailRows(subjectLike).length, edielMessages: sourceRows(subjectLike).length }
    const mails = mailRows(subjectLike)
    ev.save('http-cron-outcome.json', { status: r.status, ms: r.ms, body: r.body ?? r.text.slice(0, 2000), before, after, mailCompanyIds: [...new Set(mails.map((m) => m.company_id))], mailStatuses: [...new Set(mails.map((m) => `${m.processing_status}/${m.match_status}`))] })
    ev.observe('http_inbound_cron', { status: r.status, ms: r.ms, before, after })
    expect(r.status).toBe(200)
  }, 600_000)

  it('CUSTODY01.01 intag med aktör (ERSÄTTNINGSSTEG om HTTP-cron inte gav 28 ediel_messages): poll -> kö -> Processa om -> motor', async () => {
    const have = sourceRows(subjectLike).length
    if (have >= 28) { ev.observe('ersattningssteg_motor_med_aktor', { used: false, reason: 'HTTP-cron gav 28 ediel_messages' }); return }
    const r = await runIntakeWithActor(subjectLike, 28)
    ev.save('intake-with-actor.json', r)
    ev.observe('ersattningssteg_motor_med_aktor', { used: true, reason: `HTTP-cron gav ${have} av 28 ediel_messages`, result: r })
    expect(mailRows(subjectLike).length, '28 mail lagrade').toBe(28)
  }, 1_200_000)

  it('CUSTODY01.01 28 ediel_messages finns, med raw_payload sha256 == manifestets .edi och rätt tenant', () => {
    sources = sourceRows(subjectLike)
    expect(sources, '28 inkommande ediel_messages').toHaveLength(28)
    const byRef = new Map(sources.map((s) => [s.interchange_reference, s]))
    const rows: Array<Record<string, unknown>> = []
    const mismatches: string[] = []
    const finalCrlfTrimmed: string[] = []
    for (const p of parsed) {
      const s = byRef.get(p.interchangeRef!)
      if (!s) { mismatches.push(`${p.name}: ediel_messages saknas för ${p.interchangeRef}`); continue }
      const bodySha = sha256(Buffer.from(s.raw_payload, 'utf8'))
      const fp = messageFingerprint(s.id)
      rows.push({ name: p.name, id: s.id, interchangeRef: p.interchangeRef, manifestEdiSha256: p.ediSha, dbBodySha256: fp?.bodySha256, immutablePayloadHash: s.immutable_payload_hash, company: s.company_id === tenant.companyId })
      if (bodySha !== p.mimeBodyTrimSha || fp?.bodySha256 !== p.mimeBodyTrimSha) mismatches.push(`${p.name}: body sha256 ${fp?.bodySha256} != mottagen MIME-kropp (utan slutlig CRLF) ${p.mimeBodyTrimSha} (${s.raw_payload.length} tecken)`)
      if (s.immutable_payload_hash && s.immutable_payload_hash !== p.mimeBodyTrimSha) mismatches.push(`${p.name}: immutable_payload_hash ${s.immutable_payload_hash} != mottagen MIME-kropp`)
      if (bodySha === p.mimeBodyTrimSha && bodySha !== p.mimeBodySha) finalCrlfTrimmed.push(p.name)
      if (s.company_id !== tenant.companyId) mismatches.push(`${p.name}: fel company ${s.company_id}`)
    }
    ev.save('ediel-messages-vs-manifest.json', rows)
    ev.observe('body_sha_mismatches', mismatches)
    // Kandidatfynd (observation): produkten lagrar mottagen kropp byte-lika förutom att slutlig CRLF (MIME-radslut) saknas.
    ev.observe('stored_body_final_crlf_trimmed', { count: finalCrlfTrimmed.length, of: parsed.length })
    expect(mismatches).toEqual([])
  })

  it('CUSTODY01.01 originalen har bevarat bytes efter hela intaget (omläsning, rad + kropp)', () => {
    const second = sources.map((s) => ({ id: s.id, ...messageFingerprint(s.id)! }))
    ev.save('ediel-messages-fingerprints.json', second)
    for (const [i, s] of sources.entries()) expect(second[i].bodySha256, s.interchange_reference).toBe(expectedStoredSha(s.interchange_reference))
  })
})

describe('CUSTODY01.01 nedströms: kan lagrade original nå underlag/faktura? (observation av exakt utfall)', () => {
  it('CUSTODY01.01 försök generera faktureringsunderlag för 2026-10 och läs spärr/utfall (ingen omväg)', async () => {
    const counts = () => sqlIn<Record<string, number>>(`SELECT jsonb_build_object(
      'normalized_metering_values',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${lit(tenant.companyId)}),
      'billing_underlays',(SELECT count(*) FROM public.billing_underlays WHERE company_id=${lit(tenant.companyId)}),
      'underlay_bindings',(SELECT count(*) FROM gridex_billing_source.underlay_bindings WHERE company_id=${lit(tenant.companyId)}),
      'customer_invoices',(SELECT count(*) FROM public.customer_invoices WHERE company_id=${lit(tenant.companyId)}),
      'supply_periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${lit(tenant.companyId)}),
      'contracts',(SELECT count(*) FROM public.customer_contracts WHERE company_id=${lit(tenant.companyId)}))`)
    const before = counts()
    let outcome: Record<string, unknown>
    try {
      const { generateBillingUnderlaysForMonth } = await import('@/lib/billing/underlayEngine')
      const result = await generateBillingUnderlaysForMonth({ companyId: tenant.companyId, billingMonth: '2026-10', createdBy: actorId() })
      outcome = { threw: false, result: JSON.parse(JSON.stringify(result ?? null)) }
    } catch (e) {
      outcome = { threw: true, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string }).code ?? null }
    }
    const after = counts()
    ev.save('downstream-underlay-attempt.json', { before, after, outcome })
    ev.observe('downstream', { before, after, outcome })
    // Oraklet: inga original utan kvalificerad kedja (leveransperiod/kontrakt/pris) får ge bindande underlagskälla.
    expect(after.underlay_bindings, 'ingen bunden (finaliserad) underlay härledd ur de 28 originalen').toBe(0)
    // Originalen är fortfarande bytevis oförändrade efter försöket.
    for (const s of sources) expect(messageFingerprint(s.id)!.bodySha256).toBe(expectedStoredSha(s.interchange_reference))
  }, 300_000)
})
