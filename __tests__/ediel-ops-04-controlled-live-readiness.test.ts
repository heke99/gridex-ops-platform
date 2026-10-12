// masterplan: OPS-04, TR-08
//
// Code-only component tests for the OPS-04 controlled live readiness gate.
// All identifiers are SYNTHETIC. These tests do not perform a real
// counterparty test and do not approve OPS-04/AT-OPS-04 or TR-08 as a whole.
import { describe, expect, it } from 'vitest'

import {
  CONTROLLED_LIVE_SCHEMA,
  evaluateControlledLiveReadiness,
  type ControlledLiveInput,
} from '@/lib/ediel/transport/controlledLiveReadiness'
import { evaluateRelayTrace } from '@/lib/ediel/transport/relayTrace'

const NOW = new Date('2026-10-12T10:00:00Z')
const T = 'tenant-a'

const tlsTrace = evaluateRelayTrace({
  rawHeaders: [
    'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
    'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ESMTPS id r2; Mon, 12 Oct 2026 12:00:02 +0200',
    'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 12 Oct 2026 12:00:01 +0200',
    'Subject: SYNTHETIC',
    '',
  ].join('\r\n'),
})
const plaintextNextHop = evaluateRelayTrace({
  smtpPortReachable: true,
  rawHeaders: [
    'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
    'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ESMTP id r2; Mon, 12 Oct 2026 12:00:02 +0200',
    'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 12 Oct 2026 12:00:01 +0200',
    'Subject: SYNTHETIC',
    '',
  ].join('\r\n'),
})

function base(): ControlledLiveInput {
  return {
    now: NOW,
    tenantId: T,
    environment: 'production',
    incident: { id: 'inc-1', tenantId: T, status: 'corrected', correctionRef: 'fix-1' },
    route: { id: 'route-1', tenantId: T, environment: 'production', counterpartyId: 'cp-1', profileId: 'prof-1' },
    certificate: {
      fingerprint: 'AA:BB',
      tenantId: T,
      environment: 'production',
      notBefore: new Date('2026-01-01T00:00:00Z'),
      notAfter: new Date('2027-01-01T00:00:00Z'),
      revoked: false,
    },
    profile: { id: 'prof-1', tenantId: T, environment: 'production' },
    counterpartyAgreement: {
      ref: 'agr-1',
      counterpartyId: 'cp-1',
      tenantId: T,
      environment: 'production',
      routeId: 'route-1',
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validTo: new Date('2026-10-31T00:00:00Z'),
    },
    liveMandate: { ref: 'mandate-1', tenantId: T, environment: 'production', incidentId: 'inc-1' },
    plan: { references: ['msg-1'], source: 'single_controlled', resend: null },
    relayTrace: tlsTrace,
  }
}

const reasonsOf = (patch: (i: ControlledLiveInput) => void) => {
  const i = base()
  patch(i)
  const v = evaluateControlledLiveReadiness(i)
  expect(v.ready).toBe(false)
  expect(v.productionApproved).toBe(false)
  return v.reasons
}

describe('OPS-04 controlled live readiness (synthetic)', () => {
  it('passes a fully consistent single controlled flow but never self-approves production', () => {
    expect(tlsTrace.verified).toBe(true)
    const v = evaluateControlledLiveReadiness(base())
    expect(v).toEqual({ schema: CONTROLLED_LIVE_SCHEMA, ready: true, transportVerified: true, productionApproved: false, reasons: [] })
  })

  it.each([
    ['incident_trace_missing', (i: ControlledLiveInput) => { i.incident = null }],
    ['incident_not_corrected', (i: ControlledLiveInput) => { i.incident!.status = 'open' }],
    ['route_missing', (i: ControlledLiveInput) => { i.route = null }],
    ['certificate_missing', (i: ControlledLiveInput) => { i.certificate = null }],
    ['certificate_revoked', (i: ControlledLiveInput) => { i.certificate!.revoked = true }],
    ['certificate_not_valid_now', (i: ControlledLiveInput) => { i.certificate!.notAfter = new Date('2026-10-11T00:00:00Z') }],
    ['profile_missing', (i: ControlledLiveInput) => { i.profile = null }],
    ['route_profile_mismatch', (i: ControlledLiveInput) => { i.route!.profileId = 'prof-other' }],
    ['tenant_context_missing', (i: ControlledLiveInput) => { i.tenantId = ' ' }],
    ['counterparty_agreement_missing', (i: ControlledLiveInput) => { i.counterpartyAgreement = null }],
    ['counterparty_agreement_route_mismatch', (i: ControlledLiveInput) => { i.counterpartyAgreement!.counterpartyId = 'cp-2' }],
    ['counterparty_agreement_not_valid_now', (i: ControlledLiveInput) => { i.counterpartyAgreement!.validTo = new Date('2026-10-05T00:00:00Z') }],
    ['live_mandate_missing', (i: ControlledLiveInput) => { i.liveMandate = null }],
    ['live_mandate_incident_mismatch', (i: ControlledLiveInput) => { i.liveMandate!.incidentId = 'inc-other' }],
  ])('fails closed: %s', (reason, patch) => {
    expect(reasonsOf(patch)).toContain(reason)
  })

  it('rejects cross-tenant evidence for every component', () => {
    const r = reasonsOf((i) => {
      i.incident!.tenantId = 'tenant-b'
      i.route!.tenantId = 'tenant-b'
      i.certificate!.tenantId = 'tenant-b'
      i.profile!.tenantId = 'tenant-b'
      i.counterpartyAgreement!.tenantId = 'tenant-b'
      i.liveMandate!.tenantId = 'tenant-b'
    })
    for (const k of ['incident', 'route', 'certificate', 'profile', 'counterparty_agreement', 'live_mandate'])
      expect(r).toContain(`${k}_tenant_mismatch`)
  })

  it('rejects test-environment evidence for a production flow', () => {
    const r = reasonsOf((i) => {
      i.route!.environment = 'test'
      i.certificate!.environment = 'test'
      i.profile!.environment = 'test'
      i.counterpartyAgreement!.environment = 'test'
      i.liveMandate!.environment = 'test'
    })
    for (const k of ['route', 'certificate', 'profile', 'counterparty_agreement', 'live_mandate'])
      expect(r).toContain(`${k}_environment_mismatch`)
  })

  it('prohibits mass import of references', () => {
    expect(reasonsOf((i) => { i.plan = { references: ['a', 'b', 'c'], source: 'bulk_import', resend: null } })).toEqual(
      expect.arrayContaining(['bulk_reference_import_not_a_test_strategy', 'plan_not_single_controlled_flow']),
    )
    expect(reasonsOf((i) => { i.plan.references = ['msg-1', 'msg-1'] })).toContain('plan_not_single_controlled_flow')
  })

  it('prohibits blind resends but accepts a diagnosed resend of the corrected incident', () => {
    expect(reasonsOf((i) => { i.plan.resend = { incidentId: null, diagnosis: null } })).toContain('blind_resend_not_a_test_strategy')
    expect(reasonsOf((i) => { i.plan.resend = { incidentId: 'inc-other', diagnosis: 'x' } })).toContain('blind_resend_not_a_test_strategy')
    const i = base()
    i.plan.resend = { incidentId: 'inc-1', diagnosis: 'route certificate rotated' }
    expect(evaluateControlledLiveReadiness(i).ready).toBe(true)
  })

  it('TR-08: a reachable port with plaintext next hop does not verify the transport', () => {
    expect(plaintextNextHop.verified).toBe(false)
    const r = reasonsOf((i) => { i.relayTrace = plaintextNextHop })
    expect(r).toContain('relay_trace_not_verified')
    expect(reasonsOf((i) => { i.relayTrace = null })).toContain('relay_trace_not_verified')
  })
})
