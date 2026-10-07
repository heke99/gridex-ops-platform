// Component TDD only: real wire/parser/grammar/matcher; declared public DB I/O.
// No admission, assessment, custody, actor permission or business-effect proof.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEdifactPayload, type ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { validateEdifactEnvelope, validateUnsmGrammar } from '@/lib/ediel/core/edifactValidation'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { alphabets, characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { head } from './fixtures/prodat-identity'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'

type ModelRow = Record<string, unknown> & { id: string; company_id: string }
type Query = { table: string; equals: Array<[string, unknown]>; or: string | null; limit: number | null; excluded: string[]; included: [string, unknown[]] | null }
const port = vi.hoisted(() => ({
  rows: [] as ModelRow[], messages: [] as ModelRow[], requests: [] as ModelRow[],
  queries: [] as Query[], writes: [] as { table: string; value: Record<string, unknown> }[],
  error: null as Error | null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    return {
      insert(value: Record<string, unknown>) {
        port.writes.push({ table, value })
        return Promise.resolve({ error: null })
      },
      select() {
        const query: Query = { table, equals: [], or: null, limit: null, excluded: [], included: null }
        port.queries.push(query)
        const chain = {
          eq(key: string, value: unknown) { query.equals.push([key, value]); return chain },
          or(value: string) { query.or = value; return chain },
          not(key: string, operator: string, value: string) {
            if (key !== 'message_family' || operator !== 'in') throw Error('unsupported_declared_query')
            query.excluded = value.slice(1, -1).split(','); return chain
          },
          in(key: string, value: unknown[]) { query.included = [key, value]; return chain },
          limit(value: number) { query.limit = value; return chain },
          then(resolve: (value: { data: ModelRow[] | null; error: Error | null }) => unknown) {
            if (port.error) return Promise.resolve(resolve({ data: null, error: port.error }))
            const source = table === 'metering_points' ? port.rows : table === 'ediel_messages' ? port.messages
              : table === 'outbound_requests' ? port.requests : null
            if (!source) throw Error('unexpected_public_table')
            // Declared PostgREST equality/union port only; no private SQL rules.
            const rows = source.filter(row => query.equals.every(([key, value]) => row[key] === value)
              && (!query.included || query.included[1].includes(row[query.included[0]]))
              && !query.excluded.includes(String(row.message_family))
              && (query.or === null || query.or.split(',').some(term => {
                const separator = term.indexOf('.eq.')
                return separator > 0 && row[term.slice(0, separator)] === term.slice(separator + 4)
              })))
            return Promise.resolve(resolve({ data: query.limit === null ? rows : rows.slice(0, query.limit), error: null }))
          },
        }
        return chain
      },
    }
  },
} }))
import { matchMeteringPointForInbound, matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'

const company = 'declared-own-company', foreignCompany = 'declared-other-company'
const point = '735999000000000001', otherPoint = '735999000000000002'
const originalLi = 'DECLARED-ORIGINAL-Z01'
const own = (value = point, column = 'metering_point_id', id = 'own-point'): ModelRow => ({ id, company_id: company, [column]: value })
const bait = (): ModelRow => own(originalLi, 'ediel_reference', 'unrelated-li-alias')
function object(reason = 'Z22', identity = point, agency = '9', sequence = '1'): Parts[] {
  return [line(sequence, identity, undefined, agency), ...characteristic('Z13', reason), ['RFF', ['LI', originalLi]]]
}
function wire(reason = 'Z22', identity = point, agency = '9', alphabet: readonly string[] = alphabets[0]) {
  return guideOrderedFixtureRaw([...head(), ...object(reason, identity, agency)], 'Z02', alphabet)
}
function changedBusiness(change: (segments: string[]) => string[], source = wire()) {
  const business = tokenizeEdifact(source).segments.filter(token => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(token.tag)).map(token => token.raw)
  return EdifactEnvelopeCodec.encode({ sender: 'S', receiver: 'R', interchangeReference: 'I',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-06T12:00:00Z'), messages: [{ messageReference: 'M',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: change(business) }] })
}
function twoMessages() {
  const businessSegments = tokenizeEdifact(wire()).segments.filter(token => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(token.tag)).map(token => token.raw)
  return EdifactEnvelopeCodec.encode({ sender: 'S', receiver: 'R', interchangeReference: 'I',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-06T12:00:00Z'), messages: ['M', 'SECOND'].map(messageReference => ({
      messageReference, messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments })) })
}
function assertPhysical(source: string, identity = point, agency = '9') {
  expect(validateEdifactEnvelope(source).ok).toBe(true)
  expect(validateUnsmGrammar(source)).toMatchObject({ qualification: 'qualified', syntaxOk: true })
  const tokens = tokenizeEdifact(source), grouping = prodatRegisterGroups(tokens.segments, tokens.una, 'Z02')
  expect(grouping.problems).toEqual([])
  expect(grouping.groups).toHaveLength(1)
  expect(grouping.groups[0]).toMatchObject({ itemId: identity, identityAgency: agency, lineNumber: '1' })
  expect(prodatRegisterFieldState('209', grouping.groups[0].segments, tokens.una)).toMatchObject({ present: true, malformed: false, value: identity })
  expect(prodatRegisterFieldState('314', grouping.groups[0].segments, tokens.una)).toMatchObject({ present: true, malformed: false, value: '1' })
}
async function match(source: string, change?: (parsed: ParsedEdifactEnvelope) => void) {
  const parsed = parseEdifactPayload(source)
  change?.(parsed)
  const result = await matchMeteringPointForInbound({ companyId: company, parsed,
    inboundEmailMessageId: 'declared-mail', parseResultId: 'declared-parse' })
  expect(port.writes).toEqual([{ table: 'inbound_ediel_match_attempts', value: expect.objectContaining({
    company_id: company, inbound_email_message_id: 'declared-mail', parse_result_id: 'declared-parse',
    match_type: 'metering_point', match_status: result.status, matched_entity_id: result.entityId,
  }) }])
  for (const query of port.queries) expect(query.equals).toContainEqual(['company_id', company])
  return result
}
beforeEach(() => {
  port.rows = []; port.messages = []; port.requests = []; port.queries = []; port.writes = []; port.error = null
})

describe('physical own Z02L/LK metering-point candidates without authority claims', () => {
  it.each([['L', 'Z22', '9'], ['LK', 'Z23', '9'], ['L', 'Z22', '89'], ['LK', 'Z23', '89']])(
    'matches physical %s/%s agency%s instead of its different original LI', async (_variant, reason, agency) => {
      const source = wire(reason, point, agency); assertPhysical(source, point, agency)
      expect(parseEdifactPayload(source).references.LI).toEqual([originalLi])
      port.rows = [own()]
      expect(await match(source)).toMatchObject({ status: 'matched', entityType: 'metering_point', entityId: 'own-point' })
    })
  it.each(['Z22', 'Z23'])('never selects an unrelated own LI alias for physical %s', async reason => {
    port.rows = [bait(), own()]
    expect(await match(wire(reason))).toMatchObject({ status: 'matched', entityId: 'own-point' })
    expect(port.queries.every(query => query.or === null)).toBe(true)
  })
  it.each(['meter_point_id', 'metering_point_id', 'site_facility_id', 'ediel_reference'])('uses literal physical identity in existing %s column', async column => {
    port.rows = [own(point, column)]
    expect(await match(wire())).toMatchObject({ status: 'matched', entityId: 'own-point' })
    expect(port.queries.some(query => query.equals.some(([key, value]) => key === column && value === point))).toBe(true)
  })
  it('keeps another company same-point row out of a unique own match', async () => {
    port.rows = [own(), { ...own(), id: 'foreign-point', company_id: foreignCompany }]
    expect(await match(wire())).toMatchObject({ status: 'matched', entityId: 'own-point', candidates: [own()] })
  })
  it('does not match a foreign-only physical row', async () => {
    port.rows = [{ ...own(), company_id: foreignCompany }]
    expect(await match(wire())).toMatchObject({ status: 'missing', entityId: null, candidates: [] })
  })
  it('deduplicates the same real row ID returned through four literal identity columns', async () => {
    port.rows = [{ ...own(), meter_point_id: point, site_facility_id: point, ediel_reference: point }]
    expect(await match(wire())).toMatchObject({ status: 'matched', entityId: 'own-point', candidates: port.rows })
  })
  it('holds two distinct own row IDs rather than choosing first or latest', async () => {
    port.rows = [own(), own(point, 'metering_point_id', 'second-own-point')]
    expect(await match(wire())).toMatchObject({ status: 'ambiguous', entityType: null, entityId: null })
  })
  it('reads actual raw LIN when mutable parsed lineGroups are forged', async () => {
    port.rows = [own(), own(otherPoint, 'metering_point_id', 'forged-point')]
    expect(await match(wire(), parsed => { parsed.lineGroups[0].itemId = otherPoint })).toMatchObject({ status: 'matched', entityId: 'own-point' })
  })
  it('does not pool forged parsed LOC/LI with the qualified physical point', async () => {
    port.rows = [own(), bait()]
    expect(await match(wire(), parsed => { parsed.locations['172'] = [originalLi]; parsed.references.LI = [originalLi] }))
      .toMatchObject({ status: 'matched', entityId: 'own-point' })
  })
  it('qualifies physical family/code rather than mutable parsed flags', async () => {
    port.rows = [own()]
    expect(await match(wire(), parsed => { parsed.messageFamily = 'OTHER'; parsed.messageCode = 'FAKE' }))
      .toMatchObject({ status: 'matched', entityId: 'own-point' })
  })
  it('cannot create a physical point from forged data when actual LIN has another identity', async () => {
    port.rows = [own()]
    expect(await match(wire('Z22', otherPoint), parsed => { parsed.lineGroups[0].itemId = point }))
      .toMatchObject({ status: 'missing', entityId: null })
  })
  it.each(alphabets.slice(1))('decodes alternate UNA %j with actual release escaping', async (...alphabet) => {
    const identity = 'MP*;!~|^%'; const source = wire('Z22', identity, '9', alphabet); assertPhysical(source, identity)
    port.rows = [own(identity)]
    expect(await match(source)).toMatchObject({ status: 'matched', entityId: 'own-point' })
  })
  it('keeps lawful decoded filter punctuation in literal eq, never an OR expression', async () => {
    const identity = 'MP,alt.eq.FOREIGN'; const source = wire('Z22', identity); assertPhysical(source, identity)
    port.rows = [own(identity)]
    expect(await match(source)).toMatchObject({ status: 'matched', entityId: 'own-point' })
    expect(port.queries.every(query => query.or === null)).toBe(true)
    expect(port.queries.some(query => query.equals.some(([, value]) => value === identity))).toBe(true)
  })
  it('propagates a real public-query error without candidate or audit success', async () => {
    const error = Error('declared_public_read_failed'); port.error = error
    await expect(match(wire())).rejects.toBe(error)
    expect(port.writes).toEqual([])
  })
})

describe('malformed selected physical Z02 cannot fall back to the original LI row', () => {
  const cases: Array<[string, () => string]> = [
    ['missing field209', () => wire('Z22', '')],
    ['invalid agency', () => wire('Z22', point, '260')],
    ['extra C212 qualifier', () => changedBusiness(parts => parts.map(p => p.startsWith('LIN+') ? `LIN+1++${point}:BAD::9` : p))],
    ['overlong physical identity', () => wire('Z22', 'X'.repeat(26))],
    ['empty line sequence', () => guideOrderedFixtureRaw([...head(), ...object('Z22', point, '9', '')], 'Z02')],
    ['zero line sequence', () => guideOrderedFixtureRaw([...head(), ...object('Z22', point, '9', '0')], 'Z02')],
    ['nonincrementing line sequence', () => guideOrderedFixtureRaw([...head(), ...object('Z22', point, '9', '2')], 'Z02')],
    ['single C829 repeated-register marker', () => guideOrderedFixtureRaw([...head(), line('1', point, '1', '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', originalLi]]], 'Z02')],
    ['duplicate same-point LIN', () => guideOrderedFixtureRaw([...head(), ...object(), ...object('Z22', point, '9', '2')], 'Z02')],
    ['two different physical objects', () => guideOrderedFixtureRaw([...head(), ...object(), ...object('Z22', otherPoint, '9', '2')], 'Z02')],
    ['second object borrows first reason', () => guideOrderedFixtureRaw([...head(), ...object(), line('2', otherPoint, undefined, '9'), ['RFF', ['LI', originalLi]]], 'Z02')],
    ['mixed own L/LK reasons', () => guideOrderedFixtureRaw([...head(), ...object(), ...object('Z23', otherPoint, '9', '2')], 'Z02')],
    ['second UNH', twoMessages],
    ['duplicate own reason', () => guideOrderedFixtureRaw([...head(), ...object(), ...characteristic('Z13', 'Z22')], 'Z02')],
    ['reason after own reference', () => raw([...head(), line('1', point, undefined, '9'), ['RFF', ['LI', originalLi]], ...characteristic('Z13', 'Z22')], 'Z02')],
    ['wrong service UNT count', () => wire().replace(/UNT\+\d+\+M/, 'UNT+1+M')],
    ['wrong service UNT reference', () => wire().replace(/UNT\+(\d+)\+M/, 'UNT+$1+OTHER')],
    ['wrong service UNZ reference', () => wire().replace('UNZ+1+I', 'UNZ+1+OTHER')],
    ['missing service UNZ', () => wire().replace("UNZ+1+I'", '')],
  ]
  it.each(cases)('holds %s with no first-object or LI fallback', async (_name, build) => {
    port.rows = [bait(), own(), own(otherPoint, 'metering_point_id', 'other-point')]
    expect(await match(build())).toMatchObject({ status: 'missing', entityType: null, entityId: null, candidates: [] })
  })
})

describe('outside qualified physical own-adjacent L/LK branch retains legacy candidates', () => {
  // Selection is raw own CCI/Z13 + adjacent CAV Z22/Z23 under LIN, in the
  // exact guide/application. Absent selection never grants new LIN credit and
  // never invents a global ban on the existing LOC/RFF candidate path.
  const outsideCases: Array<[string, () => string]> = [
    ['unavailable full directory', () => wire().replace('PRODAT:D:97A:UN:E2SE6A', 'PRODAT:D:97B:UN:E2SE6A')],
    ['wrong association', () => wire().replace('PRODAT:D:97A:UN:E2SE6A', 'PRODAT:D:97A:UN:OTHER')],
    ['wrong physical application', () => wire().replace('23-DDQ-PRODAT', '23-WRONG-PRODAT')],
    ['absent LIN', () => guideOrderedFixtureRaw([...head(), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', originalLi]]], 'Z02')],
    ['missing own reason', () => guideOrderedFixtureRaw([...head(), line('1', point, undefined, '9'), ['RFF', ['LI', originalLi]]], 'Z02')],
    ['empty own reason', () => wire('')],
    ['reason only before LIN', () => guideOrderedFixtureRaw([...head(), ...characteristic('Z13', 'Z22'), line('1', point, undefined, '9'), ['RFF', ['LI', originalLi]]], 'Z02')],
    ['reason CAV separated from CCI', () => raw([...head(), line('1', point, undefined, '9'), ['CCI', '', 'Z13'], ['RFF', ['LI', originalLi]], ['CAV', ['Z22']]], 'Z02')],
  ]
  const noPhysicalQuery = () => {
    for (const query of port.queries) {
      expect(query.equals.every(([, value]) => value !== point)).toBe(true)
      expect(query.or?.includes(`.eq.${point}`) ?? false).toBe(false)
    }
  }
  it.each(outsideCases)('preserves exact legacy LI candidate for %s', async (_name, build) => {
    port.rows = [bait(), own()]
    expect(await match(build())).toMatchObject({ status: 'matched', entityType: 'metering_point', entityId: 'unrelated-li-alias', candidates: [bait()] })
    noPhysicalQuery()
  })
  it.each(outsideCases)('does not grant new physical LIN credit for %s without a legacy alias', async (_name, build) => {
    port.rows = [own(), { ...own(), id: 'foreign-point', company_id: foreignCompany }]
    expect(await match(build())).toMatchObject({ status: 'missing', entityType: null, entityId: null, candidates: [] })
    noPhysicalQuery()
  })
})

describe('unchanged legacy candidate and P-APERAK ACW boundaries', () => {
  it.each([
    ['non-Z02 LOC172', guideOrderedFixtureRaw([...head(), ['LOC', '172', ['LEGACY']], ...object('Z26')], 'Z05')],
    ['non-Z02 RFF MG', guideOrderedFixtureRaw([...head(), ...object('Z26'), ['RFF', ['MG', 'LEGACY']]], 'Z05')],
    ['non-L/LK Z02 RFF LI', guideOrderedFixtureRaw([...head(), ...object('Z25')], 'Z02')],
  ])('retains %s matching without globally treating LIN as point data', async (name, source) => {
    port.rows = [own(name.includes('LI') ? originalLi : 'LEGACY', 'ediel_reference', 'legacy-point'), own()]
    expect(await match(source)).toMatchObject({ status: 'matched', entityId: 'legacy-point' })
  })
  it('does not expand a foreign physical reason through forged parsed own-reason data', async () => {
    port.rows = [own()]
    expect(await match(wire('Z25'), parsed => { parsed.lineGroups[0].cciCavCodes.Z13 = ['Z22'] }))
      .toMatchObject({ status: 'missing', entityId: null })
  })
  it('preserves literal P-APERAK ACW original selection and diagnostic only', async () => {
    port.messages = [
      { id: 'original-document', company_id: company, direction: 'outbound', message_family: 'PRODAT', external_reference: 'DOCUMENT', bgm_reference: 'DOCUMENT' },
      { id: 'wrong-own-unb', company_id: company, direction: 'outbound', message_family: 'PRODAT', external_reference: 'I', bgm_reference: 'I' },
      { id: 'foreign-document', company_id: foreignCompany, direction: 'outbound', message_family: 'PRODAT', external_reference: 'DOCUMENT', bgm_reference: 'DOCUMENT' },
    ]
    const parsed = parseEdifactPayload("UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+I++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'RFF+ACW:DOCUMENT'ERC+42::260'FTX+AAO++314::260+Synthetic'UNT+6+1'UNZ+1+I'")
    expect(await matchOutboundRequestForInbound({ companyId: company, parsed }))
      .toMatchObject({ status: 'matched', entityType: 'ediel_message', entityId: 'original-document' })
    expect(port.queries.every(query => query.table === 'ediel_messages' && query.or === null && query.equals.some(([key]) => key === 'company_id'))).toBe(true)
    expect(port.writes).toHaveLength(1)
    expect(port.writes[0].table).toBe('inbound_ediel_match_attempts')
  })
})
