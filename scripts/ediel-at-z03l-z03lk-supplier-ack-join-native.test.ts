// masterplan-component: AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER
// SOURCE PREPARATION. No whole-ID credit. Native cases require the retained
// producer's current disposable, genuinely admitted prospective L/LK cohorts.
// JSON supplies selectors only; it cannot supply authority/context/acceptance.
// SMTP and counterparty wire are explicitly synthetic external boundaries.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentElementCount, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { Parts } from '../__tests__/fixtures/prodat-register'
import { prodatMarketMinuteToUtc, prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { originalAckPartyIdentities, originalAckLegalNadSegment } from '@/lib/ediel/core/originalAckPartyIdentities'
import { guideOrderedFixtureBody } from '../__tests__/helpers/prodatGuideOrderedFixture'

type Row = Record<string, unknown>
type Variant = 'L' | 'LK'
type Selector = { variant: Variant; companyId: string; actorUserId: string; switchId: string;
  routeId: string; unrelatedSwitchId: string; siblingCompanyId: string }
type Input = { sourceCommit: string; sourceTree: string; inputEpoch: string; cases: Selector[] }
const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function exactKeys(value: unknown, keys: string[]): Row {
  const row = record(value)
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) throw Error('z03_join_selector_keys_required')
  return row
}
function selectorInput(value: unknown): Input {
  const input = exactKeys(value, ['sourceCommit', 'sourceTree', 'inputEpoch', 'cases'])
  if (![input.sourceCommit, input.sourceTree].every(v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v))
    || typeof input.inputEpoch !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(input.inputEpoch)
    || !Array.isArray(input.cases) || input.cases.length !== 2) throw Error('z03_join_source_selectors_required')
  const cases = input.cases.map(value => {
    const row = exactKeys(value, ['variant', 'companyId', 'actorUserId', 'switchId', 'routeId', 'unrelatedSwitchId', 'siblingCompanyId'])
    if (!['L', 'LK'].includes(String(row.variant)) || Object.entries(row).some(([key, v]) => key !== 'variant'
      && (typeof v !== 'string' || !uuid.test(v)))) throw Error('z03_join_cohort_selectors_required')
    return row as Selector
  })
  if (cases.map(r => r.variant).sort().join('|') !== 'L|LK'
    || ['companyId', 'actorUserId', 'switchId', 'routeId'].some(key => new Set(cases.map(r => r[key as keyof Selector])).size !== 2)
    || cases.some(r => r.switchId === r.unrelatedSwitchId || r.companyId === r.siblingCompanyId)
    || cases.some(r => cases.some(other => r.switchId === other.unrelatedSwitchId || r.companyId === other.siblingCompanyId))) {
    throw Error('z03_join_disjoint_l_lk_required')
  }
  return { sourceCommit: input.sourceCommit as string, sourceTree: input.sourceTree as string,
    inputEpoch: input.inputEpoch, cases }
}
function observeOwnWire(raw: string, code: 'Z03' | 'Z04', variant: Variant) {
  const wire = tokenizeEdifact(raw), envelope = EdifactEnvelopeCodec.decode(raw)
  const single = (tag: string, scope = wire.segments, qualifier?: string) => {
    const rows = scope.filter(t => t.tag === tag && (!qualifier || segmentComposite(t, 1, wire.una)[0] === qualifier))
    if (rows.length !== 1) throw Error('z03_join_unique_wire_field_required')
    return rows[0]
  }
  const bgm = single('BGM'), lin = single('LIN'), first = wire.segments.slice(wire.segments.indexOf(lin), wire.segments.indexOf(single('UNT')))
  single('UNH')
  const reasonRows = first.filter(t => t.tag === 'CCI' && segmentComposite(t, 2, wire.una)[0] === 'Z13')
  if (reasonRows.length !== 1) throw Error('z03_join_unique_wire_field_required')
  const cav = first[first.indexOf(reasonRows[0]) + 1], reason = cav?.tag === 'CAV' ? segmentComposite(cav, 1, wire.una)[0] : null
  if (segmentComposite(bgm, 1, wire.una)[0] !== code || reason !== (variant === 'L' ? 'Z22' : 'Z23')
    || envelope.applicationReference !== '23-DDQ-PRODAT' || envelope.environment !== 'test') throw Error('z03_join_variant_wire_required')
  const installation = first.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, wire.una)[0] === 'IT')
  const linId = segmentComposite(lin, 3, wire.una), itId = installation.length === 1 ? segmentComposite(installation[0], 2, wire.una) : []
  if (installation.length > 1 || (linId[0] && itId[0] && linId[0] !== itId[0])) throw Error('z03_join_unique_wire_field_required')
  const point = linId[0] || (code === 'Z03' ? itId[0] : ''), agency = linId[0] ? linId[3] : itId[2]
  const li = segmentComposite(single('RFF', first, 'LI'), 1, wire.una)[1]
  const start = segmentComposite(single('DTM', first, '92'), 1, wire.una)[1]
  const customerIdentity = segmentComposite(single('NAD', first, 'UD'), 2, wire.una)
  const gridArea = segmentComposite(single('RFF', first, 'Z05'), 1, wire.una)[1]
  if (!point || !['9', '89'].includes(agency) || !li || !/^\d{12}$/.test(start) || !customerIdentity[0]
    || !gridArea) throw Error('z03_join_physical_own_tuple_required')
  return { code, reason, point, agency, li, start, customerIdentity, gridArea,
    document: segmentComposite(bgm, 2, wire.una)[0], envelope }
}

const smtp = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send }) } }))

// Dynamic imports keep finite raw/selector checks entirely outside native
// setup. These are the current real ports, never JSON executable adapters.
async function nativePorts() {
  const [fixture, mailbox, db, source, method, processContext, switchFlow, transport, ack, committed,
    match, tenant, birth, reception, inbound, decision, responses, technical, auth, smtpConfig, registry, spec] = await Promise.all([
    import('./helpers/ediel-normal-switch-native-fixture'), import('./helpers/originalMailboxNative'),
    import('@/lib/ediel/db'), import('@/lib/ediel/production/customerMasterdataSource'),
    import('@/lib/ediel/production/contractRequestedMethodSource'), import('@/lib/customer-operations/customerSiteProcessContext'),
    import('@/lib/ediel/flows/prodatSwitch'), import('@/lib/ediel/transport/acceptedProjection'),
    import('@/lib/ediel/ack'), import('@/lib/ediel/ack/committedInboundAck'),
    import('@/lib/inbound-mail/inboundMatcher'), import('@/lib/ediel/tenant/resolveInboundTenant'),
    import('@/lib/inbound-mail/inboundStatusUpdater'), import('@/lib/ediel/inbound/receptions'),
    import('@/lib/ediel/flows/inboundProcessing'), import('@/lib/ediel/core/runtimeDecision'),
    import('@/lib/ediel/inbound/businessAckMessages'), import('@/lib/ediel/ack/technicalSyntaxAuthority'),
    import('@supabase/supabase-js'), import('@/lib/ediel/mailReadiness'),
    import('@/lib/supabase/service'), import('@/lib/ediel/specRegistry'),
  ])
  const outbox = await import('@/lib/ediel/outbox/sendOutboxItem')
  return { ...fixture, ...mailbox, ...db, ...source, ...method, ...processContext, ...switchFlow, ...transport,
    ...ack, ...committed, ...match, ...tenant, ...birth, ...reception, ...inbound, ...decision, ...responses,
    ...technical, ...auth, ...smtpConfig, ...registry, ...spec, ...outbox, sql: fixture.nativeSql }
}
type Ports = Awaited<ReturnType<typeof nativePorts>>
type Cohort = Selector & { customerId: string; siteId: string; pointId: string; contractId: string;
  requestedStartDate: string; external: string; brp: string; customerName: string }

function currentSelectors(variant: Variant): Selector {
  const path = process.env.GRIDEX_NATIVE_Z03_ACK_JOIN_INPUT
  if (!path) throw Error('z03_join_INPUT_HOLD:retained_producer_current_prospective_selectors_required')
  const input = selectorInput(JSON.parse(readFileSync(path, 'utf8')))
  // Bind to the producer's actual selected source union and input epoch, rather
  // than this preparation base. No guessed source-applicability or clock override.
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(input.sourceCommit)
  expect(execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()).toBe(input.sourceTree)
  execFileSync('git', ['ls-files', '--error-unmatch', 'scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts',
    'scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts'], { encoding: 'utf8' })
  execFileSync('git', ['diff', '--exit-code', 'HEAD'], { encoding: 'utf8' })
  expect(process.env.GRIDEX_NATIVE_INPUT_EPOCH).toBe(input.inputEpoch)
  return input.cases.find(row => row.variant === variant)!
}

async function admittedCohort(p: Ports, selected: Selector): Promise<Cohort> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('z03_join_owned_disposable_backend_required')
  const own = p.sql<{ sw: Row; site: Row; point: Row; customer: Row; contract: Row; brp: string; future: boolean }>(`
    SELECT jsonb_build_object('sw',to_jsonb(s),'site',to_jsonb(site),'point',to_jsonb(mp),
      'customer',to_jsonb(c),'contract',to_jsonb(contract),'future',s.requested_start_date>(now() AT TIME ZONE 'Europe/Stockholm')::date,
      'brp',(SELECT brp_ediel_id FROM public.ediel_brp_settings WHERE company_id=s.company_id AND environment='test'))
    FROM public.supplier_switch_requests s JOIN public.customer_sites site ON site.id=s.site_id AND site.company_id=s.company_id
    JOIN public.metering_points mp ON mp.id=s.metering_point_id AND mp.company_id=s.company_id
    JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
    JOIN public.customer_contracts contract ON contract.id=coalesce(s.customer_contract_id,s.contract_id) AND contract.company_id=s.company_id
    WHERE s.company_id=${p.literal(selected.companyId)} AND s.id=${p.literal(selected.switchId)}`)
  expect(own, 'z03_join_INPUT_HOLD:current_owned_prospective_graph_required').toBeTruthy()
  const reason = selected.variant === 'L' ? 'Z22' : 'Z23'
  expect(own.sw).toMatchObject({ id: selected.switchId, company_id: selected.companyId, prodat_variant: selected.variant,
    prodat_reason: reason, request_type: selected.variant === 'L' ? 'switch' : 'move_in',
    outbound_z03_message_id: null, inbound_z04_message_id: null, lifecycle_blocked: false })
  expect(['draft', 'ready', 'ready_for_switch', 'ready_for_z03', 'z03_ready'].includes(String(own.sw.status))).toBe(true)
  expect(own.future).toBe(true)
  expect(own.customer).toMatchObject({ is_test_data: true })
  expect(own.site).toMatchObject({ is_test_data: true, customer_id: own.customer.id })
  expect(own.point).toMatchObject({ is_test_data: true, customer_id: own.customer.id, site_id: own.site.id })
  expect(own.contract).toMatchObject({ customer_id: own.customer.id, metering_point_id: own.point.id,
    requested_start_date: own.sw.requested_start_date })
  expect(['signed', 'active']).toContain(own.contract.status)
  expect(own.contract.signed_at).toEqual(expect.any(String))
  expect(own.contract.signature_snapshot_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(own.contract.document_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(own.brp).toEqual(expect.any(String))
  const f: Cohort = { ...selected, customerId: String(own.customer.id), siteId: String(own.site.id),
    pointId: String(own.point.id), contractId: String(own.contract.id), external: String(own.point.ediel_metering_point_id),
    requestedStartDate: String(own.sw.requested_start_date), brp: own.brp, customerName: String(own.customer.name) }
  const siteProcess = await p.resolveCustomerSiteProcessContext({ companyId: f.companyId, customerId: f.customerId, siteId: f.siteId })
  expect(siteProcess.processType).toBe(f.variant === 'LK' ? 'move_in' : 'supplier_switch_existing_site')
  if (f.variant === 'LK') expect(own.site.move_in_date).toBe(f.requestedStartDate)
  const method = await p.readContractRequestedMethodSource({ companyId: f.companyId, contractId: f.contractId,
    actorUserId: f.actorUserId, environment: 'test' })
  if (method.status === 'held') throw Error(`z03_join_INPUT_HOLD:current_requested_method:${method.missing.join(',')}`)
  p.assertContractRequestedMethodSelection(method, { companyId: f.companyId, contractId: f.contractId,
    customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, environment: 'test' })
  expect(method.pointId).toBe(f.external)
  const masterdata = await p.prepareCustomerMasterdataSource({ companyId: f.companyId, customerId: f.customerId,
    actorUserId: f.actorUserId, environment: 'test' })
  expect(masterdata.customerIdentity.id).toBe(own.customer.org_number || own.customer.personal_number)
  // Actual disposable GoTrue authentication; no caller-supplied JWT/claims,
  // password, grants or accepted user/context seed. No email is sent.
  const existing = await p.supabaseService.auth.admin.getUserById(f.actorUserId)
  expect(existing.error).toBeNull()
  const email = existing.data.user?.email
  if (!email?.endsWith('@example.invalid')) throw Error('z03_join_INPUT_HOLD:disposable_current_actor_required')
  const link = await p.supabaseService.auth.admin.generateLink({ type: 'magiclink', email })
  expect(link.error).toBeNull(); expect(link.data.user?.id).toBe(f.actorUserId)
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anon) throw Error('z03_join_owned_local_anon_required')
  const client = p.createClient('http://127.0.0.1:54321', anon, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const signed = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'email' })
    expect(signed.error).toBeNull(); expect(signed.data.user?.id).toBe(f.actorUserId)
    const current = await client.auth.getUser()
    expect(current.error).toBeNull(); expect(current.data.user?.id).toBe(f.actorUserId)
  } finally { await client.auth.signOut({ scope: 'local' }) }
  return f
}

function exactRows(p: Ports, table: string, company: string, predicate = 'true', order = 'id') {
  // JSON strings, rather than parsed numeric row projections, preserve exact
  // source/control bytes. Table/ordering/predicate are fixed source literals.
  return p.sql<string[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r)::text ORDER BY ${order}),'[]') FROM ${table} r
    WHERE company_id=${p.literal(company)} AND ${predicate}`)
}
function market(p: Ports, f: Cohort) {
  return { customers: exactRows(p, 'public.customers', f.companyId), sites: exactRows(p, 'public.customer_sites', f.companyId),
    points: exactRows(p, 'public.metering_points', f.companyId), contracts: exactRows(p, 'public.customer_contracts', f.companyId),
    periods: exactRows(p, 'public.customer_supply_periods', f.companyId),
    activations: exactRows(p, 'gridex_received_sources.normal_supply_activations', f.companyId, 'true', 'period_id') }
}
function controls(p: Ports, f: Cohort) {
  const ownOther = exactRows(p, 'public.supplier_switch_requests', f.companyId, `id=${p.literal(f.unrelatedSwitchId)}`)
  expect(ownOther, 'z03_join_INPUT_HOLD:nonempty_unrelated_switch_required').toHaveLength(1)
  const otherOriginal = record(JSON.parse(ownOther[0])).outbound_z03_message_id
  expect(otherOriginal, 'z03_join_INPUT_HOLD:unrelated_bound_original_required').toEqual(expect.any(String))
  const original = exactRows(p, 'public.ediel_messages', f.companyId, `id=${p.literal(otherOriginal)}`)
  expect(original).toHaveLength(1)
  const sibling = { customers: exactRows(p, 'public.customers', f.siblingCompanyId),
    switches: exactRows(p, 'public.supplier_switch_requests', f.siblingCompanyId),
    originals: exactRows(p, 'public.ediel_messages', f.siblingCompanyId), market: market(p, { ...f, companyId: f.siblingCompanyId }) }
  expect(sibling.customers.length).toBeGreaterThan(0); expect(sibling.switches.length).toBeGreaterThan(0)
  expect(sibling.originals.length).toBeGreaterThan(0)
  return { ownOther, original, sibling }
}
function sealed(p: Ports, company: string, id: string) {
  return p.sql<string>(`SELECT to_jsonb(jsonb_build_object('id',m.id,'company',m.company_id,'environment',m.environment,
    'raw',m.raw_payload,'hash',m.immutable_payload_hash,'direction',m.direction,'sourceOperation',m.source_operation_id,
    'customer',m.customer_id,'site',m.site_id,'point',m.metering_point_id,'intent',m.intent_id,'request',m.outbound_request_id,
    'canonical',jsonb_build_object('pack',m.canonical_rule_pack_id,'profile',m.rule_profile_version_id,'key',m.rule_profile_key,
      'checksum',m.rule_pack_checksum,'snapshot',m.rule_pack_snapshot),'execution',m.execution_context_snapshot,
    'source',(SELECT to_jsonb(r) FROM gridex_received_sources.sources r WHERE source_message_id=m.id),
    'origin',(SELECT to_jsonb(r) FROM gridex_received_sources.switch_originals r WHERE message_id=m.id))::text)
    FROM public.ediel_messages m WHERE m.id=${p.literal(id)} AND m.company_id=${p.literal(company)}`)
}

async function sendOwn(p: Ports, f: Cohort, message: EdielMessageRow) {
  const outboxes = p.sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o
    WHERE company_id=${p.literal(f.companyId)} AND environment='test' AND ediel_message_id=${p.literal(message.id)}`)
  expect(outboxes).toHaveLength(1)
  expect(outboxes[0]).toMatchObject({ immutable_payload_hash: digest(message.raw_payload!), status: 'queued', sent_at: null })
  const result = await p.sendOutboxItem({ actorUserId: f.actorUserId, outboxItemId: String(outboxes[0].id), smtpMimeMode: 'nodemailer-attachment' })
  expect(result.status, JSON.stringify(result)).toBe('sent')
  const accepted = await p.readAcceptedEdielTransportProjection({ companyId: f.companyId, environment: 'test',
    actorUserId: f.actorUserId, messageId: message.id })
  expect(accepted).toMatchObject({ status: 'accepted_projection', companyId: f.companyId, environment: 'test',
    messageId: message.id, originalHash: digest(message.raw_payload!), lane: 'generic_journal',
    businessExpectationPlan: null, authorizesProviderEntry: false, deliveryProven: false })
  expect(accepted!.providerReceipt.accepted).toEqual([accepted!.frozenRecipient])
  expect(accepted!.providerReceipt.rejected).toEqual([])
  expect(accepted!.providerReceipt.messageId).toBe(result.messageId)
  return accepted!
}

async function physicalReceive(p: Ports, f: Cohort, raw: string) {
  const mailbox = await p.seedOriginalMailboxNative(
    <T = unknown>(statement: string): T => p.nativeSql<T>(`BEGIN;\nSET LOCAL ROLE service_role;\n${statement}\nCOMMIT;`),
    p.literal, { companyId: f.companyId, environment: 'test', raw, smtpFrom: p.edielSmtpConfig().from!, senderEmail: 'recipient@example.invalid' })
  const parsed = mailbox.parsed
  const [outboundMatch, meteringPointMatch] = await Promise.all([
    p.matchOutboundRequestForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
    p.matchMeteringPointForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
  ])
  const tenant = await p.resolveInboundTenantFromIdentifiers({ mailboxCompanyId: f.companyId, mailboxId: mailbox.mailboxId,
    environment: 'test', senderEdielId: parsed.senderEdielId, senderSubaddress: parsed.senderSubAddress,
    receiverEdielId: parsed.receiverEdielId, receiverSubaddress: parsed.receiverSubAddress,
    marketActorEdielId: p.inboundLegalReceiverEdielId(raw, parsed.receiverEdielId), applicationReference: parsed.applicationReference,
    messageFamily: parsed.messageFamily, messageCode: parsed.messageCode, referenceCandidates: Object.values(parsed.references).flat() })
  expect(tenant, 'physical current tenant resolution').toMatchObject({ status: 'resolved', companyId: f.companyId })
  const id = await p.createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId, parsed,
    outboundMatch, meteringPointMatch, tenantResolution: tenant })
  expect(id, 'z03_join_physical_canonical_birth_required').toEqual(expect.any(String))
  const message = (await p.getEdielMessageById(id!, { companyId: f.companyId }))!
  expect(message).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'inbound',
    inbound_email_message_id: mailbox.inboundEmailMessageId, mailbox_message_id: mailbox.inboundEmailMessageId,
    raw_payload: raw, immutable_payload_hash: digest(raw) })
  const custody = await p.readInboundReceptionRequest({ companyId: f.companyId, messageId: message.id,
    inboundEmailMessageId: mailbox.inboundEmailMessageId, actorUserId: f.actorUserId })
  expect(custody).toMatchObject({ companyId: f.companyId, sourceMessageId: message.id, classification: 'first_reception',
    inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId,
    canonicalPayloadHash: digest(raw), receivedPayloadHash: digest(raw), businessEffectAuthorized: false })
  const decision = await p.resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision))
    .toEqual(['accepted', 'accepted', 'accepted'])
  return { message, mailbox, custody }
}

function assertAckWire(raw: string, sourceRaw: string, family: 'CONTRL' | 'APERAK', point: string) {
  const source = tokenizeEdifact(sourceRaw), wire = tokenizeEdifact(raw)
  const envelope = EdifactEnvelopeCodec.decode(sourceRaw), reverse = EdifactEnvelopeCodec.decode(raw)
  expect(reverse).toMatchObject({ sender: envelope.receiver, receiver: envelope.sender, senderSubAddress: envelope.receiverSubAddress,
    receiverSubAddress: envelope.senderSubAddress, environment: 'test', applicationReference: '23-DDQ-PRODAT' })
  const single = (tag: string, qualifier?: string) => {
    const found = wire.segments.filter(s => s.tag === tag && (!qualifier || segmentComposite(s, 1, wire.una)[0] === qualifier))
    expect(found).toHaveLength(1); return found[0]
  }
  expect(segmentComposite(single('UNH'), 2, wire.una)[0]).toBe(family)
  if (family === 'CONTRL') {
    const uci = single('UCI'), unb = source.segments.find(s => s.tag === 'UNB')!
    expect(segmentComposite(uci, 1, wire.una)[0]).toBe(envelope.interchangeReference!.slice(0, 14))
    expect(segmentComposite(uci, 4, wire.una)[0]).toBe('1')
    for (const i of [2, 3]) expect(segmentComposite(uci, i, wire.una)).toEqual(segmentComposite(unb, i, source.una))
    for (const ucm of wire.segments.filter(s => s.tag === 'UCM')) {
      expect(segmentComposite(ucm, 1, wire.una)[0]).toBe(segmentComposite(source.segments.find(s => s.tag === 'UNH')!, 1, source.una)[0])
      expect(segmentComposite(ucm, 3, wire.una)[0]).toBe('1')
    }
  } else {
    const sourceParties = originalAckPartyIdentities({ rawPayload: sourceRaw })
    for (const [role, party] of [['FR', sourceParties.legalReceiver], ['DO', sourceParties.legalSender]] as const)
      expect(segmentComposite(single('NAD', role), 2, wire.una)).toEqual(party.identityComponents)
    expect(wire.segments.filter(t => t.tag === 'ERC').map(t => segmentComposite(t, 1, wire.una))).toEqual([['100', '', '260']])
    const bgm = source.segments.find(s => s.tag === 'BGM')!
    const li = source.segments.find(s => s.tag === 'RFF' && segmentComposite(s, 1, source.una)[0] === 'LI')!
    expect(segmentComposite(single('RFF', 'ACW'), 1, wire.una)).toEqual(['ACW', segmentComposite(bgm, 2, source.una)[0]])
    expect(segmentComposite(single('RFF', 'LI'), 1, wire.una)).toEqual(segmentComposite(li, 1, source.una))
    expect(segmentComposite(single('RFF', 'Z07'), 1, wire.una)).toEqual(['Z07', point])
  }
}

async function ownRequestAck(p: Ports, f: Cohort, original: EdielMessageRow, family: 'CONTRL' | 'APERAK') {
  // A DSO view is only pure raw rendering input. The sealed supplier original
  // is never rewritten, and this view is never passed as a received source.
  const input = { actorUserId: f.actorUserId, sourceMessage: { ...original, direction: 'inbound' as const }, outcome: 'positive' as const }
  const raw = (family === 'CONTRL' ? p.buildContrlDraft(input) : p.buildAperakDraft(input)).rawPayload!
  assertAckWire(raw, original.raw_payload!, family, f.external)
  const received = await physicalReceive(p, f, raw)
  expect(received.message.message_family).toBe(family)
  await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.message.id })
  const message = (await p.getEdielMessageById(received.message.id, { companyId: f.companyId }))!
  const receipt = await p.readCommittedInboundAck({ actorUserId: f.actorUserId, message })
  expect(receipt).toMatchObject({ kind: 'exact_receipt', sourceMessageId: original.id,
    result: { outcome: 'positive', sourceMessage: { id: original.id, company_id: f.companyId, environment: 'test',
      direction: 'outbound', raw_payload: original.raw_payload, immutable_payload_hash: digest(original.raw_payload!) } } })
  expect(p.sql<Row>(`SELECT to_jsonb(c) FROM gridex_ack_authority.source_correlations c
    WHERE ack_message_id=${p.literal(message.id)} AND company_id=${p.literal(f.companyId)}`)).toMatchObject({
    company_id: f.companyId, environment: 'test', source_message_id: original.id, source_payload_hash: digest(original.raw_payload!),
    ack_message_id: message.id, ack_payload_hash: digest(raw), ack_family: family, ack_outcome: 'positive' })
  return { ...received, message, receipt }
}

function externalZ04(f: Pick<Cohort, 'variant' | 'customerName' | 'brp'>, originalRaw: string) {
  const own = observeOwnWire(originalRaw, 'Z03', f.variant), parties = originalAckPartyIdentities({ rawPayload: originalRaw })
  const parts = (raw: string): Parts[] => {
    const wire = tokenizeEdifact(raw)
    return wire.segments.map(s => [s.tag, ...Array.from({ length: segmentElementCount(s, wire.una) }, (_, i) => segmentComposite(s, i + 1, wire.una))])
  }
  const characteristic = (qualifier: string, value: string, position = 0): Parts[] =>
    [['CCI', '', qualifier], ['CAV', [...Array<string>(position).fill(''), value]]]
  const body: Parts[] = [['BGM', 'Z04', randomUUID().replaceAll('-', '').slice(0, 14), '9', 'AB'],
    ['DTM', ['137', prodatNowDate203(), '203']], ['DTM', ['ZZZ', '1', '805']],
    ...parts(originalAckLegalNadSegment('FR', parties.legalReceiver) + "'"),
    ...parts(originalAckLegalNadSegment('DO', parties.legalSender) + "'"),
    ['LIN', '1', '', [own.point, '', '', own.agency]], ['DTM', ['92', own.start, '203']], ['DTM', ['354', '15', '806']],
    ['QTY', ['31', '1000', 'KWH']], ...characteristic('Z13', own.reason), ...characteristic('Z04', 'Z03'),
    ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'Z32'),
    ...characteristic('Z02', '10', 3), ...characteristic('Z05', '8', 3), ...characteristic('Z16', '101', 3),
    ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L917', '8716867000030']],
    ['RFF', ['MG', `SYNTHETIC-${own.point}`]], ['RFF', ['LI', own.li]], ['RFF', ['Z05', own.gridArea]],
    ['NAD', 'UD', own.customerIdentity, '', f.customerName, 'Synthetic DSO road', 'Teststad', '', '12345', 'SE'],
    ['NAD', 'IT', [own.point, '', '9'], '', '', 'Synthetic installation road', 'Teststad', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.brp, '160', 'SVK'], '', '', '', '', '', '', 'SE']]
  const render = (part: Parts) => part.map(v => (typeof v === 'string' ? [v] : v)
    .map(s => s.replace(/[?':+]/g, ch => '?' + ch)).join(':')).join('+')
  const e = own.envelope
  // External synthetic DSO representation; only the actual physical mailbox,
  // canonical birth/current source owners and normal transition can qualify it.
  return EdifactEnvelopeCodec.encode({ sender: e.receiver!, receiver: e.sender!, senderQualifier: e.receiverQualifier,
    receiverQualifier: e.senderQualifier, senderSubAddress: e.receiverSubAddress, receiverSubAddress: e.senderSubAddress,
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test', createdAt: new Date(),
    interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14), messages: [{
      messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: guideOrderedFixtureBody(body).map(render) }] })
}

async function causalZ04(p: Ports, f: Cohort, original: EdielMessageRow) {
  const raw = externalZ04(f, original.raw_payload!), own = observeOwnWire(original.raw_payload!, 'Z03', f.variant)
  const physical = observeOwnWire(raw, 'Z04', f.variant)
  for (const key of ['reason', 'point', 'agency', 'li', 'start', 'customerIdentity', 'gridArea'] as const)
    expect(physical[key], key).toEqual(own[key])
  const before = market(p, f), received = await physicalReceive(p, f, raw)
  expect(received.message).toMatchObject({ message_family: 'PRODAT', message_code: 'Z04', customer_id: f.customerId,
    metering_point_id: f.pointId })
  await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.message.id })
  const confirmed = p.sql<{ proof: Row; period: Row; transition: Row; sw: Row; future: boolean }>(`
    SELECT jsonb_build_object('proof',to_jsonb(c),'period',to_jsonb(period),'transition',to_jsonb(t),'sw',to_jsonb(s),
      'future',c.market_start_at>now()) FROM gridex_received_sources.normal_switch_confirmations c
    JOIN public.customer_supply_periods period ON period.id=c.period_id AND period.company_id=c.company_id
    JOIN public.supplier_switch_requests s ON s.id=c.switch_id AND s.company_id=c.company_id
    JOIN gridex_received_sources.supply_source_transitions t ON t.source_message_id=c.source_message_id AND t.company_id=c.company_id
    WHERE c.company_id=${p.literal(f.companyId)} AND c.source_message_id=${p.literal(received.message.id)} AND c.switch_id=${p.literal(f.switchId)}`)
  expect(confirmed, 'actual canonical consumer must commit the exact same-original confirmation').toBeTruthy()
  expect(confirmed.proof).toMatchObject({ company_id: f.companyId, switch_id: f.switchId, original_message_id: original.id,
    original_payload_hash: digest(original.raw_payload!), source_message_id: received.message.id, contract_id: f.contractId,
    source_object: { point: own.point, li: own.li, start: own.start, reason: own.reason, customerIdentity: own.customerIdentity[0] } })
  expect(confirmed.period).toMatchObject({ company_id: f.companyId, customer_id: f.customerId, metering_point_id: f.pointId,
    contract_id: f.contractId, source_switch_request_id: f.switchId, source_message_id: received.message.id,
    start_date: f.requestedStartDate, status: 'confirmed_by_grid_owner', market_state_version: 1 })
  expect(confirmed.sw).toMatchObject({ status: 'accepted', inbound_z04_message_id: received.message.id,
    confirmed_start_date: f.requestedStartDate, outbound_z03_message_id: original.id, rff_li_reference: own.li })
  expect(confirmed.transition).toMatchObject({ company_id: f.companyId, source_message_id: received.message.id,
    payload_hash: digest(raw), qualified_switch_ids: [f.switchId], source_code: 'Z04', actor_user_id: f.actorUserId })
  expect(confirmed.future).toBe(true)
  expect(Date.parse(String(confirmed.proof.market_start_at))).toBe(Date.parse(prodatMarketMinuteToUtc(own.start)!))
  expect(Date.parse(String(confirmed.period.market_start_at))).toBe(Date.parse(String(confirmed.proof.market_start_at)))
  const after = market(p, f)
  for (const key of ['customers', 'sites', 'points', 'contracts', 'activations'] as const) expect(after[key], key).toEqual(before[key])
  expect(after.periods).toHaveLength(before.periods.length + 1)
  expect(after.periods).toEqual(expect.arrayContaining(before.periods))
  const acks = await p.listBusinessAckMessagesForSource({ companyId: f.companyId, environment: 'test',
    sourceMessageId: received.message.id, actorUserId: f.actorUserId })
  expect(acks.map(m => m.message_family).sort()).toEqual(['APERAK', 'CONTRL'])
  for (const ack of acks) {
    expect(ack).toMatchObject({ direction: 'outbound', company_id: f.companyId, environment: 'test',
      related_message_id: received.message.id, ack_outcome: 'positive', immutable_payload_hash: digest(ack.raw_payload!) })
    assertAckWire(ack.raw_payload!, raw, ack.message_family as 'CONTRL' | 'APERAK', f.external)
    if (ack.message_family === 'CONTRL') {
      const basis = await p.readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'test',
        ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: f.actorUserId, phase: 'read' })
      expect(basis.evidence).toMatchObject({ sourceMessageId: received.message.id, sourceHash: digest(raw), syntaxDecision: 'accepted' })
    } else {
      // Bind the business response's actual immutable owner/facet consumption
      // to this Z04 hash, separately from the request's incoming ACK receipts.
      expect(p.sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM public.ediel_messages m
        JOIN gridex_ediel_outbound_owner.witnesses w ON w.id::text=m.execution_context_snapshot->>'outboundOwnerWitnessId'
        JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=w.id AND c.source_message_id=m.id
        WHERE m.id=${p.literal(ack.id)} AND m.company_id=${p.literal(f.companyId)} AND m.environment='test'
        AND m.direction='outbound' AND m.message_family='APERAK' AND m.related_message_id=${p.literal(received.message.id)}
        AND w.company_id=m.company_id AND w.environment=m.environment AND w.family='APERAK'
        AND w.actor_user_id=${p.literal(f.actorUserId)} AND w.related_message_id=m.related_message_id
        AND w.payload_sha256=${p.literal(digest(ack.raw_payload!))} AND c.payload_sha256=w.payload_sha256
        AND c.company_id=m.company_id AND c.environment=m.environment AND (
          EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_response_owner_bindings b
            JOIN gridex_received_sources.prodat_response_facets r ON r.assessment_id=b.assessment_id
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256 AND b.facet_hash=r.response_facts_hash
            AND r.source_message_id=b.source_message_id AND r.company_id=b.company_id AND r.environment=b.environment
            AND r.source_payload_hash=${p.literal(digest(raw))}
            AND r.response_facts_hash=encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex'))
          OR EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_structural_response_bindings b
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256
            AND b.facet_hash=encode(sha256(convert_to(b.facet_text,'UTF8')),'hex')
            AND b.facet_text::jsonb->>'sourcePayloadHash'=${p.literal(digest(raw))}))))`)).toBe(true)
    }
    await sendOwn(p, f, ack)
  }
  return { ...received, confirmed, acks }
}

describe('native prospective own Z03 L/LK ACK-to-Z04 join', () => {
  it.each(['L', 'LK'] as const)('%s joins its sent original and physical request ACKs to only its own future Z04', async variant => {
    const selected = currentSelectors(variant), p = await nativePorts(), f = await admittedCohort(p, selected)
    smtp.send.mockReset()
    // Transparent external SMTP substitution only. Actual send-owner chooses
    // the recipient, enters the provider and commits its observed acceptance.
    smtp.send.mockImplementation(async (mail: { to: string }) => ({ accepted: [mail.to], rejected: [],
      messageId: `<synthetic-z03-join-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance' }))
    const preservedControls = controls(p, f), before = market(p, f)
    const prepared = await p.prepareAndQueueEdielZ03({ actorUserId: f.actorUserId, switchRequestId: f.switchId,
      communicationRouteId: f.routeId, environment: 'test' })
    const original = (await p.getEdielMessageById(prepared.id, { companyId: f.companyId }))!
    expect(original).toMatchObject({ direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z03',
      company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId,
      switch_request_id: f.switchId, immutable_payload_hash: digest(original.raw_payload!) })
    const own = observeOwnWire(original.raw_payload!, 'Z03', variant)
    expect(own.point).toBe(f.external); expect(own.start.slice(0, 8)).toBe(f.requestedStartDate.replaceAll('-', ''))
    const origin = p.sql<Row>(`SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o
      WHERE message_id=${p.literal(original.id)} AND company_id=${p.literal(f.companyId)} AND switch_id=${p.literal(f.switchId)}`)
    expect(origin).toMatchObject({ message_id: original.id, company_id: f.companyId, switch_id: f.switchId,
      payload_hash: digest(original.raw_payload!), actor_user_id: f.actorUserId, contract_id: f.contractId })
    expect(record(origin.previous_switch)).toMatchObject({ prodat_variant: variant, prodat_reason: variant === 'L' ? 'Z22' : 'Z23',
      outbound_z03_message_id: null })
    const immutable = sealed(p, f.companyId, original.id), accepted = await sendOwn(p, f, original)
    const sent = (await p.getEdielMessageById(original.id, { companyId: f.companyId }))!
    expect(['sent', 'acknowledged']).toContain(sent.status)
    expect(Date.parse(sent.message_sent_at!)).toBe(Date.parse(accepted.observedAt))
    for (const due of [sent.ack_due_at, sent.contrl_due_at])
      expect(Date.parse(due!)).toBe(Date.parse(accepted.observedAt) + p.EDIEL_ACK_DEADLINE_MINUTES * 60000)
    const attempt = p.sql<{ plan: Row; policy: Row; originalHash: string; recipient: string; actor: string; owner: Row }>(`SELECT jsonb_build_object('plan',binding->'technicalExpectationPlan',
      'originalHash',binding->>'originalHash','recipient',binding->>'to','actor',actor_user_id,'owner',owner,
      'policy',jsonb_build_object('guideRevision',binding#>'{admissionDecision,guide,guideRevision}',
        'referenceDate',binding#>'{admissionDecision,referenceDate}','profileKey',binding#>'{admissionDecision,profileKey}',
        'sourceTrace',binding#>'{admissionDecision,sourceTrace}')) FROM gridex_ediel_transport.attempts
      WHERE id=${p.literal(accepted.attemptId)} AND company_id=${p.literal(f.companyId)} AND environment='test'
        AND message_id=${p.literal(original.id)} AND classification='accepted' AND observed_at=${p.literal(accepted.observedAt)}::timestamptz`)
    expect(attempt.plan).toEqual({ version: 1, ruleId: 'TM-CONTRL', offset: p.EDIEL_ACK_DEADLINE_MINUTES, unit: 'minutes',
      anchor: 'actual_accepted_smtp_observed_at', timerKind: 'internal_sender_watch', remoteReceiptKnown: false, policy: attempt.policy })
    expect(attempt.policy).toMatchObject({ guideRevision: expect.any(String), referenceDate: expect.any(String),
      profileKey: expect.any(String), sourceTrace: expect.any(Array) })
    expect(attempt).toMatchObject({ originalHash: digest(original.raw_payload!), recipient: accepted.frozenRecipient,
      actor: f.actorUserId, owner: { kind: 'worker', outboxId: expect.any(String), sendAttemptId: expect.any(String) } })
    expect(market(p, f)).toEqual(before); expect(sealed(p, f.companyId, original.id)).toBe(immutable)
    const contrl = await ownRequestAck(p, f, original, 'CONTRL')
    expect(market(p, f)).toEqual(before)
    let aperak: Awaited<ReturnType<typeof ownRequestAck>>, z04: Awaited<ReturnType<typeof causalZ04>>
    if (variant === 'L') {
      aperak = await ownRequestAck(p, f, original, 'APERAK')
      expect(market(p, f)).toEqual(before)
      z04 = await causalZ04(p, f, original)
    } else {
      // Correct business confirmation is allowed before the full request pair.
      const partial = (await p.getEdielMessageById(original.id, { companyId: f.companyId }))!
      expect(partial.contrl_status).toBe('received'); expect(partial.aperak_status).not.toBe('received')
      z04 = await causalZ04(p, f, original)
      const confirmedMarket = market(p, f)
      aperak = await ownRequestAck(p, f, original, 'APERAK')
      expect(market(p, f)).toEqual(confirmedMarket)
    }
    expect(aperak.receipt).toMatchObject({ kind: 'exact_receipt', sourceMessageId: original.id,
      result: { finalAckReached: true, sourceAccepted: true, wholeSourceRejected: false } })
    expect(await p.getEdielMessageById(original.id, { companyId: f.companyId })).toMatchObject({ contrl_status: 'received', aperak_status: 'received' })
    expect(contrl.message.id).not.toBe(aperak.message.id)
    for (const requestAck of [contrl.message, aperak.message]) {
      expect(requestAck.direction).toBe('inbound')
      expect(z04.acks.some(reply => reply.id === requestAck.id)).toBe(false)
    }
    expect(p.sql<Row>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE company_id=${p.literal(f.companyId)} AND id=${p.literal(f.switchId)}`))
      .toMatchObject({ status: 'accepted', inbound_z04_message_id: z04.message.id, outbound_z03_message_id: original.id,
        prodat_variant: variant, prodat_reason: variant === 'L' ? 'Z22' : 'Z23' })
    expect(sealed(p, f.companyId, original.id)).toBe(immutable)
    expect(controls(p, f)).toEqual(preservedControls)
    const replay = () => ({ market: market(p, f), controls: controls(p, f), original: sealed(p, f.companyId, original.id),
      sources: [contrl.message, aperak.message, z04.message].map(m => sealed(p, f.companyId, m.id)),
      correlations: exactRows(p, 'gridex_ack_authority.source_correlations', f.companyId, 'true', 'ack_message_id'),
      applied: p.sql(`SELECT coalesce(jsonb_agg(to_jsonb(r)::text ORDER BY r.ack_message_id),'[]')
        FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id)
        WHERE c.company_id=${p.literal(f.companyId)}`),
      confirmations: exactRows(p, 'gridex_received_sources.normal_switch_confirmations', f.companyId, 'true', 'period_id'),
      transitions: exactRows(p, 'gridex_received_sources.supply_source_transitions', f.companyId, 'true', 'source_message_id'),
      outboxes: exactRows(p, 'public.ediel_outbox', f.companyId), attempts: exactRows(p, 'gridex_ediel_transport.attempts', f.companyId),
      sends: smtp.send.mock.calls.length })
    const frozen = replay()
    for (const m of [contrl.message, aperak.message, z04.message])
      await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: m.id })
    expect(replay()).toEqual(frozen)
    for (const received of [contrl, aperak, z04]) {
      expect(await p.readInboundReceptionRequest({ companyId: f.companyId, messageId: received.message.id,
        inboundEmailMessageId: received.mailbox.inboundEmailMessageId, actorUserId: f.actorUserId })).toEqual(received.custody)
    }
  })
})

// Finite tests exercise only the selector/raw-wire assertion boundary used by
// the prospective native cases. No backend, source admission or native callback.
describe('finite Z03 join input and raw boundary', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const data = () => ({ sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), inputEpoch: 'disposable-own-epoch',
    cases: (['L', 'LK'] as const).map((variant, i) => ({ variant, companyId: id(i * 10 + 1),
      actorUserId: id(i * 10 + 2), switchId: id(i * 10 + 3), routeId: id(i * 10 + 4),
      unrelatedSwitchId: id(i * 10 + 5), siblingCompanyId: id(i * 10 + 6) })) })
  it('admits only disjoint L/LK data selectors', () => {
    expect(selectorInput(data())).toEqual(data())
  })
  it('refuses authority facts supplied by an input instead of its consumers', () => {
    const value = data()
    expect(() => selectorInput({ ...value, accepted: true })).toThrow('z03_join_selector_keys_required')
    expect(() => selectorInput({ ...value, cases: [{ ...value.cases[0], receivedAckContext: {} }, value.cases[1]] }))
      .toThrow('z03_join_selector_keys_required')
  })
  it('refuses relabelled or overlapping prospective cohort selectors', () => {
    const value = data()
    expect(() => selectorInput({ ...value, cases: [value.cases[0], { ...value.cases[1], variant: 'L' }] }))
      .toThrow('z03_join_disjoint_l_lk_required')
    expect(() => selectorInput({ ...value, cases: [value.cases[0], { ...value.cases[1], switchId: value.cases[0].switchId }] }))
      .toThrow('z03_join_disjoint_l_lk_required')
  })
  const wire = (reason: string) => EdifactEnvelopeCodec.encode({ sender: '40001', receiver: '60001',
    senderQualifier: '14', receiverQualifier: '14', environment: 'test', applicationReference: '23-DDQ-PRODAT',
    interchangeReference: 'OWN-INTERCHANGE', acknowledgementRequest: true, createdAt: new Date('2026-10-13T12:00:00Z'),
    messages: [{ messageReference: 'OWN-MESSAGE', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [
      'BGM+Z03+OWN-DOCUMENT+9+AB', 'NAD+FR+40001::260+++++++SE', 'NAD+DO+60001::260+++++++SE',
      'LIN+1++735123456789012345:::9', 'DTM+92:202610270000:203', `CCI++Z13`, `CAV+${reason}`,
      'RFF+LI:OWN-LI', 'RFF+Z05:TES', 'NAD+UD+199001011234:SE2:260',
    ] }] })
  it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('observes the actual own %s wire identity', (variant, reason) => {
    expect(observeOwnWire(wire(reason), 'Z03', variant)).toMatchObject({ code: 'Z03', reason,
      point: '735123456789012345', agency: '9', li: 'OWN-LI', start: '202610270000',
      customerIdentity: ['199001011234', 'SE2', '260'], gridArea: 'TES', document: 'OWN-DOCUMENT' })
  })
  it('refuses the wrong original subtype and duplicate own LI before causal comparison', () => {
    expect(() => observeOwnWire(wire('Z22'), 'Z03', 'LK')).toThrow('z03_join_variant_wire_required')
    expect(() => observeOwnWire(wire('Z22').replace('RFF+LI:OWN-LI', 'RFF+LI:FOREIGN-LI\'RFF+LI:OWN-LI'), 'Z03', 'L'))
      .toThrow('z03_join_unique_wire_field_required')
  })
  it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('renders only a synthetic external Z04%s representation of the own tuple', (variant, reason) => {
    const raw = externalZ04({ variant, customerName: 'Synthetic Own Customer', brp: '99876' }, wire(reason))
    expect(observeOwnWire(raw, 'Z04', variant)).toMatchObject({ code: 'Z04', reason,
      point: '735123456789012345', agency: '9', li: 'OWN-LI', start: '202610270000',
      customerIdentity: ['199001011234', 'SE2', '260'], gridArea: 'TES',
      envelope: { sender: '60001', receiver: '40001', environment: 'test', applicationReference: '23-DDQ-PRODAT' } })
    const replyWire = tokenizeEdifact(raw)
    for (const [role, party] of [['FR', '60001'], ['DO', '40001']] as const) {
      const nad = replyWire.segments.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, replyWire.una)[0] === role)
      expect(nad).toHaveLength(1); expect(segmentComposite(nad[0], 2, replyWire.una)[0]).toBe(party)
    }
  })
})
