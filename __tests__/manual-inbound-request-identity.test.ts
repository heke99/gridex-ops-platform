import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'
import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'

const io = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return io.db.client } }))

import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'

const company = '11111111-1111-4111-8111-111111111111'
const facilityA = '735999100000000001', facilityB = '735999100000000002'
const meterA = '735999200000000001', meterB = '735999200000000002'
const sender = 'avtal@supplier.example'
const caseReference = 'GX-FIR-ABCDEF12'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  io.db = createFakeDb({
    grid_owner_information_requests: [{ id: 'request-a', company_id: company, customer_id: 'customer-a', customer_site_id: 'site-a',
      request_type: 'current_supplier_contract_information_request', status: 'waiting_manual_response', case_reference: caseReference, recipient_email: sender,
      metadata: { target_party: 'current_supplier', supplier_id: 'supplier-a', supplier_actor_id: 'actor-a', supplier_contact_id: 'contact-a' } }],
    manual_email_outbox: [{ id: 'outbox-a', company_id: company, request_id: 'request-a', provider_message_id: '<request-a@example.test>' }],
    customer_sites: [
      { id: 'site-a', company_id: company, customer_id: 'customer-a', facility_id: facilityA, normalized_facility_id: facilityA, current_supplier_id: 'supplier-a' },
      { id: 'site-b', company_id: company, customer_id: 'customer-a', facility_id: facilityB, normalized_facility_id: facilityB, current_supplier_id: 'supplier-a' },
    ],
    metering_points: [
      { id: 'point-a', company_id: company, customer_id: 'customer-a', site_id: 'site-a', meter_point_id: meterA, site_facility_id: facilityA },
      { id: 'point-b', company_id: company, customer_id: 'customer-a', site_id: 'site-b', meter_point_id: meterB, site_facility_id: facilityB },
    ],
    customers: [{ id: 'customer-a', company_id: company, customer_number: 'K0000001' }, { id: 'customer-b', company_id: company, customer_number: 'K0000002' }],
    electricity_suppliers: [{ id: 'supplier-a', company_id: null, is_active: true, platform_market_actor_id: 'actor-a' }],
    platform_market_actors: [{ id: 'actor-a', status: 'active', match_status: 'verified' }],
    platform_actor_roles: [{ actor_id: 'actor-a', actor_role: 'electricity_supplier', is_active: true }],
    platform_actor_contacts: [{ id: 'contact-a', actor_id: 'actor-a', contact_type: 'poa', channel: 'email', email: sender,
      is_verified: true, verified_at: '2026-01-01T00:00:00Z', valid_from: null, valid_to: null }],
    grid_owner_contact_channels: [], communication_log_events: [],
  })
})
afterEach(() => vi.useRealTimers())

function resolve(extracted: ManualFacilityExtractedPayload = {}, body = '') {
  return resolveManualInboundCorrelation({ email: { fromEmail: sender, inReplyTo: '<request-a@example.test>', references: [] },
    caseReference, normalizedText: body, extracted: { ...extracted, earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' } })
}

describe('request-scoped body identity checks', () => {
  it.each([
    [{ facility_id: facilityB }, `Anläggnings-ID: ${facilityB}`],
    [{ metering_point_id: meterB }, `Mätpunkts-ID: ${meterB}`],
    [{ facility_id: facilityB, metering_point_id: meterB }, `Anläggnings-ID: ${facilityB}\nMätpunkts-ID: ${meterB}`],
    [{ facility_id: facilityA, metering_point_id: meterB }, `Anläggnings-ID: ${facilityA}\nMätpunkts-ID: ${meterB}`],
  ] as const)('rejects another site of the same customer despite an exact case and reply thread %#', async (extracted, body) => {
    const result = await resolve(extracted, body)
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
    expect(result.evidence.request_identity_conflicts).toBeDefined()
  })

  it('rejects an unknown new facility ID when the request site already has a different canonical ID', async () => {
    const result = await resolve({ facility_id: '735999100000000099' }, 'Anläggnings-ID: 735999100000000099')
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
  })

  it('rejects an unknown metering ID when the request site has a different established point', async () => {
    const result = await resolve({ metering_point_id: '735999200000000099' }, 'Mätpunkts-ID: 735999200000000099')
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
  })

  it('keeps distinct matching facility and metering identifiers attached to their own request site', async () => {
    const result = await resolve({ facility_id: facilityA, metering_point_id: meterA }, `Anläggnings-ID: ${facilityA}\nMätpunkts-ID: ${meterA}`)
    expect(result).toMatchObject({ resolutionStatus: 'matched', senderCredible: true, customerId: 'customer-a', customerSiteId: 'site-a', meteringPointId: 'point-a' })
  })

  it('keeps a strongly threaded response without body identifiers attached to its request', async () => {
    const result = await resolve({}, 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen')
    expect(result).toMatchObject({ resolutionStatus: 'matched', senderCredible: true, customerId: 'customer-a', customerSiteId: 'site-a' })
  })

  it('rejects an explicit customer number for another customer in the same tenant', async () => {
    const result = await resolve({}, 'Kundnummer: K0000002')
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
  })

  it('rejects an unrecognized customer number that contradicts the canonical request customer', async () => {
    const result = await resolve({}, 'Kundnummer: K0000099')
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
  })

  it('accepts the exact canonical customer number', async () => {
    expect(await resolve({}, 'Kundnummer: K0000001')).toMatchObject({ resolutionStatus: 'matched', senderCredible: true })
  })

  it('still allows first-time facility data for a lookup whose site has no established identity', async () => {
    const request = io.db.tables.grid_owner_information_requests[0]
    request.request_type = 'facility_identifier_lookup'
    request.grid_owner_id = 'owner-a'
    request.recipient_email = sender
    io.db.tables.customer_sites[0].grid_owner_id = 'owner-a'
    io.db.tables.customer_sites[0].facility_id = null
    io.db.tables.customer_sites[0].normalized_facility_id = null
    io.db.tables.metering_points = []
    const result = await resolve({ facility_id: '735999100000000099' }, 'Anläggnings-ID: 735999100000000099')
    expect(result).toMatchObject({ resolutionStatus: 'matched', senderCredible: true, customerSiteId: 'site-a' })
  })
})
