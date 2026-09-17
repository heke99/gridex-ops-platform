import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { decideProdatAperak } from '@/lib/ediel/decisionEngine'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { parseEdifactEnvelope } from '@/lib/ediel/transport/index.part-1'
import { createEdielMessage } from '@/lib/ediel/db'
import { deriveProdatAperakValidationIssues } from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import type { EdielMessageRow, CreateEdielMessageInput } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
beforeEach(() => {
  db.from.mockReset()
  db.from.mockImplementation(() => { throw new Error('Unexpected database access in reference read test') })
})

// Synthetic independent reference cases; no SMTP, original TGT file or live DB.
function payload(code: string, body: string[], header: string[] = []): string {
  const segments = ['UNH+MSG+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOCUMENT+9+AB`,
    'DTM+137:202609171200:203', ...header, 'LIN+1++735999999999999999:::9', ...body]
  return ["UNA:+.? ", 'UNB+UNOC:3+12345:14+54321:14+260917:1200+INTERCHANGE++23-DDQ-PRODAT',
    ...segments, `UNT+${segments.length + 1}+MSG`, 'UNZ+1+INTERCHANGE'].join("'") + "'"
}
function message(raw: string | null, parsed: Record<string, unknown> = {}, code = 'Z04'): EdielMessageRow {
  return { id: 'message-id', company_id: 'tenant-A', direction: 'inbound', message_family: 'PRODAT',
    message_code: code, message_standard: 'edifact', environment: 'test', raw_payload: raw,
    parsed_payload: parsed, external_reference: 'DOCUMENT', transaction_reference: 'CASE',
    grid_owner_data_request_id: 'request-id' } as EdielMessageRow
}
const encode = (value: string) => value.replace(/[?:+']/g, character => `?${character}`)

describe('PRODAT reference projection through customer staging', () => {
  for (const value of ['A:B', 'A+B', "A'B", 'A?', '0000123']) {
    it(`preserves literal ${JSON.stringify(value)} and excludes C506 metadata`, () => {
      const raw = payload('Z04', ['MG', 'Z07', 'ANJ', 'Z05'].map(q => `RFF+${q}:${encode(value)}:LINE:VERSION`))
      const result = parseInboundProdatBusinessData(message(raw, { meterNumber: 'STALE', referenceToMeteringPoint: 'STALE', agreementReference: 'STALE', gridAreaCode: 'STALE' }))
      expect(result.meteringPoint.meterNumber).toBe(value)
      expect(result.meteringPoint.referenceToMeteringPoint).toBe(value)
      expect(result.production.referenceToMeteringPoint).toBe(value)
      expect(result.contract.agreementReference).toBe(value)
      expect(result.contract.gridAreaCode).toBe(value)
      expect(result.site.gridAreaCode).toBe(value)
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  it('absence in the first object is not filled from a header, later object or stale projection', () => {
    const raw = payload('Z04', ['RFF+MG::LINE', 'RFF+ACW:DECOY', 'LIN+2++OTHER:::9',
      'RFF+MG:SECOND', 'RFF+Z05:SECOND', 'RFF+Z07:SECOND', 'RFF+ANJ:SECOND'], ['RFF+MG:HEADER'])
    const result = parseInboundProdatBusinessData(message(raw, { meterNumber: 'STALE', referenceToMeteringPoint: 'STALE', agreementReference: 'STALE', gridAreaCode: 'STALE', customerName: 'Retained' }))
    expect(result.meteringPoint.meterNumber).toBeNull()
    expect(result.meteringPoint.referenceToMeteringPoint).toBeNull()
    expect(result.contract.agreementReference).toBeNull()
    expect(result.site.gridAreaCode).toBeNull()
    expect(result.customer.fullName).toBe('Retained')
  })
  it('structured-only legacy input retains explicit values', () => {
    const result = parseInboundProdatBusinessData(message(null, { meterNumber: 'OLD', referenceToMeteringPoint: 'LINK', agreementReference: 'AUTH', gridAreaCode: 'AREA' }))
    expect(result.meteringPoint).toMatchObject({ meterNumber: 'OLD', referenceToMeteringPoint: 'LINK' })
    expect(result.contract.agreementReference).toBe('AUTH')
    expect(result.site.gridAreaCode).toBe('AREA')
  })
})

describe('real transport, compatibility and ACK reference consumers', () => {
  for (const value of ['CASE:1', 'CASE+1', "CASE'1", 'CASE?', '00001']) {
    it(`all ingress readers preserve LI ${JSON.stringify(value)}`, () => {
      const raw = payload('Z15', [`RFF+LI:${encode(value)}:LINE:REV`, 'CCI++Z23', 'CAV+::A75', 'CCI++Z25', 'CAV+::B79'])
      const envelope = parseEdifactEnvelope(raw, 'PRODAT', 'Z15')
      expect(envelope.transactionReference).toBe(value)
      expect(envelope.parsedPayload.lineItemReference).toBe(value)
      expect(parseInboundProdat(raw).transactionReference).toBe(value)
      const ack = decideProdatAperak({ family: 'PRODAT', messageCode: 'Z15', testKind: 'TGT', rawPayload: raw })
      expect(ack.applicationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldCode: '322', lineItemReference: value }),
      ]))
      expect(db.from).not.toHaveBeenCalled()
    })
  }
  it('transport/compatibility cannot manufacture LI from C506 line/version metadata', () => {
    const raw = payload('Z15', ['RFF+LI::LINE:VERSION'])
    expect(parseEdifactEnvelope(raw, 'PRODAT', 'Z15').transactionReference).toBeNull()
    expect(parseInboundProdat(raw).transactionReference).toBeNull()
  })
  it('the production Z18 preflight checks actual Z09 value, not qualifier-only presence', () => {
    for (const reference of ['RFF+Z09:', 'RFF+Z09::LINE:VERSION', 'RFF+Z07:OBJECT']) {
      expect(preflightEdielPayload({ rawPayload: payload('Z18', [reference]), messageStandard: 'edifact', mode: 'send' }).issues)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_Z18_RFF_Z09_MISSING' })]))
    }
    expect(preflightEdielPayload({ rawPayload: payload('Z18', ['RFF+Z09:PERM?:1']), messageStandard: 'edifact', mode: 'send' }).issues
      .filter(issue => issue.code === 'PRODAT_Z18_RFF_Z09_MISSING')).toEqual([])
  })
})

describe('Z10 source-backed new versus old meter comparison in the real ACK path', () => {
  for (const [label, refs, invalid] of [
    ['same real values', ['RFF+MG:A?:1:LINE', 'RFF+Z02:A?:1:OTHER'], true],
    ['different real values', ['RFF+MG:A?:NEW', 'RFF+Z02:A?:OLD'], false],
    ['duplicate MG alone', ['RFF+MG:A', 'RFF+MG:A'], false],
    ['no cross-object borrowing', ['RFF+MG:A', 'RFF+Z02:B', 'LIN+2++OTHER:::9', 'CCI++Z02', 'CAV+:::1', 'RFF+MG:B', 'RFF+Z02:A'], false],
  ] as const) {
    it(label, () => {
      const raw = payload('Z10', ['CCI++Z02', 'CAV+:::1', ...refs])
      const testData = { testCaseCode: 'AUTO', groups: [] } as unknown as EdielTgtCaseTestData
      const issues = deriveProdatAperakValidationIssues({ message: message(raw, {}, 'Z10'), testData })
      expect(issues.some(issue => issue.ruleKey === 'meter_number_invalid')).toBe(invalid)
      expect(db.from).not.toHaveBeenCalled()
    })
  }
})

describe('business-reference persistence uses real PRODAT references, not stale aliases', () => {
  for (const variant of ['present', 'absent', 'undecodable'] as const) {
    const hasRefs = variant === 'present'
    it(`persists ${variant} source references without inventing typed aliases`, async () => {
      const row = message(payload('Z15', hasRefs ? ['RFF+LI:CASE?:1:LINE:REV', 'RFF+Z09:PERM?:1:LINE:REV', 'RFF+Z07:OBJECT?:1'] : ['RFF+LI::LINE:REV', 'RFF+Z07:OBJECT?:1']),
        { references: [{ qualifier: 'LI', value: 'STALE' }], permissionId: 'STALE_PERMISSION', transactionReference: 'STALE_IDE' }, 'Z15')
      if (variant === 'undecodable') row.raw_payload += '?'
      const saved: Array<Record<string, unknown>> = []
      db.from.mockImplementation((table: string) => {
        if (table === 'ediel_business_references') return { upsert: vi.fn(async (rows: Array<Record<string, unknown>>) => { saved.push(...rows); return { error: null } }) }
        if (!['ediel_messages', 'ediel_message_events'].includes(table)) throw new Error(`Unexpected table ${table}`)
        const query = { insert: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() }
        query.insert.mockReturnValue(query); query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
        query.single.mockResolvedValue({ data: table === 'ediel_messages' ? row : { id: 'event-id' }, error: null })
        query.maybeSingle.mockResolvedValue({ data: row, error: null })
        return query
      })
      const original = JSON.stringify(row)
      await createEdielMessage({ direction: 'inbound', messageFamily: 'PRODAT', messageCode: 'Z15', messageStandard: 'edifact', environment: 'test', rawPayload: row.raw_payload } as CreateEdielMessageInput)
      const ref = (type: string) => saved.find(item => item.reference_type === type)?.reference_value
      expect(ref('BGM_REF')).toBe(variant === 'undecodable' ? undefined : 'DOCUMENT')
      expect(ref('RFF_LI')).toBe(hasRefs ? 'CASE:1' : undefined)
      expect(ref('PERMISSION_ID')).toBe(hasRefs ? 'PERM:1' : undefined)
      expect(ref('RFF_Z07')).toBe(variant === 'undecodable' ? undefined : 'OBJECT:1')
      expect(ref('RFF_TN')).toBeUndefined()
      expect(ref('IDE')).toBeUndefined()
      expect(saved.every(item => item.company_id === 'tenant-A' && item.source_message_id === 'message-id' && item.business_object_id === 'request-id')).toBe(true)
      expect(JSON.stringify(row)).toBe(original)
    })
  }
})
