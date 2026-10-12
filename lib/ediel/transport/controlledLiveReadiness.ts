// OPS-04 controlled live verification readiness (code-only component).
//
// After a correction, a limited production test may only start when the
// incident trace, route, certificate, profile and tenant context all agree and
// an agreed counterparty test exists. The plan must be one controlled flow in
// the right environment: mass import of references or blind resends are not a
// test strategy. This pure evaluator is fail-closed; any doubt yields
// ready=false with reasons.
//
// It never grants a LIVE mandate or a counterparty agreement — both are
// external, operator-owned inputs. ready=true only means the mechanism found
// no contradiction in the supplied evidence; it is not production approval.

import type { RelayTraceVerdict } from './relayTrace'

export const CONTROLLED_LIVE_SCHEMA = 'gridex_controlled_live_readiness_v1'
/** A controlled flow is a single exchange, not a batch. */
export const CONTROLLED_LIVE_MAX_REFERENCES = 1

export type LiveEnvironment = 'test' | 'production'

export type ControlledLiveInput = {
  now: Date
  tenantId: string
  environment: LiveEnvironment
  incident: { id: string; tenantId: string; status: 'open' | 'corrected' | 'closed'; correctionRef: string | null } | null
  route: {
    id: string
    tenantId: string
    environment: LiveEnvironment
    counterpartyId: string
    profileId: string
    /** Certificate fingerprints this route may use (not necessarily exclusive). */
    permittedCertificateFingerprints: string[]
  } | null
  certificate: {
    fingerprint: string
    tenantId: string
    environment: LiveEnvironment
    notBefore: Date
    notAfter: Date
    revoked: boolean
  } | null
  profile: { id: string; tenantId: string; environment: LiveEnvironment } | null
  counterpartyAgreement: {
    ref: string
    counterpartyId: string
    tenantId: string
    environment: LiveEnvironment
    routeId: string
    validFrom: Date
    validTo: Date
  } | null
  liveMandate: { ref: string; tenantId: string; environment: LiveEnvironment; incidentId: string } | null
  plan: {
    references: string[]
    source: 'single_controlled' | 'bulk_import'
    /** Resends must cite a diagnosed incident; otherwise they are blind. */
    resend: { incidentId: string | null; diagnosis: string | null } | null
  }
  /** TR-08 relay verdict, bound to the operator-owned context it was captured in. */
  relayEvidence?: {
    verdict: RelayTraceVerdict
    evidenceRef: string
    routeId: string
    tenantId: string
    environment: LiveEnvironment
  } | null
}

export type ControlledLiveVerdict = {
  schema: typeof CONTROLLED_LIVE_SCHEMA
  ready: boolean
  /** True only when a supplied TR-08 relay verdict is verified; reachability never counts. */
  transportVerified: boolean
  /** Always false: the mechanism never self-approves production. */
  productionApproved: false
  reasons: string[]
}

const blank = (v: string | null | undefined): boolean => !v || v.trim() === ''
const validDate = (d: Date): boolean => d instanceof Date && Number.isFinite(d.getTime())
/** Fail-closed interval check: invalid or reversed bounds never contain `now`. */
const within = (now: number, from: Date, to: Date): 'ok' | 'invalid' | 'outside' => {
  if (!Number.isFinite(now) || !validDate(from) || !validDate(to) || from.getTime() > to.getTime()) return 'invalid'
  return now >= from.getTime() && now <= to.getTime() ? 'ok' : 'outside'
}

export function evaluateControlledLiveReadiness(input: ControlledLiveInput): ControlledLiveVerdict {
  const reasons: string[] = []
  const t = input.tenantId
  const env = input.environment
  const now = input.now.getTime()
  if (blank(t)) reasons.push('tenant_context_missing')
  if (!validDate(input.now)) reasons.push('clock_invalid')

  const { incident, route, certificate, profile, counterpartyAgreement: agr, liveMandate, plan } = input

  if (!incident || blank(incident.id)) reasons.push('incident_trace_missing')
  else {
    if (incident.tenantId !== t) reasons.push('incident_tenant_mismatch')
    if (incident.status !== 'corrected' || blank(incident.correctionRef)) reasons.push('incident_not_corrected')
  }

  if (!route || blank(route.id)) reasons.push('route_missing')
  else {
    if (route.tenantId !== t) reasons.push('route_tenant_mismatch')
    if (route.environment !== env) reasons.push('route_environment_mismatch')
  }

  if (!certificate || blank(certificate.fingerprint)) reasons.push('certificate_missing')
  else {
    if (certificate.tenantId !== t) reasons.push('certificate_tenant_mismatch')
    if (certificate.environment !== env) reasons.push('certificate_environment_mismatch')
    if (certificate.revoked) reasons.push('certificate_revoked')
    const w = within(now, certificate.notBefore, certificate.notAfter)
    if (w === 'invalid') reasons.push('certificate_validity_invalid')
    else if (w === 'outside') reasons.push('certificate_not_valid_now')
    if (route && !route.permittedCertificateFingerprints.includes(certificate.fingerprint))
      reasons.push('certificate_not_permitted_for_route')
  }

  if (!profile || blank(profile.id)) reasons.push('profile_missing')
  else {
    if (profile.tenantId !== t) reasons.push('profile_tenant_mismatch')
    if (profile.environment !== env) reasons.push('profile_environment_mismatch')
    if (route && route.profileId !== profile.id) reasons.push('route_profile_mismatch')
  }

  if (!agr || blank(agr.ref)) reasons.push('counterparty_agreement_missing')
  else {
    if (agr.tenantId !== t) reasons.push('counterparty_agreement_tenant_mismatch')
    if (agr.environment !== env) reasons.push('counterparty_agreement_environment_mismatch')
    if (route && (agr.routeId !== route.id || agr.counterpartyId !== route.counterpartyId))
      reasons.push('counterparty_agreement_route_mismatch')
    const w = within(now, agr.validFrom, agr.validTo)
    if (w === 'invalid') reasons.push('counterparty_agreement_validity_invalid')
    else if (w === 'outside') reasons.push('counterparty_agreement_not_valid_now')
  }

  if (env === 'production') {
    if (!liveMandate || blank(liveMandate.ref)) reasons.push('live_mandate_missing')
    else {
      if (liveMandate.tenantId !== t) reasons.push('live_mandate_tenant_mismatch')
      if (liveMandate.environment !== env) reasons.push('live_mandate_environment_mismatch')
      if (incident && liveMandate.incidentId !== incident.id) reasons.push('live_mandate_incident_mismatch')
    }
  }

  const refs = new Set(plan.references.filter((r) => !blank(r)))
  if (plan.source === 'bulk_import') reasons.push('bulk_reference_import_not_a_test_strategy')
  if (refs.size === 0) reasons.push('plan_reference_missing')
  if (refs.size > CONTROLLED_LIVE_MAX_REFERENCES || refs.size !== plan.references.length)
    reasons.push('plan_not_single_controlled_flow')
  if (plan.resend) {
    if (blank(plan.resend.diagnosis) || !incident || plan.resend.incidentId !== incident.id)
      reasons.push('blind_resend_not_a_test_strategy')
  }

  // TR-08: port reachability or first-hop TLS never verifies the transport.
  // The verdict only counts for the selected route, tenant and environment.
  const rel = input.relayEvidence
  let transportVerified = false
  if (!rel || rel.verdict?.verified !== true) reasons.push('relay_trace_not_verified')
  else if (blank(rel.evidenceRef)) reasons.push('relay_evidence_ref_missing')
  else if (rel.tenantId !== t || rel.environment !== env || !route || rel.routeId !== route.id)
    reasons.push('relay_evidence_context_mismatch')
  else transportVerified = true

  return {
    schema: CONTROLLED_LIVE_SCHEMA,
    ready: reasons.length === 0,
    transportVerified,
    productionApproved: false,
    reasons,
  }
}
