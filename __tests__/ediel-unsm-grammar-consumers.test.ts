import { describe, expect, it } from 'vitest'
import { validateUnsmGrammar } from '@/lib/ediel/core/unsmGrammar'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

/** Independently assembled directory facits, not encoder/parser round trips.
 * These prove syntax consumers only, never source custody, actor, guide, grant,
 * native persistence, HTTP delivery or external national acceptance. */
const wire = (body: string[], profile = 'PRODAT:D:97A:UN:E2SE6A') =>
  "UNA:+.? 'UNB+UNOC:3+11111:ZZ+22222:ZZ+261001:1200+I++23-DDQ-PRODAT++++1'" +
  [`UNH+M+${profile}`, ...body, `UNT+${body.length + 2}+M`, 'UNZ+1+I'].join("'") + "'"
const prodat = ['BGM+Z03+DOC+9', 'DTM+137:202610011200:203', 'LIN+1++OBJ:::9']
const row = (raw: string) => ({ id: 'syntax-source', company_id: 'company', direction: 'inbound', environment: 'test',
  message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z03', raw_payload: raw, parsed_payload: {},
  status: 'received', syntax_check_status: 'not_checked', validation_report: {}, failure_reason: null }) as EdielMessageRow

describe('ENV-09 exact original full UNSM syntax at actual consumers', () => {
  it('retains archive and nested original-directory hashes for the actual physical version', () => {
    const proof = validateUnsmGrammar(wire(prodat))
    expect(proof.qualification).toBe('qualified')
    expect(proof.syntaxOk).toBe(true)
    expect(proof.sources[0].key).toBe('PRODAT:D:97A:UN')
    expect(proof.sources[0].archiveSha256).toBe('4a8fbe74935a140b0982f9b555571831e7b9d90311acdbf195ae481e2fe705a8')
    expect(proof.sources[0].members).toHaveLength(3)
    expect(proof.sources[0].members.every(member => /^[a-f0-9]{64}$/.test(member.sha256))).toBe(true)
  })

  it('rejects missing mandatory D97A header DTM while a correct envelope stays valid', () => {
    const raw = wire([prodat[0], prodat[2]])
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    const syntax = validateEdifactSyntax(row(raw))
    expect(syntax.ok).toBe(false)
    expect(syntax.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
    const decision = resolveCanonicalRuntimeDecision(row(raw))
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.policy).toBeNull()
    expect(decision.utiltsBusinessOutcome).toBeNull()
    expect(decision.responsePlan.every(item => item.family === 'CONTRL' && item.outcome === 'negative')).toBe(true)
    expect(decision.responsePlan).toHaveLength(1)
  })

  it('rejects a missing mandatory D97A SG8/LIN rather than treating a short national segment list as complete grammar', () => {
    const raw = wire(prodat.slice(0, 2))
    expect(validateEdifactSyntax(row(raw)).ok).toBe(false)
    expect(validateUnsmGrammar(raw).issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
  })

  it('holds eleven header DTMs in real send preflight although each value and the envelope are valid', () => {
    const raw = wire([prodat[0], ...Array.from({ length: 11 }, () => prodat[1]), prodat[2]])
    expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
    const preflight = preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' })
    expect(preflight.blocking).toBe(true)
    expect(preflight.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID')).toBe(true)
  })

  it('uses each optional group occurrence own mandatory trigger, ordering and repetition limit', () => {
    const valid = wire([prodat[0], prodat[1], 'RFF+ON:ONE', 'DTM+171:20261001:102',
      'RFF+ON:TWO', 'DTM+171:20261002:102', prodat[2]])
    expect(validateUnsmGrammar(valid).syntaxOk).toBe(true)
    const misplaced = wire([...prodat, 'COM+123:TE'])
    expect(validateUnsmGrammar(misplaced).syntaxOk).toBe(false)
    const overflow = wire([prodat[0], prodat[1], 'NAD+FR+11111:160:SVK', 'CTA+IC+CONTACT',
      ...Array.from({ length: 11 }, () => 'COM+123:TE'), prodat[2]])
    expect(validateUnsmGrammar(overflow).syntaxOk).toBe(false)
  })

  it('accepts legitimate trailing full-directory components omitted from a shorter national table', () => {
    const raw = wire([prodat[0], prodat[1], 'NAD+FR+11111:160:SVK++One:Two:Three:Four:Five', prodat[2]])
    expect(validateUnsmGrammar(raw).syntaxOk).toBe(true)
    expect(validateEdifactSyntax(row(raw)).ok).toBe(true)
  })

  it.each([
    ['mandatory component', 'DTM+:202610011200:203', 'UNSM_MANDATORY_ELEMENT_MISSING'],
    ['extra component', 'DTM+137:202610011200:203:EXTRA', 'UNSM_COMPONENT_CARDINALITY_INVALID'],
    ['extra element', 'DTM+137:202610011200:203+EXTRA', 'UNSM_ELEMENT_CARDINALITY_INVALID'],
    ['own element length', 'DTM+1234:202610011200:203', 'UNSM_ELEMENT_LENGTH_INVALID'],
  ])('rejects %s at the original physical segment and field', (_name, dtm, code) => {
    const proof = validateUnsmGrammar(wire([prodat[0], dtm, prodat[2]]))
    expect(proof.syntaxOk).toBe(false)
    expect(proof.issues.some(issue => issue.code === code && issue.segmentIndex === 3 && issue.field?.startsWith('DTM'))).toBe(true)
  })

  it('selects actual APERAK96A simple BGM/1004 versus actual04A composite C106 without caller metadata authority', () => {
    const body = ['BGM+312+DOC:1+9', 'ERC+100::260']
    expect(validateUnsmGrammar(wire(body, 'APERAK:D:96A:UN:E2SE6A')).issues.some(issue => issue.code === 'UNSM_SIMPLE_ELEMENT_COMPOSITE_INVALID')).toBe(true)
    const newer = validateUnsmGrammar(wire(body, 'APERAK:D:04A:UN:E5SE5A'))
    expect(newer.syntaxOk).toBe(true)
    expect(newer.sources[0].key).toBe('APERAK:D:04A:UN')
    expect(validateUnsmGrammar(wire(['BGM+312+DOC?:1+9', 'ERC+100::260'], 'APERAK:D:96A:UN:E2SE6A')).syntaxOk).toBe(true)
  })

  it('does not borrow APERAK04A DOC group to declare DOC valid in96A', () => {
    const body = ['BGM+312+DOC+9', 'DOC+380+DOCUMENT', 'ERC+100::260']
    expect(validateUnsmGrammar(wire(body, 'APERAK:D:04A:UN:E5SE5A')).syntaxOk).toBe(true)
    expect(validateUnsmGrammar(wire(body, 'APERAK:D:96A:UN:E2SE6A')).syntaxOk).toBe(false)
  })

  it('checks actual UTILTS02B mandatory DTM and nested SEQ/QTY grammar before application effects', () => {
    const body = ['BGM+E66+DOC+9', 'DTM+137:202610011200:203', 'IDE+24+TX', 'SEQ+Z01+1', 'QTY+136:1:KWH']
    expect(validateUnsmGrammar(wire(body, 'UTILTS:D:02B:UN:E5SE5A')).syntaxOk).toBe(true)
    const raw = wire([body[0], ...body.slice(2)], 'UTILTS:D:02B:UN:E5SE5A')
    const decision = resolveCanonicalRuntimeDecision({ ...row(raw), message_family: 'UTILTS', message_code: 'E66' })
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.policy).toBeNull()
    expect(decision.utiltsBusinessOutcome).toBeNull()
    expect(decision.utiltsTransactionValidation).toBeUndefined()
    expect(decision.responsePlan.every(item => item.family === 'CONTRL' && item.outcome === 'negative')).toBe(true)
  })

  it('checks version3 physical repeated COM elements against the selected02B maximum and each occurrence own mandatory components', () => {
    const body = ['BGM+E66+DOC+9', 'DTM+137:202610011200:203', 'NAD+MS+11111::9', 'CTA+IC+CONTACT',
      'COM+111:TE+222:FX+333:EM']
    expect(validateUnsmGrammar(wire(body, 'UTILTS:D:02B:UN:E5SE5A')).syntaxOk).toBe(true)
    const overflow = [...body.slice(0, -1), 'COM+111:TE+222:FX+333:EM+444:TE']
    expect(validateUnsmGrammar(wire(overflow, 'UTILTS:D:02B:UN:E5SE5A')).issues.some(issue => issue.code === 'UNSM_ELEMENT_CARDINALITY_INVALID')).toBe(true)
    const missingOwnQualifier = [...body.slice(0, -1), 'COM+111:TE+222']
    expect(validateUnsmGrammar(wire(missingOwnQualifier, 'UTILTS:D:02B:UN:E5SE5A')).issues.some(issue => issue.code === 'UNSM_MANDATORY_ELEMENT_MISSING' && issue.field?.includes('3155'))).toBe(true)
  })

  it('holds an unqualified physical release in inbound and send consumers without inventing negative CONTRL', () => {
    const raw = wire(prodat, 'PRODAT:D:99A:UN:E2SE6A')
    const decision = resolveCanonicalRuntimeDecision(row(raw))
    expect(decision.syntaxDecision).toBe('manual_review')
    expect(decision.policy).toBeNull()
    expect(decision.responsePlan).toEqual([])
    const preflight = preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' })
    expect(preflight.blocking).toBe(true)
    expect(preflight.issues.some(issue => issue.code === 'UNSM_DIRECTORY_SOURCE_UNAVAILABLE')).toBe(true)
  })

  it('refuses the direct UTILTS owner before minting an application or persistence result for unknown source', () => {
    const raw = wire(['BGM+E66+DOC+9', 'DTM+137:202610011200:203'], 'UTILTS:D:99A:UN:E5SE5A')
    expect(() => runUtiltsRuntimeForMessage({ ...row(raw), message_family: 'UTILTS', message_code: 'E66' }))
      .toThrow('ediel_unsm_directory_source_unavailable')
  })

  it('never reuses the first physical message grammar to approve a second unknown release', () => {
    const one = wire(prodat).replace("UNZ+1+I'", '')
    const two = ['UNH+SECOND+PRODAT:D:99A:UN:E2SE6A', ...prodat, 'UNT+5+SECOND', 'UNZ+2+I'].join("'") + "'"
    expect(validateEdifactEnvelope(one + two).syntaxOk).toBe(true)
    const proof = validateUnsmGrammar(one + two)
    expect(proof.qualification).toBe('unavailable')
    expect(proof.sources).toHaveLength(1)
    expect(proof.issues.some(issue => issue.code === 'UNSM_DIRECTORY_SOURCE_UNAVAILABLE' && issue.segmentIndex === 6)).toBe(true)
  })

  it('holds syntax4 repetition rather than validating it with syntax3 component semantics', () => {
    const raw = wire(prodat).replace('UNOC:3', 'UNOC:4')
    expect(validateUnsmGrammar(raw).qualification).toBe('unavailable')
    const decision = resolveCanonicalRuntimeDecision(row(raw))
    expect(decision.syntaxDecision).toBe('manual_review')
    expect(decision.responsePlan).toEqual([])
  })

  it('does not normalize a different physical directory selector into a source qualification', () => {
    const raw = wire(prodat, 'PRODAT:d:97A:un:E2SE6A')
    expect(validateUnsmGrammar(raw).qualification).toBe('unavailable')
    expect(resolveCanonicalRuntimeDecision(row(raw)).responsePlan).toEqual([])
  })

  it('retains unknown-directory holds even with a missing UNT or a second UNH before closing', () => {
    const incomplete = wire(prodat, 'PRODAT:D:99A:UN:E2SE6A').replace("UNT+5+M'", '')
    expect(validateEdifactEnvelope(incomplete).syntaxOk).toBe(false)
    const decision = resolveCanonicalRuntimeDecision(row(incomplete))
    expect(decision.syntaxDecision).toBe('manual_review')
    expect(decision.responsePlan).toEqual([])
    const nested = incomplete.replace('UNZ+1+I', 'UNH+SECOND+PRODAT:D:97A:UN:E2SE6A\'BGM+Z03+DOC+9\'UNT+3+SECOND\'UNZ+2+I')
    expect(validateUnsmGrammar(nested).qualification).toBe('unavailable')
    expect(resolveCanonicalRuntimeDecision(row(nested)).responsePlan).toEqual([])
  })

  it('uses original custom UNA components and released separators without altering source indexes', () => {
    const raw = 'UNA^;.! ~UNB;UNOC^3;11111^ZZ;22222^ZZ;261001^1200;I~UNH;M;PRODAT^D^97A^UN^E2SE6A~BGM;Z03;DOC!^1;9~DTM;137^202610011200^203~LIN;1;;OBJ^^^9~UNT;5;M~UNZ;1;I~'
    expect(validateUnsmGrammar(raw).syntaxOk).toBe(true)
    expect(validateEdifactSyntax(row(raw)).ok).toBe(true)
    expect(validateUnsmGrammar(raw.replace('DTM;137^', 'DTM;1234^')).issues[0].segmentIndex).toBe(3)
  })

  it('leaves unregistered generic messages and older CONTRL service syntax outside these four grammar claims', () => {
    expect(validateUnsmGrammar(wire(['BGM+220+ORDER+9'], 'ORDERS:D:96A:UN')).qualification).toBe('not_applicable')
    expect(validateUnsmGrammar(wire(['UCI+SOURCE+11111:ZZ+22222:ZZ+7'], 'CONTRL:2:2:UN:EDIEL2')).qualification).toBe('not_applicable')
  })
})
