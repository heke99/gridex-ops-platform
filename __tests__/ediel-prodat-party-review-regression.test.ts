import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import { describe, expect, it } from 'vitest'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { fieldRulePresent, validateFieldMatrixPayload, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'

// Independently specified synthetic wire fixtures; no original TGT files or
// normative rules are rewritten, and no network/database/send operation runs.
type Alphabet = readonly [string, string, string, string]
type Parts = readonly (string | readonly string[])[]
const alphabets: readonly Alphabet[] = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']]
const point = '735999999999999999'
function wire(syntax: Alphabet, body: readonly Parts[], options: { code?: string; count?: number; endRef?: string; app?: string | readonly string[]; header?: readonly Parts[] } = {}): string {
  const encode = (value: string) => [...value].map(char => syntax.includes(char) ? syntax[2] + char : char).join('')
  const render = (parts: Parts) => parts.map(p => typeof p === 'string' ? encode(p) : p.map(encode).join(syntax[0])).join(syntax[1])
  const mid: Parts[] = [
    ['UNH', 'M-1', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], ['BGM', options.code ?? 'Z18', 'DOC-1', '9', 'AB'],
    ['DTM', ['137', '202609171200', '203']], ['DTM', ['ZZZ', '1', '805']],
    ['NAD', 'FR', ['LEGAL-S', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', ['LEGAL-R', '160', 'SVK'], '', '', '', '', '', '', 'SE'], ...(options.header ?? []),
    ['LIN', '1', '', [point, '', '', '9']], ...body,
  ]
  return `UNA${syntax[0]}${syntax[1]}.${syntax[2]} ${syntax[3]}` + [
    ['UNB', ['UNOC', '3'], ['TECH-S', '14', 'S:?!+'], ['TECH-R', '14', 'R*;!'], ['260917', '1200'], 'I-1', '', options.app ?? '23-DGI-PRODAT'],
    ...mid, ['UNT', String(options.count ?? mid.length + 1), options.endRef ?? 'M-1'], ['UNZ', '1', 'I-1'],
  ].map(render).join(syntax[3]) + syntax[3]
}
const ud: Parts = ['NAD', 'UD', ['User-1', '', '89'], '', 'Test User', '', '', '', '', 'SE']
const permissionBody: readonly Parts[] = [
  ['DTM', ['693', '202609161201', '203']], ['DTM', ['164', '202609181202', '203']],
  ['CCI', '', 'Z13'], ['CAV', 'S17'], ['CCI', '', 'Z25'], ['CAV', '1'],
  ['RFF', ['Z05', 'NET']], ['RFF', ['LI', 'CASE']], ['RFF', ['Z09', 'PERMISSION']], ud,
]
const preflight = (raw: string) => preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' })
const matrixInput = (raw: string, code: string) => {
  const tokens = tokenizeEdifact(raw)
  return { family: 'PRODAT', code, rawSegments: tokens.segments.map(s => s.raw), una: tokens.una, mode: 'parse' as const }
}

describe('PR326 review: full UNA-aware preflight boundary', () => {
  for (const syntax of alphabets) {
    it(`accepts the complete permission message using ${syntax.join('')}`, () => {
      const result = preflight(wire(syntax, permissionBody))
      expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
      expect(result.ok).toBe(true)
      expect(result.family).toBe('PRODAT')
      expect(result.code).toBe('Z18')
      expect(result.declaredUntCount).toBe(18)
      expect(result.markers).toMatchObject({ UNB: true, UNH: true, BGM: true, RFF: true, UNT: true, UNZ: true })
    })
    it(`rejects wrong count and correlation without a phantom missing header (${syntax.join('')})`, () => {
      const result = preflight(wire(syntax, permissionBody, { count: 99, endRef: 'WRONG' }))
      const codes = result.issues.map(i => i.code)
      expect(codes).toContain('UNT_COUNT_MISMATCH')
      expect(codes).toContain('UNH_UNT_REFERENCE_MISMATCH')
      expect(codes.filter(c => c.startsWith('MISSING_'))).toEqual([])
      expect(result.blocking).toBe(true)
    })
    it(`retains negative party/date checks with ${syntax.join('')}`, () => {
      const result = preflight(wire(syntax, permissionBody.filter(p => p !== ud && !(p[0] === 'DTM' && Array.isArray(p[1]) && p[1][0] === '164'))))
      expect(result.issues.map(i => i.code)).toContain('PRODAT_Z18_NAD_UD_MISSING')
      expect(result.issues.map(i => i.code)).toContain('PRODAT_Z18_DTM_164_MISSING')
      expect(result.blocking).toBe(true)
    })
    it(`does not lose literal release/element characters in length checks (${syntax.join('')})`, () => {
      const raw = wire(syntax, permissionBody).replace('TECH-S', 'A'.repeat(34) + syntax[2] + syntax[2] + 'X')
      const result = preflight(raw)
      expect(result.issues.map(i => i.code)).toContain('UNB_SENDER_TOO_LONG')
      expect(result.blocking).toBe(true)
    })
  }
})

describe('PR326 review: compatibility metadata remains source-backed', () => {
  for (const syntax of alphabets) {
    it(`retains exact UNB metadata and dates using ${syntax.join('')}`, () => {
      const raw = wire(syntax, [ ['DTM', ['7', '202610010930', '203']], ['RFF', ['LI', "00a:?+'"]] ], { code: 'Z03', header: [['LOC', '48', ['SE3', '', 'SVK']]] })
      const parsed = parseInboundProdat(raw)
      expect(parsed).toMatchObject({ senderEdielId: 'TECH-S', receiverEdielId: 'TECH-R', senderSubAddress: 'S:?!+', receiverSubAddress: 'R*;!',
        applicationReference: '23-DGI-PRODAT', messageVersion: 'E2SE6A', transactionReference: "00a:?+'" })
      expect(parsed.parsedPayload).toMatchObject({ requestedStartDate: '2026-10-01', createdDate: '2026-09-17', priceAreaCode: 'SE3', legalSenderId: 'LEGAL-S', legalReceiverId: 'LEGAL-R' })
      const rules = parseRulebookMessage(raw)
      expect(rules).toMatchObject({ sender: 'TECH-S', receiver: 'TECH-R', senderSubAddress: 'S:?!+', receiverSubAddress: 'R*;!', applicationReference: '23-DGI-PRODAT' })
    })
    it(`does not invent application/date metadata from another component (${syntax.join('')})`, () => {
      const parsed = parseInboundProdat(wire(syntax, [['DTM', ['7', '', '203', '20261001']]], { app: ['23-DGI-PRODAT', 'OTHER'] }))
      expect(parsed.applicationReference).toBeNull()
      expect(parsed.parsedPayload.requestedStartDate).toBeNull()
    })
  }
})

describe('PR326 review: legacy builder separates legal and transport identities', () => {
  const base = { dependentConditionFacts:{endUserAddressObjects:[selectedAddressFact(point,'tenant-A','9','User-1')],invoiceeObjects:[selectedInvoiceeFact(point,'tenant-A','9','User-1')]}, companyId: 'tenant-A', role: 'supplier', businessCode: 'Z03', sender: { edielId: 'TECH-S' }, receiver: { edielId: 'TECH-R' },
    meteringPoint: { id: point }, customer: { identity: 'User-1', idAgency: '89' as const, name: 'Test User' }, references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' }, dates: { startDate: '2026-10-01' }, environment: 'test' }
  it('uses explicit legal parties and countries only in NAD', () => {
    const input = { ...base, legalSenderId: '00Legal:+?', legalReceiverId: 'Receiver:1', legalSenderCountry: 'DK', legalReceiverCountry: 'NO' }
    const raw = buildProdatMessage(input).rawEdifact
    expect(raw).toContain('NAD+FR+00Legal?:?+??:160:SVK+++++++DK')
    expect(raw).toContain('NAD+DO+Receiver?:1:160:SVK+++++++NO')
    expect(parseCanonicalEdielPayload({ rawPayload: raw })).toMatchObject({ sender: 'TECH-S', receiver: 'TECH-R' })
  })
  it('retains explicit legacy fallbacks when legal fields are omitted', () => {
    const raw = buildProdatMessage(base).rawEdifact
    expect(raw).toContain('NAD+FR+TECH-S:160:SVK+++++++SE')
    expect(raw).toContain('NAD+DO+TECH-R:160:SVK+++++++SE')
  })
  for (const bad of [{ legalSenderId: '' }, { legalReceiverId: 'A'.repeat(36) }, { legalSenderCountry: 'SWE' }, { legalReceiverCountry: '' }]) {
    it(`rejects explicit invalid legal metadata ${JSON.stringify(bad)}`, () => {
      expect(() => buildProdatMessage({ ...base, ...bad })).toThrow(/prodat_(legal_party|party_field)_invalid/)
    })
  }
})

describe('PR326 review: line-scoped NAD rules', () => {
  for (const syntax of alphabets) {
    for (const role of ['UD', 'IT', 'IV']) {
      it(`rejects forbidden ${role} on a later Z10 line (${syntax.join('')})`, () => {
        const row: Parts = role === 'UD' ? ud : ['NAD', role, ['OBJECT', '', '89'], '', role === 'IT' ? '' : 'Invoicee', 'Street', 'Town', '', '12345', 'SE']
        const input = matrixInput(wire(syntax, [['LIN', '2', '', ['SECOND', '', '', '9']], row], { code: 'Z10' }), 'Z10')
        const rules = canonicalProdat26AFieldRules('Z10').filter(r => r.segmentPath?.startsWith(`NAD+${role}`))
        expect(rules.length).toBeGreaterThan(0)
        expect(validateFieldMatrixPayload(input, rules).some(i => i.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT')).toBe(true)
      })
    }
    it(`requires the name on every object, without cross-object borrowing (${syntax.join('')})`, () => {
      const rule = canonicalProdat26AFieldRules('Z04').find(r => r.fieldNumber === '228')!
      const noName: Parts = ['NAD', 'UD', ['User-2', '', '89'], '', '', '', '', '', '', 'SE']
      const raw = wire(syntax, [ud, ['LIN', '2'], noName], { code: 'Z04' })
      const input = matrixInput(raw, 'Z04')
      expect(fieldRulePresent(rule, input)).toBe(false)
      expect(validateFieldMatrixPayload(input, [rule]).some(i => i.code === 'FIELD_MATRIX_REQUIRED_FIELD_MISSING')).toBe(true)
      expect(validateFieldMatrixPayload(matrixInput(wire(syntax, [ud, ['LIN', '2'], ud], { code: 'Z04' }), 'Z04'), [rule])).toEqual([])
    })
    it(`checks allowed-value rules in every object (${syntax.join('')})`, () => {
      const rule: RulebookFieldRule = { ...canonicalProdat26AFieldRules('Z04').find(r => r.fieldNumber === '316')!, allowedValues: ['SE'] }
      const foreign: Parts = [...ud.slice(0, 9), 'NO']
      const input = matrixInput(wire(syntax, [ud, ['LIN', '2'], foreign], { code: 'Z04' }), 'Z04')
      expect(validateFieldMatrixPayload(input, [rule]).some(i => i.code === 'FIELD_MATRIX_CODE_LIST_INVALID')).toBe(true)
    })
    it(`does not scan another message as another object (${syntax.join('')})`, () => {
      const rule = canonicalProdat26AFieldRules('Z10').find(r => r.fieldNumber === 'END_USER_GROUP')!
      const one = wire(syntax, [], { code: 'Z10' })
      const other = wire(syntax, [ud], { code: 'Z04' }).slice(9)
      expect(validateFieldMatrixPayload(matrixInput(one + other, 'Z10'), [rule])).toEqual([])
    })
  }
})

describe('PR326 review: negative controls remain active under every alphabet', () => {
  for (const syntax of alphabets) {
    for (const tag of ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ']) {
      it(`detects a genuinely missing ${tag}, even with its name inside data (${syntax.join('')})`, () => {
        const raw = wire(syntax, [...permissionBody, ['FTX', 'AAI', '', '', `${tag}+FAKE`]])
        const tokens = tokenizeEdifact(raw)
        const altered = raw.slice(0, 9) + tokens.segments.filter(s => s.tag !== tag).map(s => s.raw).join(syntax[3]) + syntax[3]
        const result = preflight(altered)
        expect(result.markers[tag]).toBe(false)
        expect(result.issues.map(i => i.code)).toContain(`MISSING_${tag}`)
        expect(result.blocking).toBe(true)
      })
    }
    it(`retains interchange correlation and count rejection (${syntax.join('')})`, () => {
      const raw = wire(syntax, permissionBody).replace(`UNZ${syntax[1]}1${syntax[1]}I-1`, `UNZ${syntax[1]}2${syntax[1]}WRONG`)
      const result = preflight(raw)
      expect(result.issues.map(i => i.code)).toContain('UNB_UNZ_REFERENCE_MISMATCH')
      expect(result.issues.map(i => i.code)).toContain('UNZ_COUNT_MISMATCH')
      expect(result.blocking).toBe(true)
    })
    it(`keeps a decoded 35-character identifier at the boundary (${syntax.join('')})`, () => {
      const raw = wire(syntax, permissionBody).replace('TECH-S', 'A'.repeat(33) + syntax[2] + syntax[2] + 'X')
      const result = preflight(raw)
      expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
      expect(result.ok).toBe(true)
    })
    it(`requires a required party group on the second object (${syntax.join('')})`, () => {
      const rule = canonicalProdat26AFieldRules('Z04').find(r => r.fieldNumber === 'END_USER_GROUP')!
      expect(rule.requirement).toBe('required')
      const input = matrixInput(wire(syntax, [ud, ['LIN', '2']], { code: 'Z04' }), 'Z04')
      expect(validateFieldMatrixPayload(input, [rule]).some(i => i.code === 'FIELD_MATRIX_REQUIRED_FIELD_MISSING')).toBe(true)
    })
    it(`does not promote a national dependent cell into unconditional R (${syntax.join('')})`, () => {
      const rule = canonicalProdat26AFieldRules('Z04').find(r => r.fieldNumber === '229')!
      expect(rule.requirement).toBe('dependent')
      const input = matrixInput(wire(syntax, [ud, ['LIN', '2'], ud], { code: 'Z04' }), 'Z04')
      expect(validateFieldMatrixPayload(input, [rule])).toEqual([])
    })
    it(`never borrows compatibility metadata from the next object or message (${syntax.join('')})`, () => {
      const raw = wire(syntax, [['LIN', '2'], ['DTM', ['7', '202610010930', '203']], ['LOC', '48', ['SE4']]], { code: 'Z03', app: '' })
      const parsed = parseInboundProdat(raw + wire(syntax, [], { app: 'NEXT-MESSAGE' }).slice(9))
      expect(parsed.applicationReference).toBeNull()
      expect(parsed.parsedPayload.requestedStartDate).toBeNull()
      expect(parsed.parsedPayload.priceAreaCode).toBeNull()
    })
    for (const [value, format, expected] of [
      ['20280229', '102', '2028-02-29'], ['202802292359', '203', '2028-02-29'],
      ['20260229', '102', null], ['202802292460', '203', null], ['20261001', '203', null],
    ] as const) {
      it(`uses exactly the legacy date component ${value}:${format} (${syntax.join('')})`, () => {
        const parsed = parseInboundProdat(wire(syntax, [['DTM', ['7', value, format]]]))
        expect(parsed.parsedPayload.requestedStartDate).toBe(expected)
      })
    }
  }
})
