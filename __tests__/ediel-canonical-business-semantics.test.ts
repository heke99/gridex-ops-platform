import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import {
  assertMessageMatchesRequestType,
  fallbackMessageSemantics,
  messageForRequestType,
} from '@/lib/ediel/messageSemantics'
import {
  assertCanonicalEdielBusinessSemanticCoverage,
  resolveCanonicalEdielBusinessSemantics,
} from '@/lib/ediel/rulebook/businessSemantics'
import { resolveCanonicalProdatRuntimeProfile } from '@/lib/ediel/rulebook/prodatRuntimeProfileRegistry'

describe('canonical Ediel business semantics', () => {
  it('covers every canonical PRODAT subtype and UTILTS profile', () => {
    expect(() => assertCanonicalEdielBusinessSemanticCoverage()).not.toThrow()
  })

  it('preserves exact Z01/Z02/Z10 transaction meaning instead of wildcarding it', () => {
    expect(resolveCanonicalProdatRuntimeProfile({
      code: 'Z01', subtypeOrReasonCode: 'L', version: '26A',
    })).toMatchObject({ subtype: 'L', businessResponse: 'Z02L' })
    expect(resolveCanonicalProdatRuntimeProfile({
      code: 'Z01', subtypeOrReasonCode: 'LK', version: '26A',
    })).toMatchObject({ subtype: 'LK', businessResponse: 'Z02LK' })
    expect(resolveCanonicalProdatRuntimeProfile({
      code: 'Z02', subtypeOrReasonCode: 'L', version: '26A',
    })?.subtype).toBe('L')
    expect(resolveCanonicalProdatRuntimeProfile({
      code: 'Z02', subtypeOrReasonCode: 'LK', version: '26A',
    })?.subtype).toBe('LK')
    expect(resolveCanonicalProdatRuntimeProfile({
      code: 'Z10', subtypeOrReasonCode: 'M', version: '26A',
    })?.subtype).toBe('M')

    expect(resolveCanonicalProdatRuntimeProfile({ code: 'Z01', version: '26A' })).toBeNull()
    expect(resolveCanonicalProdatRuntimeProfile({ code: 'Z02', version: '26A' })).toBeNull()
    expect(resolveCanonicalProdatRuntimeProfile({ code: 'Z10', version: '26A' })).toBeNull()
  })

  it('derives the positive Z01 acknowledgement path from the canonical ACK matrix', () => {
    const z01 = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z01', subtype: 'L' })
    expect(z01?.expectedAcknowledgements).toEqual(['CONTRL'])
    expect(z01?.expectedBusinessResponses).toEqual(['PRODAT:Z02:L'])

    const compatibility = fallbackMessageSemantics({ messageFamily: 'PRODAT', messageCode: 'Z01', subtype: 'L' })
    expect(compatibility?.ackPolicy).toBe('technical_ack_only')
    expect(compatibility?.expectedResponse).toEqual(['CONTRL', 'PRODAT:Z02:L'])
  })

  it('does not confuse metering permission, historical access, values or forecasts', () => {
    const currentAccess = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z13', subtype: 'V' })
    const historicalAccess = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z13', subtype: 'VH' })
    const values = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E66' })
    const forecast = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'S02' })
    const missing = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E73' })

    expect(currentAccess).toMatchObject({
      domainObject: 'metering_data_permission', carriesQuantities: false, historical: false,
    })
    expect(historicalAccess).toMatchObject({
      domainObject: 'historical_metering_data_permission', carriesQuantities: false, historical: true,
    })
    expect(values).toMatchObject({
      domainObject: 'validated_metering_values', carriesQuantities: true, supplierUtiltsSupport: 'inbound_only',
    })
    expect(forecast).toMatchObject({
      domainObject: 'object_consumption_forecast', carriesQuantities: true, supplierUtiltsSupport: 'inbound_only',
    })
    expect(missing).toMatchObject({
      businessEffect: 'request_missing_values', carriesQuantities: false, supplierUtiltsSupport: 'outbound_only',
    })
    expect(missing?.expectedBusinessResponses).toEqual(['UTILTS:E66', 'UTILTS:S02'])
  })

  it('preserves UTILTS identity alternatives instead of falsely requiring a metering point', () => {
    const e66 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E66' })
    expect(e66?.dataScope).toBe('metering_point_or_regulating_object')
    expect(fallbackMessageSemantics({ messageFamily: 'UTILTS', messageCode: 'E66' })?.requiredFields).toEqual([])

    const e31 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E31' })
    expect(e31?.dataScope).toBe('grid_area')
    expect(fallbackMessageSemantics({ messageFamily: 'UTILTS', messageCode: 'E31' })?.requiredFields).toEqual(['grid_area_id', 'period'])
  })

  it('maps cancellation, rescission and reporting termination to different business messages', () => {
    expect(messageForRequestType('supplier_switch_cancellation')).toEqual({
      messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'C',
    })
    expect(messageForRequestType('contract_rescission')).toEqual({
      messageFamily: 'PRODAT', messageCode: 'Z08', subtype: 'H',
    })
    expect(messageForRequestType('metering_access_end_request')).toEqual({
      messageFamily: 'PRODAT', messageCode: 'Z18', subtype: 'V',
    })

    expect(resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z05', subtype: 'C' })?.operationKind).toBe('reversal')
    expect(resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z15', subtype: 'C' })?.operationKind).toBe('reversal')
  })

  it('retains the request/message compatibility guard on top of canonical semantics', async () => {
    await expect(assertMessageMatchesRequestType({
      requestType: 'supplier_switch', messageFamily: 'PRODAT', messageCode: 'Z03', subtype: 'L',
    })).resolves.toMatchObject({ ok: true })

    await expect(assertMessageMatchesRequestType({
      requestType: 'supplier_switch', messageFamily: 'PRODAT', messageCode: 'Z08', subtype: 'H',
    })).resolves.toMatchObject({ ok: false, reason: 'message_code_request_type_mismatch' })
  })
})

describe('published canonical market and business semantics', () => {
  it.each(['row', 'backing array'] as const)('keeps the first E73 send held after attempted %s replacement', async (target) => {
    vi.resetModules()
    const { UTILTS_CANONICAL_MARKET_PROFILES, getCanonicalUtiltsMarketProfile } = await import('@/lib/ediel/rulebook/utiltsMarketSemantics')
    const { UTILTS_MARKET_PROFILES } = await import('@/lib/ediel/rulebook/utiltsMarketEngine')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = getCanonicalUtiltsMarketProfile('E73')!
    expect(row.bilateralRequired).toBe(true)
    expect(UTILTS_MARKET_PROFILES).toBe(UTILTS_CANONICAL_MARKET_PROFILES)
    const changed = target === 'row' ? Reflect.set(row, 'bilateralRequired', false)
      : Reflect.set(UTILTS_CANONICAL_MARKET_PROFILES, String(UTILTS_CANONICAL_MARKET_PROFILES.indexOf(row)), { ...row, bilateralRequired: false })
    try {
      expect(() => resolveCanonicalEdielPolicy({
        family: 'UTILTS', messageCode: 'E73', direction: 'outbound', referenceDate: '2026-10-15',
        applicationReference: '23-DDQ-E66-S', requestedMessageCode: 'E66', bilateralCapabilityVerified: false, mode: 'send',
      })).toThrow('utilts_bilateral_capability_required:E73')
      expect(changed).toBe(false)
    } finally { vi.resetModules() }
  })

  it('preserves market roles before the first dependent profile import and canonical selection', async () => {
    vi.resetModules()
    const { getCanonicalUtiltsMarketProfile } = await import('@/lib/ediel/rulebook/utiltsMarketSemantics')
    const row = getCanonicalUtiltsMarketProfile('E73')!
    const changes = [Reflect.set(row.senderRoles, '0', 'unqualified_sender'), Reflect.set(row.receiverRoles, '0', 'unqualified_receiver')]
    try {
      const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
      const policy = resolveCanonicalEdielPolicy({
        family: 'UTILTS', messageCode: 'E73', direction: 'outbound', referenceDate: '2026-10-15',
        applicationReference: '23-DDQ-E66-S', requestedMessageCode: 'E66', mode: 'catalog_evidence',
      })
      expect(policy.utiltsProfile?.allowedSenderRoles[0]).toBe('supplier')
      expect(policy.utiltsProfile?.allowedReceiverRoles).toEqual(['grid_owner'])
      expect(changes).toEqual([false, false])
    } finally { vi.resetModules() }
  })

  it('retains all four nested semantic arrays in the first actual Z01 policy projection', async () => {
    vi.resetModules()
    const { listCanonicalEdielBusinessSemantics, resolveCanonicalEdielBusinessSemantics } = await import('@/lib/ediel/rulebook/businessSemantics')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z01', subtype: 'L' })!
    expect(listCanonicalEdielBusinessSemantics()).toContain(row)
    const changes = [
      Reflect.set(row.expectedBusinessResponses, '0', 'PRODAT:Z99:L'), Reflect.set(row.expectedAcknowledgements, '0', 'UNQUALIFIED_ACK'),
      Reflect.set(row.senderRoles, '0', 'unqualified_sender'), Reflect.set(row.receiverRoles, '0', 'unqualified_receiver'),
    ]
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L', direction: 'outbound', referenceDate: '2026-10-15', mode: 'catalog_evidence' })
      expect(policy.businessResponses).toEqual(['PRODAT:Z02:L'])
      expect(policy.semantics.expectedAcknowledgements).toEqual(['CONTRL'])
      expect(policy.semantics.senderRoles).toEqual(['supplier'])
      expect(policy.semantics.receiverRoles).toEqual(['grid_owner'])
      expect(policy.ackRule.businessResponses).toEqual(['Z02'])
      expect(changes).toEqual([false, false, false, false])
    } finally { vi.resetModules() }
  })

  it('retains the published semantic effect and source locator in the first canonical trace', async () => {
    vi.resetModules()
    const { resolveCanonicalEdielBusinessSemantics } = await import('@/lib/ediel/rulebook/businessSemantics')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z01', subtype: 'L' })!
    const changes = [Reflect.set(row, 'businessEffect', 'unqualified_effect'), Reflect.set(row.source, 'pageOrSection', 'unqualified locator')]
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L', direction: 'outbound', referenceDate: '2026-10-15', mode: 'catalog_evidence' })
      expect(policy.semantics.businessEffect).toBe('request_grid_contract_check')
      expect(policy.sourceTrace.find(source => source.authority === 'business_semantics')).toEqual({
        authority: 'business_semantics', document: 'Ediel PRODAT/APERAK + Svensk Elmarknadshandbok',
        section: 'PRODAT field 223 and Handbook chapters 4, 10, 11',
      })
      expect(changes).toEqual([false, false])
    } finally { vi.resetModules() }
  })

  it('cannot replace the published semantic row through its actual list alias before selection', async () => {
    vi.resetModules()
    const { CANONICAL_EDIEL_BUSINESS_SEMANTICS, listCanonicalEdielBusinessSemantics, resolveCanonicalEdielBusinessSemantics } = await import('@/lib/ediel/rulebook/businessSemantics')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z01', subtype: 'L' })!
    const list = listCanonicalEdielBusinessSemantics()
    expect(list).toBe(CANONICAL_EDIEL_BUSINESS_SEMANTICS)
    const changed = Reflect.set(list, String(list.indexOf(row)), { ...row, businessEffect: 'unqualified_effect' })
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L', direction: 'outbound', referenceDate: '2026-10-15', mode: 'catalog_evidence' })
      expect(policy.semantics.businessEffect).toBe('request_grid_contract_check')
      expect(changed).toBe(false)
    } finally { vi.resetModules() }
  })
})
