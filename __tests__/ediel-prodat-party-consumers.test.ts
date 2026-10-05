import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEdifactEnvelope } from '@/lib/ediel/transport/index.part-1'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveProdatPermissionAperakValidationIssues } from '@/lib/ediel/testing/prodatPermissionEngine'
import { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
beforeEach(() => {
  db.from.mockReset()
  db.from.mockImplementation(() => { throw new Error('Unexpected database access in NAD projection test') })
})

// Independent synthetic wires, not original market/TGT fixtures. The only DB
// boundary below is an explicitly declared in-memory candidate result.
type Alphabet = readonly [string, string, string, string]
const defaultSyntax: Alphabet = [':', '+', '?', "'"]
const alphabets: readonly Alphabet[] = [defaultSyntax, ['*', ';', '!', '~'], ['^', '|', '!', '%']]
const point = '735999999999999999'
const encode = (value: string, syntax: Alphabet) => [...value].map(ch => syntax.includes(ch) ? syntax[2] + ch : ch).join('')
function segment(parts: readonly (string | readonly string[])[], syntax = defaultSyntax): string {
  return parts.map(part => typeof part === 'string' ? encode(part, syntax) : part.map(value => encode(value, syntax)).join(syntax[0])).join(syntax[1])
}
function nad(role: string, overrides: Record<number, string | string[]> = {}, syntax = defaultSyntax): string {
  const header = ['FR', 'DO', 'Z02'].includes(role), installation = role === 'IT'
  const parts: Array<string | string[]> = ['NAD', role, header ? ['000Legal', '160', 'SVK'] : [installation ? point : '00a:B', '', '89'], '',
    header || installation ? '' : ['Name  (1)', "Second?'"], header ? '' : ['Street+1', '', 'Box:3'], header ? '' : 'Town', '', header ? '' : '001 23', role === 'Z02' ? '' : 'SE']
  for (const [key, value] of Object.entries(overrides)) parts[Number(key)] = value
  return segment(parts, syntax)
}
function payload(body: string[], syntax = defaultSyntax, code = 'Z04', header?: string[]): string {
  const segments = [segment(['UNH', 'MSG', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], syntax), segment(['BGM', code, 'DOCUMENT', '9', 'AB'], syntax),
    segment(['DTM', ['137', '202609171200', '203']], syntax), ...(header ?? [nad('FR', {}, syntax), nad('DO', {}, syntax)]),
    segment(['LIN', '1', '', [point, '', '', '9']], syntax), ...body]
  return `UNA${syntax[0]}${syntax[1]}.${syntax[2]} ${syntax[3]}` + [
    segment(['UNB', ['UNOC', '3'], ['12345', '14'], ['54321', '14'], ['260917', '1200'], 'INTERCHANGE', '', '23-DDQ-PRODAT'], syntax),
    ...segments, segment(['UNT', String(segments.length + 1), 'MSG'], syntax), segment(['UNZ', '1', 'INTERCHANGE'], syntax),
  ].join(syntax[3]) + syntax[3]
}
function message(raw: string | null, extra: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return { id: 'source-id', company_id: 'tenant-A', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04',
    message_standard: 'edifact', environment: 'test', raw_payload: raw, external_reference: 'DOCUMENT', transaction_reference: 'CASE',
    sender_ediel_id: '12345', receiver_ediel_id: '54321', parsed_payload: { customerId: 'STALE-ID', customerName: 'Stale name', customerAddress: 'Stale UD', siteAddress: 'Stale IT' }, ...extra } as EdielMessageRow
}
const nadIssues = (raw: string) => preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues
  .filter(issue => issue.segment?.startsWith('NAD') && ['PROFILE_FIELD_LENGTH_EXCEEDED', 'FIELD_MATRIX_FIELD_FORMAT_INVALID'].includes(issue.code))

describe('NAD read consumers use one source party identity', () => {
  for (const syntax of alphabets) {
    it(`keeps legal actors, customer, installation and invoicee separate with ${syntax.join('')}`, () => {
      const raw = payload([nad('UD', {}, syntax), nad('IT', { 5: ['Installation:1', 'Floor+2', 'Door?3'] }, syntax), nad('IV', { 2: ['Invoice+1', '', '89'], 4: 'Invoice name' }, syntax)], syntax)
      const row = message(raw), original = JSON.stringify(row)
      const ingress = parseEdifactEnvelope(raw, 'PRODAT', 'Z04'), compatibility = parseInboundProdat(raw)
      expect(ingress.senderEdielId).toBe('12345')
      expect(ingress.parsedPayload).toMatchObject({ legalSenderId: '000Legal', legalReceiverId: '000Legal' })
      expect(compatibility.parsedPayload).toMatchObject({ customerId: '00a:B', customerName: "Name  (1)\nSecond?'", invoiceeId: 'Invoice+1' })
      const lines = parseProdatMessage(raw).lineItems
      expect(lines[0]).toMatchObject({ endUserAddress: 'Street+1\n\nBox:3', installationAddress: 'Installation:1\nFloor+2\nDoor?3', invoiceeName: 'Invoice name' })
      const staging = parseInboundProdatBusinessData(row)
      expect(staging.customer).toMatchObject({ customerId: '00a:B', fullName: "Name  (1)\nSecond?'", address: 'Street+1\n\nBox:3', postalCode: '001 23' })
      expect(staging.site.street).toBe('Installation:1\nFloor+2\nDoor?3')
      expect(JSON.stringify(row)).toBe(original)
      expect(db.from).not.toHaveBeenCalled()
    })
    it(`passes the parsed UNA to the canonical NAD policy evaluator (${syntax.join('')})`, () => {
      const raw = payload([nad('UD', {}, syntax), nad('IT', {}, syntax), nad('Z02', {}, syntax)], syntax)
      const canonical = parseCanonicalEdielPayload({ rawPayload: raw, standardHint: 'edifact' })
      expect(canonical).toMatchObject({ sender: '12345', receiver: '54321', applicationReference: '23-DDQ-PRODAT', version: 'E2SE6A' })
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z04', subtypeOrReasonCode: 'Z22', direction: 'inbound', referenceDate: '2026-09-17', applicationReference: canonical.applicationReference, mode: 'catalog_evidence' })
      const issues = validateCanonicalPolicyFields({ policy, rawSegments: canonical.rawSegments, una: canonical.una })
      // Other required/dependent fields are outside this synthetic NAD example.
      expect(issues.filter(issue => issue.fieldPath?.startsWith('NAD+') && !issue.code.startsWith('PRODAT_DEPENDENT_'))).toEqual([])
      expect(canonical.una?.dataElementSeparator).toBe(syntax[1])
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  for (const syntax of alphabets) {
    it(`preserves technical route components without promoting legal parties (${syntax.join('')})`, () => {
      const baseUnb = segment(['UNB', ['UNOC', '3'], ['12345', '14'], ['54321', '14'], ['260917', '1200'], 'INTERCHANGE', '', '23-DDQ-PRODAT'], syntax)
      const actualUnb = segment(['UNB', ['UNOC', '3'], ["Sender:?+", '14', "S:?'"], ["Receiver:*;!", '14', 'R*;!'], ['260917', '1200'], 'INTERCHANGE', '', '23-DDQ-PRODAT'], syntax)
      const raw = payload([nad('UD', {}, syntax)], syntax).replace(baseUnb, actualUnb)
      expect(parseCanonicalEdielPayload({ rawPayload: raw, standardHint: 'edifact' })).toMatchObject({
        sender: 'Sender:?+', receiver: 'Receiver:*;!', senderSubAddress: "S:?'", receiverSubAddress: 'R*;!',
        applicationReference: '23-DDQ-PRODAT', version: 'E2SE6A',
      })
    })
    it(`missing or composite application reference cannot select a policy (${syntax.join('')})`, () => {
      for (const application of ['', '23-DDQ-PRODAT' + syntax[0] + 'OTHER']) {
        const raw = payload([nad('UD', {}, syntax)], syntax).replace('23-DDQ-PRODAT', application)
        const canonical = parseCanonicalEdielPayload({ rawPayload: raw, standardHint: 'edifact' })
        expect(canonical.applicationReference).toBeNull()
        expect(() => resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z04', subtypeOrReasonCode: 'Z22',
          direction: 'inbound', referenceDate: '2026-09-17', applicationReference: canonical.applicationReference, mode: 'catalog_evidence' }))
          .toThrow('canonical_ediel_application_reference_required:PRODAT:Z04')
      }
    })
  }
  for (const variant of ['absent', 'empty', 'header', 'later'] as const) {
    it(`never fills ${variant} UD from IV, another object or cached metadata`, () => {
      const body = [nad('IV')], header = [nad('FR'), nad('DO')]
      if (variant === 'empty') body.unshift(nad('UD', { 2: '', 4: '', 5: '', 6: '', 8: '', 9: '' }))
      if (variant === 'header') header.push(nad('UD'))
      if (variant === 'later') body.push(`LIN+2++OTHER:::9`, nad('UD'))
      const raw = payload(body, defaultSyntax, 'Z04', header)
      expect(parseProdatMessage(raw).lineItems[0].customerId).toBeNull()
      expect(parseInboundProdat(raw).parsedPayload.customerId).toBeNull()
      const staging = parseInboundProdatBusinessData(message(raw))
      expect(staging.customer).toMatchObject({ customerId: null, fullName: null, address: null, country: null })
      expect(staging.site.street).toBeNull()
      expect(db.from).not.toHaveBeenCalled()
    })
  }
})

describe('real preflight validates decoded source NAD components, not sanitized identities', () => {
  for (const value of ['000aBc', 'A:B', 'A+B', "A'B", 'A?', 'A  B', 'A'.repeat(35)]) {
    it(`preserves permitted an content ${JSON.stringify(value)}`, () => {
      expect(nadIssues(payload([nad('UD', { 2: [value, '', '89'], 4: [value, 'B'.repeat(35)], 5: [value, '', 'C'.repeat(35)] }), nad('IT')]))).toEqual([])
    })
  }
  for (const [role, element, value] of [
    ['UD', 2, ['X', 'SE1', 'ZZZ']], ['UD', 4, ['First', 'Second', 'Unused']], ['UD', 5, ['Street', '', '', 'Unused']],
    ['UD', 4, 'X'.repeat(36)], ['UD', 8, 'X'.repeat(10)], ['UD', 6, ['Town', 'Other']],
    ['IT', 2, [point, 'SE1', '260']], ['IT', 2, ['OTHER', '', '9']], ['IT', 4, 'Unused name'], ['IT', 5, ['', 'Second']],
    ['IV', 6, ''], ['IV', 8, ''], ['IV', 9, ''], ['FR', 9, 'SWE'], ['DO', 9, ''], ['Z02', 9, 'SE'],
  ] as Array<[string, number, string | string[]]>) {
    it(`blocks source-invalid ${role}/${element}/${JSON.stringify(value)}`, () => {
      const header = [nad('FR'), nad('DO')]
      if (role === 'FR' || role === 'DO') header[role === 'FR' ? 0 : 1] = nad(role, { [element]: value })
      const body = role === 'FR' || role === 'DO' ? [nad('UD')] : [nad(role, { [element]: value })]
      expect(nadIssues(payload(body, defaultSyntax, 'Z04', header)).length).toBeGreaterThan(0)
    })
  }
  it('checks the second object and wrong header scope without borrowing a valid first object', () => {
    expect(nadIssues(payload([nad('UD'), `LIN+2++${point}:::9`, nad('UD', { 4: ['First', 'Second', 'Third'] })])).length).toBeGreaterThan(0)
    expect(nadIssues(payload([nad('FR'), nad('UD')])).length).toBeGreaterThan(0)
  })
  it('a malformed nonempty wire blocks instead of falling back to a stored party', () => {
    expect(() => parseInboundProdatBusinessData(message(payload([nad('UD')]) + '?'))).toThrow('edifact_dangling_release_character')
    expect(parseInboundProdatBusinessData(message(null)).customer.fullName).toBe('Stale name')
  })
})

describe('actual builders carry explicit parties without inventing substitutes', () => {
  it('the compatibility builder emits FR/DO and a line-level UD with ebIX260', () => {
    const built = buildProdatMessage({ dependentConditionFacts:{endUserAddressObjects:[selectedAddressFact(point,'tenant-A','9','000a:B',[],'SE1')],invoiceeObjects:[selectedInvoiceeFact(point,'tenant-A','9','000a:B',[],'SE1')]}, companyId: 'tenant-A', role: 'supplier', businessCode: 'Z03', sender: { edielId: '12345' }, receiver: { edielId: '54321' },
      meteringPoint: { id: point }, customer: { identity: '000a:B', identityQualifier: 'SE1', name: "Name?'" }, references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' }, dates: { startDate: '2026-10-01' }, environment: 'test' })
    expect(built.rawEdifact).toContain('NAD+FR+12345:160:SVK+++++++SE')
    expect(built.rawEdifact).not.toContain('NAD+MS+')
    expect(built.rawEdifact.indexOf('NAD+UD+')).toBeGreaterThan(built.rawEdifact.indexOf('LIN+'))
    expect(parseProdatMessage(built.rawEdifact).lineItems[0]).toMatchObject({ customerId: '000a:B', endUserName: "Name?'" })
    expect(nadIssues(built.rawEdifact)).toEqual([])
  })
  it('the main renderer keeps explicit invoicee components and drops them when source usage is forbidden', () => {
    const context: ProdatEngineProductionContext = { code: 'Z04', bgmReference: 'DOCUMENT', transactionReference: 'CASE', senderEdielId: '12345', receiverEdielId: '54321',
      legalSenderId: '00999', legalSenderCountry: 'DK', customerName: 'User', customerId: '001', customerIdAgency: '89', customerNameLines: ['User', 'Other'],
      meterPointId: point, siteAddressLines: ['Site', '', 'Door'], reasonForTransaction: 'Z22',
      invoicee: { id: 'Bill+1', idAgency: '89', name: 'Bill', addressLines: ['Invoice', '', 'Box'], city: 'Town', postalCode: '001 23', country: 'NO' } }
    const result = buildProfiledProdatSegments({ context, generatedAt: new Date('2026-09-17T12:00:00Z') })
    expect(parseProdatMessage(result.segments.join("'") + "'").lineItems[0]).toMatchObject({ endUserName: 'User\nOther', invoiceeId: 'Bill+1', invoiceeAddress: 'Invoice\n\nBox' })
    expect(result.segments).toContain('NAD+FR+00999:160:SVK+++++++DK')
    const noInvoicee = buildProfiledProdatSegments({ context: { ...context, code: 'Z13', reasonForTransaction: 'S17' }, generatedAt: new Date('2026-09-17T12:00:00Z') })
    expect(noInvoicee.segments.some(s => s.startsWith('NAD+IV+'))).toBe(false)
    expect(() => buildProfiledProdatSegments({ context: { ...context, customerIdCodeListQualifier: 'Z01' }, generatedAt: new Date('2026-09-17T12:00:00Z') }))
      .toThrow('prodat_party_code_list_invalid')
  })
})

describe('NAD permission matching at the declared service boundary', () => {
  for (const variant of ['matching', 'case', 'invoicee', 'bad-agency', 'other-tenant', 'headerless'] as const) {
    it(`handles ${variant} without crossing party or tenant boundaries`, async () => {
      const candidate = message(payload([nad('UD'), 'RFF+LI:CASE'], defaultSyntax, 'Z13'), { id: 'candidate', direction: 'outbound', message_code: 'Z13', sender_ediel_id: '54321', receiver_ediel_id: '12345' })
      const inbound = message(payload([variant === 'invoicee' ? nad('IV') : nad('UD', variant === 'case' ? { 2: ['00A:B', '', '89'] } : {}), 'RFF+LI:CASE'], defaultSyntax, 'Z14'), { message_code: 'Z14' })
      if (variant === 'bad-agency') candidate.raw_payload = payload([nad('UD', { 2: ['00a:B', 'SE1', 'ZZZ'] }), 'RFF+LI:CASE'], defaultSyntax, 'Z13')
      if (variant === 'other-tenant') candidate.company_id = 'tenant-B'
      if (variant === 'headerless') { candidate.raw_payload = 'NO-EDIFACT'; candidate.customer_id = '00a:B'; candidate.metering_point_id = point }
      const original = JSON.stringify([candidate, inbound])
      const filters: unknown[][] = []
      const q = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
        then: (resolve: (value: { data: EdielMessageRow[]; error: null }) => unknown) => Promise.resolve({ data: [candidate], error: null }).then(resolve) }
      q.eq.mockImplementation((...args: unknown[]) => { filters.push(args); return q })
      q.select.mockReturnValue(q); q.not.mockReturnValue(q); q.order.mockReturnValue(q); q.limit.mockReturnValue(q)
      db.from.mockImplementation((table: string) => { expect(table).toBe('ediel_messages'); return q })
      const issues = await resolveProdatPermissionAperakValidationIssues({ message: inbound })
      expect(filters).toContainEqual(['company_id', 'tenant-A'])
      expect(filters).toContainEqual(['environment', 'test'])
      expect(filters).toContainEqual(['sender_ediel_id', '54321'])
      expect(filters).toContainEqual(['receiver_ediel_id', '12345'])
      expect(issues.length === 0).toBe(variant === 'matching')
      expect(JSON.stringify([candidate, inbound])).toBe(original)
    })
  }
  it('blocks missing company before a privileged lookup', async () => {
    await expect(resolveProdatPermissionAperakValidationIssues({ message: message(payload([nad('UD')], defaultSyntax, 'Z14'), { company_id: null, message_code: 'Z14' }) }))
      .rejects.toThrow('prodat_permission_company_scope_required')
    expect(db.from).not.toHaveBeenCalled()
  })
})
