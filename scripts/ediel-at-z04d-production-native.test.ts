// Bounded D-native feedback; no whole-contract coverage tag or market approval.
// Consumption uses the retained declared synthetic L control. D intake uses
// actual mailbox parsing, adapter, processor, ground, effect and ACK owners.
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createProductionReceiptNativeFixture, createConsumptionPrecondition, productionReceiptWire } from './helpers/ediel-z04d-production-native-fixture'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRuntimeDecisionWithRegistry, readReceivedCanonicalProdatResponseValidation } from '@/lib/ediel/core/runtimeDecision'
import { createCanonicalOutboundMessage } from '@/lib/ediel/core/kernel'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { readRegulatedSupplyGroundScope } from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import { supabaseService } from '@/lib/supabase/service'
import { readSourceQualifiedProdatBilateralCapability } from '@/lib/ediel/core/prodatBilateralSourceCapability'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'

const smtp = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); smtp.provider.mockReset() })
type Fixture = Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>


type SourceGuard = { raw: string; direction: string; receipt: string; created: string; document: string | null; context: unknown }
function readSourceGuard(id: string, company: string, wire: string) {
  const snapshot = sql<SourceGuard>(`SELECT jsonb_build_object('raw',raw_payload,'direction',direction,
    'receipt',message_received_at,'created',created_at,'document',message_created_at,'context',execution_context_snapshot)
    FROM public.ediel_messages WHERE id=${literal(id)} AND company_id=${literal(company)}`)
  expect(snapshot).toMatchObject({ raw: wire, direction: 'inbound' })
  expect(snapshot.receipt).not.toBeNull()
  return snapshot
}

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

async function source(f: Fixture, options: NonNullable<Parameters<typeof productionReceiptWire>[2]> = {}) {
  const providerBefore = smtp.provider.mock.calls.length
  const companyPeriodCountBeforeBirth = sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}`)
  expect(companyPeriodCountBeforeBirth).toBe(f.sameCompanyContrast ? 2 : 1)
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
  expect(smtp.provider).toHaveBeenCalledTimes(providerBefore)
  return { ...f, sourceId: id!, reference, wire, decision, original: structuredClone(original),
    sourceGuard: readSourceGuard(id!, f.companyId, wire), providerBefore, companyPeriodCountBeforeBirth }
}

function effects(f: Awaited<ReturnType<typeof source>>) {
  return sql<{ periods: { id: string; company: string; customer: string; point: string; process: string; start: string; status: string; ground: string; consumptionPoint: string }[];
    effects: number; partitions: number; transitions: number; normalConfirmations: number; companyPeriodCount: number;
    acks: { id: string; family: string; wire: string; company: string; route: string; profile: string }[];
    outbox: { message: string; company: string; source: string; status: string; hash: string }[] }>(`SELECT jsonb_build_object(
    'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'customer',customer_id,'point',metering_point_id,'process',source_process,'start',market_start_at,'status',status,'ground',metadata->>'sourceGroundId','consumptionPoint',metadata#>>'{sourceObject,consumptionPoint}')),'[]') FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
    'companyPeriodCount',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=${literal(f.sourceId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),
    'normalConfirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id,'profile',route_profile_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',ediel_message_id,'company',company_id,'source',source_message_id,'status',status,'hash',immutable_payload_hash) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}


function assertSourceGuard(f: Awaited<ReturnType<typeof source>>) {
  expect(readSourceGuard(f.sourceId, f.companyId, f.wire)).toEqual(f.sourceGuard)
  expect(smtp.provider).toHaveBeenCalledTimes(f.providerBefore)
}
function assertOwnedAckOutputs(f: Awaited<ReturnType<typeof source>>, result: ReturnType<typeof effects>) {
  expect(result.outbox.map(item => item.message).sort()).toEqual(result.acks.map(ack => ack.id).sort())
  expect(new Set(result.outbox.map(item => item.message)).size).toBe(result.outbox.length)
  for (const item of result.outbox) {
    const ack = result.acks.find(candidate => candidate.id === item.message)
    expect(ack).toBeDefined()
    expect(item).toMatchObject({ company: f.companyId, source: f.sourceId, status: 'queued',
      hash: createHash('sha256').update(ack!.wire, 'utf8').digest('hex') })
  }
  const source = tokenizeEdifact(f.wire), originalUNB = source.segments.filter(token => token.tag === 'UNB')
  const originalUNH = source.segments.filter(token => token.tag === 'UNH')
  expect(originalUNB).toHaveLength(1)
  expect(originalUNH).toHaveLength(1)
  for (const ack of result.acks.filter(candidate => candidate.family === 'CONTRL')) {
    const physical = tokenizeEdifact(ack.wire), uci = physical.segments.filter(token => token.tag === 'UCI')
    expect(uci).toHaveLength(1)
    expect(segmentComposite(uci[0], 1, physical.una)).toEqual(segmentComposite(originalUNB[0], 5, source.una))
    expect(segmentComposite(uci[0], 2, physical.una)).toEqual(segmentComposite(originalUNB[0], 2, source.una))
    expect(segmentComposite(uci[0], 3, physical.una)).toEqual(segmentComposite(originalUNB[0], 3, source.una))
    // These existing sources all have accepted full syntax, including sources
    // rejected by the separate application owner. The UCI result remains1.
    expect(segmentComposite(uci[0], 4, physical.una)).toEqual(['1'])
    const ucm = physical.segments.filter(token => token.tag === 'UCM')
    expect(ucm.length).toBeLessThanOrEqual(1)
    for (const message of ucm) {
      expect(segmentComposite(message, 1, physical.una)).toEqual(segmentComposite(originalUNH[0], 1, source.una))
      expect(segmentComposite(message, 2, physical.una)).toEqual(segmentComposite(originalUNH[0], 2, source.una))
    }
  }
}

function noEffects(f: Awaited<ReturnType<typeof source>>) {
  assertSourceGuard(f)
  const result = effects(f)
  expect(result).toMatchObject({ periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0 })
  assertOwnedAckOutputs(f, result)
  expect(result.companyPeriodCount).toBe(f.companyPeriodCountBeforeBirth)
  if (!f.sameCompanyContrast) expect(result.companyPeriodCount).toBe(1)
  expect(result.acks.some(ack => ack.family === 'APERAK' && ack.wire.includes('ERC+100'))).toBe(false)
  return result
}

async function assertProductionEffects(f: Fixture) {
  const before = graph(f, f)
  const input = await source(f)
  const productionZ03Count = () => sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND metering_point_id=${literal(f.productionPointId)} AND message_code='Z03'`)
  expect(productionZ03Count()).toBe(0)
  assertSourceGuard(input)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = effects(input)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, first)
  expect(first).toMatchObject({ effects: 1, partitions: 1, transitions: 1, normalConfirmations: 0 })
  expect(first.periods).toHaveLength(1)
  expect(first.companyPeriodCount).toBe(input.companyPeriodCountBeforeBirth + 1)
  if (!f.sameCompanyContrast) expect(first.companyPeriodCount).toBe(2)
  expect(first.periods[0]).toMatchObject({ company: f.companyId, customer: f.customerId, point: f.productionPointId,
    process: 'production_receipt_obligation', status: 'confirmed_by_grid_owner', ground: f.authorized.groundId, consumptionPoint: f.external })
  expect(first.periods[0].id).not.toBe(f.periodId)
  expect(productionZ03Count()).toBe(0)
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
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(productionZ03Count()).toBe(0)
  expect(graph(f, f)).toEqual(before)
  return { input, first }
}

it('actual D intake commits a distinct production relation through its reviewed ground and own319, preserving consumption on retry', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport())
  const { first } = await assertProductionEffects(f)
  expect(first.companyPeriodCount).toBe(2)
}, 120000)

it.each([
  { field: '319', options: { omitConsumptionReference: true } },
  { field: '214', options: { omitConstant: true } },
  { field: '218', options: { omitNumberOfDigits: true } },
  { field: '217', options: { omitMeasurementMethod: true } },
])('actual D intake refuses missing required$field without creating production effects or mutating consumption', async ({ field, options }) => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  const input = await source(f, options)
  if (field === '217') {
    expect(await readSourceQualifiedProdatBilateralCapability(input.original)).not.toBeNull()
    expect(input.decision.policy).toMatchObject({ family: 'PRODAT', code: 'Z04', subtype: 'D' })
  }
  if (field === '214' || field === '218') {
    expect(input.decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
      { meteringPointId: f.productionExternal, identityAgency: '9', meterReadingsSentInUtilts: true },
    ])
    const readings = input.decision.policy?.prodatDependentConditions.filter(condition => ['214', '218', '259'].includes(condition.fieldNumber))
    expect(readings).toHaveLength(3)
    expect(readings?.every(condition => condition.status === 'required')).toBe(true)
    expect(input.decision.issues.some(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
  }
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  expect(input.decision.syntaxDecision).toBe('accepted')
  expect(input.decision.applicationDecision).not.toBe('accepted')
  expect(input.decision.issues.some(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === field)).toBe(true)
  expect(first.acks.filter(ack => ack.family === 'CONTRL')).toHaveLength(1)
  expect(first.acks.some(ack => ack.family === 'APERAK' && /ERC\+(?:41|42)::260/.test(ack.wire)
    && ack.wire.includes(`RFF+LI:${input.reference}`) && ack.wire.includes(`RFF+Z07:${f.productionExternal}`))).toBe(true)
  expect(first.acks.every(ack => ack.company === f.companyId && ack.route === f.ackRoute && ack.profile === f.ackProfile)).toBe(true)
  expect(graph(f, f)).toEqual(before)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
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
  const input = await source(f, { consumptionPoint: other.external }), providerCalls = smtp.provider.mock.calls.length
  const original = () => sql(`SELECT jsonb_build_object('raw',raw_payload,'direction',direction,'receipt',message_received_at,
    'created',created_at,'document',message_created_at,'context',execution_context_snapshot)
    FROM public.ediel_messages WHERE id=${literal(input.sourceId)} AND company_id=${literal(f.companyId)}`)
  const originalBefore = original()
  expect(await readSourceQualifiedProdatBilateralCapability(input.original)).toBeNull()
  expect(input.decision.policy).toMatchObject({ family: 'PRODAT', code: 'Z04', subtype: 'D', semantics: { direction: 'inbound' } })
  expect([input.decision.syntaxDecision, input.decision.applicationDecision, input.decision.functionalDecision])
    .toEqual(['accepted', 'accepted', 'accepted'])
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(original()).toEqual(originalBefore)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
  console.info('D_FOREIGN_SOURCE_OBSERVATION', JSON.stringify({ stage: 'initial_effects_and_both_graphs_preserved' }))
  // Require the real public ground/application guard to be reached. An earlier
  // catalogue/canonical error cannot earn this correlation assertion.
  const applied = await supabaseService.rpc('ediel_apply_supply_source_v1', { p_company_id: f.companyId,
    p_source_message_id: input.sourceId, p_actor_user_id: f.actorUserId })
  const result = applied.data as { applied?: boolean; reason?: string; partition?: { disposition?: string; reason?: string }[] } | null
  const decision = input.decision
  // Whitelist only decision codes and positional scope facts. Original bytes,
  // customer identities, reference values and verifier material stay excluded.
  console.info('D_FOREIGN_SOURCE_DIAGNOSTIC', JSON.stringify({ stage: 'public_apply_returned_before_strict_partition_assertion',
    decisions: [decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision],
    disposition: decision.prodatProcessingDisposition && { kind: decision.prodatProcessingDisposition.kind,
      reasons: decision.prodatProcessingDisposition.reasons.map(reason => ({ code: reason.code, sourceRule: reason.sourceRule })) },
    issues: decision.issues.map(issue => ({ code: issue.code, layer: issue.layer, diagnostic: issue.prodatDiagnostic?.kind === 'field'
      ? { kind: 'field', field: issue.prodatDiagnostic.fieldNumber, errorKind: issue.prodatDiagnostic.errorKind,
        scope: issue.prodatDiagnostic.occurrence.scope, lineIndex: issue.prodatDiagnostic.occurrence.lineIndex,
        registerPosition: issue.prodatDiagnostic.occurrence.registerPosition }
      : issue.prodatDiagnostic && { kind: issue.prodatDiagnostic.kind, sourceRule: issue.prodatDiagnostic.sourceRule } })),
    register: decision.prodatRegisterValidation && { owner: decision.prodatRegisterValidation.owner, coverage: decision.prodatRegisterValidation.coverage,
      objects: decision.prodatRegisterValidation.objects.map((object, index) => ({ index, messageIndex: object.messageIndex,
        disposition: object.disposition, reasons: object.reasons,
        registers: object.registers.map(register => ({ segmentIndex: register.segmentIndex, registerPosition: register.registerPosition })) })) },
    application: decision.prodatApplicationValidation && { owner: decision.prodatApplicationValidation.owner,
      coverage: decision.prodatApplicationValidation.coverage, headerDecision: decision.prodatApplicationValidation.headerDecision,
      objects: decision.prodatApplicationValidation.objects.map((object, index) => ({ index, messageIndex: object.messageIndex,
        applicationDecision: object.applicationDecision, reasonCodes: object.reasonCodes,
        registers: object.registers.map(register => ({ segmentIndex: register.segmentIndex, registerPosition: register.registerPosition })) })) },
    publicApply: { errorCode: applied.error?.code ?? null, applied: result?.applied, reason: result?.reason,
      partition: Array.isArray(result?.partition) ? result.partition.map(own => ({ disposition: own.disposition, reason: own.reason })) : null },
  }))
  expect(applied.error).toBeNull()
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(original()).toEqual(originalBefore)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(original()).toEqual(originalBefore)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
  console.info('D_FOREIGN_SOURCE_OBSERVATION', JSON.stringify({ stage: 'public_apply_and_retry_effects_and_both_graphs_preserved' }))
  // D's ordinary canonical policy may accept while its real source owner
  // refuses the unqualified application/function before any ground partition.
  expect(applied.data).toEqual({ applied: false, reason: 'supply_complete_own_application_and_function_required' })
}, 120000)

it('dated supplier role loss before actual D birth holds its genuine ground without consumption or production effects', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.productionPointId)},${literal(f.selector.startAt)}))`)).toBe(true)
  sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second'
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier'`)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)}
    AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier'
    AND (valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(0)
  const scope = await readRegulatedSupplyGroundScope({ companyId: f.companyId, actorUserId: f.actorUserId, ...f.selector })
  expect(scope.status).toBe('held')
  expect(scope.missing).not.toEqual([])
  const permission = await supabaseService.rpc('gridex_actor_has_company_permission', {
    p_actor_user_id: f.actorUserId, p_company_id: f.companyId, p_permission: 'communication.write',
  })
  expect(permission.error).toBeNull()
  expect(permission.data).toBe(true)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.productionPointId)},${literal(f.selector.startAt)}))`)).toBe(false)
  const input = await source(f), providerCalls = smtp.provider.mock.calls.length
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  expect(graph(f, f)).toEqual(before)
  expect(sql(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(input.sourceId)}`)).toBe(input.wire)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
}, 120000)

it('revoked separate D reviewer permission holds an accepted genuine source with no consumption or production effects', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f), input = await source(f)
  expect([input.decision.syntaxDecision, input.decision.applicationDecision, input.decision.functionalDecision]).toEqual(['accepted', 'accepted', 'accepted'])
  const providerCalls = smtp.provider.mock.calls.length
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)}
    AND company_id=${literal(f.companyId)} AND permission_key='ediel.regulated_supply.review'`)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.productionPointId)},${literal(f.selector.startAt)}))`)).toBe(false)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const first = noEffects(input)
  expect(graph(f, f)).toEqual(before)
  expect(sql(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(input.sourceId)}`)).toBe(input.wire)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
}, 120000)

it('actual D processor rejects a foreign company actor while preserving both genuine graphs and its source', async () => {
  const provider = externalTransport(), f = await createProductionReceiptNativeFixture(provider), other = await createConsumptionPrecondition(provider)
  const before = graph(f, f), otherBefore = graph(other), input = await source(f), providerCalls = smtp.provider.mock.calls.length
  const original = sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)
  expect([input.decision.syntaxDecision, input.decision.applicationDecision, input.decision.functionalDecision]).toEqual(['accepted', 'accepted', 'accepted'])
  expect(other.companyId).not.toBe(f.companyId)
  expect(other.actorUserId).not.toBe(f.actorUserId)
  const permission = await supabaseService.rpc('gridex_actor_has_company_permission', {
    p_actor_user_id: other.actorUserId, p_company_id: f.companyId, p_permission: 'communication.write',
  })
  expect(permission.error).toBeNull()
  expect(permission.data).toBe(false)
  const attempt = async () => {
    const refused = await processInboundEdielMessage({ actorUserId: other.actorUserId, edielMessageId: input.sourceId })
    // The observed public refusal returns its untouched original. Require
    // that exact row, then every durable no-effect oracle below and on retry.
    // An arbitrary result, exception or timeout cannot satisfy this contract.
    expect(refused).toEqual(input.original)
  }
  await attempt()
  const first = noEffects(input)
  expect(first.acks).toEqual([])
  expect(first.outbox).toEqual([])
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)).toEqual(original)
  const denied = await supabaseService.rpc('ediel_apply_supply_source_v1', {
    p_company_id: f.companyId, p_source_message_id: input.sourceId, p_actor_user_id: other.actorUserId,
  })
  expect(denied.error).toBeNull()
  expect(denied.data).toMatchObject({ applied: false, reason: 'supply_execution_actor_unqualified' })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)).toEqual(original)
  await attempt()
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(input.sourceId)}`)).toEqual(original)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
}, 120000)

it('real public outbound owner rejects supplier-originated physical D before any draft, outbox or source effects', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), beforeGraph = graph(f, f)
  const reference = `D${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  // Prospective wire only: switch physical sender/receiver to supplier → DSO.
  // No incoming D original or dependent inventory/acceptance fact is created.
  const raw = productionReceiptWire({ ...f, sender: f.receiver, receiver: f.sender }, reference)
  const counts = () => sql(`SELECT jsonb_build_object(
    'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
    'requests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),
    'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE company_id=${literal(f.companyId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE company_id=${literal(f.companyId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)}))`)
  const before = counts(), providerCalls = smtp.provider.mock.calls.length
  await expect(createCanonicalOutboundMessage({ actorUserId: f.actorUserId, requestType: 'supplier_switch', baseInput: {
    actorUserId: f.actorUserId, companyId: f.companyId, environment: 'test', direction: 'outbound', messageStandard: 'edifact',
    messageFamily: 'PRODAT', messageCode: 'Z04', messageVersion: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', rawPayload: raw,
    senderEdielId: f.sender, receiverEdielId: f.receiver, communicationRouteId: f.routeId, routeProfileId: f.routeProfileId,
  } })).rejects.toThrow('canonical_source_direction_not_allowed:Z04:outbound:inbound')
  expect(counts()).toEqual(before)
  expect(graph(f, f)).toEqual(beforeGraph)
  expect(smtp.provider).toHaveBeenCalledTimes(providerCalls)
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

it('actual healthy D intake preserves unknown reading applicability and holds own effects when original259 is absent', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  const input = await source(f, { omitReadingDeclaration: true }), physical = tokenizeEdifact(input.wire)
  expect(physical.segments.filter(token => token.tag === 'LIN')).toHaveLength(1)
  for (const qualifier of ['Z02', 'Z05']) {
    expect(physical.segments.filter(token => token.tag === 'CCI' && segmentComposite(token, 2, physical.una)[0] === qualifier)).toHaveLength(1)
  }
  expect(physical.segments.filter(token => token.tag === 'CCI' && segmentComposite(token, 2, physical.una)[0] === 'Z16')).toHaveLength(0)
  const capability = await readSourceQualifiedProdatBilateralCapability(input.original)
  expect(capability).toMatchObject({ owner: 'immutable-regulated-supply-ground-v1', subtype: 'D',
    companyId: f.companyId, sourceMessageId: input.sourceId,
    sourcePayloadHash: createHash('sha256').update(input.wire, 'utf8').digest('hex') })
  expect(capability?.objects).toHaveLength(1)
  expect(input.decision.policy).toMatchObject({ family: 'PRODAT', code: 'Z04', subtype: 'D' })
  expect(input.decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
    { meteringPointId: f.productionExternal, identityAgency: '9', meterReadingsSentInUtilts: null },
  ])
  const conditions = input.decision.policy?.prodatDependentConditions.filter(condition => ['214', '218', '259'].includes(condition.fieldNumber))
  expect(conditions).toHaveLength(3)
  expect(conditions?.every(condition => condition.status === 'undetermined')).toBe(true)
  // UNKNOWN is a local observation. Aggregate acceptance does not grant the
  // complete own APP authority required by the real downstream effect owner.
  expect([input.decision.syntaxDecision, input.decision.applicationDecision, input.decision.functionalDecision]).toEqual(['accepted', 'accepted', 'accepted'])
  expect(input.decision.prodatProcessingDisposition?.kind).toBe('continue')
  const unknowns = input.decision.issues.filter(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')
  expect(unknowns).toHaveLength(3)
  expect(unknowns.every(issue => issue.severity === 'warning' && issue.prodatDiagnostic?.kind === 'local_unknown')).toBe(true)
  expect(input.decision.issues.some(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '259')).toBe(false)
  expect(input.decision.prodatRegisterValidation?.objects).toHaveLength(1)
  expect(input.decision.prodatRegisterValidation?.objects[0]).toMatchObject({ disposition: 'unavailable', reasons: ['PRODAT_DEPENDENT_CONDITION_UNDETERMINED'] })
  expect(input.decision.prodatApplicationValidation).toMatchObject({ headerDecision: 'held', objects: [{ applicationDecision: 'held' }] })
  expect(readReceivedCanonicalProdatResponseValidation(input.decision, input.original)).toMatchObject({ objects: [{ outcome: 'held' }], responses: [] })
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const application = await supabaseService.rpc('ediel_read_prodat_application_objects_v1', {
    p_company_id: f.companyId, p_source_message_id: input.sourceId,
  })
  expect(application.error).toBeNull()
  expect(application.data).toMatchObject({ headerDecision: 'held', sourcePayloadHash: capability!.sourcePayloadHash,
    assessmentId: expect.any(String), objects: [{ applicationDecision: 'held', reasonCodes: ['PRODAT_DEPENDENT_CONDITION_UNDETERMINED'] }] })
  const first = noEffects(input)
  expect(first.acks.map(ack => ack.family)).toEqual(['CONTRL'])
  expect(first.acks[0]).toMatchObject({ company: f.companyId, route: f.ackRoute, profile: f.ackProfile })
  expect(first.outbox).toHaveLength(1)
  expect(graph(f, f)).toEqual(before)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
}, 120000)

it('actual D final partition failure rolls back production and preserves consumption before any positive own APERAK', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport()), before = graph(f, f)
  const input = await source(f), constraint = `synthetic_production_partition_${randomUUID().replaceAll('-', '')}`
  sql(`ALTER TABLE gridex_received_sources.supply_object_partitions ADD CONSTRAINT ${constraint} CHECK(source_message_id<>${literal(input.sourceId)}::uuid) NOT VALID`)
  try {
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
    const rollbacks = sql<{ reason: string }[]>(`SELECT coalesce(jsonb_agg(payload),'[]') FROM public.ediel_message_events
      WHERE ediel_message_id=${literal(input.sourceId)} AND payload->>'supplySourceApply'='rolled_back'`)
    expect(rollbacks).toHaveLength(1)
    expect(rollbacks[0].reason).toContain(constraint)
    const first = noEffects(input)
    expect(first.acks.filter(ack => ack.family === 'CONTRL')).toHaveLength(1)
    expect(graph(f, f)).toEqual(before)
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
    expect(effects(input)).toEqual(first)
    assertSourceGuard(input)
    assertOwnedAckOutputs(input, effects(input))
    expect(graph(f, f)).toEqual(before)
  } finally { sql(`ALTER TABLE gridex_received_sources.supply_object_partitions DROP CONSTRAINT ${constraint}`) }
}, 120000)

it('actual D intake cannot borrow another customer consumption319 within the same company and still accepts its own healthy319', async () => {
  const f = await createProductionReceiptNativeFixture(externalTransport(), { sameCompanyContrast: true })
  const other = f.sameCompanyContrast
  expect(other).not.toBeNull()
  if (!other) throw Error('same_company_genuine_consumption_required')
  expect(other.companyId).toBe(f.companyId)
  expect(other.customerId).not.toBe(f.customerId)
  expect(other.pointId).not.toBe(f.pointId)
  expect(other.external).not.toBe(f.external)
  const before = graph(f, f), otherBefore = graph(other)
  const consumptionSources = () => sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.ediel_messages m
    WHERE company_id=${literal(f.companyId)} AND id IN(${[f.originalZ03.id,f.consumptionSourceId,other.originalZ03.id,other.consumptionSourceId].map(literal).join(',')})`)
  const sourcesBefore = consumptionSources()
  const ground = () => sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.productionPointId)},${literal(f.selector.startAt)}::timestamptz))`)
  expect(ground()).toBe(true)
  const input = await source(f, { consumptionPoint: other.external })
  expect(input.companyPeriodCountBeforeBirth).toBe(2)
  expect(await readSourceQualifiedProdatBilateralCapability(input.original)).toBeNull()
  expect(input.decision.policy).toMatchObject({ family: 'PRODAT', code: 'Z04', subtype: 'D', semantics: { direction: 'inbound' } })
  expect([input.decision.syntaxDecision, input.decision.applicationDecision, input.decision.functionalDecision]).toEqual(['accepted', 'accepted', 'accepted'])
  expect(input.decision.prodatApplicationValidation).toMatchObject({ headerDecision: 'held', objects: [{ applicationDecision: 'held' }] })
  expect(readReceivedCanonicalProdatResponseValidation(input.decision, input.original)).toMatchObject({ objects: [{ outcome: 'held' }], responses: [] })
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  const application = await supabaseService.rpc('ediel_read_prodat_application_objects_v1', {
    p_company_id: f.companyId, p_source_message_id: input.sourceId,
  })
  expect(application.error).toBeNull()
  expect(application.data).toMatchObject({ headerDecision: 'held',
    sourcePayloadHash: createHash('sha256').update(input.wire, 'utf8').digest('hex'),
    assessmentId: expect.any(String), objects: [{ applicationDecision: 'held', reasonCodes: ['PRODAT_DEPENDENT_CONDITION_UNDETERMINED'] }] })
  const first = noEffects(input)
  expect(first.acks.map(ack => ack.family)).toEqual(['CONTRL'])
  expect(first.acks.every(ack => ack.company === f.companyId && ack.route === f.ackRoute && ack.profile === f.ackProfile)).toBe(true)
  const applied = await supabaseService.rpc('ediel_apply_supply_source_v1', { p_company_id: f.companyId, p_source_message_id: input.sourceId, p_actor_user_id: f.actorUserId })
  expect(applied.error).toBeNull()
  expect(applied.data).toMatchObject({ applied: false, reason: 'supply_complete_own_application_and_function_required' })
  expect(effects(input)).toEqual(first)
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(consumptionSources()).toEqual(sourcesBefore)
  expect(ground()).toBe(true)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: input.sourceId })
  expect(noEffects(input)).toEqual(first)
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(consumptionSources()).toEqual(sourcesBefore)
  expect(ground()).toBe(true)
  // Same genuine source ground; correct only319 in a fresh prospective original.
  // Healthy processing follows the completed negative/retry proof, so an existing
  // production period cannot confound the customer-isolation contrast.
  const healthy = await assertProductionEffects(f)
  expect(healthy.first.companyPeriodCount).toBe(3)
  expect(effects(input)).toEqual({ ...first, companyPeriodCount: 3 })
  assertSourceGuard(input)
  assertOwnedAckOutputs(input, effects(input))
  expect(graph(f, f)).toEqual(before)
  expect(graph(other)).toEqual(otherBefore)
  expect(consumptionSources()).toEqual(sourcesBefore)
  expect(ground()).toBe(true)
}, 120000)
