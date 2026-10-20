// masterplan: AT-Z06G-SUPPLIER
// Component acceptance only. CONTRL/APERAK dispatch, SQL structural apply,
// tenant/actor authority and the native first-effect original keep their owners
// in scripts/ediel-at-z06g-supplier-acceptance-native.test.ts.
// Independent oracle: frozen AT-Z06G-SUPPLIER / CASE-Z06G-SUPPLIER (wire_reason
// E32) and P26.A field usage (217/214/218 mandatory only in Z06F; NAD+UD parent
// inapplicable in Z06F/G). Expectations are not read back from runtime output.
import { describe, expect, it, vi } from 'vitest'
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
function withForbiddenUd(message: EdielMessageRow): EdielMessageRow {
  const raw = message.raw_payload!, wire = tokenizeEdifact(raw)
  const it = wire.segments.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === 'IT')
  expect(it).toHaveLength(1)
  const span = segmentSourceSpan(it[0])!
  const changed = raw.slice(0, span.startOffset) + "NAD+UD+FORBIDDEN-UD-G::89++Forbidden Identity+Forbidden Street+Town++12345+SE'" + raw.slice(span.startOffset)
  // Keep UNT consistent: one segment was added inside the same message.
  return { ...message, raw_payload: changed.replace(/UNT\+(\d+)\+/, (_, count: string) => `UNT+${Number(count) + 1}+`) }
}

describe('AT-Z06G-SUPPLIER component effects', () => {
  it('inbound Z06G original carries BGM=Z06 and field223=E32 under CCI+Z13, and the structural owner derives a no-reading change', () => {
    const g = structuralOwnerSource('Z06', 'E32'), f = structuralOwnerSource('Z06', 'E64')
    const wire = tokenizeEdifact(g.raw_payload!)
    expect(wire.segments.filter(segment => segment.tag === 'BGM').map(segment => segmentComposite(segment, 1, wire.una)[0])).toEqual(['Z06'])
    expect(characteristicValue(g.raw_payload!, 'Z13')).toEqual(['E32'])
    expect(characteristicValue(f.raw_payload!, 'Z13')).toEqual(['E64'])
    expect(readStructuralSourceWire(g.raw_payload!, scopeOf(g))).toMatchObject({ messageCode: 'Z06', businessCase: 'change_without_reading' })
    // Discriminating contrast: the same shape with E64 is the F reading case.
    expect(readStructuralSourceWire(f.raw_payload!, scopeOf(f))).toMatchObject({ messageCode: 'Z06', businessCase: 'change_with_reading' })
  })

  it('canonical engine accepts Z06G without reading-only register fields that Z06F carries', () => {
    const g = structuralOwnerSource('Z06', 'E32'), f = structuralOwnerSource('Z06', 'E64')
    // 214 (CCI Z02) and 218 (CCI Z05) are mandatory only in Z06F when readings follow in UTILTS.
    expect(characteristicValue(g.raw_payload!, 'Z02')).toEqual([])
    expect(characteristicValue(g.raw_payload!, 'Z05')).toEqual([])
    expect(characteristicValue(f.raw_payload!, 'Z02')).toHaveLength(1)
    expect(characteristicValue(f.raw_payload!, 'Z05')).toHaveLength(1)
    const decision = resolveCanonicalRuntimeDecision(g)
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
    expect(decision.issues.filter(issue => issue.prodatDiagnostic?.kind === 'field' && ['214', '218', '217', '508'].includes(issue.prodatDiagnostic.fieldNumber) && issue.prodatDiagnostic.errorKind === 'missing')).toEqual([])
  })

  it('forbidden NAD+UD in Z06G is ignored evidence and never becomes staged customer identity', () => {
    const baseline = structuralOwnerSource('Z06', 'E32'), extra = withForbiddenUd(baseline)
    expect(baseline.raw_payload).not.toContain('NAD+UD+')
    expect(extra.raw_payload).toContain('NAD+UD+FORBIDDEN-UD-G::89')
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
