import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { ud, udAddressFact, selectedAddressFact } from './fixtures/prodat-ud'
import { describe, expect, it } from 'vitest'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { renderProdat } from '@/lib/ediel/prodat/engine'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

const CODES = ['Z01', 'Z03', 'Z08'] as const
const target = (issue: { code: string; scope?: string; description: string }) =>
  (issue.scope === 'prodat_dependent' || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))
  && /Z0[138]:(INSTALLATION_GROUP|233|234)\b/.test(issue.description)

function installation(id = 'OBJECT-A', agency = '89', address = 'Site A'): Parts {
  return ['NAD', 'IT', [id, '', agency], '', '', address]
}

function body(code: typeof CODES[number], parents: Parts[] = []): Parts[] {
  return [
    line('1', 'OBJECT-A', undefined, '89'),
    ['DTM', ['92', '202610010000', '203']],
    ...characteristic('Z13', code === 'Z08' ? 'E58' : 'Z22'),
    ['RFF', ['Z05', 'ABC']],
    ['RFF', ['LI', 'CASE-A']],
    ...parents, ud(),
  ]
}

function policy(code: typeof CODES[number]) {
  return resolveCanonicalEdielPolicy({
    family: 'PRODAT', messageCode: code, subtypeOrReasonCode: code === 'Z08' ? 'H' : 'L',
    direction: 'outbound', referenceDate: '2026-09-19', mode: 'catalog_evidence',
    // Old caller facts are deliberately opposite to the wire. They cannot
    // select or suppress the optional parent and its own children.
    prodatDependentFacts: { byCell: { [`${code}:233`]: true, [`${code}:234`]: false } },
  })
}

function canonical(code: typeof CODES[number], parts: Parts[], alphabet: readonly string[] = alphabets[0]) {
  const wire = input(raw(parts, code, alphabet), code)
  return validateCanonicalPolicyFields({ policy: policy(code), rawSegments: wire.rawSegments, una: wire.una })
}

function row(code: typeof CODES[number], parts: Parts[], alphabet: readonly string[] = alphabets[0]): EdielMessageRow {
  const message: Partial<EdielMessageRow> = {
    message_family: 'PRODAT', message_code: code, message_version: '26A', direction: 'outbound',
    environment: 'test', message_standard: 'edifact', company_id: 'synthetic-company',
    application_reference: '23-DDQ-PRODAT', raw_payload: raw(parts, code, alphabet),
    mime_type: 'application/EDIFACT', parsed_payload: {
      rulebookAllowInvalidSend: true,
      prodatEngine: {
        registerEvidence:createProdatRegisterEvidence({...input(raw(parts,code,alphabet),code),code,facts:{endUserAddressObjects:[udAddressFact('OBJECT-A')]}}),
        // Even a complete persisted snapshot claiming no requirements cannot
        // override an actually supplied object-scoped parent on the wire.
        dependentConditionStatuses: policy(code).prodatDependentConditions
          .map(condition => ({ ...condition, status: 'not_required' as const })),
      },
    },
  }
  return message as EdielMessageRow
}

describe('P26.A optional installation parent and six child cells', () => {
  for (const code of CODES) for (const field of ['233', '234']) {
    it(`${code}:${field}: message-wide byCell cannot claim the per-object parent choice`, () => {
      for (const value of [true, false]) {
        expect(resolveProdatDependentCondition({ messageCode: code, fieldNumber: field, facts: { byCell: { [`${code}:${field}`]: value } } }))
          .toMatchObject({ status: 'not_required', conditionId: 'optional_installation_wire_parent', decisionPhase: 'pre_wire_parent' })
      }
    })
  }
  for (const code of CODES) for (const alphabet of alphabets) {
    it(`${code}/${alphabet.join('')}: absent optional IT has no child requirement or unknown`, () => {
      expect(canonical(code, body(code), alphabet).filter(target)).toEqual([])
      expect(validateProdatSubtypePayload(input(raw(body(code), code, alphabet), code)).filter(target)).toEqual([])
    })

    it(`${code}/${alphabet.join('')}: exact own IT selects both children`, () => {
      const parts = body(code, [installation()])
      expect(canonical(code, parts, alphabet).filter(target)).toEqual([])
      expect(validateProdatSubtypePayload(input(raw(parts, code, alphabet), code)).filter(target)).toEqual([])
      expect(preflightEdielMessageRow(row(code, parts, alphabet), 'send').issues.filter(target)).toEqual([])
      expect(() => assertEdielSendLock(row(code, parts, alphabet))).not.toThrow()
    })
  }

  for (const code of CODES) {
    it(`${code}: supplied partial, duplicate, header and wrong-object IT cannot disappear`, () => {
      const invalid: Parts[][] = [
        body(code, [['NAD', 'IT', ['OBJECT-A', '', '89']]]),
        body(code, [installation(), installation()]),
        [installation(), ...body(code, [installation()])],
        body(code, [installation('OBJECT-B')]),
        body(code, [installation('OBJECT-A', '9')]),
        [
          ...body(code, [['NAD', 'IT', ['OBJECT-A', '', '89']]]),
          line('2', 'OBJECT-B', undefined, '89'),
          ...characteristic('Z13', code === 'Z08' ? 'E58' : 'Z22'),
          installation('OBJECT-B'),
        ],
      ]
      for (const parts of invalid) {
        expect(validateProdatSubtypePayload(input(raw(parts, code), code)).some(target)).toBe(true)
        expect(preflightEdielMessageRow(row(code, parts), 'send').issues.some(target)).toBe(true)
        expect(() => assertEdielSendLock(row(code, parts))).toThrow(/PRODAT_DEPENDENT_PREFLIGHT_/)
      }
    })

    it(`${code}: a later message cannot supply the first object's partial IT`, () => {
      const first = raw(body(code, [['NAD', 'IT', ['OBJECT-A', '', '89']]]), code)
      const second = raw(body(code, [installation()]), code)
      const joined = first.slice(0, 9) + [
        ...input(first, code).rawSegments.slice(0, -1),
        ...input(second, code).rawSegments.slice(1, -1),
        'UNZ+2+I',
      ].join("'") + "'"
      expect(validateProdatSubtypePayload(input(joined, code)).some(target)).toBe(true)
    })
  }
})

describe('optional installation builders', () => {
  const profileBase: ProdatEngineProductionContext = {
    code: 'Z03', bgmReference: 'DOCUMENT', transactionReference: 'CASE',
    senderEdielId: '12345', receiverEdielId: '54321', meterPointId: 'OBJECT-A', meterPointIdAgency: '89',
    customerId: 'USER', customerName: 'Synthetic User', customerIdAgency: '89', customerCountry: 'SE',
    siteAddress: 'Site A', siteCountry: 'SE', reasonForTransaction: 'Z22', startDate: '2026-10-01',
  }

  it('complete installation-specific profile data selects IT', () => {
    const result = buildProfiledProdatSegments({ context: profileBase, variant: 'L' })
    expect(result.segments).toContain('NAD+IT+OBJECT-A::89+++Site A++++SE')
    expect(result.issues.filter(target)).toEqual([])
  })

  it('profile omits an incomplete optional IT instead of manufacturing a child requirement', () => {
    for (const incomplete of [
      { ...profileBase, siteAddress: null, siteAddressLines: undefined },
      { ...profileBase, meterPointId: '' },
    ]) {
      const result = buildProfiledProdatSegments({ context: incomplete, variant: 'L', mode: 'test' })
      expect(result.segments.some(segment => segment.startsWith('NAD+IT'))).toBe(false)
      expect(result.issues.filter(target)).toEqual([])
    }
  })

  it('engine diagnostics report the emitted parent decision, never message-wide byCell claims', () => {
    const render = (siteAddress: string | null, claimed: boolean) => renderProdat({
      code: 'Z03', variant: 'L', mode: 'test', generatedAt: new Date('2026-09-19T00:00:00Z'),
      actor: { senderEdielId: '12345', receiverEdielId: '54321' },
      route: { applicationReference: '23-DDQ-PRODAT' },
      version: { selectedVersion: 'E2SE6A', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A' },
      context: {
        ...profileBase,
        siteAddress,
        dependentConditionFacts: { byCell: { 'Z03:233': claimed, 'Z03:234': claimed } },
      },
    })
    const status = (siteAddress: string | null, claimed: boolean) =>
      render(siteAddress, claimed).diagnostics.dependentConditionStatuses
        ?.filter(value => value.conditionId === 'optional_installation_wire_parent')
        .map(value => [value.status, value.decisionPhase])

    expect(status('Site A', false)).toEqual([
      ['required', 'rendered_wire_parent'], ['required', 'rendered_wire_parent'],
    ])
    expect(status(null, true)).toEqual([
      ['not_required', 'rendered_wire_parent'], ['not_required', 'rendered_wire_parent'],
    ])
  })

  const genericBase: BuildProdatMessageInput = {
    dependentConditionFacts:{endUserAddressObjects:[selectedAddressFact('OBJECT-A','synthetic-company','89','USER')]},
    companyId: 'synthetic-company', role: 'supplier', businessCode: 'Z03', transactionSubtype: 'L',
    sender: { edielId: '12345' }, receiver: { edielId: '54321' },
    meteringPoint: { id: 'OBJECT-A', identityAgency: '89' }, environment: 'test',
    customer: { identity: 'USER', idAgency: '89', name: 'Synthetic User', country: 'SE' },
    dates: { startDate: '2026-10-01' }, references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' },
  }

  it('generic installation input is the explicit parent choice', () => {
    expect(buildProdatMessage(genericBase).rawEdifact).not.toContain('NAD+IT')
    const built = buildProdatMessage({ ...genericBase, installation: { address: 'Site A', idAgency: '89' } })
    expect(built.rawEdifact).toContain('NAD+IT+OBJECT-A::89+++Site A++++SE')
    expect(() => buildProdatMessage({ ...genericBase, installation: { idAgency: '89' } })).toThrow(/234|installation/i)
  })
})

it('inbound remains parse-only', () => {
  for (const code of CODES) {
    const result = validateRulebookMessage({
      rawPayload: raw(body(code, [['NAD', 'IT', ['OBJECT-A', '', '89']]]), code),
      family: 'PRODAT', code, direction: 'inbound', mode: 'parse', environment: 'test',
    })
    expect(result.issues.filter(target)).toEqual([])
  }
})
