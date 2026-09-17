import { describe, expect, it } from 'vitest'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalProdat26AFieldRules, PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { prodatDate102, prodatDate203, prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat'

// Independent expected tuples from locked P26.A r3 pp43,49–52, not the implementation table.
const fields = [
  ['205','137','203','202402291230','Z04','header'], ['206','ZZZ','805','1','Z04','header'],
  ['210','92','203','202403010130','Z04','line'], ['211','93','203','202404010230','Z05','line'],
  ['302','90','203','202403010330','Z13','line'], ['321','91','203','202404010430','Z13','line'],
  ['216','157','203','202403010530','Z06','line'], ['212','51','203','202403010630','Z04','line'],
  ['249','329','102','20000229','Z04','line'], ['508','354','806','15','Z04','line'],
  ['326','693','203','202402291130','Z14','line'], ['327','164','203','202405010730','Z15','line'],
] as const
const alphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']] as const
type Parts = readonly (string | readonly string[])[]
function raw(body: readonly Parts[], header: readonly Parts[] = [], alphabet: readonly string[] = alphabets[0]): string {
  const [component, element, release, segment] = alphabet
  const encode = (s: string) => [...s].map(ch => alphabet.includes(ch) ? release + ch : ch).join('')
  const render = (p: Parts) => p.map(v => typeof v === 'string' ? encode(v) : v.map(encode).join(component)).join(element)
  return `UNA${component}${element}.${release} ${segment}` + [
    ['UNB',['UNOC','3'],'S','R',['240229','1230'],'I'],
    ['UNH','M',['PRODAT','D','97A','UN','E2SE6A']], ['BGM','Z04','D','9','AB'],
    ...header, ['LIN','1','',['POINT-1','','','89']], ...body, ['UNT','1','M'],['UNZ','1','I'],
  ].map(render).join(segment) + segment
}
const dtm = (q: string, value: string, format: string): Parts => ['DTM',[q,value,format]]
function evaluation(payload: string, code: string) {
  const t = tokenizeEdifact(payload)
  return { family: 'PRODAT', code, rawSegments: t.segments.map(s => s.raw), una: t.una, mode: 'parse' as const }
}
const ruleFor = (field: string, code: string) => canonicalProdat26AFieldRules(code).find(r => r.fieldNumber === field)!

 describe('DTM: all twelve original field locators, units and formats', () => {
  for (const [field,q,fmt,value,code,scope] of fields) {
    const sample = (entry: Parts, alphabet: readonly string[] = alphabets[0]) => scope === 'header' ? raw([], [entry], alphabet) : raw([entry], [], alphabet)
    it(`${field} has its exact source qualifier ${q}`, () => {
      expect(PRODAT_26A_FIELD_MATRIX.find(r => r.fieldNumber === field)?.segmentPath).toBe(`DTM+${q}`)
    })
    for (const alphabet of alphabets) {
      it(`${field}: valid value/unit works with ${alphabet.join('')}`, () => {
        const input = evaluation(sample(dtm(q,value,fmt), alphabet), code)
        expect(fieldRulePresent(ruleFor(field,code),input)).toBe(true)
        expect(validateFieldMatrixPayload(input,[ruleFor(field,code)])).toEqual([])
      })
    }
    for (const [name,entry] of [
      ['empty',dtm(q,'',fmt)], ['wrong format',dtm(q,value,fmt === '102' ? '203' : '102')],
      ['extra component',['DTM',[q,value,fmt,'EXTRA']]], ['extra element',['DTM',[q,value,fmt],'EXTRA']],
      ['embedded separator',dtm(q, value + ':FAKE',fmt)],
    ] as const) {
      it(`${field}: blocks provided ${name} even when optional/dependent`, () => {
        const invalid = evaluation(sample(entry),code)
        const optionalRule = { ...ruleFor(field,code), requirement: 'optional' as const }
        expect(validateFieldMatrixPayload(invalid,[optionalRule]).some(i => i.blocking)).toBe(true)
      })
    }
    it(`${field}: wrong scope does not satisfy its rule`, () => {
      const entry = dtm(q,value,fmt)
      const wrong = evaluation(scope === 'header' ? raw([entry]) : raw([], [entry]),code)
      expect(fieldRulePresent(ruleFor(field,code),wrong)).toBe(false)
    })
    it(`${field}: duplicate evidence is ambiguous, not a first-wins value`, () => {
      const entry = dtm(q,value,fmt)
      const payload = scope === 'header' ? raw([], [entry,entry]) : raw([entry,entry])
      expect(validateFieldMatrixPayload(evaluation(payload,code),[{ ...ruleFor(field,code), requirement:'optional' }]).some(i => i.blocking)).toBe(true)
    })
  }
  for (const invalid of ['202302291200','202413011200','202404311200','202400011200','202401002359','202401012400','202401011260','000001011200','2024-02-29','20240229120000','garbage202402291200']) {
    it(`does not accept impossible/malformed calendar value ${invalid}`, () => {
      expect(validateFieldMatrixPayload(evaluation(raw([dtm('92',invalid,'203')]),'Z04'),[ruleFor('210','Z04')]).some(i => i.blocking)).toBe(true)
    })
  }
  for (const value of ['2','+1','0','-1','01','1.0']) {
    it(`does not declare PRODAT offset ${value} instead of fixed standard time`, () => {
      expect(validateFieldMatrixPayload(evaluation(raw([], [dtm('ZZZ',value,'805')]),'Z04'),[ruleFor('206','Z04')]).some(i => i.blocking)).toBe(true)
    })
  }
  it('checks required/forbidden DTM values in every object without cross-object borrowing', () => {
    const two = raw([dtm('92','202403011200','203'),['LIN','2']])
    expect(validateFieldMatrixPayload(evaluation(two,'Z04'),[ruleFor('210','Z04')]).some(i => i.blocking)).toBe(true)
    const forbidden = raw([['LIN','2'],dtm('93','202403011200','203')])
    expect(validateFieldMatrixPayload(evaluation(forbidden,'Z03'),[ruleFor('211','Z03')]).some(i => i.blocking)).toBe(true)
  })
})

describe('DTM: strict market-calendar and absolute-instant rendering', () => {
  for (const [value,expected] of [
    ['2024-02-29','202402290000'],['202402291201','202402291201'], ['2024-07-01T12:34','202407011234'],
    ['2024-07-01T12:34:00Z','202407011334'],['2024-07-01T12:34:00+02:00','202407011134'],
    ['2024-12-31T23:30:00Z','202501010030'], ['0099-01-01','009901010000'],
  ]) it(`renders ${value} without host-timezone or DST dependence`, () => expect(prodatDate203(value)).toBe(expected))
  for (const value of ['2023-02-29','2024-04-31','20241301','202401012400','x2024-01-01','2024-01-01junk','0000-01-01','2024-01-01T12:00+24:00']) {
    it(`rejects bad provided renderer input ${value}`, () => expect(prodatDate203(value)).toBeNull())
  }
  it('converts creation instants to UTC+1 throughout the year', () => {
    expect(prodatNowDate203(new Date('2026-07-01T12:30:00Z'))).toBe('202607011330')
    expect(prodatNowDate203(new Date('2026-01-01T12:30:00Z'))).toBe('202601011330')
  })
  it('preserves a date-only birth date rather than fabricating it from timestamp/text', () => {
    expect(prodatDate102('2000-02-29')).toBe('20000229')
    expect(prodatDate102('garbage20000229')).toBeNull()
    expect(prodatDate102('2001-02-29')).toBeNull()
  })
})

describe('DTM: parser and actual legacy builder', () => {
  for (const alphabet of alphabets) {
    it(`keeps date meanings separate with ${alphabet.join('')}`, () => {
      const p = parseProdatMessage(raw([dtm('157','202403011245','203')],[],alphabet))
      expect(p.lineItems[0].contractStartDate).toBeNull()
      expect(p.lineItems[0].contractEndDate).toBeNull()
    })
    it(`retains minutes and explicit report/permission timestamps with ${alphabet.join('')}`, () => {
      const p = parseProdatMessage(raw([dtm('92','202403011245','203'),dtm('93','202404011246','203'),dtm('90','202402011247','203'),dtm('91','202403011248','203'),dtm('693','202401011249','203'),dtm('164','202405011250','203')],[],alphabet))
      expect(p.lineItems[0]).toMatchObject({contractStartDate:'202403011245',contractEndDate:'202404011246',reportStartDate:'202402011247',reportEndDate:'202403011248',permissionTimestamp:'202401011249',permissionEndTimestamp:'202405011250'})
    })
  }
  it('does not infer historical S18 from reporting-period dates alone', () => {
    expect(parseProdatMessage(raw([dtm('90','202403011200','203')])).lineItems[0].isHistoricalMeteringRequest).toBe(false)
  })
  it('does not project malformed source dates as usable business values', () => {
    expect(parseProdatMessage(raw([dtm('92','202402301200','203')])).lineItems[0].contractStartDate).toBeNull()
  })
  const input = {companyId:'tenant', role:'supplier',businessCode:'Z03',sender:{edielId:'S'},receiver:{edielId:'R'},meteringPoint:{id:'POINT'},environment:'test',references:{LI:'CASE'},codedAttributes:{Z13:'Z22'},dates:{startDate:'2026-10-01T12:30',createdAt:'2026-07-01T12:30:00Z'}}
  it('renders header UTC+1 and contract203 after LIN in the real builder', () => {
    const built = buildProdatMessage(input)
    const wire = tokenizeEdifact(built.rawEdifact).segments
    expect(built.rawEdifact).toContain('DTM+137:202607011330:203')
    expect(built.rawEdifact).toContain('DTM+ZZZ:1:805')
    expect(built.rawEdifact).toContain('DTM+92:202610011230:203')
    expect(wire.findIndex(r => r.raw.startsWith('DTM+92'))).toBeGreaterThan(wire.findIndex(r => r.tag==='LIN'))
  })
  it('never replaces an explicitly invalid creation date with now', () => {
    expect(() => buildProdatMessage({...input, dates:{...input.dates,createdAt:'2026-02-30'}})).toThrow()
  })
})


it('creation137 cannot substitute for required contract start92 in the compatibility builder', () => {
  expect(() => buildProdatMessage({companyId:'synthetic',role:'supplier',businessCode:'Z03',sender:{edielId:'S'},receiver:{edielId:'R'},meteringPoint:{id:'POINT'},references:{LI:'CASE'},codedAttributes:{Z13:'Z22'},dates:{createdAt:'2026-09-17T12:30Z'},environment:'test'})).toThrow()
})
