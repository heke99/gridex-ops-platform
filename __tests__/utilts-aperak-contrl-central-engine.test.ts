import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  UTILTS_MARKET_PROFILES,
  assertSupplierUtiltsOutboundAllowed,
  getSupplierUtiltsSupport,
  getUtiltsMarketProfile,
  resolveCanonicalUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsMarketEngine'
import {
  decideUtiltsAckFamily,
  getCanonicalUtiltsProfile,
} from '@/lib/ediel/rulebook/utiltsRulebook'
import {
  isUtiltsCodeReceivable,
  isUtiltsCodeSendable,
  verifyUtiltsRegistryConsistency,
} from '@/lib/ediel/utilts/utiltsMessageSupportRegistry'
import { resolveCanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'

describe('central Swedish UTILTS market engine', () => {
  it('covers the complete current canonical code set exactly once', () => {
    expect(UTILTS_MARKET_PROFILES.map((entry) => entry.code)).toEqual([
      'S01','S02','S03','S04','S05','S06','S07','E30','E31','E66','E72','E73','E74','ERR',
    ])
    expect(new Set(UTILTS_MARKET_PROFILES.map((entry) => entry.code)).size).toBe(14)
  })

  it('models the supplier-facing directions instead of broad both-direction aliases', () => {
    expect(getSupplierUtiltsSupport('S02')).toBe('inbound_only')
    expect(getSupplierUtiltsSupport('S03')).toBe('inbound_only')
    expect(getSupplierUtiltsSupport('S05')).toBe('inbound_only')
    expect(getSupplierUtiltsSupport('E31')).toBe('inbound_only')
    expect(getSupplierUtiltsSupport('E66')).toBe('inbound_only')
    expect(getSupplierUtiltsSupport('E73')).toBe('outbound_only')

    expect(isUtiltsCodeReceivable('E66')).toBe(true)
    expect(isUtiltsCodeSendable('E66')).toBe(false)
    expect(isUtiltsCodeSendable('E73')).toBe(true)
  })

  it('requires bilateral capability for every Swedish UTILTS request family', () => {
    for (const code of ['S06','E72','E73','E74']) {
      expect(getUtiltsMarketProfile(code)?.bilateralRequired).toBe(true)
      expect(getCanonicalUtiltsProfile(code)?.bilateralCapabilityRequired).toBe(true)
    }
  })

  it('blocks supplier E66 and fail-closes E73 without bilateral proof/requested application', () => {
    expect(() => assertSupplierUtiltsOutboundAllowed({ code: 'E66' }))
      .toThrow('utilts_supplier_outbound_not_allowed:E66')
    expect(() => assertSupplierUtiltsOutboundAllowed({ code: 'E73', requestedMessageCode: 'E66' }))
      .toThrow('utilts_bilateral_capability_required:E73')
    expect(() => assertSupplierUtiltsOutboundAllowed({ code: 'E73', bilateralCapabilityVerified: true }))
      .toThrow('utilts_e73_requested_message_required')
    expect(assertSupplierUtiltsOutboundAllowed({
      code: 'E73', bilateralCapabilityVerified: true, requestedMessageCode: 'E66',
    })).toEqual({ requestedMessageCode: 'E66' })
  })

  it('derives E73 Application Reference from the requested application, never generic UTILTS', () => {
    expect(resolveCanonicalUtiltsApplicationReference({
      code: 'E73', actorRole: 'supplier', requestedMessageCode: 'S02', resolution: 'monthly',
    })).toBe('23-DDQ-S02-S')
    expect(resolveCanonicalUtiltsApplicationReference({
      code: 'E73', actorRole: 'supplier', requestedMessageCode: 'E66', resolution: '15',
    })).toBe('23-DDQ-E66-T')
    expect(resolveCanonicalUtiltsApplicationReference({
      code: 'E73', actorRole: 'supplier', requestedMessageCode: 'E66', resolution: 'hourly',
    })).toBe('23-DDQ-E66-S')
    expect(() => resolveCanonicalUtiltsApplicationReference({ code: 'E73', actorRole: 'supplier' }))
      .toThrow('utilts_e73_requested_message_required')

    const registry = verifyUtiltsRegistryConsistency()
    expect(registry).toEqual({ ok: true, issues: [] })
  })
})

describe('UTILTS validation class -> acknowledgement family', () => {
  it('keeps syntax, guide and processability errors separate', () => {
    expect(decideUtiltsAckFamily({ syntaxOk: false })).toBe('negative_contrl')
    expect(decideUtiltsAckFamily({ syntaxOk: true, hasApplicationError: true })).toBe('negative_aperak')
    expect(decideUtiltsAckFamily({ syntaxOk: true, hasFunctionalError: true })).toBe('utilts_err')
    expect(decideUtiltsAckFamily({ syntaxOk: true })).toBe('positive_aperak')
  })

  it('models CONTRL, APERAK and UTILTS-ERR as distinct protocol layers', () => {
    const contrl = resolveCanonicalAckMatrixRule({ family: 'CONTRL' })
    expect(contrl.acknowledgeIncomingMessageWith).toEqual([])

    const aperak = resolveCanonicalAckMatrixRule({ family: 'APERAK' })
    expect(aperak.acknowledgeIncomingMessageWith).toEqual(['CONTRL'])
    expect(aperak.applicationAck).toBe('none')

    const utiltsErr = resolveCanonicalAckMatrixRule({ family: 'UTILTS_ERR' })
    expect(utiltsErr.acknowledgeIncomingMessageWith).toEqual(['CONTRL', 'APERAK'])

    const utilts = resolveCanonicalAckMatrixRule({ family: 'UTILTS', code: 'E66' })
    expect(utilts.technicalAck).toBe('CONTRL')
    expect(utilts.applicationAck).toBe('transactional')
    expect(utilts.negativeApplicationResponse).toBe('APERAK_OR_UTILTS_ERR')
  })
})

describe('database defense in depth', () => {
  it('pins the operational supplier guard and canonical ACK rule version', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260822130000_utilts_aperak_contrl_central_engine.sql'),
      'utf8',
    )
    expect(migration).toContain('utilts_e66_supplier_outbound_not_allowed')
    expect(migration).toContain('utilts_e73_bilateral_capability_required')
    expect(migration).toContain('utilts_generic_application_reference_forbidden')
    expect(migration).toContain("'23-DDQ-S02-S'")
    expect(migration).toContain("'23-DDQ-E66-T'")
    expect(migration).toContain("'23-DDQ-E66-S'")
    expect(migration).toContain("'canonical-2026-08-22'")
    expect(migration).toContain('transport_ack_is_not_business_acceptance')
  })
})
