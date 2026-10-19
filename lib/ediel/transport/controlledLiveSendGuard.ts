// OPS-04 controlled live send guard (server-side enforcement).
//
// The explicit runbook entry point `sendControlledLiveEdielMessage`
// (lib/ediel/orchestrator.ts) is the ONLY way to send on a controlled route.
// The caller supplies identifiers (message id, incident id, actor) and the
// plan only; every approval/evidence fact is read here, server-side, scoped to
// the message's own company + environment. The entry point mints a frozen
// `ControlledLiveBinding` (TOCTOU snapshot + selection) that the send path
// carries; a binding not minted by `issueControlledLiveBinding` is refused.
//
// Activation is decided by the server, not by the caller. For every routed
// outbound send the preflight performs one scoped read (CONTROLLED_FLOW_PROBE_RPC).
// A selected controlled send repeats the current check at the final provider
// gate, after all existing journal entry awaits, before atomic consumption.
// The flow is controlled when that route (or the stored message's route) has a
// current, unrevoked counterparty agreement, or when the message already
// consumed an OPS-04 authorisation.
//
//   probe controlled + binding   -> full fail-closed evaluation, then single-use
//                                   consumption of the agreement/mandate
//   probe controlled, no binding -> refused (entry point required)
//   binding/marker, not controlled -> refused (never self-activates)
//   neither                      -> normal send, unchanged
//
// A legacy `ops04ControlledLiveFlow` payload marker never selects or approves
// anything; it is only refused when the server has no binding for it.
// A send without communication_route_id makes no OPS-04 read. A declared
// marker or binding without a route is refused without I/O.
// Preflight refuses missing, foreign or malformed inputs before wire-reference
// reservation. Later authority changes are rechecked after journal entry; a
// refusal then preserves entered uncertainty and never reaches SMTP.

import { z } from 'zod'
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import { readFreshEdielBusinessIncident } from '@/lib/ediel/incidents/freshBusinessIncident'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { evaluateControlledLiveReadiness, type ControlledLiveInput, type LiveEnvironment } from './controlledLiveReadiness'
import { evaluateRelayTrace } from './relayTrace'

export const CONTROLLED_LIVE_FLOW_KEY = 'ops04ControlledLiveFlow'
export const CONTROLLED_LIVE_REFUSED = 'ediel_ops04_controlled_live_refused'
/** Server-side activation probe (one scoped read per routed send). */
export const CONTROLLED_FLOW_PROBE_RPC = 'gridex_ediel_ops04_controlled_flow_probe_v1'
/** Native read for the correction, agreement, mandate and relay capture. */
export const CONTROLLED_LIVE_EVIDENCE_RPC = 'gridex_ediel_ops04_controlled_live_evidence_v1'
/** Atomic single-use consumption of the agreement (and LIVE mandate). */
export const CONTROLLED_LIVE_CONSUME_RPC = 'gridex_ediel_ops04_consume_controlled_live_v1'

const env = z.enum(['test', 'production'])
const isoDate = z.string().refine((v) => Number.isFinite(Date.parse(v)))

const flowMarker = z.object({
  schema: z.literal('gridex_ops04_controlled_flow_v1'),
  incidentId: z.string().uuid(),
  references: z.array(z.string()).max(1000),
  source: z.enum(['single_controlled', 'bulk_import']),
  resend: z.object({ incidentId: z.string().nullable(), diagnosis: z.string().nullable() }).strict().nullable(),
}).strict()

/** Caller-supplied selection: identifiers and the plan only, never approvals. */
export const controlledLiveSelection = z.object({
  incidentId: z.string().uuid(),
  plan: z.object({
    references: z.array(z.string()).max(1000),
    source: z.enum(['single_controlled', 'bulk_import']),
    resend: z.object({ incidentId: z.string().nullable(), diagnosis: z.string().nullable() }).strict().nullable(),
  }).strict(),
}).strict()
export type ControlledLiveSelection = z.infer<typeof controlledLiveSelection>

/** TOCTOU snapshot minted by the entry point and carried through the send path. */
export type ControlledLiveBinding = {
  readonly messageSnapshot: string
  readonly routeProfileSnapshot: string
  readonly certificateId: string
  readonly certificateFingerprint: string
  readonly selection: Readonly<ControlledLiveSelection>
  readonly evidenceSnapshot: Readonly<{
    agreementId: string | null
    mandateId: string | null
    correctionRef: string | null
    relayEvidenceRef: string | null
    relayHeadersHash: string | null
  }>
}

const probeResult = z.object({ companyId: z.string().min(1), environment: env, messageId: z.string().min(1), controlled: z.boolean() }).strict()

const scoped = { companyId: z.string().min(1), environment: env }
const nativeEvidence = z.object({
  companyId: z.string().min(1),
  environment: env,
  incidentId: z.string().uuid(),
  routeProfileId: z.string().min(1),
  incidentCorrection: z.object({ ...scoped, incidentId: z.string().uuid(), correctionRef: z.string().min(1) }).strict().nullable(),
  counterpartyAgreement: z.object({ id: z.string().uuid(), ...scoped, ref: z.string().min(1), counterpartyId: z.string().min(1), routeId: z.string().min(1),
    validFrom: isoDate, validTo: isoDate, consumedByMessageId: z.string().nullable() }).strict().nullable(),
  liveMandate: z.object({ id: z.string().uuid(), ...scoped, ref: z.string().min(1), incidentId: z.string().uuid(), consumedByMessageId: z.string().nullable() }).strict().nullable(),
  // Raw captured headers only: a stored "verified" flag is never trusted.
  relayCapture: z.object({ ...scoped, evidenceRef: z.string().min(1), routeId: z.string().min(1), rawHeaders: z.string().min(1) }).strict().nullable(),
}).strict()

const consumption = z.object({ consumptionId: z.string().uuid(), companyId: z.string().min(1), environment: env, messageId: z.string().min(1),
  agreementId: z.string().uuid(), mandateId: z.string().uuid().nullable(), replayed: z.boolean() }).strict()

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
type Row = Record<string, unknown>

// Only exact identity metadata is sent to the consumption RPC. In particular,
// the provider's rawBase64, transport secrets and arbitrary extras are omitted.
const providerBinding = z.object({
  originalHash: z.string().regex(/^[a-f0-9]{64}$/), routeId: z.string().uuid(),
  to: z.string().min(1).max(512), from: z.string().min(1).max(512),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/), payloadLength: z.number().int().positive(),
  encoding: z.enum(['utf8', 'latin1']), mimeMode: z.string().min(1).max(100),
  mimeSha256: z.string().regex(/^[a-f0-9]{64}$/), mimeLength: z.number().int().positive(),
  mimeArchiveRef: z.string().min(1).max(2048), rfcMessageId: z.string().min(1).max(512),
  mimePayloadSnapshotId: z.string().uuid(),
})
const payloadHash = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex')
function messageProjection(row: Row) {
  const nullable = (value: unknown): string | null => typeof value === 'string' ? value : null
  return {id: str(row.id), companyId: str(row.company_id), environment: str(row.environment), direction: str(row.direction),
    communicationRouteId: nullable(row.communication_route_id), originalMessageId: nullable(row.original_message_id),
    sourcePayloadHash: payloadHash(str(row.raw_payload)), recipient: nullable(row.receiver_email),
    senderEdielId: nullable(row.sender_ediel_id), receiverEdielId: nullable(row.receiver_ediel_id)}
}

const refuse = (reasons: string[]): never => {
  throw new Error(`${CONTROLLED_LIVE_REFUSED}: ${reasons.join(' | ')}`)
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const date = (v: unknown): Date => new Date(typeof v === 'string' ? v : Number.NaN)
const liveEnv = (v: unknown): LiveEnvironment | null => (v === 'test' || v === 'production' ? v : null)
const isObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

/** Reasons carried by a guard refusal, or null when the error is not one. */
export function controlledLiveRefusalReasons(error: unknown): string[] | null {
  const text = error instanceof Error ? error.message : ''
  return text.startsWith(`${CONTROLLED_LIVE_REFUSED}: `) ? text.slice(CONTROLLED_LIVE_REFUSED.length + 2).split(' | ') : null
}

export const normalizeCertificateFingerprint = (value: string): string => value.replace(/[:\s]/g, '').toLowerCase()
/** Same column precedence as the route contract (fingerprint_sha256, then certificate_fingerprint). */
export function controlledCertificateFingerprint(row: Row | null | undefined): string {
  const value = row ? clean(row.fingerprint_sha256) ?? clean(row.certificate_fingerprint) : null
  return value ? normalizeCertificateFingerprint(value) : ''
}
/** Same `??` selection as the send path's effectiveCertificateId. */
export function selectControlledCertificateId(routeRow: Row | null | undefined): string | null {
  const selected = routeRow ? routeRow.receiver_certificate_id ?? routeRow.certificate_id ?? null : null
  return typeof selected === 'string' ? selected : null
}

const issuedBindings = new WeakSet<object>()
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Row)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}
/** Mint the frozen binding; only the entry point calls this after its own server-side checks. */
export function issueControlledLiveBinding(input: ControlledLiveBinding): ControlledLiveBinding {
  const binding = deepFreeze(structuredClone({ ...input, selection: controlledLiveSelection.parse(input.selection) }))
  issuedBindings.add(binding)
  return binding
}
export function isIssuedControlledLiveBinding(value: unknown): value is ControlledLiveBinding {
  return !!value && typeof value === 'object' && issuedBindings.has(value)
}

/** parsed_payload as an object; a JSON-object string is read the same way, anything else is empty. */
function payloadObject(payload: unknown): Row {
  if (isObject(payload)) return payload
  if (typeof payload === 'string') {
    try {
      const parsed: unknown = JSON.parse(payload)
      if (isObject(parsed)) return parsed
    } catch { /* not JSON: carries no marker */ }
  }
  return {}
}

/** True when the payload declares a legacy OPS-04 marker (declaration only: never activation). */
export function isControlledLiveFlow(message: Pick<EdielMessageRow, 'parsed_payload'>): boolean {
  return Object.prototype.hasOwnProperty.call(payloadObject(message.parsed_payload), CONTROLLED_LIVE_FLOW_KEY)
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc
  try {
    return await rpc(name, args)
  } catch (error) {
    return { data: null, error }
  }
}

async function readTenantRow(table: 'ediel_certificates' | 'ediel_transport_profiles', id: string, companyId: string): Promise<Row | null> {
  const { data, error } = await supabaseService.from(table).select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  if (error) refuse([`${table}_read_failed`])
  return (data as Row | null) ?? null
}

export type ControlledLiveAssessment = {
  ready: boolean
  reasons: string[]
  routeRow: Row | null
  certificateId: string | null
  certificateFingerprint: string
  incidentId: string | null
  routeProfileId: string | null
  agreementId: string | null
  mandateId: string | null
  correctionRef: string | null
  relayEvidenceRef: string | null
  relayHeadersHash: string | null
}

/**
 * Full fail-closed evaluation of one message against server-side evidence, with
 * no consumption and no transport effect. Tenant and environment are always the
 * stored message's own; the selection only names the incident and the plan.
 */
export async function assessControlledLiveSend(message: EdielMessageRow, actorUserId: string, selectionInput: unknown): Promise<ControlledLiveAssessment> {
  const reasons: string[] = []
  const held = (more: string[]): ControlledLiveAssessment => ({ ready: false, reasons: [...new Set([...reasons, ...more])], routeRow: null, certificateId: null,
    certificateFingerprint: '', incidentId: null, routeProfileId: null, agreementId: null, mandateId: null, correctionRef: null, relayEvidenceRef: null, relayHeadersHash: null })
  const parsedSelection = controlledLiveSelection.safeParse(selectionInput)
  if (!parsedSelection.success) return held(['controlled_flow_selection_invalid'])
  const flow = parsedSelection.data
  const companyId = str(message.company_id)
  const environment = liveEnv(message.environment)
  const routeId = message.communication_route_id
  if (!companyId) return held(['tenant_context_missing'])
  if (!environment) return held(['environment_invalid'])
  if (!routeId) return held(['route_missing'])
  if (message.direction !== 'outbound') return held(['controlled_flow_not_outbound'])

  // The plan names exactly this message.
  if (flow.plan.references.length !== 1 || flow.plan.references[0] !== message.id) reasons.push('plan_reference_message_mismatch')

  // Incident trace: own tenant + actor scoped native read.
  let incident: ControlledLiveInput['incident'] = null
  try {
    const receipt = await readFreshEdielBusinessIncident({ companyId, actorUserId, incidentId: flow.incidentId })
    if (receipt.environment !== environment) reasons.push('incident_environment_mismatch')
    // A resend must be the corrected original this incident was reported on.
    if (flow.plan.resend && (!message.original_message_id || message.original_message_id !== receipt.sourceMessageId))
      reasons.push('resend_original_mismatch')
    incident = { id: receipt.incidentId, tenantId: receipt.companyId, status: 'open', correctionRef: null }
  } catch {
    reasons.push('incident_trace_unreadable')
  }

  // Route: same loader and selector as the actual send path.
  const routeRow = await getEdielRouteProfileByCommunicationRouteId(routeId, { companyId }) as unknown as Row | null
  const routeUsable = routeRow && routeRow.is_enabled !== false && routeRow.is_active !== false
  if (routeRow && !routeUsable) reasons.push('route_disabled')
  if (routeUsable && message.route_profile_id && message.route_profile_id !== routeRow.id) reasons.push('message_route_profile_mismatch')
  const certificateId = routeUsable ? selectControlledCertificateId(routeRow) : null
  const profileId = routeUsable ? str(routeRow.transport_profile_id) : ''
  const [certRow, profileRow] = await Promise.all([
    certificateId ? readTenantRow('ediel_certificates', certificateId, companyId) : null,
    profileId ? readTenantRow('ediel_transport_profiles', profileId, companyId) : null,
  ])
  const fingerprint = certRow && str(certRow.id) === certificateId ? controlledCertificateFingerprint(certRow) : ''
  const route: ControlledLiveInput['route'] = routeUsable ? {
    id: str(routeRow.id), tenantId: str(routeRow.company_id), environment: liveEnv(routeRow.environment) ?? ('' as LiveEnvironment),
    counterpartyId: str(routeRow.counterparty_id), profileId,
    permittedCertificateFingerprints: fingerprint ? [fingerprint] : [],
  } : null
  const certificate: ControlledLiveInput['certificate'] = certRow ? {
    fingerprint, tenantId: str(certRow.company_id), environment: liveEnv(certRow.environment) ?? ('' as LiveEnvironment),
    notBefore: date(certRow.valid_from ?? certRow.certificate_valid_from),
    notAfter: date(certRow.valid_to ?? certRow.certificate_valid_to),
    revoked: certRow.status !== 'active',
  } : null
  const profile: ControlledLiveInput['profile'] = profileRow && profileRow.is_active === true ? {
    id: str(profileRow.id), tenantId: str(profileRow.company_id), environment: liveEnv(profileRow.environment) ?? ('' as LiveEnvironment),
  } : null

  let native: z.infer<typeof nativeEvidence> | null = null
  if (incident && route) {
    const { data, error } = await callRpc(CONTROLLED_LIVE_EVIDENCE_RPC, {
      p_company_id: companyId, p_environment: environment, p_actor_user_id: actorUserId,
      p_message_id: message.id, p_incident_id: incident.id, p_route_profile_id: route.id,
    })
    const parsed = error ? null : nativeEvidence.safeParse(data)
    if (!parsed?.success) reasons.push('controlled_live_evidence_unavailable')
    else if (parsed.data.companyId !== companyId || parsed.data.environment !== environment
      || parsed.data.incidentId !== incident.id || parsed.data.routeProfileId !== route.id) reasons.push('controlled_live_evidence_scope_mismatch')
    else native = parsed.data
  }

  const fix = native?.incidentCorrection
  if (incident && fix) {
    if (fix.companyId !== companyId || fix.environment !== environment || fix.incidentId !== incident.id) reasons.push('incident_correction_scope_mismatch')
    else incident = { ...incident, status: 'corrected', correctionRef: fix.correctionRef }
  }
  const agr = native?.counterpartyAgreement
  const mandate = native?.liveMandate
  const relay = native?.relayCapture
  for (const consumedBy of [agr?.consumedByMessageId, environment === 'production' ? mandate?.consumedByMessageId : null])
    if (consumedBy && consumedBy !== message.id) reasons.push('controlled_live_authorization_consumed')
  const verdict = evaluateControlledLiveReadiness({
    now: new Date(),
    tenantId: companyId,
    environment,
    incident,
    route,
    certificate,
    profile,
    counterpartyAgreement: agr ? { ref: agr.ref, counterpartyId: agr.counterpartyId, tenantId: agr.companyId, environment: agr.environment,
      routeId: agr.routeId, validFrom: date(agr.validFrom), validTo: date(agr.validTo) } : null,
    liveMandate: mandate ? { ref: mandate.ref, tenantId: mandate.companyId, environment: mandate.environment, incidentId: mandate.incidentId } : null,
    plan: { references: flow.plan.references, source: flow.plan.source, resend: flow.plan.resend },
    relayEvidence: relay ? { verdict: evaluateRelayTrace({ rawHeaders: relay.rawHeaders }), evidenceRef: relay.evidenceRef,
      routeId: relay.routeId, tenantId: relay.companyId, environment: relay.environment } : null,
  })
  const all = [...new Set([...reasons, ...verdict.reasons])]
  const ready = verdict.ready && !all.length && !!agr && !!route && !!incident
  return {
    ready, reasons: ready ? [] : all.length ? all : ['controlled_live_evidence_unavailable'],
    routeRow: routeUsable ? routeRow : null, certificateId, certificateFingerprint: fingerprint,
    incidentId: incident?.id ?? null, routeProfileId: route?.id ?? null, agreementId: agr?.id ?? null,
    mandateId: environment === 'production' ? mandate?.id ?? null : null,
    correctionRef: fix?.correctionRef ?? null, relayEvidenceRef: relay?.evidenceRef ?? null,
    relayHeadersHash: relay ? payloadHash(relay.rawHeaders) : null,
  }
}

/** Early fail-closed activation/evidence check. It never consumes authority. */
export async function assertControlledLiveSendPreflight(message: EdielMessageRow, actorUserId: string, controlledBinding?: unknown): Promise<void> {
  await checkControlledLiveSend(message, actorUserId, controlledBinding, false)
}

/** Final gate: the caller awaits this only after the existing provider-entry
 * callback (including prepare/enter/witness) has returned. No retries or resets. */
export async function assertControlledLiveSendAllowed(message: EdielMessageRow, actorUserId: string, controlledBinding: unknown, actualProviderBinding: unknown): Promise<void> {
  await checkControlledLiveSend(message, actorUserId, controlledBinding, true, actualProviderBinding)
}

async function checkControlledLiveSend(message: EdielMessageRow, actorUserId: string, controlledBinding: unknown, consume: boolean, actualProviderBinding?: unknown): Promise<void> {
  const hasBinding = controlledBinding !== undefined && controlledBinding !== null
  // Provenance first: a binding not minted by the entry point is refused without I/O.
  if (hasBinding && !isIssuedControlledLiveBinding(controlledBinding)) return refuse(['controlled_binding_not_issued'])
  const binding = hasBinding ? controlledBinding as ControlledLiveBinding : null
  const payload = payloadObject(message.parsed_payload)
  const declared = Object.prototype.hasOwnProperty.call(payload, CONTROLLED_LIVE_FLOW_KEY)
  const routeId = message.communication_route_id
  if (!declared && !binding && !routeId) return
  if (declared && !flowMarker.safeParse(payload[CONTROLLED_LIVE_FLOW_KEY]).success) return refuse(['controlled_flow_marker_invalid'])
  if ((declared || binding) && !routeId) return refuse(['route_missing'])
  const companyId = str(message.company_id)
  const environment = liveEnv(message.environment)
  if (!companyId) return refuse(['tenant_context_missing'])
  if (!environment) return refuse(['environment_invalid'])

  // Server-side activation: one scoped read for this company/environment/message/route.
  const probe = await callRpc(CONTROLLED_FLOW_PROBE_RPC, {
    p_company_id: companyId, p_environment: environment, p_message_id: message.id, p_communication_route_id: routeId,
  })
  const probed = probe.error ? null : probeResult.safeParse(probe.data)
  if (!probed?.success) return refuse(['controlled_flow_probe_unavailable'])
  if (probed.data.companyId !== companyId || probed.data.environment !== environment || probed.data.messageId !== message.id)
    return refuse(['controlled_flow_probe_scope_mismatch'])
  if (!probed.data.controlled) {
    if (declared || binding) refuse(['controlled_flow_binding_missing'])
    return
  }
  // A controlled route is only reachable through the explicit entry point.
  if (!binding) return refuse(['controlled_flow_entry_point_required'])

  // Fresh server-side evaluation at send time (fresh clock), bound to the entry-point snapshot.
  const assessment = await assessControlledLiveSend(message, actorUserId, binding.selection)
  const reasons = [...assessment.reasons]
  let admitted: Row | null = null
  let admittedRoute: Row | null = null
  try {
    const parsed: unknown = JSON.parse(binding.messageSnapshot)
    const route: unknown = JSON.parse(binding.routeProfileSnapshot)
    if (isObject(parsed)) admitted = parsed
    if (isObject(route)) admittedRoute = route
  } catch { /* invalid snapshots cannot authorize a send */ }
  if (!admitted || JSON.stringify(messageProjection(message as unknown as Row)) !== JSON.stringify(messageProjection(admitted)))
    reasons.push('controlled_binding_message_changed')
  const snapshot = binding.evidenceSnapshot
  if (!snapshot || snapshot.agreementId !== assessment.agreementId || snapshot.mandateId !== assessment.mandateId
    || snapshot.correctionRef !== assessment.correctionRef || snapshot.relayEvidenceRef !== assessment.relayEvidenceRef
    || snapshot.relayHeadersHash !== assessment.relayHeadersHash) reasons.push('controlled_binding_evidence_changed')
  if (assessment.routeRow && JSON.stringify(assessment.routeRow) !== binding.routeProfileSnapshot) reasons.push('controlled_binding_route_changed')
  if (assessment.certificateId !== binding.certificateId || assessment.certificateFingerprint !== binding.certificateFingerprint)
    reasons.push('controlled_binding_certificate_changed')
  if (!assessment.ready || reasons.length || !assessment.agreementId || !assessment.incidentId || !assessment.routeProfileId)
    return refuse(reasons.length ? [...new Set(reasons)] : ['controlled_live_evidence_unavailable'])

  if (!consume) return
  const provider = providerBinding.safeParse(actualProviderBinding)
  const projected = admitted ? messageProjection(admitted) : null
  if (!provider.success || !projected || !admittedRoute
    || provider.data.originalHash !== projected.sourcePayloadHash || provider.data.routeId !== projected.communicationRouteId
    || provider.data.to.trim().toLowerCase() !== projected.recipient?.trim().toLowerCase())
    return refuse(['controlled_live_provider_binding_invalid'])

  // Single use at the actual final provider seam. SQL rechecks the same frozen
  // message/route/cert/relay and the committed, entered MIME attempt under lock.
  const consumed = await callRpc(CONTROLLED_LIVE_CONSUME_RPC, {
    p_company_id: companyId, p_environment: environment, p_actor_user_id: actorUserId, p_message_id: message.id,
    p_incident_id: assessment.incidentId, p_route_profile_id: assessment.routeProfileId, p_agreement_id: assessment.agreementId,
    p_mandate_id: assessment.mandateId, p_resend: binding.selection.plan.resend !== null,
    p_binding: {message: projected, routeProfile: admittedRoute, certificateId: binding.certificateId,
      certificateFingerprint: binding.certificateFingerprint, correctionRef: snapshot.correctionRef,
      relayEvidenceRef: snapshot.relayEvidenceRef, relayHeadersHash: snapshot.relayHeadersHash, provider: provider.data},
  })
  const receipt = consumed.error ? null : consumption.safeParse(consumed.data)
  if (!receipt?.success) {
    const text = consumed.error && typeof consumed.error === 'object' ? str((consumed.error as Row).message) : ''
    return refuse([text.includes('ediel_ops04_authorization_consumed') ? 'controlled_live_authorization_consumed' : 'controlled_live_consumption_unavailable'])
  }
  if (receipt.data.companyId !== companyId || receipt.data.environment !== environment || receipt.data.messageId !== message.id
    || receipt.data.agreementId !== assessment.agreementId || receipt.data.mandateId !== assessment.mandateId) refuse(['controlled_live_consumption_scope_mismatch'])
  // Historical accepted repair happens before this path. A repeated final gate
  // is not permission for another provider call, even for the same message.
  if (receipt.data.replayed) refuse(['controlled_live_authorization_consumed'])
}
