import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatFieldDiagnostic,prodatLocalDiagnostic,prodatErrorOccurrence,type ProdatDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import type { TgtDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority';
import { segmentComposite, segmentElementCount } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups';
import { copyProdatDateEventObjects, prodatDateEventRequirement, prodatEventMinute, type ProdatDateEventObject } from '@/lib/ediel/prodat/prodatDateEvents';
import { isProdatCalendarMinute } from '@/lib/ediel/prodat/render/dates';
import type { ProdatDependentConditionFacts, ProdatDependentConditionStatus } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielRulebookIssue } from './rulebook';
import { prodatEndUserWireSubtype } from './prodatEndUserPolicy';
export type ProdatDatePolicyInput = {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts | null;
    direction?: 'inbound' | 'outbound';
    requireAuthority?: boolean;
    dateEventContext?: TgtDateEventValidationContext;
};
export function validateProdatDateEvents(input: ProdatDatePolicyInput) { return evaluateProdatDateEvents(input).issues; }
export function evaluateProdatDateEvents(input: ProdatDatePolicyInput) {
    const issues: EdielRulebookIssue[] = [], statuses = new Map<string, ProdatDependentConditionStatus>();
    if (!['Z06', 'Z09', 'Z10'].includes(input.code))
        return { issues, statuses };
    const fields = input.code === 'Z09' ? ['210', '211'] : ['210'];
    for (const field of fields)
        statuses.set(field, 'not_required');
    let diagnosticScope: string[] = [];
    const fail = (code: string, detail: string, field = '210', diagnostic: ProdatDiagnostic = prodatLocalDiagnostic('internal','PRODAT26A:date-event',detail)) => { issues.push({ prodatDiagnostic:diagnostic, scope: 'prodat_dependent', severity: 'error', blocking: true, code: `PRODAT_DATE_EVENT_${code}`, title: 'PRODAT-datum saknar giltigt underlag', description: `${input.code}:${field}, P26.A s.17/50/109/112: ${detail}`, fieldPath: field === '211' ? 'DTM+93' : 'DTM+92' }); if (code !== 'ROUTE_MISMATCH')
        statuses.set(field, 'undetermined'); };
    const una = input.una ?? parseUna(null), tokens = prodatRegisterMessageSegments(input.rawSegments, una), grouped = prodatRegisterGroups(tokens, una, input.code), outbound = input.direction !== 'inbound';
    let facts: ProdatDateEventObject[] = [];
    try {
        if (outbound && input.facts?.dateEventObjects !== undefined)
            facts = copyProdatDateEventObjects(input.facts.dateEventObjects);
    }
    catch {
        fail('EVIDENCE_INVALID', 'ogiltiga händelsefakta');
    }
    for (const problem of grouped.problems)
        fail('SCOPE_INVALID', 'ogiltig registerstruktur',problem.fieldNumber,prodatFieldDiagnostic(problem.fieldNumber,prodatRegisterFieldState(problem.fieldNumber,grouped.groups[problem.lineIndex].segments,una)?.present?'invalid':'missing',input,[],'PRODAT26A:P47/114–116',problem.lineIndex));
    const first = grouped.groups.filter(g => g.registerPosition === 1), seen = new Set<string>();
    if (!first.length)
        fail('SCOPE_INVALID', 'första objekt saknas');
    for (const group of first) {
        diagnosticScope = group.segments.map(t=>t.raw);
        const key = JSON.stringify([group.itemId, group.identityAgency]);
        seen.add(key);
        let subtype = prodatEndUserWireSubtype(input.code, group.segments, una);
        if (group.segments.some((s, i) => s.tag === 'CCI' && segmentComposite(s, 2, una)[0] === 'Z13' && group.segments[i + 1]?.tag === 'CAV' && segmentComposite(group.segments[i + 1], 1, una)[0] !== segmentComposite(group.segments[i + 1], 1, una)[0]?.trim()))
            subtype = null;
        const ownD = input.code === 'Z09' && subtype === 'D';
        const selected = (q: string) => group.segments.filter(s => s.tag === 'DTM' && segmentComposite(s, 1, una)[0]?.trim() === q);
        const starts = selected('92'), ends = selected('93');
        if (ownD && starts.length + ends.length !== 1)
            fail('XOR', 'Z09D kräver exakt ett av start/slutdatum', '210', starts.length && ends.length ? {kind:'application',ercCode:'40',applicationCode:'109',sourceRule:'PRODAT26A:P17/93/121',occurrence:prodatErrorOccurrence(input,diagnosticScope,'object')!} : prodatLocalDiagnostic('internal','PRODAT26A:P17/112','Unrepresented missing either/or date'));
        if (outbound || ownD)
            for (const s of [...starts, ...(input.code === 'Z09' ? ends : [])]) {
                const v = segmentComposite(s, 1, una);
                if (v.length !== 3 || !['92', '93'].includes(v[0]) || v[2] !== '203' || !isProdatCalendarMinute(v[1]) || segmentElementCount(s, una) !== 1)
                    fail('FORMAT_INVALID', 'datum måste vara exakt format203', v[0]?.trim() === '93' ? '211' : '210', prodatFieldDiagnostic(v[0]?.trim() === '93' ? '211' : '210','invalid',input,diagnosticScope,'PRODAT26A:P50/119'));
            }
        if (!outbound) {
            continue;
        } // §2.2 p119: local event knowledge is not sender validity.
        if (!subtype && ['Z06', 'Z09'].includes(input.code)) {
            fail('EVIDENCE_INVALID', 'egen transaktionsorsak saknas/är tvetydig');
            continue;
        }
        if (input.requireAuthority && !(input.code === 'Z09' && !ownD) && (!input.dateEventContext || input.facts?.dateEventSource?.kind !== 'tgt'))
            fail('SOURCE_UNQUALIFIED', 'saknar auktoriserad källa för leveranshändelsen');
        const fact = facts.find(f => f.meteringPointId === group.itemId && f.identityAgency === group.identityAgency);
        if (input.facts?.market !== 'electricity' && !(input.code === 'Z09' && !ownD))
            fail('UNDETERMINED', 'EL-marknad måste vara explicit');
        for (const field of fields) {
            const segments = field === '210' ? starts : ends, requirement = prodatDateEventRequirement(input.code, subtype, field, fact);
            if (requirement === 'undetermined') {
                fail('UNDETERMINED', 'oberoende händelse/gräns saknas', field);
                continue;
            }
            if (requirement === 'required' && statuses.get(field) !== 'undetermined')
                statuses.set(field, 'required');
            if (requirement === 'required' && !segments.length)
                fail('REQUIRED', 'obligatoriskt datum saknas', field);
            if (requirement === 'forbidden' && segments.length)
                fail('FORBIDDEN', 'datum får inte skickas för egen händelse/process', field);
            if (segments.length > 1)
                fail('CARDINALITY_INVALID', 'flera egna datum', field);
            for (const s of segments) {
                const v = segmentComposite(s, 1, una);
                if (v.length !== 3 || v[0] !== (field === '210' ? '92' : '93') || v[2] !== '203' || !isProdatCalendarMinute(v[1]) || segmentElementCount(s, una) !== 1)
                    fail('FORMAT_INVALID', 'datum måste vara exakt format203', field);
                const expected = fact?.kind === 'production_contract' ? fact.supplyBoundaryAt : fact?.supplyStartsAt;
                if (expected && requirement !== 'forbidden' && v[1] !== prodatEventMinute(expected))
                    fail('VALUE_MISMATCH', 'datum avviker från leveransgränsen', field);
            }
        }
        if (fact?.kind === 'change_before_supply') {
            if (input.code === 'Z10' && fact.changeEffectiveAt && prodatEventMinute(fact.changeEffectiveAt)?.slice(-4) !== '0000')
                fail('BOUNDARY_INVALID', 'Z10 giltighetsgräns är 00:00 på ändringsdagen enligt s.110');
            for (const s of selected('157'))
                if (fact.changeEffectiveAt && segmentComposite(s, 1, una)[1] !== prodatEventMinute(fact.changeEffectiveAt))
                    fail('VALUE_MISMATCH', 'ändringsdatum avviker från källans gräns');
            if (prodatDateEventRequirement(input.code, subtype, '210', fact) === 'required') {
                const recipient = tokens.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, una)[0] === 'DO'), supplier = fact.supplier;
                // TGT mapping is checked independently by the trusted readiness boundary.
                const mapping = input.facts?.dateEventSource?.kind === 'tgt' ? input.facts.dateEventSource.route.suppliers.find(m => m.meteringPointId === group.itemId && m.identityAgency === group.identityAgency) : null;
                const expected = mapping?.recipient ?? supplier;
                if (!supplier || !expected || recipient.length !== 1 || JSON.stringify(segmentComposite(recipient[0], 2, una)) !== JSON.stringify([expected.id, expected.qualifier, expected.agency]))
                    fail('ROUTE_MISMATCH', 'oberoende leverantör saknar korrekt juridisk mottagare');
            }
        }
    }
    for (const fact of facts)
        if (!seen.has(JSON.stringify([fact.meteringPointId, fact.identityAgency])))
            fail('SOURCE_OBJECT_MISSING', 'valt källobjekt saknas');
    return { issues, statuses };
}
