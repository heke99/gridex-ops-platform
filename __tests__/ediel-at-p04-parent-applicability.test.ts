// masterplan: AT-P-04
import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { permissionAckMessage, permissionAckObject } from './fixtures/prodat-permission-ack'
import { reportingObject, reportingZ14Selection } from './fixtures/prodat-reporting-permission'
import { alphabets, input, type Parts } from './fixtures/prodat-register'

// P26.A r3 §2.2 pp20–22: parent applicability precedes child R.
// Existing fixture writers provide synthetic wire, never authority or an ACK effect.
const childFields = ['316', '233', '234'] as const
type Child = typeof childFields[number]
const forField = (issues: EdielRulebookIssue[], field: Child) => issues.filter(issue =>
  issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === field
  || issue.description.includes(`Z14:${field}:`) || issue.description.includes(`Z14:${field},`))

function negative(status: 'A13' | 'A76' = 'A76', sequence = '1'): Parts[] {
  const body = permissionAckObject('Z14', 'Z96', status, null, sequence)
  // The shared general ACK fixture includes optional energy; this literal N
  // control deliberately omits the positive energy field as well as both parents.
  const energy = body.findIndex(part => part[0] === 'CCI' && part[2] === 'Z14')
  return body.filter((_, index) => energy < 0 || index !== energy && index !== energy + 1)
}

function wire(body: Parts[], alphabet: readonly string[]) {
  return permissionAckMessage('Z14', 'Z96', 'A76', null, alphabet, body).raw_payload!
}

function positive(reason: 'S17' | 'S18', sequence = '1'): Parts[] {
  return permissionAckObject('Z14', reason, 'A74', null, sequence)
}

// Fixed request facts are declared independently of the rendered response.
// They qualify only these synthetic field controls, never a live permission.
function reporting(reason: 'S17' | 'S18', sequence = '1') {
  const selection = reportingZ14Selection(reason), object = selection.objects[0]
  if (object.code !== 'Z14' || object.requestAssociation.kind !== 'known' || object.term.kind !== 'indefinite') throw new Error('fixed Z14 request fixture changed')
  const id = sequence === '2' ? '735123456789012352' : '735123456789012345'
  const customer = { id: '001', qualifier: '', agency: '89' }
  object.installation = { id, agency: '9' }
  object.li = 'CASE:A+B?C'; object.customer = customer
  object.purpose = { ...reportingObject().purpose, customer }
  object.requestAssociation = { ...object.requestAssociation, li: 'CASE:A+B?C', customer,
    allowedInstallations: [{ id, agency: '9' }], purpose: { kind: 'present', code: 'B72' } }
  if (reason === 'S18') object.term = { kind: 'bounded', endMinute: '202611010000', declaration: object.term.declaration }
  return selection
}

function canonical(payload: string, subtype: 'N' | 'V' | 'VH', request?: ReturnType<typeof reporting>) {
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z14',
    subtypeOrReasonCode: subtype, direction: 'outbound', applicationReference: '23-DGI-PRODAT',
    referenceDate: '2026-09-19', mode: 'catalog_evidence',
    prodatDependentFacts: { canonicalSubtype: subtype, customerKind: 'private', reportingPermission: request,
      byCell: { 'Z14:316': !request, 'Z14:233': !request, 'Z14:234': !request } } })
  return { policy, issues: validateCanonicalPolicyFields({ policy, ...input(payload, 'Z14'), rawPayload: payload }) }
}

function omitChild(body: Parts[], field: Child): Parts[] {
  const role = field === '316' ? 'UD' : 'IT', position = field === '316' ? 9 : field === '233' ? 2 : 5
  return body.map(part => part[0] === 'NAD' && part[1] === role
    ? part.map((value, index) => index === position ? '' : value) : part)
}

function expectChildFailure(issues: EdielRulebookIssue[], field: Child) {
  const role = field === '316' ? 'UD' : 'IT'
  const parent = field === '316' ? 'END_USER_GROUP' : 'INSTALLATION_GROUP'
  expect(forField(issues, field).some(issue => issue.blocking)).toBe(true)
  for (const unaffected of childFields.filter(value => value !== field)) expect(forField(issues, unaffected)).toEqual([])
  // The missing mandatory NAD component also fails that same parent's supplied
  // syntax. Require this exact companion diagnostic; reject every other issue.
  expect(issues.filter(issue => forField([issue], field).length !== 1)).toEqual([
    expect.objectContaining({ blocking: true, severity: 'error', scope: 'prodat_dependent',
      code: 'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID', fieldPath: `NAD+${role}`,
      description: expect.stringContaining(`Z14:${parent},`) }),
  ])
}

for (const alphabet of alphabets) describe(`AT-P-04 ${alphabet.join('')}`, () => {
  for (const status of ['A13', 'A76'] as const) it(`actual DGI/N ${status} is valid without parents or positive fields`, () => {
    const body = negative(status), payload = wire(body, alphabet), before = structuredClone(body)
    expect(payload).toContain('23-DGI-PRODAT')
    expect(body.some(part => part[0] === 'NAD' && ['UD', 'IT'].includes(String(part[1])))).toBe(false)
    expect(body.some(part => part[0] === 'DTM' || part[0] === 'RFF' && Array.isArray(part[1]) && part[1][0] === 'Z09')).toBe(false)
    const direct = validateProdatSubtypePayload(input(payload, 'Z14'))
    expect(direct).toEqual([])
    for (const root of ['N', 'V', 'VH'] as const) {
      const result = canonical(payload, root), policyBefore = structuredClone(result.policy)
      expect(result.issues).toEqual([])
      for (const field of childFields) expect(forField(result.issues, field)).toEqual([])
      expect(validateCanonicalPolicyFields({ policy: result.policy, ...input(payload, 'Z14'), rawPayload: payload })).toEqual([])
      expect(result.policy).toEqual(policyBefore)
    }
    expect(body).toEqual(before); expect(wire(body, alphabet)).toBe(payload)
  })

  for (const [reason, subtype] of [['S17', 'V'], ['S18', 'VH']] as const) {
    for (const field of childFields) it(`${subtype} requires exactly child ${field} while its parent remains present`, () => {
      const body = positive(reason), original = wire(body, alphabet), request = reporting(reason)
      const before = structuredClone({ body, request })
      expect(validateProdatSubtypePayload(input(original, 'Z14'))).toEqual([])
      expect(canonical(original, 'N', request).issues).toEqual([])
      const changed = omitChild(body, field), payload = wire(changed, alphabet)
      expect(changed.filter(part => part[0] === 'NAD' && part[1] === (field === '316' ? 'UD' : 'IT'))).toHaveLength(1)
      const issues = validateProdatSubtypePayload(input(payload, 'Z14'))
      expectChildFailure(issues, field)
      const result = canonical(payload, 'N', request)
      expectChildFailure(result.issues, field)
      expect(canonical(original, 'N', request).issues).toEqual([])
      expect({ body, request }).toEqual(before)
    })
  }

  for (const role of ['UD', 'IT'] as const) for (const supplied of [false, true])
    it(`N refuses ${supplied ? 'populated' : 'empty'} ${role} without requiring its absent children`, () => {
      const fragment: Parts = supplied ? role === 'UD'
        ? ['NAD', 'UD', ['001', '', '89'], '', 'Synthetic']
        : ['NAD', 'IT', ['735123456789012345', '', '9'], '', '', 'Street']
        : ['NAD', role]
      const issues = validateProdatSubtypePayload(input(wire([...negative(), fragment], alphabet), 'Z14'))
      const parent = role === 'UD' ? 'END_USER_GROUP' : 'INSTALLATION_GROUP'
      expect(issues.some(issue => issue.blocking && issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT'
        && issue.description.includes(`Z14:${parent}:`))).toBe(true)
      for (const field of childFields) expect(forField(issues, field).filter(issue => issue.prodatDiagnostic?.kind === 'field'
        && issue.prodatDiagnostic.errorKind === 'missing')).toEqual([])
    })

  it('each mixed positive/N object keeps its own parent obligation and fields', () => {
    const body = positive('S17'), request = reporting('S17')
    const n = negative('A76', '2')
    const original = wire([...body, ...n], alphabet)
    expect(validateProdatSubtypePayload(input(original, 'Z14'))).toEqual([])
    expect(canonical(original, 'N', request).issues).toEqual([])
    for (const field of childFields) {
      const payload = wire([...omitChild(body, field), ...n], alphabet)
      expectChildFailure(validateProdatSubtypePayload(input(payload, 'Z14')), field)
      const result = canonical(payload, 'N', request)
      expectChildFailure(result.issues, field)
    }
    const noCountry = omitChild(body, '316')
    const sibling = positive('S17', '2')
    expect(forField(validateProdatSubtypePayload(input(wire([...noCountry, ...sibling], alphabet), 'Z14')), '316')
      .some(issue => issue.blocking)).toBe(true)
  })

  it('a second complete message cannot supply the first message parent children', () => {
    const body = positive('S17'), second = wire(body, alphabet), request = reporting('S17')
    expect(canonical(second, 'N', request).issues).toEqual([])
    for (const field of childFields) {
      const first = wire(omitChild(body, field), alphabet)
      const joined = first + second.slice(9)
      expect(forField(validateProdatSubtypePayload(input(joined, 'Z14')), field).some(issue => issue.blocking)).toBe(true)
      expect(forField(canonical(joined, 'N', request).issues, field).some(issue => issue.blocking)).toBe(true)
      expect(canonical(second, 'N', request).issues).toEqual([])
    }
  })
})
