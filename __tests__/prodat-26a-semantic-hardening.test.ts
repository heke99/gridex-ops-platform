import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { gridexBusinessMessageLabel } from '@/lib/ediel/businessLabels'
import { messageForRequestType, fallbackMessageSemantics } from '@/lib/ediel/messageSemantics'
import { applyPermissionEvent } from '@/lib/ediel/permissions/permissionEngine'
import {
  getProdatMessageSupport,
  isProdatCodeReceivable,
  isProdatCodeSendable,
  verifyProdatRegistryConsistency,
} from '@/lib/ediel/prodat/prodatMessageSupportRegistry'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import { activeRulebookRules, processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'
import { decideProdatLifecycle, normalizeProdatSubtype } from '@/lib/ediel/stateMachines/prodatLifecycle'

describe('PRODAT 26.A semantic hardening', () => {
  it('locks canonical direction and market roles per message function', () => {
    const expected = {
      Z01: ['actor_to_portal', 'supplier', 'grid_owner'],
      Z02: ['portal_to_actor', 'grid_owner', 'supplier'],
      Z03: ['actor_to_portal', 'supplier', 'grid_owner'],
      Z04: ['portal_to_actor', 'grid_owner', 'supplier'],
      Z05: ['portal_to_actor', 'grid_owner', 'supplier'],
      Z06: ['portal_to_actor', 'grid_owner', 'supplier'],
      Z08: ['actor_to_portal', 'supplier', 'grid_owner'],
      Z09: ['actor_to_portal', 'supplier', 'grid_owner'],
      Z10: ['portal_to_actor', 'grid_owner', 'supplier'],
      Z13: ['actor_to_portal', 'esco', 'grid_owner'],
      Z14: ['portal_to_actor', 'grid_owner', 'esco'],
      Z15: ['portal_to_actor', 'grid_owner', 'esco'],
      Z18: ['actor_to_portal', 'esco', 'grid_owner'],
    } as const

    for (const [code, [direction, senderRole, receiverRole]] of Object.entries(expected)) {
      const profile = getCanonicalProdatProfile(code)
      expect(profile, code).not.toBeNull()
      expect(profile?.direction).toBe(direction)
      expect(profile?.senderRole).toBe(senderRole)
      expect(profile?.receiverRole).toBe(receiverRole)
    }
  })

  it('never classifies inbound-only Gridex messages as sendable', () => {
    for (const code of ['Z02', 'Z04', 'Z05', 'Z06', 'Z10', 'Z14', 'Z15']) {
      expect(isProdatCodeSendable(code), code).toBe(false)
      expect(isProdatCodeReceivable(code), code).toBe(true)
    }

    for (const code of ['Z01', 'Z03', 'Z08', 'Z09', 'Z13', 'Z18']) {
      expect(isProdatCodeSendable(code), code).toBe(true)
    }

    expect(verifyProdatRegistryConsistency()).toEqual({ ok: true, issues: [] })
    expect(getProdatMessageSupport('Z13')?.allowedSenderRoles).toEqual(['esco'])
  })

  it('keeps tenant wording simple while preserving subtype meaning', () => {
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z03', reasonForTransaction: 'Z22' })).toBe('Leverantörsbyte')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z03', reasonForTransaction: 'Z23' })).toBe('Inflytt / leverantörsbyte')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z05', reasonForTransaction: 'Z24' })).toBe('Leveransen fortsätter')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z15', reasonForTransaction: 'Z24' })).toBe('Mätvärdesrapportering fortsätter')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z13', reasonForTransaction: 'S18' })).toBe('Begär historiska mätvärden')
  })

  it('normalizes the complete Swedish 26.A transaction code set used by Gridex', () => {
    const expected = {
      Z22: 'L', Z23: 'LK', Z24: 'C', Z25: 'H', Z26: 'A', Z27: 'B', Z70: 'D', Z96: 'N',
      E34: 'E', E58: 'M', E64: 'F', E32: 'G', S17: 'V', S18: 'VH',
    }
    for (const [reason, subtype] of Object.entries(expected)) {
      expect(normalizeProdatSubtype('Z15', reason), reason).toBe(subtype)
    }
  })

  it('treats Z05C and Z15C as reversals instead of terminations', () => {
    const z05c = decideProdatLifecycle({
      message_code: 'Z05',
      parsed_payload: { reasonForTransaction: 'Z24' },
      raw_payload: '',
      direction: 'inbound',
    })
    expect(z05c?.subtype).toBe('C')
    expect(z05c?.outcome).toBe('supply_continuation_confirmed')
    expect(z05c?.endSupplyPeriod).toBe(false)

    const z15c = decideProdatLifecycle({
      message_code: 'Z15',
      parsed_payload: { reasonForTransaction: 'Z24' },
      raw_payload: '',
      direction: 'inbound',
    })
    expect(z15c?.subtype).toBe('C')
    expect(z15c?.outcome).toBe('permission_continues')

    expect(applyPermissionEvent({
      currentState: 'termination_requested_after_z18',
      event: 'z15_c_continues',
    })).toBe('active_after_z14v_or_z14vh')
  })

  it('quarantines inbound messages that should originate from Gridex market role', () => {
    const inboundZ03 = decideProdatLifecycle({
      message_code: 'Z03',
      parsed_payload: { reasonForTransaction: 'Z22' },
      raw_payload: '',
      direction: 'inbound',
    })
    expect(inboundZ03?.outcome).toBe('unexpected_direction_review')

    const inboundZ18 = decideProdatLifecycle({
      message_code: 'Z18',
      parsed_payload: { reasonForTransaction: 'S17' },
      raw_payload: '',
      direction: 'inbound',
    })
    expect(inboundZ18?.outcome).toBe('unexpected_direction_review')
  })

  it('separates masterdata, meter and delivery-contract processes from supplier switch', () => {
    expect(processGroupForMessage('PRODAT', 'Z03')).toBe('supplier_switch')
    expect(processGroupForMessage('PRODAT', 'Z06')).toBe('masterdata')
    expect(processGroupForMessage('PRODAT', 'Z08')).toBe('delivery_contract')
    expect(processGroupForMessage('PRODAT', 'Z09')).toBe('masterdata')
    expect(processGroupForMessage('PRODAT', 'Z10')).toBe('metering')

    const z06 = activeRulebookRules().find((rule) => rule.family === 'PRODAT' && rule.code === 'Z06')
    const z09 = activeRulebookRules().find((rule) => rule.family === 'PRODAT' && rule.code === 'Z09')
    expect(z06?.allowedSubtypes).toContain('E34')
    expect(z09?.allowedSubtypes).toContain('E34')
    expect(z06?.allowedSubtypes).not.toContain('Z34')
    expect(z09?.allowedSubtypes).not.toContain('Z34')
  })

  it('never maps a supplier metering-values request to outbound E66', () => {
    expect(messageForRequestType('metering_values_request')).toEqual({
      messageFamily: 'UTILTS',
      messageCode: 'E73',
    })
    expect(fallbackMessageSemantics({ messageFamily: 'UTILTS', messageCode: 'E66' })?.direction).toBe('inbound')
    expect(fallbackMessageSemantics({ messageFamily: 'UTILTS', messageCode: 'E73' })?.direction).toBe('outbound')
  })

  it('ships a DB invariant that requires inbound Z04 for accepted/completed switches', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260822010000_prodat_26a_semantic_hardening.sql'),
      'utf8',
    )
    expect(migration).toContain("new.status in ('accepted','completed')")
    expect(migration).toContain('supplier_switch_business_confirmation_requires_inbound_z04')
    expect(migration).toContain("upper(coalesce(m.message_code,'')) = 'Z04'")
    expect(migration).toContain("profile.direction = contract.direction")
    expect(migration).toContain('Expected 34 active PRODAT 26.A semantic rows')
  })
})
