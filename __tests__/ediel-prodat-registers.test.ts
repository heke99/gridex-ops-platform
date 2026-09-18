import { describe, expect, it } from 'vitest'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { fieldRulePresent } from '@/lib/ediel/rulebook/fieldMatrix'

import { alphabets, line, qty, characteristic, common, raw, input, rule, validate, blocked } from './fixtures/prodat-register'

describe('P26.A: 314 and 258 are separate identities', () => {
  for (const alphabet of alphabets) {
    it(`reads C829 second component, not the whole element (${alphabet.join('')})`, () => {
      const payload = raw([line('1','A','1'),line('2','A','2')],'Z04',alphabet)
      expect(fieldRulePresent(rule('258'),input(payload))).toBe(true)
      expect(validate(payload)).toEqual([])
      expect(parseProdatMessage(payload).lineItems).toMatchObject([
        { lineSequenceNumber:'1', registerIndex:'1' }, { lineSequenceNumber:'2', registerIndex:'2' },
      ])
      expect(parseCanonicalEdifactAst(payload).messages[0].lineGroups).toMatchObject([
        { lineNumber:'1', registerIndex:'1' }, { lineNumber:'2', registerIndex:'2' },
      ])
    })
    it(`keeps the six-LIN/four-object original example (${alphabet.join('')})`, () => {
      const payload = raw([line('1','A'),line('2','B','1'),line('3','B','2'),line('4','C'),line('5','D','1'),line('6','D','2')],'Z04',alphabet)
      expect(validate(payload)).toEqual([])
      expect(parseProdatMessage(payload).lineItems).toMatchObject([
        { lineSequenceNumber:'1', registerIndex:null, registerCount:1 },
        { lineSequenceNumber:'2', registerIndex:'1', registerCount:2 },
        { lineSequenceNumber:'3', registerIndex:'2', registerCount:2 },
        { lineSequenceNumber:'4', registerIndex:null, registerCount:1 },
        { lineSequenceNumber:'5', registerIndex:'1', registerCount:2 },
        { lineSequenceNumber:'6', registerIndex:'2', registerCount:2 },
      ])
    })
  }
  for (const [name,body] of [
    ['global duplicate',[line('1','A','1'),line('1','A','2')]],
    ['global gap',[line('1','A','1'),line('3','A','2')]],
    ['global starts at two',[line('2','A')]],
    ['global empty',[line('','A')]],
    ['global zero',[line('0','A')]],
    ['global nonnumeric',[line('X','A')]],
    ['global exceeds n6',[line('1000000','A')]],
    ['missing object in second register',[line('1','A','1'),line('2','','2')]],
    ['single register must omit C829',[line('1','A','1')]],
    ['absent indices on repeated object',[line('1','A'),line('2','A')]],
    ['first index missing',[line('1','A'),line('2','A','2')]],
    ['second index missing',[line('1','A','1'),line('2','A')]],
    ['index starts at two',[line('1','A','2'),line('2','A','3')]],
    ['index duplicate',[line('1','A','1'),line('2','A','1')]],
    ['index gap',[line('1','A','1'),line('2','A','3')]],
    ['index reversed',[line('1','A','2'),line('2','A','1')]],
    ['index zero',[line('1','A','1'),line('2','A','0')]],
    ['index empty',[line('1','A','1'),line('2','A','')]],
    ['index nonnumeric',[line('1','A','1'),line('2','A','two')]],
    ['index exceeds n6',[line('1','A','1'),line('2','A','1000000')]],
    ['wrong subline indicator',[line('1','A','1'),['LIN','2','',['A','','','89'],['2','2']]]],
    ['scalar subline is not C829',[line('1','A','1'),['LIN','2','',['A','','','89'],'2']]],
    ['extra C829 component',[line('1','A','1'),['LIN','2','',['A','','','89'],['1','2','3']]]],
  ] as const) {
    it(`rejects ${name} without dropping wire evidence`, () => {
      const payload = raw(body)
      expect(parseProdatMessage(payload).lineItems).toHaveLength(body.length)
      expect(blocked(payload)).toBe(true)
    })
  }
  for (const code of ['Z01','Z02','Z03','Z05','Z08','Z09','Z13','Z14','Z15','Z18']) {
    it(`${code} cannot carry multiple-register C829`, () => {
      expect(blocked(raw([line('1','A','1'),line('2','A','2')],code),['258'],code)).toBe(true)
    })
  }
  it('accepts numeric leading zero without normalizing the stored wire', () => {
    const payload = raw([line('01','A','01'),line('02','A','02')])
    expect(validate(payload)).toEqual([])
    expect(parseProdatMessage(payload).lineItems[1]).toMatchObject({lineSequenceNumber:'02',registerIndex:'02'})
  })
})

describe('P annex2: first-register authority, register-local measurements', () => {
  for (const alphabet of alphabets) {
    it(`preserves unequal interleaved groups and escaped identities (${alphabet.join('')})`, () => {
      const a = 'A:+;*?\'!~^|%'
      const payload = raw([
        line('1',a,'1'),...common(a,'Alice'),qty('10'),...characteristic('Z02','1',3),
        line('2','B','1'),...common('B','Bob','202611010000'),qty('20'),
        line('3',a,'2'),qty('30'),...characteristic('Z02','3',3),...common('EVIL','Ignored','202612010000'),
        line('4','B','2'),qty('40'),
        line('5',a,'3'),qty('50'),
      ],'Z04',alphabet)
      expect(validate(payload)).toEqual([])
      const parsed = parseProdatMessage(payload)
      expect(parsed.lineItems.map(r => r.meteringPointId)).toEqual([a,'B',a,'B',a])
      expect(parsed.lineItems).toMatchObject([
        { registerIndex:'1',registerCount:3,endUserName:'Alice',annualConsumption:'10',meterConstant:'1' },
        { registerIndex:'1',registerCount:2,endUserName:'Bob',annualConsumption:'20' },
        { registerIndex:'2',registerCount:3,endUserName:'Alice',annualConsumption:'30',meterConstant:'3',meterNumber:'METER-'+a,gridAreaId:'NET-'+a,lineItemReference:'CASE-'+a,contractStartDate:'202610010000' },
        { registerIndex:'2',registerCount:2,endUserName:'Bob',annualConsumption:'40',contractStartDate:'202611010000' },
        { registerIndex:'3',registerCount:3,endUserName:'Alice',annualConsumption:'50',meterConstant:null },
      ])
      expect(parsed.lineItems[2].rawSegments.join('')).toContain('Ignored')
      expect(parsed.lineItems[4].rawSegments.join('')).not.toContain('Alice')
    })
    it(`later LIN need not repeat first-register dates/parties/references (${alphabet.join('')})`, () => {
      const payload = raw([line('1','A','1'),...common('A','Alice'),qty('10'),line('2','A','2'),qty('20')],'Z04',alphabet)
      expect(validate(payload,['314','209','258','210','508','223','224','226','260','227','228','231','232','316','213'])).toEqual([])
    })
  }
  it('never borrows annual energy from another register or another object', () => {
    expect(blocked(raw([line('1','A','1'),qty('10'),line('2','A','2')]),['213'])).toBe(true)
    expect(blocked(raw([line('1','A'),qty('10'),line('2','B')]),['213'])).toBe(true)
  })
  it('does not let a later repeat fill missing first-register authority', () => {
    const payload = raw([line('1','A','1'),line('2','A','2'),...common('A','Too late')])
    expect(parseProdatMessage(payload).lineItems[1].endUserName).toBeNull()
    expect(blocked(payload,['226','227','210'])).toBe(true)
  })
  it('does not treat different identity agencies as one meter', () => {
    const payload = raw([line('1','A',undefined,'89'),...common('A','Alice'),line('2','A',undefined,'9'),...common('A','Bob')])
    expect(validate(payload)).toEqual([])
    expect(parseProdatMessage(payload).lineItems).toMatchObject([{registerCount:1,endUserName:'Alice'},{registerCount:1,endUserName:'Bob'}])
  })
  it('does not manufacture a first-register authority for an invalid chain', () => {
    const payload = raw([line('1','A','2'),...common('A','Not register one'),line('2','A','3')])
    expect(blocked(payload)).toBe(true)
    expect(parseProdatMessage(payload).lineItems[1].endUserName).toBeNull()
  })
})
