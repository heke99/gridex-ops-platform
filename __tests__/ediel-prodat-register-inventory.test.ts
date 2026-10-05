import { describe, expect, it } from 'vitest'

import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import {
  resolveProdatDependentCondition,
  type ProdatDependentConditionFacts,
} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import { preflightEdielMessageRow, preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { reconcileProdatRegisterInventoryStatus } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, qty, raw, type Parts } from './fixtures/prodat-register'

const variants = { Z04: 'L', Z06: 'F', Z10: 'M' } as const
const reason = (variant: string): Parts[] => characteristic('Z13', ({ L: 'Z22', F: 'E64', M: 'Z70' } as Record<string, string>)[variant])
const objectFact = (meteringPointId: string, expectedRegisterCount?: number | null, identityAgency: '9' | '89' = '89') => ({
  meteringPointId,
  identityAgency,
  ...(expectedRegisterCount === undefined ? {} : { expectedRegisterCount }),
  meterReadingsSentInUtilts: false,
})

function field258Issues(
  code: keyof typeof variants,
  body: Parts[],
  facts: ProdatDependentConditionFacts,
  direction: 'inbound' | 'outbound' = 'outbound',
  alphabet: readonly string[] = alphabets[0],
) {
  const policy = resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode: code,
    subtypeOrReasonCode: variants[code],
    direction,
    referenceDate: '2026-09-19',
    applicationReference: '23-DDQ-PRODAT',
    bilateralCapabilityVerified: true,
    prodatDependentFacts: facts,
    mode: direction === 'outbound' ? 'catalog_evidence' : 'parse',
  })
  const narrowed = {
    ...policy,
    fieldRules: policy.fieldRules.filter((rule) => 'fieldNumber' in rule && rule.fieldNumber === '258'),
  }
  const wire = input(raw(body, code, alphabet), code)
  return validateCanonicalPolicyFields({ policy: narrowed, rawSegments: wire.rawSegments, una: wire.una })
}

describe('field 258 uses independent physical register inventory', () => {
  for (const code of Object.keys(variants) as Array<keyof typeof variants>) {
    for (const alphabet of alphabets) {
      it(`${code}: absent inventory stays unknown for a syntactically valid singleton (${alphabet.join('')})`, () => {
        const payload = raw([line('1', 'A'), ...reason(variants[code]), qty('10')], code, alphabet)
        const wire = input(payload, code)
        const issues = field258Issues(code, [line('1', 'A'), ...reason(variants[code]), qty('10')], {
          market: 'electricity',
          meterReadingsSentInUtilts: false,
          multipleMeterRegisters: false,
          byCell: { [`${code}:258`]: false },
        }, 'outbound', alphabet)
        expect(wire.una).toEqual(expect.objectContaining({ componentDataElementSeparator: alphabet[0] }))
        expect(issues).toContainEqual(expect.objectContaining({
          code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',
          fieldPath: 'LIN/C829/1082',
          blocking: true,
        }))
      })
    }
  }

  it.each(Object.keys(variants) as Array<keyof typeof variants>)(
    '%s: direct condition diagnostics ignore root topology flags and use exact inventory counts',
    (code) => {
      expect(resolveProdatDependentCondition({
        messageCode: code,
        fieldNumber: '258',
        facts: { multipleMeterRegisters: true, byCell: { [`${code}:258`]: true } },
      })).toMatchObject({ status: 'undetermined', decisionPhase: 'pre_wire_inventory_aggregate' })
      expect(resolveProdatDependentCondition({
        messageCode: code,
        fieldNumber: '258',
        facts: { registerObjects: [objectFact('A', 1)] },
      })).toMatchObject({ status: 'not_required', decisionPhase: 'pre_wire_inventory_aggregate' })
      expect(resolveProdatDependentCondition({
        messageCode: code,
        fieldNumber: '258',
        facts: { registerObjects: [objectFact('A', 2)] },
      })).toMatchObject({ status: 'required', decisionPhase: 'pre_wire_inventory_aggregate' })
      expect(resolveProdatDependentCondition({
        messageCode: code,
        fieldNumber: '258',
        facts: { registerObjects: [objectFact('A', null)] },
      })).toMatchObject({ status: 'undetermined', decisionPhase: 'pre_wire_inventory_aggregate' })
    },
  )

  it('accepts explicit singleton, multiple and mixed-object inventories', () => {
    expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {
      registerObjects: [objectFact('A', 1)],
    })).toEqual([])
    expect(field258Issues('Z04', [line('1', 'A', '1'), ...reason('L'), qty('10'), line('2', 'A', '2'), qty('20')], {
      registerObjects: [objectFact('A', 2)],
    })).toEqual([])
    const mixedBody = [
      line('1', 'A'), ...reason('L'), qty('10'),
      line('2', 'B', '1'), ...reason('L'), qty('20'),
      line('3', 'B', '2'), qty('30'),
    ]
    const completeFacts = { registerObjects: [objectFact('A', 1), objectFact('B', 2)] }
    const completeIssues = field258Issues('Z04', mixedBody, completeFacts)
    expect(completeIssues).toEqual([])
    const completeAggregate = resolveProdatDependentCondition({
      messageCode: 'Z04',
      fieldNumber: '258',
      facts: completeFacts,
    })!
    expect(completeAggregate).toMatchObject({ status: 'required', decisionPhase: 'pre_wire_inventory_aggregate' })
    expect(reconcileProdatRegisterInventoryStatus(completeAggregate.status, completeIssues)).toBe('required')

    const partialFacts = { registerObjects: [objectFact('A', 1)] }
    const partialIssues = field258Issues('Z04', mixedBody, partialFacts)
    const partialAggregate = resolveProdatDependentCondition({
      messageCode: 'Z04', fieldNumber: '258', facts: partialFacts,
    })!
    expect(partialAggregate.status).toBe('not_required')
    expect(reconcileProdatRegisterInventoryStatus(partialAggregate.status, partialIssues)).toBe('undetermined')
  })

  it('rejects an omitted trailing register and missing/null counts', () => {
    expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {
      registerObjects: [objectFact('A', 2)],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PRODAT_REGISTER_COUNT_MISMATCH' }),
      expect.objectContaining({ code: 'PRODAT_DEPENDENT_FIELD_MISSING' }),
    ]))
    for (const fact of [objectFact('A'), objectFact('A', null)]) {
      expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {
        registerObjects: [fact],
      })).toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED' }))
    }
  })

  it('rejects wrong agency, swapped counts, missing/extra objects and duplicate evidence', () => {
    const mixed = [line('1', 'A'), ...reason('L'), qty('10'), line('2', 'B', '1'), ...reason('L'), qty('20'), line('3', 'B', '2'), qty('30')]
    expect(field258Issues('Z04', mixed, { registerObjects: [objectFact('A', 1, '9'), objectFact('B', 2)] }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PRODAT_REGISTER_EXPECTED_OBJECT_MISSING' }),
        expect.objectContaining({ code: 'PRODAT_REGISTER_UNEXPECTED_OBJECT' }),
      ]))
    expect(field258Issues('Z04', mixed, { registerObjects: [objectFact('A', 2), objectFact('B', 1)] }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PRODAT_REGISTER_COUNT_MISMATCH' }),
      ]))
    expect(field258Issues('Z04', mixed, { registerObjects: [objectFact('A', 1)] }))
      .toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_UNEXPECTED_OBJECT' }))
    expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {
      registerObjects: [objectFact('A', 1), objectFact('B', 1)],
    })).toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_EXPECTED_OBJECT_MISSING' }))
    expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {
      registerObjects: [objectFact('A', 1), objectFact('A', 1)],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED' }),
    ]))
  })

  it('keeps malformed, repeated and skipped C829 in structural validation', () => {
    for (const body of [
      [line('1', 'A', '1'), line('2', 'A', '1')],
      [line('1', 'A', '1'), line('2', 'A', '3')],
      [line('1', 'A', '1'), ['LIN', '2', '', ['A', '', '', '89'], ['2', '2']] as Parts],
    ]) {
      expect(field258Issues('Z04', body as Parts[], { registerObjects: [objectFact('A', 2)] }))
        .toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_STRUCTURE_INVALID' }))
    }
  })

  it('does not require local business inventory at the parse-only inbound boundary', () => {
    expect(field258Issues('Z04', [line('1', 'A'), ...reason('L'), qty('10')], {}, 'inbound'))
      .not.toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED' }))
  })
})

describe('field 258 inventory reaches builders and protected send guards', () => {
  const profileContext: ProdatEngineProductionContext = {
    code: 'Z04', bgmReference: 'DOC', transactionReference: 'CASE', senderEdielId: '12345', receiverEdielId: '54321',
    meterPointId: 'B', meterPointIdAgency: '89', customerId: 'USER', customerName: 'Synthetic', customerIdAgency: '89', gridAreaId: 'TES',
    startDate: '202610010000', observationLength: '15', observationLengthFormat: '806', reasonForTransaction: 'Z22',
    registers: [{ annualConsumption: '10' }, { annualConsumption: '20' }],
    dependentConditionFacts: { market: 'electricity', meterReadingsSentInUtilts: false, multipleMeterRegisters: true },
  }
  const genericInput: BuildProdatMessageInput = {
    companyId: 'tenant', role: 'supplier', businessCode: 'Z04', transactionSubtype: 'L',
    sender: { edielId: '12345' }, receiver: { edielId: '54321' },
    meteringPoint: { id: 'A', identityAgency: '89', gridArea: 'TES' },
    registers: [{ annualConsumption: '10' }, { annualConsumption: '20' }],
    customer: { id: 'USER', name: 'Synthetic', idAgency: '89' },
    dates: { contractStartDate: '202610010000', observationLength: '15', observationLengthFormat: '806' },
    references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' }, environment: 'test',
    dependentConditionFacts: { market: 'electricity', meterReadingsSentInUtilts: false, multipleMeterRegisters: true },
  }
  const renderInventory = (
    registerObjects: ProdatDependentConditionFacts['registerObjects'],
    registers = profileContext.registers,
  ) => buildProfiledProdatSegments({
    context: {
      ...profileContext,
      registers,
      dependentConditionFacts: { market: 'electricity', registerObjects },
    },
    variant: 'L',
    mode: 'test',
  })
  const rendered258 = (result: ReturnType<typeof renderInventory>) => result.diagnostics.dependentConditionStatuses
    ?.find(value => value.fieldNumber === '258')
  const inventoryCodes = (result: ReturnType<typeof renderInventory>) => result.issues
    .filter(issue => ['PRODAT_REGISTER_EXPECTED_OBJECT_MISSING', 'PRODAT_REGISTER_UNEXPECTED_OBJECT', 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED'].includes(issue.code))
    .map(issue => issue.code)

  it('profile and generic builders preserve unknown inventory instead of deriving count from rendered rows', () => {
    const profiled = buildProfiledProdatSegments({ context: profileContext, variant: 'L', mode: 'test' })
    expect(profiled.issues).toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED' }))
    expect(() => buildProdatMessage(genericInput)).toThrow(/registerunderlag|registerantal|register inventory|PRODAT_REGISTER_EVIDENCE_UNDETERMINED/i)
  })

  it('keeps complete singleton and multiple rendered diagnostics resolved for the exact object scope', () => {
    const completeMultiple = renderInventory([objectFact('B', 2)])
    expect(rendered258(completeMultiple)).toMatchObject({ status: 'required', decisionPhase: 'rendered_wire_inventory' })
    expect(inventoryCodes(completeMultiple)).toEqual([])

    const completeSingleton = renderInventory([objectFact('B', 1)], [{ annualConsumption: '10' }])
    expect(rendered258(completeSingleton)).toMatchObject({ status: 'not_required', decisionPhase: 'rendered_wire_inventory' })
    expect(inventoryCodes(completeSingleton)).toEqual([])
  })

  it.each([
    ['missing inventory entry', undefined],
    ['null count', [objectFact('B', null)]],
    ['different object', [objectFact('A', 1)]],
    ['wrong agency', [objectFact('B', 1, '9')]],
    ['extra mixed object', [objectFact('B', 2), objectFact('A', 1)]],
  ] as const)('keeps rendered field 258 undetermined for %s', (_name, inventory) => {
      const result = renderInventory(inventory)
      expect(rendered258(result)).toMatchObject({ status: 'undetermined', decisionPhase: 'rendered_wire_inventory' })
      expect(inventoryCodes(result).length).toBeGreaterThan(0)
  })

  it('keeps duplicate inventory diagnostics pre-wire undetermined and rejects persistence', () => {
    const duplicate = [objectFact('B', 2), objectFact('B', 2)]
    expect(resolveProdatDependentCondition({
      messageCode: 'Z04', fieldNumber: '258', facts: { registerObjects: duplicate },
    })).toMatchObject({ status: 'undetermined', decisionPhase: 'pre_wire_inventory_aggregate' })
    expect(() => renderInventory(duplicate)).toThrow(/prodat_register_evidence_invalid/)
  })

  it('bare public send preflight blocks when body-bound inventory metadata is unavailable', () => {
    const result = preflightEdielPayload({
      rawPayload: raw([line('1', 'A'), ...reason('L'), qty('10')]),
      messageStandard: 'edifact',
      mode: 'send',
    })
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',
      severity: 'error',
    }))
    expect(result.blocking).toBe(true)
  })

  it('body-bound missing-count evidence blocks preflight and both protected guards', () => {
    const payload = raw([line('1', 'A'), ...reason('L'), qty('10')])
    const wire = input(payload)
    const evidence = createProdatRegisterEvidence({
      code: 'Z04', rawSegments: wire.rawSegments, una: wire.una,
      facts: { market: 'electricity', registerObjects: [objectFact('A')] },
    })
    const message = {
      company_id: 'tenant', message_family: 'PRODAT', message_code: 'Z04', message_version: '26A',
      direction: 'outbound', environment: 'test', message_standard: 'edifact', application_reference: '23-DDQ-PRODAT',
      raw_payload: payload, mime_type: 'application/EDIFACT', parsed_payload: { rulebookAllowInvalidSend: true, prodatEngine: { registerEvidence: evidence } },
    } as unknown as EdielMessageRow

    expect(validateEdielMessageRowWithRulebook(message, 'send').issues)
      .toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_EVIDENCE_UNDETERMINED', scope: 'prodat_register' }))
    expect(preflightEdielMessageRow(message, 'send').issues)
      .toContainEqual(expect.objectContaining({ code: 'PRODAT_REGISTER_PREFLIGHT_PRODAT_REGISTER_EVIDENCE_UNDETERMINED' }))
    expect(() => assertRulebookAllowsSend(message)).toThrow(/register/i)
    expect(() => assertEdielSendLock(message)).toThrow(/register/i)
  })
})
