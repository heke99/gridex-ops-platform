// masterplan: AT-Z06F-SUPPLIER
// Component acceptance only. CONTRL/APERAK dispatch, SQL structural apply,
// tenant/actor/legal-role authority, UTILTS reading follow-up and the native
// first-effect original keep their owners in
// scripts/ediel-at-z06f-supplier-acceptance-native.test.ts and
// scripts/ediel-z06f-reading-followup-native.test.ts.
// Independent oracle: frozen AT-Z06F-SUPPLIER (BGM=Z06; field223=E64) and P26.A
// prodat_fields.json usage (214/217/218/259/508 mandatory in Z06F, transaction
// type E64; 306 mandatory in Z06F/G; NAD+UD parent inapplicable in Z06F/G).
// Expectations are not read back from runtime output.
import { describe, expect, it, vi } from 'vitest'
// Finite IO ports only; the canonical engine, structural wire reader and
// inbound business-data parser below are the real product functions.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: vi.fn(), createEdielMessageEvent: vi.fn(), linkEdielMessage: vi.fn() }))
import { structuralOwnerSource } from './helpers/structuralOwnerFixtures'
import { timelineFacts } from './helpers/sourceDecisionTimelineFixtures'
import { tokenizeEdifact, segmentComposite, segmentSourceSpan } from '@/lib/ediel/core/edifactTokenizer'
import { readStructuralSourceWire } from '@/lib/ediel/sources/structuralSourceWire'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import type { SourceObjectScope } from '@/lib/ediel/sources/sourceOwnerWire'
import type { EdielMessageRow } from '@/lib/ediel/types'

const F_REASON = 'E64'
const z06f = () => structuralOwnerSource('Z06', F_REASON)

function characteristicValue(raw: string, qualifier: string) {
  const wire = tokenizeEdifact(raw)
  const heads = wire.segments.filter(segment => segment.tag === 'CCI' && segmentComposite(segment, 2, wire.una)[0] === qualifier)
  return heads.map(head => {
    const tail = wire.segments.find(segment => segment.index === head.index + 1)
    expect(tail?.tag).toBe('CAV')
    return segmentComposite(tail!, 1, wire.una)[0]
  })
}
function scopeOf(message: EdielMessageRow) {
  return timelineFacts(message.raw_payload!).objects[0].object as SourceObjectScope
}
/** Remove whole segments by exact tag/qualifier and keep UNT consistent. */
function withoutSegments(message: EdielMessageRow, match: (tag: string, qualifier: string) => boolean): EdielMessageRow {
  const raw = message.raw_payload!, wire = tokenizeEdifact(raw)
  const removed: { start: number; end: number }[] = []
  wire.segments.forEach((segment, i) => {
    const qualifier = segment.tag === 'CCI' ? segmentComposite(segment, 2, wire.una)[0] : segmentComposite(segment, 1, wire.una)[0]
    if (!match(segment.tag, qualifier)) return
    const span = segmentSourceSpan(segment)!
    removed.push({ start: span.startOffset, end: span.endOffset })
    // A characteristic's value travels with its CCI head.
    const tail = wire.segments[i + 1]
    if (segment.tag === 'CCI' && tail?.tag === 'CAV') { const t = segmentSourceSpan(tail)!; removed.push({ start: t.startOffset, end: t.endOffset }) }
  })
  expect(removed.length).toBeGreaterThan(0)
  let changed = raw
  for (const span of [...removed].sort((a, b) => b.start - a.start)) changed = changed.slice(0, span.start) + changed.slice(span.end)
  return { ...message, raw_payload: changed.replace(/UNT\+(\d+)\+/, (_, count: string) => `UNT+${Number(count) - removed.length}+`) }
}
function withForbiddenUd(message: EdielMessageRow): EdielMessageRow {
  const raw = message.raw_payload!, wire = tokenizeEdifact(raw)
  const it = wire.segments.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === 'IT')
  expect(it).toHaveLength(1)
  const span = segmentSourceSpan(it[0])!
  const changed = raw.slice(0, span.startOffset) + "NAD+UD+FORBIDDEN-UD-F::89++Forbidden Identity+Forbidden Street+Town++12345+SE'" + raw.slice(span.startOffset)
  return { ...message, raw_payload: changed.replace(/UNT\+(\d+)\+/, (_, count: string) => `UNT+${Number(count) + 1}+`) }
}
function missing(message: EdielMessageRow) {
  return resolveCanonicalRuntimeDecision(message).issues
    .flatMap(issue => { const d = issue.prodatDiagnostic; return d?.kind === 'field' && d.errorKind === 'missing' ? [d.fieldNumber] : [] })
    .sort()
}

// Field → its prodat_fields.json locator (SG14 CCI qualifier or SG8 DTM 2005).
const F_MANDATORY = [
  { field: '217', tag: 'CCI', qualifier: 'Z04' },
  { field: '214', tag: 'CCI', qualifier: 'Z02' },
  { field: '218', tag: 'CCI', qualifier: 'Z05' },
  { field: '259', tag: 'CCI', qualifier: 'Z16' },
  { field: '508', tag: 'DTM', qualifier: '354' },
] as const

describe('AT-Z06F-SUPPLIER component effects', () => {
  it('inbound Z06F original carries 23-DDQ-PRODAT, BGM=Z06 and field223=E64 under CCI+Z13; the structural owner derives a reading change', () => {
    const f = z06f(), wire = tokenizeEdifact(f.raw_payload!)
    expect(f).toMatchObject({ direction: 'inbound', message_family: 'PRODAT', message_code: 'Z06', application_reference: '23-DDQ-PRODAT' })
    expect(wire.segments.filter(segment => segment.tag === 'BGM').map(segment => segmentComposite(segment, 1, wire.una)[0])).toEqual(['Z06'])
    expect(characteristicValue(f.raw_payload!, 'Z13')).toEqual(['E64'])
    expect(readStructuralSourceWire(f.raw_payload!, scopeOf(f))).toMatchObject({ messageCode: 'Z06', businessCase: 'change_with_reading' })
    const decision = resolveCanonicalRuntimeDecision(f)
    expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  })

  it('complete Z06F carries 214/217/218/259/508 and the canonical engine reports none of them missing', () => {
    const f = z06f()
    for (const { qualifier } of F_MANDATORY.filter(x => x.tag === 'CCI')) expect(characteristicValue(f.raw_payload!, qualifier), qualifier).toHaveLength(1)
    expect(missing(f).filter(field => F_MANDATORY.some(x => x.field === field))).toEqual([])
  })

  it.each(F_MANDATORY)('Z06F without field $field is rejected with exactly that missing field', ({ field, tag, qualifier }) => {
    const changed = withoutSegments(z06f(), (t, q) => t === tag && q === qualifier)
    const decision = resolveCanonicalRuntimeDecision(changed)
    expect(decision.applicationDecision, JSON.stringify(decision.issues)).toBe('rejected')
    expect(missing(changed)).toEqual([field])
  })

  it.each([
    { name: '306 installation status', tag: 'CCI', qualifier: 'Z07', field: '306' },
    { name: 'RFF+LI transaction reference', tag: 'RFF', qualifier: 'LI', field: '226' },
  ])('Z06F missing mandatory $name is rejected', ({ tag, qualifier, field }) => {
    const changed = withoutSegments(z06f(), (t, q) => t === tag && q === qualifier)
    expect(resolveCanonicalRuntimeDecision(changed).applicationDecision).toBe('rejected')
    expect(missing(changed)).toEqual([field])
  })

  it('a supplier-originated (outbound) Z06F is not accepted as the grid owner\'s update', () => {
    const decision = resolveCanonicalRuntimeDecision({ ...z06f(), direction: 'outbound' })
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.functionalDecision).not.toBe('accepted')
  })

  it('forbidden NAD+UD in Z06F is ignored evidence and never becomes staged customer identity', () => {
    const baseline = z06f(), extra = withForbiddenUd(baseline)
    expect(baseline.raw_payload).not.toContain('NAD+UD+')
    expect(extra.raw_payload).toContain('NAD+UD+FORBIDDEN-UD-F::89')
    const decision = resolveCanonicalRuntimeDecision(extra)
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
    expect(decision.prodatIgnoredFields).toContainEqual(expect.objectContaining({ fieldNumber: 'END_USER_GROUP', sourceRule: 'PRODAT26A:P119' }))
    const before = structuredClone(extra)
    const staged = parseInboundProdatBusinessData(extra)
    expect(staged.customer).toEqual(parseInboundProdatBusinessData(baseline).customer)
    expect(staged.customer).toMatchObject({ customerId: null, customerIdQualifier: null, fullName: null, companyName: null, firstName: null, lastName: null, address: null, postalCode: null, city: null, country: null, personalNumber: null, orgNumber: null })
    expect(JSON.stringify(staged.customer)).not.toContain('FORBIDDEN')
    expect(extra).toEqual(before)
  })
})
