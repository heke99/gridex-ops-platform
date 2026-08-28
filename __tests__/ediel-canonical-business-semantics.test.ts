import { describe, expect, it } from 'vitest'

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
