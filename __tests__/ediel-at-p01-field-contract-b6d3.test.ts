// masterplan: AT-P-01
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODAT_26A_FIELD_MATRIX, canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { PRODAT_26A_DEPENDENT_CONDITION_REGISTRY, resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { projectProdatDiagnostics } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatRegisterPolicy } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { alphabets, characteristic, input, line, qty, raw, type Parts } from './fixtures/prodat-register'
import { head, own } from './fixtures/prodat-identity'
import { permissionAckMessage, permissionAckObject } from './fixtures/prodat-permission-ack'

// Execute delivered condition behavior unchanged as part of this acceptance
// contract. These are 854 reused tests, not 854 newly authored tests. No mocked
// registry/runtime-decision suite establishes persisted send authority here.
import './prodat-dependent-condition-engine.test'
import './ediel-prodat-register-conditions.test'
import './ediel-prodat-register-readings.test'
import './ediel-at-p04-parent-applicability.test'
import './ediel-prodat-dependent-subtype-ud.test'
import './ediel-prodat-dependent-z14.test'
import './ediel-prodat-optional-installation.test'
import './ediel-prodat-end-user-address.test'
import './ediel-prodat-invoicee.test'
import './ediel-prodat-date-events.test'
import './ediel-prodat-reporting-permission.test'
import './ediel-prodat-meter-change.test'
import './ediel-prodat-death-status-policy.test'
import './ediel-prodat-gas-policy.test'

// Expected sets come from the independently frozen original registers, never
// the descriptors, diagnostic constructor or condition registry under test.
type Usage = 'R' | 'D' | 'O' | '-'
type FrozenField = { field: string; usage: Record<string, Usage> }
type FrozenParent = { group_id: 'UD' | 'IT' | 'IV'; field: string; usage: Record<string, Usage> }
const frozen = <T,>(file: string): T => JSON.parse(readFileSync(`docs/ediel/masterplan-v2/registers/${file}.json`, 'utf8'))
const fields = frozen<FrozenField[]>('prodat_fields')
const parents = frozen<FrozenParent[]>('prodat_parent_groups')
const cells = frozen<{ field: string; message: string }[]>('prodat_conditional_cells')
const parentIds = { UD: 'END_USER_GROUP', IT: 'INSTALLATION_GROUP', IV: 'INVOICEE_GROUP' }
const requirement = { R: 'required', D: 'dependent', O: 'optional', '-': 'forbidden' }
const codes = ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18']
const numericD = fields.flatMap(row => codes.filter(code => row.usage[code] === 'D').map(code => `${code}:${row.field}`)).sort()
const parentD = parents.flatMap(row => codes.filter(code => row.usage[code] === 'D').map(code => `${code}:${parentIds[row.group_id]}`)).sort()

describe('AT-P-01 frozen register to executable field contract', () => {
  it('connects the exact 74 numeric fields and three nonnumeric parents to every original policy column', () => {
    expect(fields).toHaveLength(74)
    expect(parents.map(row => row.group_id).sort()).toEqual(['IT', 'IV', 'UD'])
    expect(parents.every(row => row.field === '-')).toBe(true)
    const expected = [...fields.map(row => row.field), ...parents.map(row => parentIds[row.group_id])].sort()
    expect(new Set(expected).size).toBe(77)
    expect(PRODAT_26A_FIELD_MATRIX.map(row => row.fieldNumber).sort()).toEqual(expected)
    for (const code of codes) {
      const projection = canonicalProdat26AFieldRules(code).map(row => [row.fieldNumber, row.requirement]).sort()
      const original = [...fields.map(row => [row.field, requirement[row.usage[code]]]),
        ...parents.map(row => [parentIds[row.group_id], requirement[row.usage[code]]])].sort()
      expect(projection, code).toEqual(original)
    }
  })

  it('keeps all 110 numeric D cells separate from the ten parent conditions, with no unmapped executable cell', () => {
    expect(numericD).toHaveLength(110)
    expect(parentD).toHaveLength(10)
    expect(cells.map(row => `${row.message}:${row.field}`).sort()).toEqual(numericD)
    expect(PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.map(row => row.id).sort()).toEqual([...numericD, ...parentD].sort())
    for (const cell of cells) {
      const id = `${cell.message}:${cell.field}`
      const executable = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.find(row => row.id === id)!
      expect(executable.predicate, id).toBeTypeOf('function')
      const evaluated = resolveProdatDependentCondition({ messageCode: cell.message, fieldNumber: cell.field })!
      expect(evaluated, id).toMatchObject({ id, fieldNumber: cell.field, messageCode: cell.message,
        conditionId: executable.conditionId, source: {
          document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
          evidenceProjection: 'supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql',
        } })
      expect(evaluated.source.section).toContain(`${cell.message} / field ${cell.field} / D`)
      expect(evaluated.source.note.trim()).not.toBe('')
      expect(['required', 'not_required', 'undetermined']).toContain(evaluated.status)
      // A caller's arbitrary cell boolean cannot turn missing source evidence
      // into knowledge. Optional wire-parent defaults are tested by the reused
      // parent suites; they are not an assertion that all parents are absent.
      if (evaluated.status === 'undetermined') for (const value of [true, false]) {
        expect(resolveProdatDependentCondition({ messageCode: cell.message, fieldNumber: cell.field,
          facts: { byCell: { [id]: value } } })?.status, `${id}/${value}`).toBe('undetermined')
      }
    }
  })
})

for (const alphabet of alphabets) describe(`AT-P-01 actual metadata ${alphabet.join('')}`, () => {
  const validate = (body: Parts[]) => validateRulebookMessage({ family: 'PRODAT', code: 'Z01', direction: 'inbound',
    rawPayload: raw(body, 'Z01', alphabet), applicationReference: '23-DDQ-PRODAT', mode: 'parse' })

  it('projects only the missing second-object LI, preserving its absent own case and true source locator', () => {
    const good = [...head(), ...own('1', '735123456789012345', 'CASE-207-210'), ...own('2', '735123456789012352', 'CASE-B')]
    expect(validate(good).issues.filter(row => row.blocking || row.severity === 'error')).toEqual([])
    const bad = [...head(), ...own('1', '735123456789012345', 'CASE-207-210'), ...own('2', '735123456789012352', null)]
    const result = projectProdatDiagnostics(validate(bad).issues)
    expect(result.disposition.kind).toBe('continue')
    expect(result.applicationErrors).toHaveLength(1)
    expect(result.applicationErrors[0]).toMatchObject({ ercCode: '41', fieldCode: '226',
      referenceNumber: '735123456789012352', lineItemReference: null, prodatFieldDiagnostic: {
        kind: 'field', fieldNumber: '226', errorKind: 'missing', group: 'SG8/SG16', segmentPath: 'RFF+LI',
        component: { locator: 'RFF+LI', valueElement: 'C506/1154', referenceScope: 'line' },
        occurrence: { messageReference: 'M', lineIndex: 1, lineNumber: '2', objectId: '735123456789012352',
          ownReferences: { lineItemReference: { kind: 'absent' } } },
      } })
    expect(result.applicationErrors[0].prodatFieldDiagnostic?.sourceRule).toContain('226')
  })

  it('DTM and RFF text containing 207/226/311 cannot choose a field number for a real invalid start date', () => {
    const good = [...head(), ...own('1', '735123456789012345', 'CASE:207+226?311')]
    expect(validate(good).issues.filter(row => row.blocking || row.severity === 'error')).toEqual([])
    const bad = good.map(part => part[0] === 'DTM' ? ['DTM', ['92', '207226311000', '203']] as Parts : part)
    const projected = projectProdatDiagnostics(validate(bad).issues)
    expect(projected.applicationErrors).toHaveLength(1)
    expect(projected.applicationErrors[0]).toMatchObject({ ercCode: '42', fieldCode: '210',
      referenceNumber: '735123456789012345', lineItemReference: 'CASE:207+226?311', prodatFieldDiagnostic: {
        kind: 'field', fieldNumber: '210', group: 'SG8', segmentPath: 'DTM+92',
        component: { locator: 'DTM+92', dateQualifier: '92', valueElement: 'C507/2380', formatElement: 'C507/2379' },
      } })
    expect(projected.applicationErrors[0].prodatFieldDiagnostic?.sourceRule).toContain('210')
  })

  it('a later register uses its own object first LI and cannot borrow a different object case', () => {
    const body: Parts[] = [...head(), line('1', '735123456789012345', '1'), ...characteristic('Z13', 'E64'),
      qty('1'), ['RFF', ['LI', 'OTHER-CASE-226']], line('2', '735123456789012352', '1'),
      ...characteristic('Z13', 'E64'), qty('2'), line('3', '735123456789012352', '2')]
    const wire = input(raw(body, 'Z06', alphabet), 'Z06')
    const rules = canonicalProdat26AFieldRules('Z06').filter(row => row.fieldNumber === '213')
    const result = validateProdatRegisterPolicy({ code: 'Z06', ...wire, direction: 'inbound',
      rules, requireIndependentInventory: false })
    const errors = projectProdatDiagnostics(result.issues).applicationErrors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ ercCode: '41', fieldCode: '213', referenceNumber: '735123456789012352',
      lineItemReference: null, prodatFieldDiagnostic: { group: 'SG8/SG12',
        component: { valueElement: 'C186/6060' }, occurrence: { lineIndex: 2, lineNumber: '3', registerPosition: 2,
          objectId: '735123456789012352', ownReferences: { lineItemReference: { kind: 'absent' } } } } })
    expect(errors[0].prodatFieldDiagnostic?.sourceRule).toContain('213')
    expect(validateProdatRegisterPolicy({ code: 'Z06', ...input(raw([...body, qty('2')], 'Z06', alphabet), 'Z06'),
      direction: 'inbound', rules, requireIndependentInventory: false }).issues).toEqual([])
  })

  it('actual Z14N without UD/IT does not invent missing child or numeric parent diagnostics', () => {
    const body = permissionAckObject('Z14', 'Z96', 'A76', null)
    const energy = body.findIndex(part => part[0] === 'CCI' && part[2] === 'Z14')
    const inactive = body.filter((_, index) => energy < 0 || index !== energy && index !== energy + 1)
    const payload = permissionAckMessage('Z14', 'Z96', 'A76', null, alphabet, inactive).raw_payload!
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z14', subtypeOrReasonCode: 'N',
      direction: 'outbound', referenceDate: '2026-09-19', applicationReference: '23-DGI-PRODAT', mode: 'catalog_evidence' })
    const issues = validateCanonicalPolicyFields({ policy, ...input(payload, 'Z14'), rawPayload: payload })
    expect(issues).toEqual([])
    expect(projectProdatDiagnostics(issues).applicationErrors).toEqual([])
  })
})
