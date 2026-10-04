import { describe, expect, it } from 'vitest'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import type { EdielMessageRow } from '@/lib/ediel/types'

// Full selected97A mandatory DTM and SG8/LIN are independently assembled so
// envelope corruption is the sole changed fact in each negative case below.
const message = "UNH+M1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC1+9'DTM+137:202609301400:203'LIN+1++735999999999999999:::9'UNT+5+M1'"
const unb = "UNB+UNOC:3+SENDER:ZZ+RECEIVER:ZZ+260930:1400+INT1++23-DDQ-PRODAT++1'"
const valid = `${unb}${message}UNZ+1+INT1'`
function runtime(raw: string) {
  return validateEdifactSyntax({ raw_payload: raw, message_family: 'PRODAT', message_code: 'Z03',
    message_standard: 'edifact', syntax_check_status: 'passed', status: 'received' } as EdielMessageRow)
}

describe('one envelope syntax authority across runtime and direct parsing', () => {
  it('accepts an independently assembled complete service envelope', () => {
    expect(validateEdifactEnvelope(valid).syntaxOk).toBe(true)
    expect(runtime(valid).ok).toBe(true)
  })

  it.each([
    ['UNZ reference', valid.replace('UNZ+1+INT1', 'UNZ+1+OTHER')],
    ['UNZ count', valid.replace('UNZ+1+INT1', 'UNZ+2+INT1')],
    ['UNZ invalid count', valid.replace('UNZ+1+INT1', 'UNZ+X+INT1')],
    ['UNZ empty count', valid.replace('UNZ+1+INT1', 'UNZ++INT1')],
    ['UNZ missing reference', valid.replace('UNZ+1+INT1', 'UNZ+1')],
    ['UNB missing reference', valid.replace('+INT1++23', '+++23')],
    ['UNT invalid count', valid.replace('UNT+5+M1', 'UNT+5e0+M1')],
    ['UNT empty count', valid.replace('UNT+5+M1', 'UNT++M1')],
    ['UNT missing reference', valid.replace('UNT+5+M1', 'UNT+5')],
    ['UNH missing reference', valid.replace('UNH+M1+', 'UNH++')],
    ['duplicate UNB', `${unb}${valid}`],
    ['duplicate UNZ', `${valid}UNZ+1+INT1'`],
    ['content after UNZ', `${valid}FTX+AAO+++EXTRA'`],
    ['content outside UNH/UNT', `${unb}FTX+AAO+++OUTSIDE'${message}UNZ+1+INT1'`],
    ['nested UNH', `${unb}UNH+M0+PRODAT:D:97A:UN:E2SE6A'${message}UNT+2+M0'UNZ+2+INT1'`],
  ])('rejects %s before guide/function consumers', (_, raw) => {
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(false)
    expect(runtime(raw).ok).toBe(false)
  })

  it('checks second message count rather than only the first UNH/UNT pair', () => {
    const raw = `${unb}${message}${message.replaceAll('M1', 'M2').replace('UNT+5+', 'UNT+99+')}UNZ+2+INT1'`
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(false)
    expect(runtime(raw).ok).toBe(false)
  })

  it('checks second message reference rather than only the first pair', () => {
    const raw = `${unb}${message}${message.replaceAll('M1', 'M2').replace('UNT+5+M2', 'UNT+5+OTHER')}UNZ+2+INT1'`
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(false)
    expect(runtime(raw).ok).toBe(false)
  })

  it('rejects duplicate message references within the same interchange', () => {
    const raw = `${unb}${message}${message}UNZ+2+INT1'`
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(false)
    expect(runtime(raw).ok).toBe(false)
  })

  it('accepts two distinct complete message envelopes without inferring national batch permission', () => {
    const raw = `${unb}${message}${message.replaceAll('M1', 'M2')}UNZ+2+INT1'`
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    expect(runtime(raw).ok).toBe(true)
  })

  it('keeps national PRODAT field203 absence out of service-envelope syntax', () => {
    const raw = valid.replace('BGM+Z03+DOC1+9', 'BGM+Z03++9')
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    expect(runtime(raw).ok).toBe(true)
  })

  it('returns a syntax rejection for a dangling release character', () => {
    expect(validateEdifactEnvelope(`${valid}BROKEN?`).syntaxOk).toBe(false)
    expect(runtime(`${valid}BROKEN?`).ok).toBe(false)
  })
})
