// reality-defects: F111
// FINDINGS F111 (scenario F run 28): every inbound PRODAT Z04 from the grid owner got "APERAK skapades inte:
// ediel_ack_atomic_foreign_source_resource" and its aperak_due timer expired; the business APERAK (ACK-02) was never
// sent. The atomic ACK creators (gridex_ediel_ack_replay.create_scope_v2 for PRODAT APERAK, create_v1 for the
// UTILTS/E66 APERAK and UTILTS-ERR) check every inherited source resource with `r.company_id = c`, and in the registry
// model (F41) the grid owner is a platform-shared row (company_id IS NULL). 20261023197000 applies the canonical rule:
// the tenant's own grid owner row, or a shared row that the tenant's own source message names; never another tenant's.
//
// Native proof on the owned local Supabase. A synthetic supplier (seedNormalSwitchNativeFixture) sends a real Z03; its
// grid owner is then the platform-shared registry row (company_id NULL) that the tenant's site names, as in the world.
// The grid owner's CONTRL, APERAK and Z04 go through the production intake and the canonical runtime. The ACK creator's
// exact RPC arguments are observed, then replayed against the installed creator inside ONE transaction that is always
// rolled back: when the installed body still predates F111 the old body is shown to refuse and the migration body is
// applied inside the same transaction, so the world database is never changed. Synthetic data only.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-f111-ack-shared-grid-owner-native.config.ts
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { supabaseService } from '@/lib/supabase/service'
import { contrlFor, positiveAperakFor } from './helpers/reality/rejectsWire'
import { z04For } from './helpers/reality/inboundProdatWire'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type Args = Record<string, unknown>
const SCOPE_RPC = 'ediel_create_outbound_ack_scope_atomic_v2'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261023197000_ediel_ack_shared_grid_owner_resource.sql')
const FIXED_PREDICATE = 'OR ($3 AND r.company_id IS NULL)'

afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
function configureSmtp() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
}
/** psql with room for one rolled-back replay of the ACK creator (nativeSql allows 10 s). */
function txSql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 }).trim()
  return JSON.parse(out) as T
}
/** A supplier with a sent Z03, its generic ACK route, and a grid owner that is the platform-shared registry row. */
async function sentZ03WithSharedGridOwner(): Promise<Fixture> {
  configureSmtp()
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(30),
    provider: (email: string) => { smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' }) } })
  const mail = assertEdielSmtpReadiness(), route = randomUUID(), profile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(f.companyId)},'Synthetic F111 ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic F111 ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',NULL,NULL,${literal(mail.from)},${literal(mail.host)},${literal(mail.port)});
    UPDATE public.grid_owners SET company_id=NULL WHERE id=${literal(f.gridId)};`)
  sharedForTest.push({ gridId: f.gridId, companyId: f.companyId })
  return f
}
// The shared row exists only for this test: it is given back to its synthetic tenant afterwards, so no other native
// suite meets a stray shared "Synthetic normal grid" for area TES (FINDINGS F113 side finding 4).
const sharedForTest: Array<{ gridId: string; companyId: string }> = []
afterAll(() => {
  for (const row of sharedForTest.splice(0)) sql(`UPDATE public.grid_owners SET company_id=${literal(row.companyId)} WHERE id=${literal(row.gridId)} AND company_id IS NULL;`)
})
/** One grid-owner file through the production intake, as the inbound-mail cron runs it (same as J1/F106). */
async function receive(f: Fixture, raw: string) {
  const smtpFrom = assertEdielSmtpReadiness().from, mailboxId = randomUUID(), mailId = randomUUID(), receivedAt = new Date().toISOString()
  const rawEmail = `From: recipient@example.invalid\r\nTo: ${smtpFrom}\r\nMessage-ID: <${mailId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${raw}`
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
      VALUES(${literal(mailboxId)},${literal(f.companyId)},'Synthetic F111 mailbox',${literal(smtpFrom)},'test',true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,from_address,to_address,raw_email,raw_edifact_payload,body_text,processing_status,match_status)
      VALUES(${literal(mailId)},${literal(f.companyId)},'test',${literal(mailboxId)},${literal(`${mailId}@example.invalid`)},${literal(receivedAt)}::timestamptz,'recipient@example.invalid',${literal(smtpFrom)},${literal(rawEmail)},${literal(raw)},${literal(raw)},'received','not_checked');`)
  const intake = await processInboundEmailMessage({ inboundEmailMessageId: mailId, actorUserId: f.actorUserId })
    .then(() => null, (e: Error) => e.message)
  const id = sql<string | null>(`SELECT to_jsonb(id) FROM public.ediel_messages WHERE inbound_email_message_id=${literal(mailId)} AND company_id=${literal(f.companyId)} ORDER BY created_at LIMIT 1`)
  if (!id) throw Error(`intake:${intake}`)
  const error = await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: id }).then(() => null, (e: Error) => e.message)
  return { id, error: intake ?? error }
}
/** The Z04 through the production pipeline while the PRODAT ACK creator's RPC arguments are observed. */
async function receivedZ04(f: Fixture) {
  await receive(f, contrlFor(f.originalZ03.raw_payload!, 'positive'))
  await receive(f, positiveAperakFor(f.originalZ03.raw_payload!))
  const calls: Args[] = [], actual = supabaseService.rpc.bind(supabaseService)
  vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Args) => {
    if (name === SCOPE_RPC) calls.push(args)
    return actual(name as never, args as never)
  }) as never)
  const z04 = await receive(f, z04For(f.originalZ03.raw_payload!, f.receiver, { readings: false }).raw)
  vi.restoreAllMocks()
  const state = sql<{ gridOwner: string | null; gridCompany: string | null; siteGridOwner: string | null; aperaks: number; blocked: string[] }>(`SELECT jsonb_build_object(
    'gridOwner',(SELECT grid_owner_id FROM public.ediel_messages WHERE id=${literal(z04.id)}),
    'gridCompany',(SELECT company_id FROM public.grid_owners WHERE id=${literal(f.gridId)}),
    'siteGridOwner',(SELECT grid_owner_id FROM public.customer_sites WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)}),
    'aperaks',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(z04.id)} AND company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='APERAK'),
    'blocked',(SELECT coalesce(jsonb_agg(message ORDER BY created_at),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${literal(z04.id)} AND company_id=${literal(f.companyId)} AND message LIKE 'APERAK skapades inte%'))`)
  return { z04, calls, state }
}
const installedFixed = () => sql<boolean>(`SELECT to_jsonb(bool_and(position(${literal(FIXED_PREDICATE)} in prosrc)>0)) FROM pg_proc
  WHERE pronamespace='gridex_ediel_ack_replay'::regnamespace AND proname IN('create_v1','create_scope_v2')`)
const migrationBody = () => {
  const block = readFileSync(MIGRATION, 'utf8').match(/do \$f111\$[\s\S]*?\$f111\$;/)?.[0]
  if (!block) throw Error('f111_migration_block_required')
  return block
}
type Replay = { old: { error?: string; ack?: string } | null; fixed: { error?: string; ack?: string }; aperaks: Array<Record<string, unknown>> }
/**
 * Replays the observed ACK creation in one rolled-back transaction: old body (if still installed), then the F111 body.
 * `scope` is the PRODAT creator (public wrapper of create_scope_v2); `v1` is gridex_ediel_ack_replay.create_v1, the
 * creator of the UTILTS/E66 APERAK and UTILTS-ERR (its public wrapper only adds the service_role gate), given the same
 * genuine source and wire with no sequence key.
 */
function replay(f: Fixture, sourceId: string, args: Args, options: { setup?: string; creator?: 'scope' | 'v1' } = {}): Replay {
  const setup = options.setup ?? ''
  const head = `${literal(args.p_company_id)}::uuid,${literal(args.p_environment)},${literal(args.p_source_message_id)}::uuid,${literal(args.p_source_payload_hash)},
    ${literal(args.p_actor_user_id)}::uuid,${literal(args.p_ack_family)}`
  const tail = `${literal(args.p_outcome ?? null)},${literal(args.p_draft)}::jsonb,${literal(args.p_common_smtp ?? null)}::jsonb`
  const call = options.creator === 'v1' ? `gridex_ediel_ack_replay.create_v1(${head},NULL,NULL,${tail})` : `public.${SCOPE_RPC}(${head},${tail})`
  const attempt = (label: string) => `DO $t$ DECLARE r jsonb; BEGIN r:=${call};
    INSERT INTO pg_temp.f111_out VALUES(${literal(label)},jsonb_build_object('ack',r#>>'{ackMessage,id}'));
    EXCEPTION WHEN OTHERS THEN INSERT INTO pg_temp.f111_out VALUES(${literal(label)},jsonb_build_object('error',SQLERRM)); END $t$;`
  const fixed = installedFixed()
  return txSql<Replay>(`BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TEMP TABLE f111_out(k text, v jsonb) ON COMMIT DROP;
${setup}
${fixed ? '' : `${attempt('old')}\n${migrationBody()}`}
${attempt('fixed')}
SELECT jsonb_build_object('old',(SELECT v FROM pg_temp.f111_out WHERE k='old'),'fixed',(SELECT v FROM pg_temp.f111_out WHERE k='fixed'),
  'aperaks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'gridOwner',grid_owner_id,'outcome',ack_outcome,'site',site_id)),'[]')
    FROM public.ediel_messages WHERE related_message_id=${literal(sourceId)} AND company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='APERAK'));
ROLLBACK;`)
}

describe('F111 the APERAK to a Z04 whose grid owner is the platform-shared registry row', () => {
  it('is persisted when the tenant\'s own source names the shared grid owner; another tenant\'s grid owner is still refused', async () => {
    const f = await sentZ03WithSharedGridOwner()
    const { z04, calls, state } = await receivedZ04(f)
    console.info(JSON.stringify({ label: 'F111 pipeline', error: z04.error, state, outcomes: calls.map(c => c.p_outcome) }))
    // The world shape: the tenant's own Z04 and site name the shared registry row.
    expect(state).toMatchObject({ gridOwner: f.gridId, gridCompany: null, siteGridOwner: f.gridId })
    expect(calls.length).toBeGreaterThan(0)
    const args = calls[0]
    expect(args).toMatchObject({ p_company_id: f.companyId, p_source_message_id: z04.id, p_ack_family: 'APERAK', p_outcome: 'positive' })
    if (!installedFixed()) {
      // Old installed body: the production pipeline reproduces F111 exactly.
      expect(state.aperaks).toBe(0)
      expect(state.blocked).toEqual([expect.stringContaining('ediel_ack_atomic_foreign_source_resource')])
    } else {
      expect(state.aperaks).toBe(1)
      expect(state.blocked).toEqual([])
    }

    // Shared grid owner named by the tenant's own source: the APERAK is persisted and keeps the source's link.
    const shared = replay(f, z04.id, args)
    console.info(JSON.stringify({ label: 'F111 shared', shared }))
    if (shared.old) expect(shared.old.error).toBe('ediel_ack_atomic_foreign_source_resource')
    if (state.aperaks === 0) {
      expect(shared.fixed.error).toBeUndefined()
      expect(shared.aperaks).toEqual([{ id: shared.fixed.ack, company: f.companyId, gridOwner: f.gridId, outcome: 'positive', site: expect.any(String) }])
    }

    // The same source naming ANOTHER tenant's grid owner row is still refused as foreign.
    const other = randomUUID()
    const foreignOwner = `INSERT INTO public.companies(id,name,status) VALUES(${literal(other)},'F111 other tenant synthetic','active');
      UPDATE public.grid_owners SET company_id=${literal(other)} WHERE id=${literal(f.gridId)};`
    const foreign = replay(f, z04.id, args, { setup: foreignOwner })
    console.info(JSON.stringify({ label: 'F111 foreign', foreign }))
    if (state.aperaks === 0) {
      expect(foreign.fixed.error).toBe('ediel_ack_atomic_foreign_source_resource')
      expect(foreign.aperaks).toEqual([])
    }

    // The same resource check in create_v1 (UTILTS/E66 APERAK and UTILTS-ERR): shared accepted, foreign refused.
    const v1Shared = replay(f, z04.id, args, { creator: 'v1' }), v1Foreign = replay(f, z04.id, args, { creator: 'v1', setup: foreignOwner })
    console.info(JSON.stringify({ label: 'F111 create_v1', v1Shared, v1Foreign }))
    if (state.aperaks === 0) {
      if (v1Shared.old) expect(v1Shared.old.error).toBe('ediel_ack_atomic_foreign_source_resource')
      expect(v1Shared.fixed.error).toBeUndefined()
      expect(v1Shared.aperaks).toEqual([{ id: v1Shared.fixed.ack, company: f.companyId, gridOwner: f.gridId, outcome: 'positive', site: expect.any(String) }])
      expect(v1Foreign.fixed.error).toBe('ediel_ack_atomic_foreign_source_resource')
      expect(v1Foreign.aperaks).toEqual([])
    }
    // Nothing from either replay is visible afterwards.
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(z04.id)} AND direction='outbound' AND message_family='APERAK'`)).toBe(state.aperaks)
    expect(sql<{ company: string | null }>(`SELECT jsonb_build_object('company',company_id) FROM public.grid_owners WHERE id=${literal(f.gridId)}`)).toEqual({ company: null })
    // The migration body ran only inside the rolled-back transactions.
    expect(installedFixed()).toBe(state.aperaks === 1)
  })
})
