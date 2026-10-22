// Reality scenario J3: inbound Ediel robustness — what arrives broken, duplicated, misaddressed or out of order.
//
// Production risk: one bad or unexpected inbound file stalls the mailbox poller, lands on the wrong tenant, is
// acknowledged wrongly, or is silently lost. Same world as scenario E: a live electricity supplier (tenant A) with an
// existing supply customer, a grid owner that only talks e-mail, the platform's shared Ediel test mailbox on GreenMail
// (SMTPS 3465 / IMAPS 3993) and the platform's own crons. The grid owner (scripts/reality/simulators/mailFaults.ts)
// submits exact mail bytes over SMTPS: CRLF/BOM files, two interchanges in one mail, a cover letter, truncated and
// envelope-broken files, a wrong encoding, binary attachments, an empty and a non-EDIFACT attachment, a month file,
// a wrong sub-address, a production interchange in the test mailbox, duplicates, a spoofed sender, a CONTRL before
// any request, an unstorable mail — and a valid control file LAST, which must still be processed.
//
// The test never writes market or mail state; it submits mail, runs the crons on Vercel's cadence and reads the
// outcome. A step the world cannot reach is a soft check that says exactly why (report.soft).
//
// Out of scope here (proved elsewhere): routing of valid files to the right tenant/customer and the unknown receiver
// (scenario E), F80 reprocess, U1/F10/F11 deadlocks, Z04-before-APERAK and duplicate APERAK (scenario I, GOR-FP1).
// Unit proofs: __tests__/reality-j3-inbound-interchange-framing.test.ts, __tests__/reality-j3-inbound-poison-mail.test.ts.
// Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { configurePlatformMailbox, configureTenant, cron, existingSupplyCustomer, type LiveCustomer, type LiveTenant } from '../helpers/live-chain-fixture'
import { brokenUna, crlfTerminated, productionIndicator, septemberMonthE66, truncatedAfterRelease, twoInterchanges, unsolicitedContrl, validE66,
  withBom, withoutUnz, withReceiverSubaddress, wrongUntCount, type E66Input } from '../helpers/reality/inboundRobustWire'
import { contrlReceivedByGridOwner, inboundOriginals, mailOutcomes, pollRunsSince, settled, sharedMailboxState, valuesSince,
  type MailOutcome } from '../helpers/reality/inboundRobustWorld'
import { composeMail, pdfBytes, sendRaw, singlePartMail, utf16, zipBytes, type FaultMail } from './simulators/mailFaults'

const report: Record<string, unknown> = { scenario: 'J3 inbound Ediel robustness', startedAt: new Date().toISOString() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-j3-report.json'
const saveReport = () => writeFileSync(REPORT, JSON.stringify(report, null, 2))
const soft: Array<{ step: string; ok: boolean; observed: unknown; why: string }> = []
report.soft = soft
/** A check the world cannot decide yet (product decision, or a path not reachable here): recorded, never failing. */
const softCheck = (step: string, ok: boolean, observed: unknown, why: string) => { soft.push({ step, ok, observed, why }) }

/** Defects found while building this scenario. Unit proofs named in the header; fixes listed per item. */
const DEFECTS = [
  { id: 'J3-01', severity: 'critical', status: 'confirmed (unit, real MIME), fixed in lib/inbound-mail/edielInboundProcessor.ts + lib/inbound-mail/inboundEdifactSources.ts',
    where: 'lib/inbound-mail/edielInboundProcessor.ts:210-217 (HEAD): [...new Set([raw_edifact_payload, ...attachments.raw_text])].join',
    what: 'F3 variant: the extracted payload is trimmed, the decoded attachment is not. Any UNA file that ends with CRLF (or starts with a BOM) was parsed as two copies -> edifact_dangling_release_character, 5 job retries, failed; no CONTRL, nothing applied. All repo/world fixtures end without a newline, so no test saw it.' },
  { id: 'J3-02', severity: 'high', status: 'confirmed (unit), fixed (held as multiple_interchanges; fan-out per interchange proposed)',
    where: 'same join + lib/ediel/core/canonicalEdifactAst.ts extractCanonicalEdifactPayload (first UNA/UNB to LAST "UNZ", case-insensitive)',
    what: 'Two EDIFACT attachments were merged into one payload (with UNA: parse error; without: last UNB header over both bodies). A cover letter saying "unzip"/"Kunz" extended a valid file into free text -> syntax rejection of a valid file.' },
  { id: 'J3-03', severity: 'medium', status: 'confirmed (unit + PostgreSQL 22P05 on the local DB), fixed in lib/inbound-mail/edielMailboxPoller.part-2.ts storableText',
    where: 'lib/inbound-mail/edielMailboxPoller.part-2.ts storeInboundEmail (body_text, attachments.raw_text)',
    what: 'A binary or UTF-16 part decodes to U+0000, which PostgreSQL text rejects: a single-part UTF-16 file failed the whole mail insert (-> J3-04); a ZIP/PDF attachment failed the attachment batch insert and every attachment row of the mail was dropped with a console warning only.' },
  { id: 'J3-04', severity: 'high', status: 'confirmed (unit, fake imapflow), fixed: bounded store attempts + dead letter in lib/inbound-mail/edielMailboxPoller.part-2.ts',
    where: 'lib/inbound-mail/edielMailboxPoller.part-2.ts pollEdielMailbox handleFetchedMessage catch (HEAD: push error, return true)',
    what: 'A mail whose storage throws (U+0000, AI/BI-shaped line without tenant, guard trigger) was never flagged \\Seen and never recorded: refetched first on every poll forever, and 25 such mails starved all newer mail (fetch budget 25). The manual mailbox poller already had this dead-letter pattern.' },
  { id: 'J3-05', severity: 'high', status: 'confirmed (unit, reception boundary), fixed: production mailbox holds UNB 0035=1 as environment_mismatch',
    where: 'lib/inbound-mail/edielInboundProcessor.ts (environment = mailbox environment; UNB 0035 never compared); technical CONTRL then blocked by technical_source_wire_scope_mismatch while business processing continued',
    what: 'A test interchange arriving in the production mailbox was attributed to the production tenant and processed as production. Reverse direction (production file in the test mailbox) is still processed in test: decision needed (J3-5 soft check).' },
  { id: 'J3-06', severity: 'medium', status: 'confirmed (unit), fixed: held as edifact_unparseable on the mail',
    where: 'lib/inbound-mail/edielInboundProcessor.ts parseInboundEmailContent (pure) threw; job retried 5x then failed, mail stayed "received"',
    what: 'A truncated file ending after a release character produced no CONTRL, no Ediel message and no reason on the mail; five identical retries. Negative CONTRL for it is still not produced (syntax_tokenization_failed exists in validateEdifactEnvelope but is unreachable from mail): proposal in report.' },
  { id: 'J3-07', severity: 'high (security)', status: 'confirmed (code), open: needs decision',
    where: 'lib/inbound-mail/edielInboundProcessor.ts, lib/inbound-mail/inboundTenantResolver.ts, lib/ediel/transport/smime.ts unpackInboundSmimeIfNeeded',
    what: 'Sender identity is never checked: From/envelope sender is not compared with the grid owner, plaintext mail is accepted in production, S/MIME is only decrypted (encryption to our public certificate authenticates nobody), no signature or DKIM check (the manual mailbox has DKIM). A mail claiming UNB sender = a grid owner is processed as that grid owner.' },
  { id: 'J3-08', severity: 'medium', status: 'confirmed (code), open (outbox owner / FINDINGS O1)',
    where: 'lib/ediel/outbox/sendOutboxItem.ts:341-355 + claim_ediel_outbox_items (prepared/queued only)',
    what: 'During an SMTP outage every CONTRL/APERAK whose connect fails becomes "failed" and is never retried automatically; known-not-sent (syscall connect, 4xx before DATA) could be requeued safely with backoff. delivery_uncertain correctly waits for reconciliation.' },
  { id: 'J3-09', severity: 'low', status: 'likely (code), open: decision',
    where: 'lib/ediel/tenant/resolveInboundTenant.ts resolveInboundTenantFromIdentifiers (only verified_legal_identity decides; sub-address is evidence only)',
    what: 'A known receiver with an unconfigured UNB routing sub-address is attributed like a correct one; whether sub-address must match is not decided anywhere (J3-4 soft check records the observed outcome).' },
]
report.defects = DEFECTS

let tenant: LiveTenant
let customer: LiveCustomer
const mails: Array<FaultMail & { from: string; sendTimes?: number }> = []
const byKey = (key: string) => mails.find(mail => mail.key === key)!
const RUN = Date.now().toString(36).slice(-5).toUpperCase()
const ref = (key: string) => `J3${RUN}${key}`.replace(/[^A-Z0-9]/g, '').slice(0, 14)
let outcomes: MailOutcome[] = []
const outcomeOf = (key: string) => outcomes.find(outcome => outcome.messageId === byKey(key).messageId)!

describe.sequential('reality J3 — inbound Ediel robustness', () => {
  afterAll(() => {
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('J3-0 a live supplier with an existing supply customer and the shared Ediel test mailbox', async () => {
    expect(configurePlatformMailbox()).toBe(1)
    tenant = await configureTenant(supabaseService as never)
    customer = await existingSupplyCustomer(supabaseService as never, tenant, { name: 'Kund J3', supplyStart: '2026-08-01' })
    report.world = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: tenant.issuerEdielId, meter: customer.meterId }
  })

  it('J3-1 the grid owner submits broken, duplicated, misaddressed and out-of-order mail over SMTPS, a valid file last', async () => {
    const base = (key: string, day: string): E66Input => ({ issuer: tenant.issuerEdielId, receiver: tenant.supplierEdielId, meterId: customer.meterId, day, reference: ref(key) })
    const e66 = (key: string, day: string, index: number) => validE66(base(key, day), index)
    const from = tenant.gridOwnerEmail
    const attach = (filename: string, content: string | Buffer, contentType = 'application/edifact') => ({ filename, content, contentType })
    const add = (mail: FaultMail, sender = from, sendTimes = 1) => { mails.push({ ...mail, from: sender, sendTimes }) }

    add(await composeMail({ key: 'CRLF', from, subject: 'J3 CRLF', attachments: [attach('E66.edi', crlfTerminated(e66('CRLF', '2026-09-10', 0)))], references: [ref('CRLF')] }))
    add(await composeMail({ key: 'BOM', from, subject: 'J3 BOM', attachments: [attach('E66.edi', Buffer.from(withBom(e66('BOM', '2026-09-11', 1)), 'utf8'))], references: [ref('BOM')] }))
    add(await composeMail({ key: 'TWOATT', from, subject: 'J3 two attachments', references: [ref('TWOA'), ref('TWOB')],
      attachments: [attach('E66_a.edi', e66('TWOA', '2026-09-12', 2)), attach('E66_b.edi', e66('TWOB', '2026-09-13', 3))] }))
    add(await composeMail({ key: 'TWOINONE', from, subject: 'J3 two interchanges in one file', references: [ref('ONEA'), ref('ONEB')],
      attachments: [attach('E66.edi', twoInterchanges(e66('ONEA', '2026-09-14', 4), e66('ONEB', '2026-09-15', 5)))] }))
    add(await composeMail({ key: 'COVER', from, subject: 'J3 cover letter', references: [ref('COVER')],
      attachments: [attach('E66.edi', e66('COVER', '2026-09-16', 6)), attach('readme.txt', 'Hej! Please unzip the archive if needed.\nMvh Hans Kunz', 'text/plain')] }))
    add(await composeMail({ key: 'TRUNC', from, subject: 'J3 truncated', attachments: [attach('E66.edi', truncatedAfterRelease(e66('TRUNC', '2026-09-17', 7)))], references: [ref('TRUNC')] }))
    add(await composeMail({ key: 'NOUNZ', from, subject: 'J3 without UNZ', attachments: [attach('E66.edi', withoutUnz(e66('NOUNZ', '2026-09-18', 8)))], references: [ref('NOUNZ')] }))
    add(await composeMail({ key: 'UNTCOUNT', from, subject: 'J3 wrong UNT count', attachments: [attach('E66.edi', wrongUntCount(e66('UNTC', '2026-09-19', 9)))], references: [ref('UNTC')] }))
    add(await composeMail({ key: 'BADUNA', from, subject: 'J3 broken UNA', attachments: [attach('E66.edi', brokenUna(e66('BADUNA', '2026-09-20', 10)))], references: [ref('BADUNA')] }))
    add(singlePartMail({ key: 'UTF16', from, subject: 'J3 UTF-16', contentType: 'application/edifact', transferEncoding: 'base64',
      body: utf16(e66('UTF16', '2026-09-21', 11)), references: [ref('UTF16')] }))
    add(await composeMail({ key: 'ZIP', from, subject: 'J3 EDIFACT and zip', references: [ref('ZIP')],
      attachments: [attach('E66.edi', e66('ZIP', '2026-09-22', 12)), attach('extra.zip', zipBytes(), 'application/zip')] }))
    add(await composeMail({ key: 'EMPTY', from, subject: 'J3 empty attachment', attachments: [attach('E66.edi', '')], references: [] }))
    add(await composeMail({ key: 'PDF', from, subject: 'J3 only a PDF', attachments: [attach('faktura.pdf', pdfBytes(), 'application/pdf')], references: [] }))
    add(await composeMail({ key: 'LARGE', from, subject: 'J3 month file', references: [ref('LARGE')],
      attachments: [attach('E66_month.edi', septemberMonthE66({ issuer: tenant.issuerEdielId, receiver: tenant.supplierEdielId, meterId: customer.meterId, reference: ref('LARGE') }))] }))
    add(await composeMail({ key: 'SUBADDR', from, subject: 'J3 wrong sub-address', references: [ref('SUBADDR')],
      attachments: [attach('E66.edi', withReceiverSubaddress(e66('SUBADDR', '2026-09-23', 13), tenant.supplierEdielId, 'XX99'))] }))
    add(await composeMail({ key: 'PRODINTEST', from, subject: 'J3 production interchange', references: [ref('PROD')],
      attachments: [attach('E66.edi', productionIndicator(e66('PROD', '2026-09-24', 14)))] }))
    add(await composeMail({ key: 'DUPMSGID', from, subject: 'J3 same mail twice', attachments: [attach('E66.edi', e66('DUPMSG', '2026-09-25', 15))], references: [ref('DUPMSG')] }), from, 2)
    const resend = e66('DUPREF', '2026-09-26', 16)
    add(await composeMail({ key: 'DUPREF1', from, subject: 'J3 same interchange 1', attachments: [attach('E66.edi', resend)], references: [ref('DUPREF')] }))
    add(await composeMail({ key: 'DUPREF2', from, subject: 'J3 same interchange 2', attachments: [attach('E66.edi', resend)], references: [ref('DUPREF')] }))
    add(await composeMail({ key: 'SPOOF', from: 'e2e-intruder@example.invalid', subject: 'J3 spoofed sender', attachments: [attach('E66.edi', e66('SPOOF', '2026-09-27', 17))],
      references: [ref('SPOOF')] }), 'e2e-intruder@example.invalid')
    add(await composeMail({ key: 'CONTRLFIRST', from, subject: 'J3 CONTRL before request', references: [ref('CTRL')],
      attachments: [attach('CONTRL.edi', unsolicitedContrl({ issuer: tenant.issuerEdielId, receiver: tenant.supplierEdielId, reference: ref('CTRL'), acknowledgedReference: ref('NEVERSENT') }))] }))
    add(singlePartMail({ key: 'POISON', from, subject: 'J3 unstorable AI list', contentType: 'text/plain; charset=utf-8', transferEncoding: '7bit',
      body: Buffer.from('AI;not;a;valid;header\r\n', 'utf8'), references: [] }))
    add(await composeMail({ key: 'CONTROL', from, subject: 'J3 control last', attachments: [attach('E66.edi', e66('CONTROL', '2026-09-28', 18))], references: [ref('CONTROL')] }))

    for (const mail of mails) for (let i = 0; i < (mail.sendTimes ?? 1); i += 1) await sendRaw(mail.from, mail)
    report.sent = mails.map(mail => ({ key: mail.key, subject: mail.subject, messageId: mail.messageId, references: mail.references, bytes: mail.raw.length, times: mail.sendTimes }))
    saveReport()
    expect(mails.length).toBeGreaterThan(20)
  })

  it('J3-2 the inbound cron keeps going: every mail settles, the unstorable one after a bounded number of polls', async () => {
    const runs: unknown[] = []
    const deadline = Date.now() + 25 * 60_000
    const ids = mails.map(mail => mail.messageId)
    for (;;) {
      const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
      const outbox = await cron('/api/ediel/outbox/process')
      runs.push({ at: new Date().toISOString(), inbound: inbound.status, outbox: outbox.status,
        fetched: (inbound.body.result as Record<string, unknown> | undefined)?.fetchedMessages ?? null })
      expect(inbound.status, JSON.stringify(inbound.body).slice(0, 500)).toBe(200)
      outcomes = mailOutcomes(ids)
      if (outcomes.every(settled) || Date.now() > deadline) break
      await new Promise(resolve => setTimeout(resolve, 60_000))
    }
    report.receptionRuns = runs
    report.outcomes = outcomes
    report.pollRuns = pollRunsSince(String(report.startedAt))
    report.mailbox = sharedMailboxState()
    saveReport()
    // Nothing is silently lost: every submitted mail has a row (stored, or quarantined after its storage failed).
    expect(outcomes.filter(outcome => outcome.rows.length === 0).map(outcome => outcome.messageId)).toEqual([])
    expect(outcomes.filter(outcome => !settled(outcome)).map(outcome => outcome.messageId)).toEqual([])
    // The mailbox is not left locked or failing.
    expect((report.mailbox as { lockedAt: string | null }).lockedAt).toBeNull()
  }, 30 * 60_000)

  it('J3-3 valid files in unusual shapes are processed once; broken ones are held visibly with nothing applied', async () => {
    const since = String(report.startedAt)
    const originals = inboundOriginals(mails.flatMap(mail => mail.references), since)
    report.originals = originals
    const originalsFor = (reference: string) => originals.filter(row => row.reference === reference)
    const rowOf = (key: string) => outcomeOf(key).rows[0]

    // J3-01: CRLF/BOM files are ordinary files. J3-03: a binary attachment does not drop the EDIFACT one.
    for (const key of ['CRLF', 'BOM', 'ZIP', 'COVER', 'LARGE', 'CONTROL']) {
      expect(originalsFor(byKey(key).references[0]).map(row => row.company), key).toEqual([tenant.companyId])
    }
    expect(rowOf('ZIP').attachments).toBe(2)
    // The valid file sent after every fault was processed: the poller did not stall.
    expect(rowOf('CONTROL').status).not.toBe('received')
    // J3-02: never merged, never acknowledged as one, nothing applied.
    for (const key of ['TWOATT', 'TWOINONE']) {
      expect(rowOf(key), key).toMatchObject({ status: 'manual_review', match: 'multiple_interchanges' })
      for (const reference of byKey(key).references) expect(originalsFor(reference), reference).toEqual([])
    }
    // J3-06: truncated file held on the mail with its reason.
    expect(rowOf('TRUNC')).toMatchObject({ status: 'manual_review', match: 'edifact_unparseable' })
    expect(originalsFor(ref('TRUNC'))).toEqual([])
    // J3-03: wrong encoding is stored and visible as a mail without readable EDIFACT.
    expect(rowOf('UTF16')).toMatchObject({ status: 'manual_review', match: 'missing_payload' })
    for (const key of ['EMPTY', 'PDF']) expect(rowOf(key), key).toMatchObject({ status: 'manual_review', match: 'missing_payload' })
    // J3-04: the unstorable mail is quarantined after the bound, visibly, without content and without a job.
    expect(outcomeOf('POISON').rows).toEqual([expect.objectContaining({ status: 'failed', match: 'storage_dead_lettered', jobs: [] })])
    // Duplicates: the same mail twice is one row; the same interchange in a new mail is one original.
    expect(outcomeOf('DUPMSGID').rows).toHaveLength(1)
    expect(originalsFor(ref('DUPMSG'))).toHaveLength(1)
    expect(outcomeOf('DUPREF1').rows).toHaveLength(1)
    expect(outcomeOf('DUPREF2').rows).toHaveLength(1)
    softCheck('J3-3 duplicate interchange in a new mail', originalsFor(ref('DUPREF')).length === 1, { originals: originalsFor(ref('DUPREF')), second: rowOf('DUPREF2') },
      'The reception kernel classifies a byte-identical interchange in a new mail as protocol_duplicate (held, duplicate response prepared). Not asserted hard: depends on the duplicate-response route of the fixture tenant.')
    // Envelope-broken files: syntax owners exist (missing_unz, unt_count_mismatch); the negative technical CONTRL is the expected answer.
    for (const key of ['NOUNZ', 'UNTCOUNT', 'BADUNA']) {
      softCheck(`J3-3 ${key} negative CONTRL`, originalsFor(byKey(key).references[0]).every(row => row.contrl !== 'positive'),
        { mail: rowOf(key), originals: originalsFor(byKey(key).references[0]) },
        'Ediel requires a negative CONTRL (UCI action 7) for a readable UNB with envelope errors. Read below from the grid owner\'s inbox; the original\'s contrl_status is the platform\'s own view.')
    }
    report.valuesForCustomer = valuesSince(customer.meteringPointId, since)
    saveReport()
  })

  it('J3-4 misaddressed and unauthenticated mail', async () => {
    const since = String(report.startedAt)
    const originals = inboundOriginals([ref('SUBADDR'), ref('PROD'), ref('SPOOF'), ref('CTRL')], since)
    report.misaddressed = { originals, mails: ['SUBADDR', 'PRODINTEST', 'SPOOF', 'CONTRLFIRST'].map(key => ({ key, rows: outcomeOf(key).rows })) }
    softCheck('J3-4 wrong sub-address (J3-09)', originals.filter(row => row.reference === ref('SUBADDR')).length === 0, originals.filter(row => row.reference === ref('SUBADDR')),
      'Expected by Ediel routing: held or rejected when the receiver never configured sub-address XX99. Observed behaviour is recorded; no rule decides it today.')
    softCheck('J3-4 production interchange in the test mailbox (J3-05 reverse)', originals.filter(row => row.reference === ref('PROD')).length === 0, originals.filter(row => row.reference === ref('PROD')),
      'Only test-in-production is held by the fix. Production-in-test is still processed in test; decision needed.')
    softCheck('J3-4 spoofed sender (J3-07)', originals.filter(row => row.reference === ref('SPOOF')).length === 0, originals.filter(row => row.reference === ref('SPOOF')),
      'Expected: a file from a mailbox that is not the grid owner\'s is held. Observed today: processed as the grid owner (no sender check).')
    // A CONTRL for an interchange never sent matches no outbound original: recorded, no transition of anything.
    const contrlFirst = originals.filter(row => row.reference === ref('CTRL'))
    softCheck('J3-4 CONTRL before any request', contrlFirst.length <= 1, { originals: contrlFirst, mail: outcomeOf('CONTRLFIRST').rows },
      'Out of order: the inbound ACK path (inboundAckProcessing, scenario I) must leave it unmatched for review. Recorded, not asserted: the unmatched-ACK disposition vocabulary is owned by the ACK flow.')
    saveReport()
  })

  it('J3-5 acknowledgements reach the grid owner only for what was received intact', async () => {
    const contrl = await contrlReceivedByGridOwner(tenant.gridOwnerEmail)
    report.contrl = contrl
    const ackFor = (reference: string) => contrl.filter(c => c.acknowledged === reference)
    for (const key of ['CRLF', 'BOM', 'ZIP', 'COVER', 'LARGE', 'CONTROL']) {
      softCheck(`J3-5 positive CONTRL ${key}`, ackFor(byKey(key).references[0]).some(c => c.action !== '7'), ackFor(byKey(key).references[0]),
        'Sent by the outbox cron; the fixture tenant\'s technical CONTRL route decides whether one is due (scenario E observed positive CONTRL for every valid E66).')
    }
    // Never a CONTRL for a merged or unparsed interchange.
    for (const reference of [ref('TWOA'), ref('TWOB'), ref('ONEA'), ref('ONEB'), ref('TRUNC')]) expect(ackFor(reference), reference).toEqual([])
    // Exactly one CONTRL per interchange, also for the mail sent twice.
    expect(ackFor(ref('DUPMSG')).length).toBeLessThanOrEqual(1)
    saveReport()
  })

  it('J3-6 IMAP and SMTP outage mid-cycle (needs the world owner to stop/start GreenMail)', async (context: TestContext) => {
    const stop = process.env.REALITY_J3_GREENMAIL_STOP, start = process.env.REALITY_J3_GREENMAIL_START
    if (!stop || !start) {
      report.outage = 'skipped: set REALITY_J3_GREENMAIL_STOP/START, e.g. "docker pause gx-mail" / "docker unpause gx-mail" (pause keeps the in-memory mailboxes; docker stop would erase them). ' +
        'Design: send one valid file, stop GreenMail, run inbound + outbox cron (expect inbound 200 with errors_by_mailbox and ediel_mailboxes.last_error set, the mailbox lock released; ' +
        'outbox CONTRL items fail with a connect error and stay failed - J3-08), start GreenMail, run the crons until the file is processed exactly once.'
      saveReport()
      return context.skip()
    }
    const mail = await composeMail({ key: 'OUTAGE', from: tenant.gridOwnerEmail, subject: 'J3 outage', references: [ref('OUTAGE')],
      attachments: [{ filename: 'E66.edi', content: validE66({ issuer: tenant.issuerEdielId, receiver: tenant.supplierEdielId, meterId: customer.meterId, day: '2026-09-29', reference: ref('OUTAGE') }, 19), contentType: 'application/edifact' }] })
    await sendRaw(tenant.gridOwnerEmail, mail)
    execSync(stop, { stdio: 'inherit', timeout: 120_000 })
    try {
      // The shared mailbox is due every poll_interval_minutes (5): run the crons until a poll hits the outage.
      const runs: unknown[] = []
      const until = Date.now() + 8 * 60_000
      for (;;) {
        const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
        const outbox = await cron('/api/ediel/outbox/process')
        runs.push({ inbound: inbound.status, outbox: outbox.status, body: JSON.stringify(inbound.body).slice(0, 1000), mailbox: sharedMailboxState() })
        // The cron answers (no hang until the platform limit) and records the failure on the mailbox.
        expect(inbound.status).toBe(200)
        if (sharedMailboxState().lastError || Date.now() > until) break
        await new Promise(resolve => setTimeout(resolve, 60_000))
      }
      report.outage = { runs }
      expect(sharedMailboxState().lastError).toBeTruthy()
      expect(sharedMailboxState().lockedAt).toBeNull()
    } finally {
      execSync(start, { stdio: 'inherit', timeout: 300_000 })
    }
    const deadline = Date.now() + 12 * 60_000
    for (;;) {
      await cron('/api/internal/inbound-mail/cron?environment=test')
      await cron('/api/ediel/outbox/process')
      if (inboundOriginals([ref('OUTAGE')], String(report.startedAt)).length > 0 || Date.now() > deadline) break
      await new Promise(resolve => setTimeout(resolve, 60_000))
    }
    expect(inboundOriginals([ref('OUTAGE')], String(report.startedAt))).toHaveLength(1)
    saveReport()
  }, 20 * 60_000)
})
