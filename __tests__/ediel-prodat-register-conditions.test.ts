import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { line, qty, characteristic, raw, input, type Parts } from './fixtures/prodat-register'

const values = (field: string, value = '1') => field === '213' ? [qty(value)] : characteristic(({ '214':'Z02','218':'Z05','259':'Z16' } as Record<string,string>)[field],value,3)
const reason = (variant: string) => characteristic('Z13',({L:'Z22',E:'E34',G:'E32',F:'E64',M:'Z70'} as Record<string,string>)[variant])
function check(code: string, variant: string, body: Parts[], facts: ProdatDependentConditionFacts, fields: string[]) {
  const payload = raw(body,code)
  const resolved = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:variant,direction:'inbound',referenceDate:'2026-09-17',
    applicationReference:'23-DDQ-PRODAT',bilateralCapabilityVerified:true,prodatDependentFacts:facts,mode:'parse'})
  const policy = {...resolved,fieldRules:resolved.fieldRules.filter(r => fields.includes(String(('fieldNumber' in r ? r.fieldNumber : null))))}
  return validateCanonicalPolicyFields({policy,rawSegments:input(payload,code).rawSegments,una:input(payload,code).una})
}
const facts = (readings?: boolean): ProdatDependentConditionFacts => ({market:'electricity',meterReadingsSentInUtilts:readings,multipleMeterRegisters:true,byCell:{'Z04:259':readings,'Z06:259':readings,'Z10:259':readings}})

describe('P annex2 conditional register overlays composed with the canonical policy', () => {
  for (const [code,variant] of [['Z04','L'],['Z06','F'],['Z10','M']]) {
    for (const field of ['214','218','259']) {
      it(`${code}${variant}/${field}: explicit readings require an own value on every register`, () => {
        const first = [line('1','A','1'),...reason(variant),...values(field)]
        expect(check(code,variant,[...first,line('2','A','2')],facts(true),[field]).some(i => i.blocking)).toBe(true)
        expect(check(code,variant,[...first,line('2','A','2'),...values(field,'2')],facts(true),[field])).toEqual([])
      })
      it(`${code}${variant}/${field}: supplied field does not establish the unknown condition`, () => {
        expect(check(code,variant,[line('1','A','1'),...reason(variant),...values(field),line('2','A','2'),...values(field,'2')],facts(),[field]).some(i => i.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      })
      it(`${code}${variant}/${field}: optional constants/digits remain distinct from forbidden electricity time frames`, () => {
        const body = [line('1','A','1'),...reason(variant),...values(field),line('2','A','2'),...values(field,'2')]
        expect(check(code,variant,body,facts(false),[field]).some(i => i.blocking)).toBe(field === '259')
      })
    }
  }
  for (const variant of ['E','G']) for (const field of ['213','214','218','259']) {
    it(`Z06${variant}/${field}: own first register controls repetition, not another object`, () => {
      const body = [line('1','A','1'),...reason(variant),...values(field),line('2','B','1'),...reason(variant),line('3','A','2'),line('4','B','2')]
      expect(check('Z06',variant,body,facts(true),[field]).some(i => i.blocking)).toBe(true)
      body.splice(body.length-1,0,...values(field,'2'))
      expect(check('Z06',variant,body,facts(true),[field])).toEqual([])
    })
    it(`Z06${variant}/${field}: no first value does not automatically forbid a later value`, () => {
      expect(check('Z06',variant,[line('1','A','1'),...reason(variant),line('2','A','2'),...values(field)],facts(true),[field])).toEqual([])
    })
  }
  for (const [code,variant] of [['Z06','F'],['Z10','M']]) {
    it(`${code}/${variant}: optional first annual energy makes later annual energy mandatory only for the same object`, () => {
      const body = [line('1','A','1'),...reason(variant),qty('1'),line('2','A','2')]
      expect(check(code,variant,body,facts(false),['213']).some(i=>i.blocking)).toBe(true)
      expect(check(code,variant,[...body,qty('1')],facts(false),['213'])).toEqual([])
    })
  }
  it('uses each object’s first subtype; a repeated subtype cannot change register semantics', () => {
    const body = [line('1','A','1'),...reason('E'),line('2','B','1'),...reason('F'),...values('214'),line('3','A','2'),...reason('F'),line('4','B','2')]
    expect(check('Z06','E',body,facts(true),['214']).some(i => i.blocking)).toBe(true)
    expect(check('Z06','E',[...body,...values('214')],facts(true),['214'])).toEqual([])
  })
  it('rejects duplicate tariff codes within an object but not equal energy/constants', () => {
    const body = [line('1','A','1'),...reason('L'),...values('259','111'),qty('20'),...values('214','1'),line('2','A','2'),...values('259','111'),qty('20'),...values('214','1')]
    expect(check('Z04','L',body,facts(true),['259','213','214']).some(i=>i.blocking)).toBe(true)
    const fixed = [line('1','A','1'),...reason('L'),...values('259','111'),qty('20'),...values('214','1'),line('2','A','2'),...values('259','112'),qty('20'),...values('214','1')]
    expect(check('Z04','L',fixed,facts(true),['259','213','214'])).toEqual([])
  })
  it('derives C829 cardinality per object, not from a caller-wide guessed flag', () => {
    const body = [line('1','SINGLE'),...reason('L'),line('2','MULTI','1'),...reason('L'),line('3','MULTI','2')]
    expect(check('Z04','L',body,{...facts(false),multipleMeterRegisters:false},['258'])).toEqual([])
  })
})

describe('register-local syntax and safe scalar projection', () => {
  for (const field of ['213','214','218','259']) {
    it(`${field}: duplicate local values cannot become a trusted scalar`, () => {
      const body = [line('1','A'),...reason('L'),...values(field),...values(field,'2')]
      const fieldName = ({'213':'annualConsumption','214':'meterConstant','218':'meterDigitCount','259':'meterTimeFrame'} as const)[field as '213']
      expect(parseProdatMessage(raw(body)).lineItems[0][fieldName]).toBeNull()
      expect(check('Z04','L',body,facts(true),[field]).some(i=>i.blocking)).toBe(true)
    })
  }
})
