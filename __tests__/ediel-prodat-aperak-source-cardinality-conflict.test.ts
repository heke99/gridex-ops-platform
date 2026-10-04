import { describe, expect, it } from 'vitest'
import { diagnoseProdatAperakOwnReferenceConflict, prodatAperakDualReferenceConflict } from '@/lib/ediel/core/unsmSourceConflicts'
import { validateUnsmGrammar } from '@/lib/ediel/core/unsmGrammar'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'

const wire = (body: string[], profile: string, sender = '11111', receiver = '22222') =>
  `UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+261001:1200+I++23-DDQ-PRODAT++++1'` +
  [`UNH+M+${profile}`, ...body, `UNT+${body.length + 2}+M`, 'UNZ+1+I'].join("'") + "'"
const sourceBody = ['BGM+Z04+ORIGINAL+9', 'DTM+137:202610011200:203', 'LIN+1++735999888777777778:::9', 'RFF+LI:OWN-LI']
const ackBody = ['BGM+++34', 'RFF+ACW:ORIGINAL', 'NAD+FR+22222:160:SVK', 'NAD+DO+11111:160:SVK',
  'ERC+100::260', 'FTX+AAO+++OK', 'RFF+Z07:735999888777777778', 'RFF+LI:OWN-LI']
const source = wire(sourceBody, 'PRODAT:D:97A:UN:E2SE6A')
const ack = (body = ackBody) => wire(body, 'APERAK:D:96A:UN:E2SE6A', '22222', '11111')

describe('P16B and original96A exact own-reference source conflict', () => {
  it.each(['100','40','41','42'])('accepts the national dual own reference for own ERC%s (owner decision, P26A/16B p105)', code => {
    const body=ackBody.map(segment=>segment==='ERC+100::260'?`ERC+${code}::260`:segment)
    const rawAck=ack(body)
    expect(diagnoseProdatAperakOwnReferenceConflict(rawAck,source)).toHaveLength(1)
    expect(validateUnsmGrammar(rawAck).syntaxOk).toBe(true)
    expect(preflightEdielPayload({rawPayload:rawAck,messageStandard:'edifact',mode:'send'}).issues.filter(issue=>issue.code==='UNSM_MESSAGE_STRUCTURE_INVALID')).toEqual([])
    expect(prodatAperakDualReferenceConflict.national.ercApplicability.positiveCode).toBe('100')
    expect(prodatAperakDualReferenceConflict.national.ercApplicability.sourceFinding).toContain('p105 har ingen negativ-ERC-avgränsning')
  })

  it('reports both conditional national references and exact nested original directory cardinality separately', () => {
    expect(prodatAperakDualReferenceConflict.directory.locator).toContain('SG4 C1 / RFF M1')
    expect(prodatAperakDualReferenceConflict.national.z07Condition).toContain('anläggnings-id finns')
    expect(prodatAperakDualReferenceConflict.national.liCondition).toContain('ärendereferens finns')
    expect(diagnoseProdatAperakOwnReferenceConflict(ack(), source)).toEqual([{
      conflictId: 'P16B_APERAK96A_OWN_Z07_LI_CARDINALITY', ackErcSegmentIndex: 6, sourceLinSegmentIndex: 4,
      objectId: '735999888777777778', lineReference: 'OWN-LI', blocking: false,
    }])
  })

  it('widens only the exact E2SE6A Z07-then-LI pair; every other SG4 shape keeps D.96A C1', () => {
    expect(validateUnsmGrammar(ack()).syntaxOk).toBe(true)
    const reversed = ack(ackBody.slice(0, -2).concat('RFF+LI:OWN-LI', 'RFF+Z07:735999888777777778'))
    expect(validateUnsmGrammar(reversed).issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
    expect(validateUnsmGrammar(ack(ackBody.concat('RFF+LI:THIRD'))).syntaxOk).toBe(false)
    const otherSubset = ack().replace('APERAK:D:96A:UN:E2SE6A', 'APERAK:D:96A:UN')
    expect(validateUnsmGrammar(otherSubset).issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
    expect(prodatAperakDualReferenceConflict.resolution).toBe('RESOLVED_NATIONAL_GUIDE_OWNER_DECISION_20261002')
  })

  it('does not invent an all-APERAK block for the directory-valid single own reference', () => {
    const single = ack(ackBody.slice(0, -1))
    expect(validateUnsmGrammar(single).syntaxOk).toBe(true)
    expect(diagnoseProdatAperakOwnReferenceConflict(single, source)).toEqual([])
  })

  it.each([
    ['neighbouring04A', ack().replace('APERAK:D:96A:UN:E2SE6A', 'APERAK:D:04A:UN:E5SE5A'), source],
    ['different own LI', ack().replace('RFF+LI:OWN-LI', 'RFF+LI:OTHER'), source],
    ['different original document', ack().replace('RFF+ACW:ORIGINAL', 'RFF+ACW:OTHER'), source],
    ['absent original conditional LI', ack(), wire(sourceBody.slice(0, -1), 'PRODAT:D:97A:UN:E2SE6A')],
  ])('does not promote %s into the exact source-conflict scope', (_name, rawAck, rawSource) => {
    expect(diagnoseProdatAperakOwnReferenceConflict(rawAck, rawSource)).toEqual([])
  })
})
