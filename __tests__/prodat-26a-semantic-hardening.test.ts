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
import {
  assertCanonicalEdielBusinessSemanticCoverage,
  resolveCanonicalEdielBusinessSemantics,
} from '@/lib/ediel/rulebook/businessSemantics'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import {
  resolveProdatBusinessContext,
  resolveProdatSubtype,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { activeRulebookRules, processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'
import { decideProdatLifecycle, normalizeProdatSubtype } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'

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
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z03', reasonForTransaction: 'Z23' })).toBe('Inflytt / kund- och leverantörsbyte')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z05', reasonForTransaction: 'Z24' })).toBe('Leveransen fortsätter')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z15', reasonForTransaction: 'Z24' })).toBe('Mätvärdesrapportering fortsätter')
    expect(gridexBusinessMessageLabel({ family: 'PRODAT', code: 'Z13', reasonForTransaction: 'S18' })).toBe('Begär historisk mätvärdesåtkomst')
    expect(gridexBusinessMessageLabel({ family: 'UTILTS', code: 'S02' })).toBe('Förbrukningsprognos')
    expect(gridexBusinessMessageLabel({ family: 'UTILTS', code: 'E66' })).toBe('Validerade mätvärden mottagna')
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

  it('has one canonical business meaning for every supported PRODAT subtype and UTILTS profile', () => {
    expect(() => assertCanonicalEdielBusinessSemanticCoverage()).not.toThrow()

    const z01 = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z01', subtype: 'L' })
    expect(z01?.businessProcess).toBe('grid_contract_check_supplier_switch')
    expect(z01?.businessEffect).toBe('request_grid_contract_check')
    expect(z01?.officialMeaning).toContain('valid grid agreement')

    const z03lk = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z03', subtype: 'LK' })
    expect(z03lk?.businessProcess).toBe('customer_and_supplier_change')
    expect(z03lk?.officialMeaning).toContain('not the only meaning')

    const z08h = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z08', subtype: 'H' })
    expect(z08h?.businessEffect).toBe('request_supply_end')
    expect(z08h?.expectedBusinessResponses).toContain('PRODAT:Z05:L')

    const z18v = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z18', subtype: 'V' })
    expect(z18v?.businessEffect).toBe('request_stop_metering_reporting')
    expect(z18v?.expectedBusinessResponses).toContain('PRODAT:Z15:V')
  })

  it('distinguishes metering permission, historical access, forecasts, values and missing-data requests', () => {
    const z13v = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z13', subtype: 'V' })
    const z13vh = resolveCanonicalEdielBusinessSemantics({ family: 'PRODAT', code: 'Z13', subtype: 'VH' })
    const e66 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E66' })
    const e73 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E73' })
    const s02 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'S02' })
    const e31 = resolveCanonicalEdielBusinessSemantics({ family: 'UTILTS', code: 'E31' })

    expect(z13v?.domainObject).toBe('metering_data_permission')
    expect(z13v?.carriesQuantities).toBe(false)
    expect(z13v?.requestsData).toBe(true)
    expect(z13vh?.historical).toBe(true)
    expect(z13vh?.businessEffect).toBe('request_historical_metering_data')

    expect(e66?.domainObject).toBe('validated_metering_values')
    expect(e66?.carriesQuantities).toBe(true)
    expect(e66?.requestsData).toBe(false)

    expect(e73?.businessEffect).toBe('request_missing_values')
    expect(e73?.carriesQuantities).toBe(false)
    expect(e73?.expectedBusinessResponses).toEqual(['UTILTS:E66', 'UTILTS:S02'])

    expect(s02?.domainObject).toBe('object_consumption_forecast')
    expect(s02?.carriesQuantities).toBe(true)

    expect(e31?.dataScope).toBe('grid_area')
    expect(fallbackMessageSemantics({ messageFamily: 'UTILTS', messageCode: 'E31' })?.requiredFields).toEqual(['grid_area_id', 'period'])
  })

  it('enforces Z04A bilateral use and context-sensitive E34 rules', () => {
    expect(resolveProdatSubtype({ messageCode: 'Z04', subtypeOrReasonCode: 'A' })).toMatchObject({
      ok: false,
      subtype: 'A',
      bilateralRequired: true,
    })
    expect(resolveProdatSubtype({ messageCode: 'Z04', subtypeOrReasonCode: 'Z26', bilateralCapabilityVerified: true })).toMatchObject({
      ok: true,
      subtype: 'A',
      bilateralRequired: true,
    })

    expect(resolveProdatBusinessContext({
      messageCode: 'Z06',
      subtypeOrReasonCode: 'E34',
      businessContext: 'death',
    })).toMatchObject({ ok: true, customerStatusRequired: true, bilateralRequired: false })

    expect(resolveProdatBusinessContext({
      messageCode: 'Z09',
      subtypeOrReasonCode: 'E',
      businessContext: 'identity_change',
    })).toMatchObject({ ok: false, bilateralRequired: true })

    expect(resolveProdatBusinessContext({
      messageCode: 'Z09',
      subtypeOrReasonCode: 'E',
      businessContext: 'identity_change',
      bilateralCapabilityVerified: true,
    })).toMatchObject({ ok: true, bilateralRequired: true })
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

  it('never maps data-access permission or a missing-values request to the wrong family', () => {
    expect(messageForRequestType('metering_values_request')).toEqual({
      messageFamily: 'UTILTS',
      messageCode: 'E73',
    })
    expect(messageForRequestType('metering_access_request')).toEqual({
      messageFamily: 'PRODAT',
      messageCode: 'Z13',
      subtype: 'V',
    })
    expect(messageForRequestType('historical_metering_access_request')).toEqual({
      messageFamily: 'PRODAT',
      messageCode: 'Z13',
      subtype: 'VH',
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

    const activationMigration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260822012000_supplier_switch_effective_date_guard.sql'),
      'utf8',
    )
    expect(activationMigration).toContain('supplier_switch_effective_date_not_reached')
    expect(activationMigration).toContain("time zone 'Europe/Stockholm'")
  })

  it('removes legacy source paths that treated transport ACK as business acceptance', () => {
    const cisActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/cis/actions.ts'), 'utf8')
    const controlActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/control-actions.ts'), 'utf8')
    const inboundState = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/flows/inboundBusinessStateMachine.ts'), 'utf8')
    const prodatSource = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/prodat.ts'), 'utf8')

    expect(cisActions).not.toMatch(/outboundRequest\.status === 'acknowledged'[\s\S]{0,500}status: 'accepted'/)
    expect(controlActions).not.toMatch(/outboundRequest\.status === 'acknowledged'[\s\S]{0,500}status: 'accepted'/)
    expect(controlActions).not.toContain('finalizeAcceptedSwitchFromAcknowledgedOutbound')
    expect(inboundState).not.toContain("status: 'confirmed'")
    expect(prodatSource).not.toContain("if (code === 'Z05') return 'Inflytt/övertagande'")
    expect(prodatSource).not.toContain("if (code === 'Z06') return 'Svar på inflytt/övertagande'")
    expect(prodatSource).not.toContain("if (code === 'Z05') return 'move_in_request'")
    expect(prodatSource).toContain('prodat_outbound_direction_not_allowed')
  })

  it('requires inbound Z04 and reached effective date before supply activation', () => {
    const base = {
      status: 'accepted' as const,
      inbound_z04_message_id: 'z04-message',
      confirmed_start_date: '2026-08-22',
      requested_start_date: '2026-08-22',
    }
    expect(getSupplierSwitchActivationReadiness(base, new Date('2026-08-22T10:00:00Z')).ready).toBe(true)
    expect(getSupplierSwitchActivationReadiness({ ...base, inbound_z04_message_id: null }, new Date('2026-08-22T10:00:00Z')).code).toBe('missing_z04_confirmation')
    expect(getSupplierSwitchActivationReadiness({ ...base, confirmed_start_date: '2026-08-23' }, new Date('2026-08-22T10:00:00Z')).code).toBe('awaiting_effective_start_date')

    const controlActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/control-actions.ts'), 'utf8')
    const operationsActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/actions.ts'), 'utf8')
    expect(controlActions).not.toContain("['queued', 'submitted', 'accepted']")
    expect(operationsActions).toContain('inbound_z04_plus_effective_start_date')
    expect(operationsActions).not.toContain('findAcknowledgedOutboundForSwitch')
  })
})
