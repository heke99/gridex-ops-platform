import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Real disposable DB, protected original, current authority and worker effects.
// The existing fixture declares synthetic tenant/legal facts; only external
// SMTP is a port. No SQL clock, readiness, source receipt or decision is forged.
const smtp = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'
import { futureNativeSupplyDate, literal, nativeSql as sql, seedNormalSwitchNativeFixture } from './helpers/ediel-normal-switch-native-fixture'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>
type Saved = { original: unknown; intent: unknown; switchOriginal: unknown; ruleBasis: unknown; archives: Array<{ id: string }> }
beforeEach(() => {
  smtp.mockReset()
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EMAIL_PROVIDER: 'resend', EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid',
    EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
})
afterEach(() => vi.unstubAllEnvs())

async function queued() {
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate() })
  const outboxId = sql<string>(`SELECT to_jsonb(id) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(f.originalZ03.id)}`)
  expect(outboxId).toBeTruthy()
  expect(smtp).not.toHaveBeenCalled()
  expect(state(outboxId)).toMatchObject({ status: 'queued' })
  expect(f.originalZ03.canonical_rule_pack_id).toBeTruthy()
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(f.originalZ03.id)}`)).toMatch(/^[a-f0-9]{64}$/)
  const original = saved(f)
  expect(original.intent).not.toBeNull()
  expect(original.switchOriginal).not.toBeNull()
  return { f, outboxId, original }
}
function state(outboxId: string) {
  return sql<Record<string, unknown>>(`SELECT to_jsonb(o) FROM public.ediel_outbox o WHERE id=${literal(outboxId)}`)
}
function saved(f: Fixture): Saved {
  return sql<Saved>(`SELECT jsonb_build_object(
    'original',jsonb_build_object('raw',m.raw_payload,'hash',m.immutable_payload_hash,'rendered',m.immutable_rendered_at,
      'recipient',m.receiver_email,'pack',m.canonical_rule_pack_id,'profile',m.rule_profile_version_id,'version',m.rule_profile_version,'snapshot',m.rule_pack_snapshot),
    'intent',(SELECT jsonb_build_object('id',i.id,'payload',i.payload,'version',i.expected_rule_version,'matrix',i.expected_field_matrix_version) FROM public.ediel_message_intents i WHERE i.ediel_message_id=m.id),
    'switchOriginal',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE o.message_id=m.id),
    'ruleBasis',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE r.source_message_id=m.id),
    'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=m.id))
    FROM public.ediel_messages m WHERE m.id=${literal(f.originalZ03.id)} AND m.company_id=${literal(f.companyId)}`)
}
function expectPreserved(f: Fixture, before: Saved) {
  const after = saved(f)
  // A pre-send archive may append. Existing originals and history never change.
  expect({ ...after, archives: after.archives.filter(row => before.archives.some(old => old.id === row.id)) }).toEqual(before)
}
function expectNoEntry(f: Fixture) {
  expect(smtp).not.toHaveBeenCalled()
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)} AND entered_at IS NOT NULL`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}`)).toBe(0)
}
const run = (f: Fixture, outboxId: string) => sendOutboxItem({ actorUserId: f.actorUserId, outboxItemId: outboxId,
  workerId: `sc064-${randomUUID()}`, smtpMimeMode: 'nodemailer-attachment' })

it('saved qualified intention cannot use its earlier policy after the actual activation is retired', async () => {
  const { f, outboxId, original } = await queued(), packId = f.originalZ03.canonical_rule_pack_id!
  const prior = sql<string>(`SELECT to_jsonb(status) FROM public.ediel_rule_packs WHERE id=${literal(packId)}`)
  expect(prior).toBe('active')
  sql(`UPDATE public.ediel_rule_packs SET status='retired' WHERE id=${literal(packId)}`)
  try {
    const result = await run(f, outboxId)
    expect(['blocked', 'failed']).toContain(result.status)
    expect(result.error).toContain('CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE')
    expect(state(outboxId)).toMatchObject({ status: result.status, last_error: result.error, locked_at: null, locked_by: null })
    expectPreserved(f, original); expectNoEntry(f)
  } finally {
    sql(`UPDATE public.ediel_rule_packs SET status=${literal(prior)} WHERE id=${literal(packId)}`)
  }
}, 120000)

it('current route target drift blocks the actual queued original without retargeting its bytes', async () => {
  const { f, outboxId, original } = await queued()
  sql(`UPDATE public.communication_routes SET target_email='changed@example.invalid' WHERE id=${literal(f.routeId)} AND company_id=${literal(f.companyId)}`)
  expect(await run(f, outboxId)).toMatchObject({ status: 'blocked', error: 'route_receiver_email_mismatch' })
  expect(state(outboxId)).toMatchObject({ status: 'blocked', last_error: 'route_receiver_email_mismatch', locked_at: null, locked_by: null })
  expectPreserved(f, original); expectNoEntry(f)
}, 120000)

it('current tenant entitlement withdrawal stores the real newer refusal before provider entry', async () => {
  const { f, outboxId, original } = await queued()
  expect(await getTenantOperationDecision(f.companyId, 'ediel.test.process')).toMatchObject({ allowed: true })
  sql(`UPDATE public.company_capabilities SET enabled=false WHERE company_id=${literal(f.companyId)} AND capability_code='ediel_test'`)
  const decision = await getTenantOperationDecision(f.companyId, 'ediel.test.process')
  expect(decision).toMatchObject({ allowed: false, reason_code: 'capability_not_ready' })
  expect(await run(f, outboxId)).toMatchObject({ status: 'blocked', error: decision.reason_code })
  expect(state(outboxId)).toMatchObject({ status: 'blocked_tenant_state', blocked_reason: decision.reason_code,
    operation_decision_snapshot: decision, locked_at: null, locked_by: null })
  expectPreserved(f, original); expectNoEntry(f)
}, 120000)

it('unchanged current authority lets the real worker enter once and persist its accepted transport', async () => {
  const { f, outboxId } = await queued()
  smtp.mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' })
  expect(await run(f, outboxId)).toMatchObject({ status: 'sent' })
  expect(smtp).toHaveBeenCalledOnce()
  expect(state(outboxId)).toMatchObject({ status: 'sent', locked_at: null, locked_by: null })
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(f.originalZ03.id)} AND entered_at IS NOT NULL AND observed_at IS NOT NULL`)).toBe(1)
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}`)).toBe(true)
}, 120000)
