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
  it.each(['100','40','41','42'])('keeps exact dual-own-reference hold for actual own ERC%s without treating positive100 as an exception', code => {
    const body=ackBody.map(segment=>segment==='ERC+100::260'?`ERC+${code}::260`:segment)
    const rawAck=ack(body)
    expect(diagnoseProdatAperakOwnReferenceConflict(rawAck,source)).toHaveLength(1)
    expect(validateUnsmGrammar(rawAck).syntaxOk).toBe(false)
    expect(preflightEdielPayload({rawPayload:rawAck,messageStandard:'edifact',mode:'send'}).blocking).toBe(true)
    expect(prodatAperakDualReferenceConflict.national.ercApplicability.positiveCode).toBe('100')
    expect(prodatAperakDualReferenceConflict.national.ercApplicability.sourceFinding).toContain('p105 har ingen negativ-ERC-avgränsning')
  })

  it('reports both conditional national references and exact nested original directory cardinality separately', () => {
    expect(prodatAperakDualReferenceConflict.directory.locator).toContain('SG4 C1 / RFF M1')
    expect(prodatAperakDualReferenceConflict.national.z07Condition).toContain('anläggnings-id finns')
    expect(prodatAperakDualReferenceConflict.national.liCondition).toContain('ärendereferens finns')
    expect(diagnoseProdatAperakOwnReferenceConflict(ack(), source)).toEqual([{
      conflictId: 'P16B_APERAK96A_OWN_Z07_LI_CARDINALITY', ackErcSegmentIndex: 6, sourceLinSegmentIndex: 4,
      objectId: '735999888777777778', lineReference: 'OWN-LI', blocking: true,
    }])
  })

  it('keeps the actual send consumer blocking without authorizing persistence or transport effects', () => {
    const original = { ack: ack(), source }
    expect(validateUnsmGrammar(source).syntaxOk).toBe(true)
    const syntax = validateUnsmGrammar(original.ack)
    expect(syntax.syntaxOk).toBe(false)
    expect(syntax.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
    const preflight = preflightEdielPayload({ rawPayload: original.ack, messageStandard: 'edifact', mode: 'send' })
    expect(preflight.blocking).toBe(true)
    expect(preflight.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
    diagnoseProdatAperakOwnReferenceConflict(original.ack, original.source)
    expect(original).toEqual({ ack: ack(), source })
    // This proves the pure actual preflight hold. Native no-write owner probes
    // remain a separate frozen-candidate requirement; no fake DB is involved.
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
