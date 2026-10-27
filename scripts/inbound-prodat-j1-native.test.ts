// reality-defects: J1-01, J1-02, J1-03, J1-04 (fixed), J1-05, J1-10, J1-11 (scenario J1, scripts/reality/chain-j1-inbound-prodat.test.ts)
// Rules exercised (specification only, not coverage tags): P-11, P-14, ACK-02, ACK-07, TR-05, ENV-04.
//
// Native proofs on the owned local Supabase. A real sent Z03 from the platform's own builder and transport
// (seedNormalSwitchNativeFixture, SMTP provider mocked), then the grid owner's PRODAT files received through the
// PRODUCTION mail intake: the fetched mail row (as the poller stores it), processInboundEmailMessage (parse, tenant,
// matchers, the legacy status writer, original + reception) and processInboundEdielMessage (canonical runtime,
// native supply owner, our own CONTRL/APERAK). Counterparty bytes come from scripts/helpers/reality/inboundProdatWire.ts.
// Nothing is written to market state; the only clock fixture moves an intake timestamp back past a watch deadline.
//
// `it.fails` marks an OPEN defect: the body asserts the expected behaviour and fails today. When the defect is
// fixed the test turns red and must become a plain `it`. Observations go to GRIDEX_J1_LOG (JSON lines).
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { createInboundOverdueTasks } from '@/lib/inbound-mail/inboundOverdueMonitor'
import { getEdielMessageById } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { contrlFor, positiveAperakFor, readReceivedRequest } from './helpers/reality/rejectsWire'
import { shiftDate, z04For, z04cFor, z04ForUnknownSwitch } from './helpers/reality/inboundProdatWire'

function record(label: string, value: unknown) {
  const line = JSON.stringify({ label, value })
  console.info(line)
  if (process.env.GRIDEX_J1_LOG) appendFileSync(process.env.GRIDEX_J1_LOG, line + '\n')
}
type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs() })
function configureSmtp() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
}
/**
 * A supplier with a signed customer whose Z03 the platform built and sent (SMTP 250, provider mocked), plus the
 * tenant's generic ACK route to the grid owner (every go-live has one; scripts/helpers/live-chain-fixture.ts).
 */
async function sentZ03(requestedStartDate = futureNativeSupplyDate(30)): Promise<Fixture> {
  configureSmtp()
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate,
    provider: (email: string) => { smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' }) } })
  const mail = assertEdielSmtpReadiness(), route = randomUUID(), profile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(f.companyId)},'Synthetic J1 ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic J1 ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',NULL,NULL,${literal(mail.from)},${literal(mail.host)},${literal(mail.port)});`)
  return f
}
/**
 * One grid-owner file through the production intake, as the inbound-mail cron runs it: the fetched mail is stored
 * with the poller's own columns (received_at in millisecond precision, as IMAP internalDate/nowIso() give), the
 * inbound-processing job runs processInboundEmailMessage, then the cron runs processInboundEdielMessage.
 */
async function receive(f: Fixture, raw: string) {
  const smtpFrom = assertEdielSmtpReadiness().from, mailboxId = randomUUID(), mailId = randomUUID(), receivedAt = new Date().toISOString()
  const rawEmail = `From: recipient@example.invalid\r\nTo: ${smtpFrom}\r\nMessage-ID: <${mailId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${raw}`
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
      VALUES(${literal(mailboxId)},${literal(f.companyId)},'Synthetic J1 mailbox',${literal(smtpFrom)},'test',true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,from_address,to_address,raw_email,raw_edifact_payload,body_text,processing_status,match_status)
      VALUES(${literal(mailId)},${literal(f.companyId)},'test',${literal(mailboxId)},${literal(`${mailId}@example.invalid`)},${literal(receivedAt)}::timestamptz,'recipient@example.invalid',${literal(smtpFrom)},${literal(rawEmail)},${literal(raw)},${literal(raw)},'received','not_checked');`)
  const intake = await processInboundEmailMessage({ inboundEmailMessageId: mailId, actorUserId: f.actorUserId })
    .then(result => ({ status: result.status, error: null as string | null }), (e: Error) => ({ status: 'error', error: e.message }))
  const id = sql<string | null>(`SELECT to_jsonb(id) FROM public.ediel_messages WHERE inbound_email_message_id=${literal(mailId)} AND company_id=${literal(f.companyId)} ORDER BY created_at LIMIT 1`)
  // A re-delivered identical interchange is held by the reception owner before any Ediel message exists.
  if (!id) return { message: null, mailId, error: `intake:${intake.status}:${intake.error ?? sql<string>(`SELECT to_jsonb(coalesce(match_status,'')) FROM public.inbound_email_messages WHERE id=${literal(mailId)}`)}` }
  const error = await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: id }).then(() => null, (e: Error) => e.message)
  return { message: (await getEdielMessageById(id)) as EdielMessageRow, mailId, error: intake.error ?? error }
}
/** The grid owner's normal answers to our Z03 before its business answer: positive CONTRL and APERAK. */
async function acknowledged(f: Fixture) {
  await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
  await receive(f, positiveAperakFor(f.originalZ03.raw_payload!))
}
type Observed = {
  switch: { status: string; confirmed: string | null; z04: string | null; completed: string | null }
  outbound: { status: string; failure: string | null } | null
  periods: Array<{ status: string; start: string }>
  answers: Array<{ family: string; outcome: string | null; wire: string }>
  hold: string | null; cases: number; caseTypes: string[]; inboundCases: string[]; notices: string[]; tasks: string[]
}
/** What the tenant, its customer, its operators and the grid owner can see after one received file. Read-only. */
function observe(f: Fixture, sourceId: string | null): Observed {
  const c = literal(f.companyId), s = literal(f.switchId), z = literal(sourceId)
  return sql<Observed>(`SELECT jsonb_build_object(
    'switch',(SELECT jsonb_build_object('status',status,'confirmed',confirmed_start_date,'z04',inbound_z04_message_id,'completed',completed_at) FROM public.supplier_switch_requests WHERE id=${s} AND company_id=${c}),
    'outbound',(SELECT jsonb_build_object('status',o.status,'failure',o.failure_reason) FROM public.outbound_requests o WHERE o.source_id=${s} AND o.company_id=${c} ORDER BY o.created_at DESC LIMIT 1),
    'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',status,'start',start_date) ORDER BY created_at),'[]') FROM public.customer_supply_periods WHERE company_id=${c}),
    'answers',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome,'wire',coalesce(substring(raw_payload from 'ERC[^'']*''FTX[^'']*'),'')) ORDER BY message_family),'[]')
      FROM public.ediel_messages WHERE related_message_id=${z} AND company_id=${c} AND direction='outbound'),
    'hold',(SELECT e.payload#>>'{sourceObjectPartition,0,reason}' FROM public.ediel_message_events e WHERE e.ediel_message_id=${z} AND e.payload ? 'sourceObjectPartition' ORDER BY e.created_at DESC LIMIT 1),
    'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${c}),
    'caseTypes',(SELECT coalesce(jsonb_agg(case_type),'[]') FROM public.customer_cases WHERE company_id=${c}),
    'inboundCases',(SELECT coalesce(jsonb_agg(status||':'||case_type),'[]') FROM public.ediel_inbound_cases WHERE ediel_message_id=${z} AND company_id=${c}),
    'notices',(SELECT coalesce(jsonb_agg(payload->>'event_type'),'[]') FROM public.customer_operation_jobs WHERE company_id=${c} AND job_type='dispatch_lifecycle_notification'),
    'tasks',(SELECT coalesce(jsonb_agg(task_type||':'||title),'[]') FROM public.customer_operation_tasks WHERE company_id=${c}))`)
}
const aperakFor = (o: Observed) => o.answers.filter(a => a.family === 'APERAK')
const requestedOf = (f: Fixture) => { const d = readReceivedRequest(f.originalZ03.raw_payload!).startDate; return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` }

describe('J1 Z04 start confirmation through the production intake', () => {
  it('baseline: a Z04 with the requested start confirms the switch, answers CONTRL+APERAK positive and tells the customer', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const o = observe(f, z04.message!.id)
    record('J1 baseline', o)
    expect(z04.error).toBeNull()
    expect(o.switch).toMatchObject({ status: 'accepted', confirmed: requestedOf(f), z04: z04.message!.id })
    expect(o.periods).toEqual([{ status: 'confirmed_by_grid_owner', start: requestedOf(f) }])
    expect(o.answers.map(a => `${a.family}:${a.outcome}`).sort()).toEqual(['APERAK:positive', 'CONTRL:positive'])
    expect(o.notices).toContain('supplier_switch.accepted')
  }, 400_000)

  for (const [label, days] of [['later', 7], ['earlier', -3]] as const) {
    // J1-01 (open): a Z04 confirming another start than requested is held (normal_z04_exact_sent_original_required):
    // the switch stays prepared, no period, and the grid owner gets NO APERAK at all (neither the positive it
    // expects nor a negative 42/210). The legacy intake writer marks the Z03 outbound request 'confirmed'.
    it.fails(`J1-01 a Z04 confirming a ${label} start than requested is answered to the grid owner (APERAK) and the date reaches the switch`, async () => {
      const f = await sentZ03()
      await acknowledged(f)
      const confirmed = shiftDate(requestedOf(f), days)
      const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver, { startDate: confirmed }).raw)
      const o = observe(f, z04.message!.id)
      record(`J1-01 ${label}`, { requested: requestedOf(f), confirmed, ...o })
      // Today: held, silent towards the grid owner, the intake already says 'confirmed'.
      expect.soft(o.hold).toBe('normal_z04_exact_sent_original_required')
      // Expected: the grid owner is answered (a positive APERAK with the confirmed date applied, or a negative
      // APERAK ERC 42/210 that refuses the date), and the switch names the date the grid owner gave.
      expect(aperakFor(o)).toHaveLength(1)
      expect(o.switch.status === 'accepted' ? o.switch.confirmed : o.outbound?.failure ?? '').toContain(o.switch.status === 'accepted' ? confirmed : '210')
    }, 400_000)
  }

  it('J1-01 (partial fix) a held Z04 reaches an operator: the intake-confirmed Z03 without a linked Z04 becomes an overdue task', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver, { startDate: shiftDate(requestedOf(f), 7) }).raw)
    const before = observe(f, z04.message!.id)
    expect(before.outbound?.status).toBe('confirmed')
    // The final positive ACK of the Z03 (acknowledged(), gridex_record_switch_final_ack_v1) makes the switch 'submitted' (T49).
    expect(before.switch).toMatchObject({ status: 'submitted', z04: null })
    // Clock fixture: the 30-minute APERAK watch for the received Z04 has passed (TM-APERAK, ENV-04).
    sql(`UPDATE public.outbound_requests SET acknowledged_at=now()-interval '2 hours' WHERE source_id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}`)
    const first = await createInboundOverdueTasks({ companyId: f.companyId })
    const again = await createInboundOverdueTasks({ companyId: f.companyId })
    const after = observe(f, z04.message!.id)
    record('J1-01 overdue', { first, again, after })
    expect(first.z04Overdue).toBe(1)
    expect(again.z04Overdue).toBe(0)
    expect(after.tasks.filter(t => t.startsWith('ediel_z04_unconfirmed:'))).toHaveLength(1)
    expect(after.outbound?.status).toBe('waiting_attention')
    // Never a business effect from the watch.
    expect(after.switch).toEqual(before.switch)
    expect(after.periods).toEqual([])
  }, 400_000)

  // J1-02 (open): a Z04 for a switch we never requested is held with no APERAK and no operator task.
  it.fails('J1-02 a Z04 for a switch we never sent is answered (negative APERAK) and reaches an operator', async () => {
    const f = await sentZ03()
    const z04 = await receive(f, z04ForUnknownSwitch(f.originalZ03.raw_payload!, f.receiver, {
      facility: '735999000000000017', caseReference: `LI${randomUUID().replaceAll('-', '').toUpperCase()}` }).raw)
    const o = observe(f, z04.message!.id)
    record('J1-02 never-sent', o)
    expect.soft(o.hold).toBe('normal_z04_exact_sent_original_required')
    expect(o.switch.status).toBe('prepared')
    expect(o.periods).toEqual([])
    expect(aperakFor(o).map(a => a.outcome)).toEqual(['negative'])
    expect(o.tasks.length + o.cases).toBeGreaterThan(0)
  }, 400_000)

  it('J1-FP1 a Z04 addressed to tenant A naming tenant B\'s pending switch changes neither tenant', async () => {
    const a = await sentZ03(), b = await sentZ03()
    const bBefore = observe(b, null)
    const own = z04For(b.originalZ03.raw_payload!, b.receiver).raw
    // Tenant B's confirmation, but the interchange and NAD+DO name tenant A (a misrouted or forged file).
    const misrouted = own.replaceAll(`${b.sender}:`, `${a.sender}:`).replaceAll(`+${b.sender}+`, `+${a.sender}+`).replaceAll(b.receiver, a.receiver)
    const z04 = await receive(a, misrouted)
    const oa = observe(a, z04.message?.id ?? null), ob = observe(b, null)
    record('J1-FP1 other tenant', { a: oa, b: ob })
    expect(z04.message?.company_id ?? a.companyId).toBe(a.companyId)
    expect(ob).toEqual(bBefore)
    expect(oa.switch.status).toBe('prepared')
    expect(oa.periods).toEqual([])
  }, 500_000)

  it('J1-FP2 an identical Z04 re-delivered is held at the reception: no second effect, no second answer', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const raw = z04For(f.originalZ03.raw_payload!, f.receiver).raw
    const first = await receive(f, raw)
    const once = observe(f, first.message!.id)
    const again = await receive(f, raw)
    const twice = observe(f, first.message!.id)
    record('J1-FP2 identical', { again: again.error, once, twice })
    expect(again.message).toBeNull()
    expect(twice.switch).toEqual(once.switch)
    expect(twice.periods).toEqual(once.periods)
    expect(twice.answers).toEqual(once.answers)
  }, 400_000)

  // J1-03 (open): the grid owner re-sends its Z04 as a NEW document (new BGM/UNB, same facts) because our APERAK did
  // not arrive. The native owner holds it (normal_z04_locked_original_scope_required) and we never answer: the grid
  // owner keeps waiting for an APERAK. A Z04 after a Z04C, by contrast, gets a positive no-effect APERAK.
  it.fails('J1-03 a re-sent Z04 (new document, same facts) for an accepted switch gets a positive APERAK and no second effect', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const first = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const once = observe(f, first.message!.id)
    const resent = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const o = observe(f, resent.message!.id)
    record('J1-03 resent', { once, resent: o })
    expect(o.switch).toEqual(once.switch)
    expect(o.periods).toEqual(once.periods)
    expect(aperakFor(o).map(a => a.outcome)).toEqual(['positive'])
  }, 400_000)

  it('J1-FP3 a Z04 before the grid owner\'s CONTRL/APERAK confirms the switch; the late ACKs complete the Z03 (P-11)', async () => {
    const f = await sentZ03()
    const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    await acknowledged(f)
    const o = observe(f, z04.message!.id)
    const z03 = sql(`SELECT jsonb_build_object('status',status,'contrl',contrl_status,'aperak',aperak_status) FROM public.ediel_messages WHERE id=${literal(f.originalZ03.id)}`)
    record('J1-FP3 before acks', { o, z03 })
    expect(o.switch.status).toBe('accepted')
    expect(o.periods.map(p => p.status)).toEqual(['confirmed_by_grid_owner'])
    expect(z03).toEqual({ status: 'acknowledged', contrl: 'received', aperak: 'received' })
  }, 400_000)
})

// J1-11 (open, root cause not yet identified): in J1-FP3's order (Z04 first, then the grid owner's CONTRL/APERAK on
// our Z03) our own positive APERAK on the Z04 was later found with related_message_id pointing at the grid owner's
// inbound APERAK instead of the Z04 (same tenant). The Z04's aperak_due watch reads our answers by related_message_id.
it('J1-11 our APERAK on a Z04 that arrived before the grid owner\'s ACKs stays related to that Z04', async () => {
  const f = await sentZ03()
  const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
  const ours = sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(z04.message!.id)} AND company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='APERAK'`)
  await acknowledged(f)
  const after = sql<Array<{ id: string; related: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'related',related_message_id)),'[]') FROM public.ediel_messages WHERE id IN (SELECT jsonb_array_elements_text(${literal(ours)}::jsonb)::uuid)`)
  record('J1-11 aperak relation', { z04: z04.message!.id, ours, after })
  expect(ours).toHaveLength(1)
  expect(after).toEqual([{ id: ours[0], related: z04.message!.id }])
}, 400_000)

describe('J1 grid-owner cancellation (Z04C)', () => {
  // J1-04 (fixed in lib/inbound-mail/inboundStatusUpdater.ts): the legacy intake writer set every matched Z04 to
  // supplier_switch_requests.status 'confirmed' (normalised to 'accepted' by the Z04 trigger once a Z04 is linked):
  // a Z04 after the grid owner's Z04C brought the cancelled switch back to 'accepted' with no supply period.
  it('J1-04 a Z04 after the grid owner\'s Z04C does not bring the cancelled switch back', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const c = await receive(f, z04cFor(f.originalZ03.raw_payload!, f.receiver).raw)
    const cancelled = observe(f, c.message!.id)
    const late = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const o = observe(f, late.message!.id)
    record('J1-04 z04c then z04', { cancelled, late: o })
    expect(cancelled.switch.status).toBe('cancelled_before_start')
    expect(o.switch.status).toBe('cancelled_before_start')
    expect(o.switch.completed).toBe(cancelled.switch.completed)
    expect(o.periods).toEqual([])
  }, 400_000)

  it('J1-04 a confirmed start the grid owner withdraws (Z04 then Z04C) is cancelled and answered positively', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const c = await receive(f, z04cFor(f.originalZ03.raw_payload!, f.receiver).raw)
    const o = observe(f, c.message!.id)
    record('J1-04 z04 then z04c', o)
    expect(o.switch.status).toBe('cancelled_before_start')
    expect(o.periods).toEqual([{ status: 'cancelled', start: requestedOf(f) }])
    expect(aperakFor(o).map(a => a.outcome)).toEqual(['positive'])
  }, 400_000)

  // J1-05 (open): the cancellation reaches neither an operator nor the customer. The customer was told
  // "switch.confirmed" by the Z04 and is never told the start is withdrawn; the contract stays 'signed'.
  it('J1-05 a grid-owner cancellation of a confirmed start opens an operator case and tells the customer', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    const c = await receive(f, z04cFor(f.originalZ03.raw_payload!, f.receiver).raw)
    const o = observe(f, c.message!.id)
    record('J1-05 cancellation follow-up', o)
    expect(o.notices).toContain('supplier_switch.accepted')
    expect(o.cases).toBeGreaterThan(0)
    expect(o.notices.filter(n => n !== 'supplier_switch.accepted').length).toBeGreaterThan(0)
  }, 400_000)
})

describe('J1-10 approved design with production risk (owner decision)', () => {
  // AT-Z04L-SUPPLIER (PASSED) asserts this hold. P26.A field 259: "only if the counter code is given in PRODAT will
  // meter readings be sent in UTILTS" - its absence is a declaration, yet the platform treats it as unknown.
  it('a Z04L without the counter code (field 259) is held: no confirmation and no APERAK', async () => {
    const f = await sentZ03()
    await acknowledged(f)
    const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver, { readings: false }).raw)
    const o = observe(f, z04.message!.id)
    record('J1-10 no counter code', o)
    expect(o.switch.status).toBe('submitted')
    expect(o.periods).toEqual([])
    expect(aperakFor(o)).toEqual([])
    expect(o.outbound?.status).toBe('confirmed')
  }, 400_000)
})
