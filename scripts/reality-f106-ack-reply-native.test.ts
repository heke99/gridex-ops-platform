// reality-defects: F106 (scenario F run 26: the grid owner's APERAK got no CONTRL, "ediel_technical_ack_route_unavailable",
// although the grid owner's technical reply route existed; and the APERAK to its Z04 found no single ediel_ack route)
// Rules exercised (specification only, not coverage tags): ACK-01 (CONTRL on every received EDIFACT except CONTRL),
// ACK-05 (never APERAK on APERAK), TM-ACK.
//
// Native proof on the owned local Supabase with an own synthetic tenant (seedNormalSwitchNativeFixture): a real sent
// Z03, then the grid owner's APERAK and CONTRL through the production intake (processInboundEmailMessage) and the
// canonical runtime (processInboundEdielMessage). The installed reception owner, technical source owner and
// gridex_ediel_technical_ack.select_configured_reply_route_v2 decide. The tenant carries two ediel_ack routes
// (one per application reference, as F92/F98 materialize them) so the APERAK route lookup must choose by reference.
// Helpers are the F105/J1 suites'. Synthetic data only. Run: GRIDEX_J1_ONLY=scripts/reality-f106-ack-reply-native.test.ts
// npx vitest run -c scripts/inbound-prodat-j1-native.config.ts
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRouteContext } from '@/lib/ediel/core/routeRegistry'
import { contrlFor, positiveAperakFor } from './helpers/reality/rejectsWire'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type Row = Record<string, unknown>
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs() })
function configureSmtp() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
}
function ackRoute(f: Fixture, applicationReference: string): string {
  const mail = assertEdielSmtpReadiness(), route = randomUUID(), profile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(f.companyId)},${literal(`Synthetic F106 ACK route ${applicationReference}`)},'ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic F106 ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},${literal(applicationReference)},true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',NULL,NULL,${literal(mail.from)},${literal(mail.host)},${literal(mail.port)});`)
  return route
}
/** A supplier with a sent Z03 and the grid owner's two technical reply routes (PRODAT and UTILTS E66-T). */
async function sentZ03(): Promise<Fixture & { prodatAckRoute: string }> {
  configureSmtp()
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(30),
    provider: (email: string) => { smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' }) } })
  const prodatAckRoute = ackRoute(f, '23-DDQ-PRODAT')
  ackRoute(f, '23-DDQ-E66-T')
  return { ...f, prodatAckRoute }
}
/** One grid-owner file through the production intake, as the inbound-mail cron runs it (same as F105/J1). */
async function receive(f: Fixture, raw: string) {
  const smtpFrom = assertEdielSmtpReadiness().from, mailboxId = randomUUID(), mailId = randomUUID(), receivedAt = new Date().toISOString()
  const rawEmail = `From: recipient@example.invalid\r\nTo: ${smtpFrom}\r\nMessage-ID: <${mailId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${raw}`
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
      VALUES(${literal(mailboxId)},${literal(f.companyId)},'Synthetic F106 mailbox',${literal(smtpFrom)},'test',true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,from_address,to_address,raw_email,raw_edifact_payload,body_text,processing_status,match_status)
      VALUES(${literal(mailId)},${literal(f.companyId)},'test',${literal(mailboxId)},${literal(`${mailId}@example.invalid`)},${literal(receivedAt)}::timestamptz,'recipient@example.invalid',${literal(smtpFrom)},${literal(rawEmail)},${literal(raw)},${literal(raw)},'received','not_checked');`)
  const intake = await processInboundEmailMessage({ inboundEmailMessageId: mailId, actorUserId: f.actorUserId })
    .then(result => ({ status: result.status, error: null as string | null }), (e: Error) => ({ status: 'error', error: e.message }))
  const id = sql<string | null>(`SELECT to_jsonb(id) FROM public.ediel_messages WHERE inbound_email_message_id=${literal(mailId)} AND company_id=${literal(f.companyId)} ORDER BY created_at LIMIT 1`)
  if (!id) throw Error(`intake:${intake.status}:${intake.error}`)
  const error = await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: id }).then(() => null, (e: Error) => e.message)
  return { id, mailId, error: intake.error ?? error }
}
function replyState(f: Fixture, id: string) {
  const c = literal(f.companyId), m = literal(id)
  return sql<Row>(`SELECT jsonb_build_object(
    'family',(SELECT message_family FROM public.ediel_messages WHERE id=${m} AND company_id=${c}),
    'mailboxMessageId',(SELECT mailbox_message_id FROM public.ediel_messages WHERE id=${m} AND company_id=${c}),
    'requiresContrl',(SELECT requires_contrl FROM public.ediel_messages WHERE id=${m} AND company_id=${c}),
    'requiresAperak',(SELECT requires_aperak FROM public.ediel_messages WHERE id=${m} AND company_id=${c}),
    'reception',(SELECT classification FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=${m} AND company_id=${c}),
    'replies',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'route',communication_route_id,'app',application_reference) ORDER BY created_at),'[]')
      FROM public.ediel_messages WHERE related_message_id=${m} AND company_id=${c} AND direction='outbound' AND message_family IN ('CONTRL','APERAK','UTILTS_ERR')),
    'blocked',(SELECT coalesce(jsonb_agg(message ORDER BY created_at),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${m} AND company_id=${c} AND message LIKE '%skapades inte%'),
    'timers',(SELECT coalesce(jsonb_agg(timer_type ORDER BY timer_type),'[]') FROM public.ediel_sla_timers WHERE ediel_message_id=${m} AND company_id=${c}))`)
}

describe('F106 the grid owner\'s APERAK and CONTRL', () => {
  it('answers the APERAK with exactly one CONTRL over the PRODAT reply route, never an APERAK; the CONTRL gets nothing', async () => {
    const f = await sentZ03()
    const aperak = await receive(f, positiveAperakFor(f.originalZ03.raw_payload!))
    const state = replyState(f, aperak.id)
    console.info(JSON.stringify({ label: 'F106 APERAK', error: aperak.error, state }))
    expect(state).toMatchObject({ family: 'APERAK', mailboxMessageId: aperak.mailId, requiresContrl: true, requiresAperak: false,
      reception: 'first_reception', blocked: [], timers: ['contrl_due'] })
    expect(state.replies).toEqual([{ family: 'CONTRL', route: f.prodatAckRoute, app: '23-DDQ-PRODAT' }])

    const contrl = await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    const technical = replyState(f, contrl.id)
    console.info(JSON.stringify({ label: 'F106 CONTRL', error: contrl.error, technical }))
    expect(technical).toMatchObject({ family: 'CONTRL', requiresContrl: false, requiresAperak: false, replies: [], timers: [] })
  }, 400_000)

  it('routes an APERAK reply by the source\'s application reference among the grid owner\'s reply routes', async () => {
    const f = await sentZ03()
    const context = await resolveCanonicalRouteContext({ requestType: 'ediel_ack', companyId: f.companyId, environment: 'test',
      receiverEdielId: f.receiver, applicationReference: '23-DDQ-PRODAT', ackProfile: { family: 'APERAK', code: 'APERAK' } })
    expect(context.route.id).toBe(f.prodatAckRoute)
    expect(context.routeRuntime).toMatchObject({ application_reference: '23-DDQ-PRODAT', communication_route_id: f.prodatAckRoute })
  }, 400_000)
})
