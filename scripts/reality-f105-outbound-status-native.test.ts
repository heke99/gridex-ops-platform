// reality-defects: F105 (scenario F run 26: the Z03 outbound request a Z04 confirmed was moved back to 'acknowledged'
// by the grid owner's CONTRL/APERAK processed later by the canonical runtime)
// Rules exercised (specification only, not coverage tags): P-11 ("Sena kvittenser får inte backa ett giltigt
// affärstillstånd"), OPS-02.
//
// Native proof on the owned local Supabase with an own synthetic tenant (seedNormalSwitchNativeFixture): a real sent
// Z03, then the grid owner's Z04 BEFORE its CONTRL/APERAK, all through the production intake (processInboundEmailMessage)
// and the canonical runtime (processInboundEdielMessage). Helpers are the J1 suite's (scripts/inbound-prodat-j1-native.test.ts).
// The only clock fixture moves this tenant's acknowledged_at back past the 24 h Z04 watch deadline.
import { randomUUID } from 'node:crypto'
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
import { contrlFor, positiveAperakFor } from './helpers/reality/rejectsWire'
import { z04For } from './helpers/reality/inboundProdatWire'

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
type OutboundState = { status: string; acknowledgedAt: string | null; ackFamily: string | null; heldEvents: number }
function outboundState(f: Fixture): OutboundState {
  const c = literal(f.companyId), s = literal(f.switchId)
  return sql<OutboundState>(`SELECT jsonb_build_object('status',o.status,'acknowledgedAt',o.acknowledged_at,'ackFamily',o.response_payload->>'inboundAckFamily',
    'heldEvents',(SELECT count(*) FROM public.outbound_dispatch_events e WHERE e.outbound_request_id=o.id AND e.payload ? 'heldStatus'))
    FROM public.outbound_requests o WHERE o.source_id=${s} AND o.company_id=${c} ORDER BY o.created_at DESC LIMIT 1`)
}
const tasks = (f: Fixture) => sql<string[]>(`SELECT coalesce(jsonb_agg(task_type||':'||title),'[]') FROM public.customer_operation_tasks WHERE company_id=${literal(f.companyId)}`)

describe('F105 a Z04 before the grid owner\'s CONTRL/APERAK', () => {
  it('keeps the Z03 outbound request confirmed, records the late ACKs and raises no "Z04-svar saknas" a day later', async () => {
    const f = await sentZ03()
    const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver).raw)
    expect(z04.error).toBeNull()
    const confirmed = outboundState(f)
    expect(confirmed.status).toBe('confirmed')
    await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
    await receive(f, positiveAperakFor(f.originalZ03.raw_payload!))
    const after = outboundState(f)
    console.info(JSON.stringify({ label: 'F105 after late acks', confirmed, after }))
    expect(after.status).toBe('confirmed')
    expect(after.acknowledgedAt).toBe(confirmed.acknowledgedAt)
    // The final technical ACK is recorded on the request although its status stays.
    expect(after.ackFamily === 'CONTRL' || after.ackFamily === 'APERAK').toBe(true)
    expect(after.heldEvents).toBeGreaterThanOrEqual(1)
    // Clock fixture (own tenant only): the 24 h Z04 watch deadline has passed.
    sql(`UPDATE public.outbound_requests SET acknowledged_at=now()-interval '25 hours' WHERE source_id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}`)
    const watch = await createInboundOverdueTasks({ companyId: f.companyId })
    const sw = sql<{ status: string; z04: string | null }>(`SELECT jsonb_build_object('status',status,'z04',inbound_z04_message_id) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)}`)
    console.info(JSON.stringify({ label: 'F105 watch', watch, tasks: tasks(f), switch: sw }))
    // Never the false 24 h "Z04-svar saknas" for a request the grid owner answered with a Z04.
    expect(tasks(f).filter(t => t.startsWith('ediel_z04_overdue:'))).toEqual([])
    if (sw.z04) {
      expect(tasks(f)).toEqual([])
      expect(outboundState(f).status).toBe('confirmed')
    } else {
      // The native owner held the Z04 (no Z04 linked to the switch): J1-01's 30-minute watch still sees the
      // confirmed request, which a late ACK used to move back to 'acknowledged' out of its reach.
      expect(tasks(f)).toEqual(['ediel_z04_unconfirmed:Z04 mottagen men inte verkställd'])
      expect(outboundState(f).status).toBe('waiting_attention')
    }
  }, 400_000)
})
