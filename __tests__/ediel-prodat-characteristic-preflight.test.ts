import { describe, expect, it, vi } from 'vitest'
import { validateEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import type { EdielTgtExpectedStep } from '@/lib/ediel/testing/tgtRegistry'

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: new Proxy({}, { get() { throw new Error('Unexpected database access in PRODAT preflight test') } }),
}))

function payload(code: string, pair: string[]): string {
  const body = [
    'UNH+M+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+MESSAGE+9+AB`,
    'DTM+137:202609171200:203', 'LIN+1++735999999999999999:::9', ...pair,
  ]
  return ["UNA:+.? ", 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT',
    ...body, `UNT+${body.length + 1}+M`, 'UNZ+1+I'].join("'") + "'"
}

function mismatches(code: string, pair: string[]): { production: boolean; tgt: boolean } {
  const raw = payload(code, pair)
  const step: EdielTgtExpectedStep = {
    stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code,
    required: true, title: 'Synthetic component regression', description: 'Not an original TGT fixture',
  }
  return {
    production: preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues
      .some(issue => issue.code === 'PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH'),
    tgt: validateEdielTgtDraft(raw, step, null, { actorEdielId: '12345', testPortalEdielId: '54321' })
      .some(issue => issue.code === 'energy_product_cav_component_mismatch'),
  }
}

describe('PRODAT field242/506: real production and TGT preflight callsites', () => {
  for (const code of ['Z04', 'Z06', 'Z10']) {
    it(`${code}: legitimate fourth-component product is not treated as permission energy`, () => {
      expect(mismatches(code, ['CCI++Z14', 'CAV+:::L917'])).toEqual({ production: false, tgt: false })
    })
  }
  for (const code of ['Z13', 'Z14']) {
    it(`${code}: misplaced energy remains blocked in both entrypoints`, () => {
      expect(mismatches(code, ['CCI++Z14', 'CAV+:::8716867000030'])).toEqual({ production: true, tgt: true })
    })
    it(`${code}: fifth-component energy does not trip the slot guard`, () => {
      expect(mismatches(code, ['CCI++Z14', 'CAV+::::8716867000030'])).toEqual({ production: false, tgt: false })
    })
    it(`${code}: neither a qualifier prefix nor an orphan CAV supplies field506`, () => {
      expect(mismatches(code, ['CCI++Z140', 'CAV+:::L917'])).toEqual({ production: false, tgt: false })
      expect(mismatches(code, ['CCI++Z14', 'LIN+2++OTHER:::9', 'CAV+:::L917'])).toEqual({ production: false, tgt: false })
    })
  }
})

// These are pure read/decision paths. No customer mutation, portal or SMTP call.
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { decideProdatAperak } from '@/lib/ediel/decisionEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'

function message(raw: string | null, parsed: Record<string, string> = {}): EdielMessageRow {
  return { raw_payload: raw, parsed_payload: parsed, message_family: 'PRODAT', message_code: 'Z04', direction: 'inbound' } as EdielMessageRow
}

describe('PRODAT characteristic consumers beyond the line parser', () => {
  it('customer staging reads exact product/status/settlement/constant/digit/frequency fields', () => {
    const result = parseInboundProdatBusinessData(message(payload('Z04', [
      'CCI++Z14', 'CAV+:::L641Q', 'CCI++Z07', 'CAV+E23', 'CCI++Z15', 'CAV+E01',
      'CCI++Z02', 'CAV+:::10', 'CCI++Z05', 'CAV+:::8', 'CCI++Z16', 'CAV+:::E01', 'CCI++Z12', 'CAV+:::D',
    ])))
    expect(result.production.productCode).toBe('L641Q')
    expect(result.production.installationStatus).toBe('E23')
    expect(result.production.settlementMethod).toBe('E01')
    expect(result.meteringPoint).toMatchObject({ meterConstant: 10, meterDigits: 8, meterInterval: 'E01', readingFrequency: 'D' })
  })
  it('status, priority and energy-product values never become product242', () => {
    const result = parseInboundProdatBusinessData(message(payload('Z04', [
      'CCI++Z07', 'CAV+L641Q', 'CCI++Z09', 'CAV+L641Q', 'CCI++Z14', 'CAV+::::L641Q',
    ]), { productCode: 'STALE_PRODUCT' }))
    expect(result.production.productCode).toBeNull()
  })
  it('wire characteristics remain exact without inventing an absent party', () => {
    const result = parseInboundProdatBusinessData(message(payload('Z04', ['CCI++Z14', 'CAV+:::L917']), { productCode: 'STALE', customerName: 'Preserved customer' }))
    expect(result.production.productCode).toBe('L917')
    expect(result.customer.fullName).toBeNull()
  })
  it('present party data remains independent of characteristic projection', () => {
    const result = parseInboundProdatBusinessData(message(payload('Z04', [
      'CCI++Z14', 'CAV+:::L917', 'NAD+UD+001::89++Wire customer+++++SE',
    ]), { productCode: 'STALE', customerName: 'Stale customer' }))
    expect(result.production.productCode).toBe('L917')
    expect(result.customer.fullName).toBe('Wire customer')
  })
  it('structured-only legacy records retain their explicit fallback', () => {
    const result = parseInboundProdatBusinessData(message(null, { productCode: 'L917', customerName: 'Legacy customer' }))
    expect(result.production.productCode).toBe('L917')
    expect(result.customer.fullName).toBe('Legacy customer')
  })
  it('first-object staging cannot borrow a product from the next LIN', () => {
    const result = parseInboundProdatBusinessData(message(payload('Z04', ['CCI++Z07', 'CAV+E23', 'LIN+2++OTHER:::9', 'CCI++Z14', 'CAV+:::L641Q'])))
    expect(result.production.productCode).toBeNull()
  })
  it('the actual ACK decision also rejects metadata-only mandatory status and end reason', () => {
    const result = decideProdatAperak({ family: 'PRODAT', messageCode: 'Z15', testKind: 'TGT', rawPayload: payload('Z15', ['CCI++Z23', 'CAV+::A75', 'CCI++Z25', 'CAV+::B79']) })
    expect(result.applicationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: '322', ercCode: '41' }),
      expect.objectContaining({ fieldCode: '324', ercCode: '41' }),
    ]))
  })
  it('the actual ACK decision does not confuse valid coded values with trailing metadata', () => {
    const result = decideProdatAperak({ family: 'PRODAT', messageCode: 'Z15', testKind: 'TGT', rawPayload: payload('Z15', ['CCI++Z23', 'CAV+A75::AGENCY', 'CCI++Z25', 'CAV+B79::AGENCY']) })
    expect(result.applicationErrors.filter(issue => ['322', '324'].includes(issue.fieldCode ?? ''))).toEqual([])
  })
})
