import {reportingZ14Selection} from './fixtures/prodat-reporting-permission'
import { describe, expect, it } from 'vitest'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// Independent P26.A r3 §2.2 pp16–22; §2.6 p57 EL limitation.
const fields = ['209','302','508','326','217','222','506','513','260','325','227','228'] as const
const reason = (value = 'S17') => characteristic('Z13', value)
const ud: Parts = ['NAD','UD',['ID','','89'],'','User','','','','','SE']
const positive = (id = 'A', sequence = '1', transaction = 'S17'): Parts[] => [
  line(sequence,id), ['DTM',['90','202610010000','203']], ['DTM',['354','15','806']], ['DTM',['693','202609191200','203']],
  ...reason(transaction), ...characteristic('Z04','Z04'), ...characteristic('Z12','D',3),
  ...characteristic('Z14','8716867000030',4), ...characteristic('Z22','E17'),
  ['RFF',['LI','CASE']],['RFF',['Z05','ABC']], ['RFF',['Z09','PERMISSION']], ud, ['NAD','IT',[id,'','89'],'','','Site'],
]
const target = (i: {scope?: string; description: string}) => i.scope === 'prodat_dependent' && i.description.includes('Z14:')
function check(body: Parts[], alphabet: readonly string[] = alphabets[0], mode = 'payload', root = 'N', reporting:ReturnType<typeof reportingZ14Selection>|null=reportingZ14Selection('S17','89')) {
  const wire = input(raw(body,'Z14',alphabet),'Z14')
  if (mode === 'payload') return validateProdatSubtypePayload(wire).filter(target)
  const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:root,direction:'outbound',referenceDate:'2026-09-19',mode:'catalog_evidence',
    prodatDependentFacts:{reportingPermission:reporting,canonicalSubtype:root,market:'electricity',byCell:Object.fromEntries(fields.map(f=>[`Z14:${f}`,false]))}})
  return validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una,scope:mode as 'all'|'dependent_only'})
    .filter(i=>target(i)|| /NAD\+(?:UD|IT)/.test(i.fieldPath ?? ''))
}

describe('Z14 source outcomes', () => {
  for (const field of fields) it(`${field}: V/VH required, N forbidden, foreign/unknown remains unknown`, () => {
    for (const byCell of [true,false]) {
      const evaluate = (subtype: unknown, market: 'electricity'|'gas'|null = 'electricity') => resolveProdatDependentCondition({messageCode:'Z14',fieldNumber:field,
        facts:{canonicalSubtype:subtype as string,market,byCell:{[`Z14:${field}`]:byCell}}})
      for (const subtype of ['V','VH']) expect(evaluate(subtype)).toMatchObject({requirement:'required',status:'required'})
      expect(evaluate('N')).toMatchObject({requirement:'forbidden',status:'not_required'})
      for (const subtype of [null,'','F','S17','Z96',{},false]) expect(evaluate(subtype)).toMatchObject({requirement:'undetermined',status:'undetermined'})
      if (field === '217') for (const market of ['gas',null] as const) expect(evaluate('V',market)).toMatchObject({requirement:'undetermined'})
    }
  })
})
for (const alphabet of alphabets) for (const mode of ['payload','all','dependent_only']) describe(`Z14 ${alphabet.join('')} ${mode}`, () => {
  it('accepts V/VH and empty N despite opposite stale root subtype', () => {
    expect(check(positive(),alphabet,mode)).toEqual([])
    expect(check(positive('A','1','S18'),alphabet,mode,'N',reportingZ14Selection('S18','89'))).toEqual([])
    expect(check([['LIN','1'],...reason('Z96')],alphabet,mode,'V',null)).toEqual([])
  })
  it('requires each positive field independently', () => {
    const missing: Parts[][] = [
      positive().map(p=>p[0]==='LIN'?['LIN','1']:p),
      ...['90','354','693'].map(q=>positive().filter(p=>!(p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]===q))),
      ...['Z04','Z12','Z14','Z22'].map(q=>{const b=positive();const n=b.findIndex(p=>p[0]==='CCI'&&p[2]===q);b.splice(n,2);return b}),
      ...['Z05','Z09'].map(q=>positive().filter(p=>!(p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]===q))),
      positive().map(p=>p===ud?['NAD','UD','','','User','','','','','SE']:p),
      positive().map(p=>p===ud?['NAD','UD',['ID','','89'],'','','','','','','SE']:p),
    ]
    for (const body of missing) expect(check(body,alphabet,mode).length).toBeGreaterThan(0)
  })
  it('forbids all positive fields on N including empty supplied fragments', () => {
    const fragments: Parts[][] = [[line('1','A')], [['DTM',['90','','203']]], [['DTM',['354','','806']]], [['DTM',['693','','203']]],
      ...['Z04','Z12','Z14','Z22'].map(q=>[['CCI','',q],['CAV','']] as Parts[]),
      [['RFF',['Z05','']]], [['RFF',['Z09','']]], [['NAD','UD']], [['NAD','IT']]]
    for (const f of fragments) expect(check([...(f[0][0]==='LIN'?f:[['LIN','1']] as Parts[]),...reason('Z96'),...(f[0][0]==='LIN'?[]:f)],alphabet,mode,'V').length).toBeGreaterThan(0)
  })
  it('never borrows reason or required fields from another object or message', () => {
    expect(check([['LIN','1'],...reason('S17'),...positive('B','2')],alphabet,mode).length).toBeGreaterThan(0)
    expect(check([...positive(),line('2','B')],alphabet,mode).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  })
  it('rejects malformed and misplaced supplied values beside a valid complete object', () => {
    for (const extra of [ [['RFF',['Z05','ABC']]], [['RFF',['Z09','P']]], characteristic('Z04','Z04'), [['NAD','UD']], [['NAD','IT']] ] as Parts[][]) {
      expect(check([...extra,...positive()],alphabet,mode).length).toBeGreaterThan(0)
      expect(check([...positive(),...extra],alphabet,mode).length).toBeGreaterThan(0)
    }
    for (const bad of [ ['RFF',['Z05','TOOLONG']], ['RFF',['Z09','P','UNUSED']], ['CCI','','Z12'], ['NAD','UD',['ID','','89'],'','User','','','','','SE','EXTRA'] ] as Parts[]) {
      expect(check([...positive(),bad],alphabet,mode).length).toBeGreaterThan(0)
    }
  })
  it('keeps malformed, duplicate, misplaced and alias reasons unknown', () => {
    const b = positive(); const n = b.findIndex(p=>p[0]==='CCI'&&p[2]==='Z13'); b.splice(n,2)
    for (const r of [reason('V'),reason('E34'),[...reason(),...reason()], [['CCI','',['Z13','EXTRA']],['CAV','S17']], [['CCI','','Z13'],['CAV',['S17','EXTRA']]]] as Parts[][]) {
      const c=b.slice();c.splice(n,0,...r); expect(check(c,alphabet,mode).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
    }
    expect(check([...b,...reason()],alphabet,mode).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  })
  it('parent activation suppresses N children but checks positive parent children', () => {
    expect(check([['LIN','1'],...reason('Z96')],alphabet,mode,'V',null)).toEqual([])
    expect(check(positive().map(p=>p===ud?['NAD','UD',['ID','','89'],'','User']:p),alphabet,mode).length).toBeGreaterThan(0)
    expect(check(positive().filter(p=>!(p[0]==='NAD'&&p[1]==='IT')),alphabet,mode).length).toBeGreaterThan(0)
  })
})
it('inbound parse keeps outbound knowledge gaps out of external protocol errors', () => {
  const result=validateRulebookMessage({rawPayload:raw([['LIN','1']],'Z14'),family:'PRODAT',code:'Z14',direction:'inbound',mode:'parse',environment:'test'})
  expect(result.issues.filter(target)).toEqual([])
})

it('rejects extra header DTM while retaining valid object DTM', () => {
  expect(check([['DTM',['90','202610010000','203']],...positive()]).length).toBeGreaterThan(0)
})
it('uses actual EL wire market; stale metadata cannot supply GAS/unknown evidence', () => {
  for (const reference of ['23-DDQ-PRODAT','23-DGI-PRODAT','GAS','']) {
    const payload=raw(positive(),'Z14').replace('23-DDQ-PRODAT',reference)
    const issues=validateProdatSubtypePayload({...input(payload,'Z14'),applicationReference:'23-DDQ-PRODAT'})
    expect(issues.some(i=>i.description.includes('Z14:217')&&i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(!reference.startsWith('23-'))
  }
})
it('validates differing V, VH and N per object', () => {
  expect(check([...positive(),...positive('B','2','S18'),['LIN','3'],...reason('Z96')])).toEqual([])
})
it('next message cannot supply the first message reason or fields', () => {
  const first=raw([['LIN','1']],'Z14'), second=raw(positive(),'Z14')
  expect(validateProdatSubtypePayload(input(first+second.slice(9),'Z14')).filter(target).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
})
it('checks source code lists and raw coded tokens, not merely field presence', () => {
  for (const [q,position,value] of [['Z04',0,'BAD'],['Z12',3,'BAD'],['Z14',4,'OTHER'],['Z22',0,'BAD']] as const) {
    const body=positive();const n=body.findIndex(p=>p[0]==='CCI'&&p[2]===q);body.splice(n,2,...characteristic(q,value,position))
    expect(check(body).length).toBeGreaterThan(0)
  }
  for (const badReason of [' S17']) {
    const body=positive();const n=body.findIndex(p=>p[0]==='CCI'&&p[2]==='Z13');body.splice(n,2,...reason(badReason))
    expect(check(body).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  }
  expect(check(positive().map(p=>p===ud?['NAD','UD',['ID','','89'],'','User','','','','',' SE']:p)).length).toBeGreaterThan(0)
})
it('keeps SG8 dates before characteristic/reference/party groups', () => {
  const body=positive().filter(p=>!(p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='90'))
  expect(check([...body,['DTM',['90','202610010000','203']]]).length).toBeGreaterThan(0)
})
it('checks installation identity against its own object and never UD identity', () => {
  const body=positive().map(p=>p[0]==='NAD'&&p[1]==='IT'?['NAD','IT',['OTHER','','89'],'','','Site']:p) as Parts[]
  expect(check(body).some(i=>i.code==='PRODAT_DEPENDENT_INSTALLATION_ID_INVALID')).toBe(true)
})
