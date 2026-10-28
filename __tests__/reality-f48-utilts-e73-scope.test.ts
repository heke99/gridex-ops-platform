// reality-defects: F48, F35
// F48 / J2-13, owner decision 43: the supplier's first production UTILTS scope is E73 (missing E66 values; S02 only
// with role, agreement and data right) plus the prescribed UTILTS-ERR. E73's Application Reference names the
// requested type from the verified profile. E74 and S07 are not activated, the supplier never originates E66, and
// CONTRL and APERAK are separate acknowledgement families. These tests call the policy, the route projection,
// the outbound assertion, the UTILTS disposition engine and the E73 flow itself (with its I/O ports mocked).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  capabilities: [] as Array<Record<string, unknown>>,
  routeApplicationReference: null as string | null,
  routeCalls: [] as Array<Record<string, unknown>>,
  structure: vi.fn(),
  outbound: vi.fn(),
  draft: vi.fn(),
  status: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const q: Record<string, unknown> = {}
      for (const name of ['select', 'eq']) q[name] = () => q
      q.limit = async () => ({ data: io.capabilities, error: null })
      return q
    },
  },
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: async () => ({ site_type: 'consumption' }),
  getMeteringPointById: async () => ({ meter_point_id: '735999000000000001' }),
  getGridOwnerById: async () => ({ id: 'go', ediel_id: '16700', owner_code: 'ALI' }),
}))
vi.mock('@/lib/ediel/sources/dataRequestStructure', () => ({ requireDataRequestStructure: io.structure }))
vi.mock('@/lib/ediel/sources/dataRequestLegalParties', () => ({ dataRequestLegalParties: () => ({ legalSupplier: '70001', legalNetwork: '16700' }) }))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({
  resolveDecisionBackedOutboundContext: async (input: Record<string, unknown>) => {
    io.routeCalls.push(input)
    return {
      route: { id: 'route-e73' }, applicationReference: io.routeApplicationReference, senderEdielId: '70001', senderName: 'Gridex',
      receiverEdielId: '16700', receiverName: 'Alingsås Energi Nät', senderSubAddress: null, receiverSubAddress: null, mailbox: null,
      receiverEmail: 'utilts@example.invalid', defaultMessageVersion: 'E5SE5A',
    }
  },
}))
vi.mock('@/lib/ediel/utilts', () => ({ buildUtiltsOutboundDraft: io.draft }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async () => undefined, linkEdielMessage: async () => undefined }))
vi.mock('@/lib/cis/db', () => ({ updateGridOwnerDataRequestStatus: io.status }))
vi.mock('@/lib/ediel/flows/shared', () => ({
  ensureActorUserId: (value: string) => value,
  makeServerClient: async () => ({}),
  resolveOutboundRuntimeEnvironment: async () => 'production',
  getGridOwnerDataRequestById: async () => currentRequest,
  findOrCreateDataRequestOutbound: io.outbound,
  finalizeOutboundDraft: async () => ({ id: 'msg-e73', external_reference: 'E73-REF' }),
  queuePreparedEdielMessage: async () => undefined,
}))

import {
  assertE73RequestedTypeAuthorized,
  e73AgreedRequestedTypes,
  resolveE73RequestApplicationReference,
  supplierUtiltsRouteApplicationReference,
  supplierUtiltsRouteMessageCodes,
} from '@/lib/ediel/utilts/supplierUtiltsOutboundScope'
import { registryRouteMessageCodes } from '@/lib/ediel/routeMaterializer'
import { assertCanonicalSupplierUtiltsOutboundAllowed } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { prepareAndQueueUtiltsE66, prepareAndQueueUtiltsE73 } from '@/lib/ediel/flows/utiltsSupplierRequest'
import { resolveUtiltsTransactionDispositions } from '@/lib/ediel/utiltsEngine'
import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { projectCanonicalAckMode } from '@/lib/ediel/ack/routeAckModeProjection'
import { routeScopeForProcess, shouldMaterializePerGridOwner } from '@/lib/ediel/routeMatrix'

let currentRequest: Record<string, unknown> = {}
const request = (payload: Record<string, unknown> = {}) => ({
  id: 'dr-1', company_id: 'company-a', customer_id: 'cu', site_id: 'si', metering_point_id: 'mp', grid_owner_id: 'go',
  request_scope: 'meter_values', requested_period_start: '2026-09-01T00:00:00+02:00', requested_period_end: '2026-10-01T00:00:00+02:00',
  request_payload: payload, response_payload: {}, external_reference: null, notes: null,
})
const capability = (metadata: Record<string, unknown> | null = null) => ({ id: 'cap-e73', valid_from: null, valid_to: null, metadata })
const selected = { status: 'selected', legalSupplier: '70001', legalNetwork: '16700', snapshotId: 's', readsetHash: 'h', selection: {},
  fields: { reportingFrequency: 'PT60M', measurementMethod: 'Z02', productCode: '8716867000030' }, resolution: '60' }

beforeEach(() => {
  io.capabilities = [capability()]
  io.routeApplicationReference = '23-DDQ-E66-S'
  io.routeCalls.length = 0
  io.structure.mockReset().mockResolvedValue(selected)
  io.outbound.mockReset().mockResolvedValue({ id: 'out-1' })
  io.draft.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({ messageFamily: 'UTILTS', messageCode: input.code, messageVersion: 'E5SE5A', input }))
  io.status.mockReset().mockResolvedValue(undefined)
  currentRequest = request()
})

describe('route materialization per message the supplier sends', () => {
  it('the supplier originates exactly E73 on a grid-owner UTILTS route, derived from the canonical market matrix', () => {
    expect(supplierUtiltsRouteMessageCodes()).toEqual(['E73'])
    expect(registryRouteMessageCodes({ metadata: {}, application_reference: null }, 'UTILTS')).toEqual(['E73'])
    expect(routeScopeForProcess({ messageFamily: 'UTILTS', messageCode: 'E73' })).toBe('meter_values')
    expect(projectCanonicalAckMode({ messageFamily: 'UTILTS', messageCode: 'E73' })).toBe('contrl_and_aperak')
  })

  it('UTILTS-ERR is a reply in the original context, never a per-grid-owner business route', () => {
    expect(routeScopeForProcess({ messageFamily: 'UTILTS_ERR', messageCode: 'ERR' })).toBeNull()
    expect(shouldMaterializePerGridOwner({ messageFamily: 'UTILTS_ERR', messageCode: 'ERR' })).toBe(false)
  })

  it('the E73 profile keeps the verified UTILTS reference; a PRODAT label of the sender is not one', () => {
    expect(supplierUtiltsRouteApplicationReference({ messageCode: 'E73', registryApplicationReference: '23-DDQ-E66-T' })).toBe('23-DDQ-E66-T')
    expect(supplierUtiltsRouteApplicationReference({ messageCode: 'E73', senderApplicationReferences: ['23-DDQ-PRODAT', '23-ddq-e66-s'] })).toBe('23-DDQ-E66-S')
    expect(supplierUtiltsRouteApplicationReference({ messageCode: 'E73', senderApplicationReferences: ['23-DDQ-PRODAT', null] })).toBeNull()
  })

  it('an invalid or foreign UTILTS reference fails closed instead of reaching the profile', () => {
    // A generic E73 value and an E74 target (E31) are not E73 field-311 values (U-06).
    expect(() => supplierUtiltsRouteApplicationReference({ messageCode: 'E73', registryApplicationReference: '23-DDQ-E73-S' })).toThrow(/invalid/)
    expect(() => supplierUtiltsRouteApplicationReference({ messageCode: 'E73', senderApplicationReferences: ['23-DDQ-E31-S'] })).toThrow(/invalid/)
  })
})

describe('E73 Application Reference names the requested type', () => {
  it('E66 uses the verified E66 profile value, S/T unchanged', () => {
    for (const reference of ['23-DDQ-E66-S', '23-DDQ-E66-T']) {
      expect(resolveE73RequestApplicationReference({ requestedMessageCode: 'E66', routeApplicationReference: reference })).toBe(reference)
    }
  })

  it('E66 without a verified S/T value is never defaulted; an E66 profile never becomes an S02 request', () => {
    expect(() => resolveE73RequestApplicationReference({ requestedMessageCode: 'E66', routeApplicationReference: null })).toThrow(/explicit_value_required:E66/)
    expect(() => resolveE73RequestApplicationReference({ requestedMessageCode: 'S02', routeApplicationReference: '23-DDQ-E66-S' }))
      .toThrow('utilts_e73_route_profile_requested_type_mismatch:E66:S02')
    expect(resolveE73RequestApplicationReference({ requestedMessageCode: 'S02', routeApplicationReference: null })).toBe('23-DDQ-S02-S')
  })

  it('only E66 and S02 can be requested with E73', () => {
    for (const requested of ['E31', 'S03', 'E73', 'S07', '']) {
      expect(() => resolveE73RequestApplicationReference({ requestedMessageCode: requested, routeApplicationReference: null }))
        .toThrow(/utilts_e73_requested_message_unsupported/)
    }
  })
})

describe('requested-type authorization (role, agreement, data right)', () => {
  it('E66 is covered by the bilateral E73 agreement and the verified data right', () => {
    expect(e73AgreedRequestedTypes(null)).toEqual(['E66'])
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'E66', applicationReference: '23-DDQ-E66-S', capabilityMetadata: null, dataRightVerified: true })).not.toThrow()
  })

  it('S02 is allowed with the supplier role, an explicit S02 agreement and the data right', () => {
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'S02', applicationReference: '23-DDQ-S02-S',
      capabilityMetadata: { requested_message_codes: ['E66', 'S02'] }, dataRightVerified: true })).not.toThrow()
  })

  it('S02 is refused without an agreement, without a data right, or outside the supplier role', () => {
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'S02', applicationReference: '23-DDQ-S02-S', capabilityMetadata: null, dataRightVerified: true }))
      .toThrow('utilts_e73_requested_type_not_agreed:S02')
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'S02', applicationReference: '23-DDQ-S02-S',
      capabilityMetadata: { requested_message_codes: ['S02'] }, dataRightVerified: false })).toThrow('utilts_e73_data_right_required:S02')
    // An ESCO (DGI) never assumes S02 because E73 can request S02 in another role.
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'S02', applicationReference: '23-DGI-S02-S',
      capabilityMetadata: { requested_message_codes: ['S02'] }, dataRightVerified: true })).toThrow()
    // An agreement listing only S02 does not cover E66, and the reference must be of the requested type.
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'E66', applicationReference: '23-DDQ-E66-S',
      capabilityMetadata: { requested_message_codes: ['S02'] }, dataRightVerified: true })).toThrow('utilts_e73_requested_type_not_agreed:E66')
    expect(() => assertE73RequestedTypeAuthorized({ requestedMessageCode: 'E66', applicationReference: '23-DDQ-S02-S',
      capabilityMetadata: null, dataRightVerified: true })).toThrow()
  })
})

describe('allowlist: E74, S07 and E66 origination are refused', () => {
  it('only E73 with a verified bilateral capability and an explicit requested type passes the canonical outbound guard', () => {
    expect(assertCanonicalSupplierUtiltsOutboundAllowed({ code: 'E73', bilateralCapabilityVerified: true, requestedMessageCode: 'E66' })).toEqual({ requestedMessageCode: 'E66' })
    expect(() => assertCanonicalSupplierUtiltsOutboundAllowed({ code: 'E73', bilateralCapabilityVerified: false, requestedMessageCode: 'E66' })).toThrow('utilts_bilateral_capability_required:E73')
    for (const code of ['E74', 'S07', 'E66', 'S06', 'ERR']) {
      expect(() => assertCanonicalSupplierUtiltsOutboundAllowed({ code, bilateralCapabilityVerified: true, requestedMessageCode: 'E66' }))
        .toThrow(`utilts_supplier_outbound_not_allowed:${code}`)
    }
  })

  it('the supplier never originates the grid owner E66', async () => {
    await expect(prepareAndQueueUtiltsE66({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })).rejects.toThrow('utilts_e66_supplier_outbound_not_allowed')
    expect(io.outbound).not.toHaveBeenCalled()
  })
})

describe('the E73 flow for missing E66 values', () => {
  it('builds an E73 for the metering point, period and grid owner with Application Reference E66 of the verified profile', async () => {
    const message = await prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })
    expect(message).toMatchObject({ id: 'msg-e73' })
    expect(io.routeCalls[0]).toMatchObject({ messageFamily: 'UTILTS', messageCode: 'E73', companyId: 'company-a', meteringPointId: 'mp',
      payload: expect.objectContaining({ requestedMessageCode: 'E66', bilateralCapabilityVerified: true }) })
    expect(io.structure).toHaveBeenCalledWith(expect.objectContaining({ meteringPointId: 'mp', periodStart: '2026-09-01T00:00:00+02:00', periodEnd: '2026-10-01T00:00:00+02:00' }))
    const draft = io.draft.mock.calls[0][0] as Record<string, unknown>
    expect(draft).toMatchObject({ code: 'E73', applicationReference: '23-DDQ-E66-S', receiverEdielId: '16700', meteringPointId: 'mp', gridOwnerId: 'go',
      payload: expect.objectContaining({ requestedMessageCode: 'E66', meterPointId: '735999000000000001', periodStart: '2026-09-01T00:00:00+02:00' }) })
    expect(io.status).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', responsePayload: expect.objectContaining({ requestedVia: 'UTILTS_E73', applicationReference: '23-DDQ-E66-S' }) }))
  })

  it('S02 is sent only with an explicit S02 agreement; without it nothing is written', async () => {
    currentRequest = request({ requestedMessageCode: 'S02' })
    io.routeApplicationReference = null
    await expect(prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })).rejects.toThrow('utilts_e73_requested_type_not_agreed:S02')
    expect(io.outbound).not.toHaveBeenCalled()

    io.capabilities = [capability({ requested_message_codes: ['E66', 'S02'] })]
    await prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })
    expect(io.draft.mock.calls[0][0]).toMatchObject({ code: 'E73', applicationReference: '23-DDQ-S02-S', payload: expect.objectContaining({ requestedMessageCode: 'S02' }) })
  })

  it('without a data right (no qualified own structure for the period) no request is written', async () => {
    io.structure.mockRejectedValue(new Error('utilts_dated_structure_unavailable:dated_structure_owned_period_missing'))
    await expect(prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })).rejects.toThrow('utilts_dated_structure_unavailable')
    expect(io.outbound).not.toHaveBeenCalled()
    expect(io.draft).not.toHaveBeenCalled()
  })

  it('an E66 request on a profile verified for S02, or without a bilateral capability, is refused before any write', async () => {
    io.routeApplicationReference = '23-DDQ-S02-S'
    await expect(prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })).rejects.toThrow('utilts_e73_route_profile_requested_type_mismatch:S02:E66')
    io.routeApplicationReference = '23-DDQ-E66-S'
    io.capabilities = []
    await expect(prepareAndQueueUtiltsE73({ actorUserId: 'u', gridOwnerDataRequestId: 'dr-1' })).rejects.toThrow('utilts_e73_bilateral_capability_missing:production')
    expect(io.outbound).not.toHaveBeenCalled()
  })
})

describe('UTILTS-ERR only when the prescribed function check rejects; CONTRL is not APERAK', () => {
  const issue = (kind: 'application' | 'functional', transactionId: string) => ({
    severity: 'error' as const, kind, code: kind === 'functional' ? 'UNKNOWN_OBJECT' : 'FIELD_REQUIRED', title: 't', description: 'd',
    referenceNumber: transactionId, lineItemReference: transactionId, ...(kind === 'functional' ? { utiltsErrCode: 'E10' } : { aperakFieldCode: '245' }),
  })

  it('a failed function check gives UTILTS-ERR; a guide error gives a negative APERAK and a passing transaction a positive APERAK', () => {
    const result = resolveUtiltsTransactionDispositions({ syntaxOk: true, transactions: [{ transactionId: 'OK' }, { transactionId: 'FN' }, { transactionId: 'GUIDE' }],
      issues: [issue('functional', 'FN'), issue('application', 'GUIDE')] })
    expect(result.map((row) => [row.transactionId, row.responseType])).toEqual([['OK', 'positive_aperak'], ['FN', 'utilts_err'], ['GUIDE', 'negative_aperak']])
    expect(canonicalAckRequirements({ family: 'UTILTS', code: 'E66' }).supportsUtiltsErr).toBe(true)
  })

  it('without a failed function check no UTILTS-ERR is created', () => {
    const result = resolveUtiltsTransactionDispositions({ syntaxOk: true, transactions: [{ transactionId: 'OK' }], issues: [] })
    expect(result.some((row) => row.responseType === 'utilts_err')).toBe(false)
  })

  it('a positive CONTRL on our E73 is classified as CONTRL and never as the APERAK E73 also requires', () => {
    const contrl = classifyCanonicalInboundAck({ messageFamily: 'CONTRL', messageCode: 'CONTRL', messageFunctionCode: null, applicationReference: '23-DDQ-E66-S',
      messageTypeVersion: { release: '2', associationAssignedCode: 'EDIEL2' }, errorCodes: [], references: { UCI_ACTION: ['1'] } } as never)
    expect(contrl).toMatchObject({ family: 'CONTRL', outcome: 'positive', profile: null })
    const aperak = classifyCanonicalInboundAck({ messageFamily: 'APERAK', messageCode: '312', messageFunctionCode: null, applicationReference: '23-DDQ-E66-S',
      messageTypeVersion: { release: '04A', associationAssignedCode: 'E5SE5A' }, errorCodes: [], references: {} } as never)
    expect(aperak).toMatchObject({ family: 'APERAK', outcome: 'positive', profile: 'UTILTS_25_A' })
    const e73 = canonicalAckRequirements({ family: 'UTILTS', code: 'E73' })
    expect(e73).toMatchObject({ requiresContrl: true, requiresAperak: true })
  })
})
