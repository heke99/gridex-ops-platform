// Bounded D-native feedback; no whole-contract coverage tag or market approval.
// Consumption uses the retained declared synthetic L control. D intake uses
// actual mailbox parsing, adapter, processor, ground, effect and ACK owners.
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createProductionReceiptNativeFixture, createConsumptionPrecondition, productionReceiptWire } from './helpers/ediel-z04d-production-native-fixture'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

const smtp = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); smtp.provider.mockReset() })
type Fixture = Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>

function externalTransport() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  return (email: string) => smtp.provider.mockResolvedValue({ accepted: [email], rejected: [], messageId: `synthetic-D-${randomUUID()}`, response: '250 synthetic accepted' })
}

function graph(f: Awaited<ReturnType<typeof createConsumptionPrecondition>>, production?: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'consumption',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),
    'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),
    'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)}),
    'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}),
    'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),
    'productionContract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(production?.productionContractId ?? null)}),
    'productionPoint',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(production?.productionPointId ?? null)}))`)
}

async function source(f: Fixture, options: { omitConsumptionReference?: boolean; consumptionPoint?: string } = {}) {
  const reference = `D${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const wire = productionReceiptWire(f, reference, options)
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire,
    receivedAt: new Date().toISOString(), smtpFrom: assertEdielSmtpReadiness().from })
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed,
    meteringPointMatch: { status: 'matched', entityType: 'metering_point', entityId: f.productionPointId, confidence: 1,
      reasons: ['Synthetic exact own physical production point'], candidates: [{ customer_id: f.customerId, site_id: f.productionSiteId, grid_owner_id: f.gridId }] } })
  // Catalogue birth and all later shared barriers remain strict native failures.
  expect(typeof id, 'actual D adapter must return its original source id').toBe('string')
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id!).single()
  expect(error).toBeNull()
  const original = data as EdielMessageRow
  expect(original).toMatchObject({ raw_payload: wire, rule_profile_key: 'PRODAT:Z04:D:26.A:r3',
    inbound_email_message_id: mail.inboundEmailMessageId, mailbox_message_id: mail.inboundEmailMessageId })
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(original)
  return { ...f, sourceId: id!, reference, wire, decision }
}

function effects(f: Awaited<ReturnType<typeof source>>) {
  return sql<{ periods: { id: string; company: string; customer: string; point: string; process: string; start: string; status: string; ground: string; consumptionPoint: string }[];
    effects: number; partitions: number; transitions: number; normalConfirmations: number;
    acks: { id: string; family: string; wire: string; company: string; route: string; profile: string }[];
    outbox: { message: string; company: string; source: string; status: string; hash: string }[] }>(`SELECT jsonb_build_object(
    'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'customer',customer_id,'point',metering_point_id,'process',source_process,'start',market_start_at,'status',status,'ground',metadata->>'sourceGroundId','consumptionPoint',metadata#>>'{sourceObject,consumptionPoint}')),'[]') FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=${literal(f.sourceId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),
    'normalConfirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id,'profile',route_profile_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',ediel_message_id,'company',company_id,'source',source_message_id,'status',status,'hash',immutable_payload_hash) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}

function noEffects(f: Awaited<ReturnType<typeof source>>) {
  const result = effects(f)
  expect(result).toMatchObject({ periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0 })
  expect(result.acks.some(ack => ack.family === 'APERAK' && ack.wire.includes('ERC+100'))).toBe(false)
  return result
}

it('actual D intake commits a distinct production relation through its reviewed ground and own319, preserving consumption on retry', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  const input = await source(f)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = effects(input)
  expect(first).toMatchObject({ effects: 1, partitions: 1, transitions: 1, normalConfirmations: 0 })
  expect(first.periods).toHaveLength(1)
  expect(first.periods[0]).toMatchObject({ company: f.companyId, customer: f.customerId, point: f.productionPointId,
    process: 'production_receipt_obligation', status: 'confirmed_by_grid_owner', ground: f.authorized.groundId, consumptionPoint: f.external })
  expect(first.periods[0].id).not.toBe(f.periodId)
  expect(Date.parse(first.periods[0].start)).toBe(Date.parse(f.selector.startAt))
  expect(first.acks.map(ack => ack.family)).toEqual(['APERAK', 'CONTRL'])
  expect(first.acks.every(ack => ack.company === f.companyId && ack.route === f.ackRoute && ack.profile === f.ackProfile)).toBe(true)
  expect(first.acks[0].wire).toContain('ERC+100::260')
  expect(first.acks[0].wire).toContain(`RFF+LI:${input.reference}`)
  expect(first.acks[0].wire).toContain(`RFF+Z07:${f.productionExternal}`)
  expect(first.outbox).toHaveLength(2)
  expect(first.outbox.every(item => item.company === f.companyId && item.source === input.sourceId && item.status === 'queued' && /^[a-f0-9]{64}$/.test(item.hash))).toBe(true)
  expect(graph(f, f)).toEqual(before)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  expect(graph(f, f)).toEqual(before)
}, 120000)

it('actual D intake refuses missing required319 without creating production effects or mutating consumption', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  const input = await source(f, { omitConsumptionReference: true })
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  expect(input.decision.syntaxDecision).toBe('accepted')
  expect(input.decision.applicationDecision).not.toBe('accepted')
  expect(input.decision.issues.some(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '319')).toBe(true)
  expect(first.acks.some(ack => ack.family === 'APERAK' && /ERC\+(?:41|42)::260/.test(ack.wire)
    && ack.wire.includes(`RFF+LI:${input.reference}`) && ack.wire.includes(`RFF+Z07:${f.productionExternal}`))).toBe(true)
  expect(graph(f, f)).toEqual(before)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  expect(graph(f, f)).toEqual(before)
}, 120000)

it('actual D intake cannot borrow another customer and company consumption319; both genuine graphs stay unchanged', async () => {
  const provider = externalTransport(), f = await createProductionReceiptNativeFixture(provider)
  // The unchanged normal producer owns a new company each time. This is an
  // explicit cross-company/customer contrast, not isolated same-company proof.
  const other = await createConsumptionPrecondition(provider), before = graph(f, f), otherBefore = graph(other)
  expect(other.companyId).not.toBe(f.companyId)
  expect(other.customerId).not.toBe(f.customerId)
  expect(other.external).not.toBe(f.external)
  const input = await source(f, { consumptionPoint: other.external })
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  // Require the real public ground/application guard to be reached. An earlier
  // catalogue/canonical error cannot earn this correlation assertion.
  const applied = await supabaseService.rpc('ediel_apply_supply_source_v1', { p_company_id: f.companyId,
    p_source_message_id: input.sourceId, p_actor_user_id: f.actorUserId })
  expect(applied.error).toBeNull()
  expect(applied.data).toMatchObject({ applied: false, partition: [expect.objectContaining({ disposition: 'held', reason: 'regulated_supply_authentic_ground_required' })] })
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
}, 120000)

it.each(['raw_payload', 'direction', 'message_received_at'] as const)(
  'actual D original refuses a %s backpatch with its whole row and graphs unchanged', async field => {
    const f = await createProductionReceiptNativeFixture(externalTransport()), beforeGraph = graph(f, f)
    const input = await source(f)
    const before = sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)
    const providerCalls = smtp.provider.mock.calls.length
    const patch = field === 'raw_payload' ? { raw_payload: `${input.wire} ` }
      : field === 'direction' ? { direction: 'outbound' }
        : { message_received_at: new Date(Date.now() + 60000).toISOString() }
    const changed = await supabaseService.from('ediel_messages').update(patch)
      .eq('id', input.sourceId).eq('company_id', f.companyId)
    const expected = field === 'raw_payload' ? 'immutable_ediel_payload_cannot_change'
      : field === 'direction' ? 'immutable_ediel_received_context_cannot_change' : 'immutable_ediel_receipt_time_cannot_change'
    expect(changed.error).toMatchObject({ code: '23514', message: expected })
    expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)).toEqual(before)
    const result = noEffects(input)
    expect(result.acks).toEqual([])
    expect(result.outbox).toEqual([])
    expect(graph(f, f)).toEqual(beforeGraph)
    expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
  }, 120000,
)
