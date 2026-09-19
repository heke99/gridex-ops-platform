import {prodatFieldDiagnostic,prodatLocalDiagnostic,type ProdatDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { segmentComposite as composite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups';
import { copyReportingSelection, REPORTING_PURPOSES, reportingEvaluationMinute, type ExpectedContext, type ReportingObject } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { isProdatCalendarMinute } from '@/lib/ediel/prodat/render/dates';
import type { ProdatDependentConditionFacts, ProdatDependentConditionStatus } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielRulebookIssue } from './rulebook';
export type ReportingPolicyInput = {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts | null;
    direction?: 'inbound' | 'outbound';
    requireAuthority?: boolean;
    reportingContext?: ExpectedContext;
};
export const validateProdatReportingPermission = (input: ReportingPolicyInput) => evaluateProdatReportingPermission(input).issues;
export function evaluateProdatReportingPermission(input: ReportingPolicyInput) {
    const issues: EdielRulebookIssue[] = [], statuses = new Map<string, ProdatDependentConditionStatus>();
    if (!['Z13', 'Z14'].includes(input.code))
        return { issues, statuses };
    for (const f of ['321', '323'])
        statuses.set(f, 'not_required');
    const fail = (code: string, detail: string, field = '321', diagnostic:ProdatDiagnostic=prodatLocalDiagnostic('local_evidence','PRODAT26A:reporting-source',detail)) => { issues.push({ prodatDiagnostic:diagnostic, scope: 'prodat_dependent', severity: 'error', blocking: true, code: `PRODAT_REPORTING_${code}`, title: 'Rapporteringens underlag är inte giltigt', description: `${input.code}:${field}, P26.A s.17/21/43/49/74: ${detail}`, fieldPath: field === '321' ? 'DTM+91' : 'CCI++Z24/CAV' }); statuses.set(field, 'undetermined'); };
    const una = input.una ?? parseUna(null), tokens = prodatRegisterMessageSegments(input.rawSegments, una), { groups, problems } = prodatRegisterGroups(tokens, una, input.code), outbound = input.direction !== 'inbound';
    const c = (t: EdifactTokenizedSegment, p: number) => composite(t, p, una);
    const isDate = (t: EdifactTokenizedSegment) => t.tag === 'DTM' && c(t, 1)[0]?.trim() === '91';
    const isPurpose = (t: EdifactTokenizedSegment) => t.tag === 'CCI' && c(t, 2)[0]?.trim().toUpperCase() === 'Z24';
    const unused = (t: EdifactTokenizedSegment, from: number) => Array.from({ length: Math.max(0, segmentElementCount(t, una) - from) }, (_, i) => c(t, from + i + 1)).some(p => p.some(v => v !== ''));
    for (const token of tokens.filter(isDate)) {
        const parts = c(token, 1);
        if (parts.length !== 3 || parts[0] !== '91' || parts[2] !== '203' || !isProdatCalendarMinute(parts[1]) || segmentElementCount(token, una) !== 1)
            fail('FORMAT_INVALID', 'rapportens slut kräver exakt Gregorian minut/203', '321', prodatFieldDiagnostic('321','invalid',input,groups.find(g=>g.segments.includes(token))?.segments.map(t=>t.raw)??[],'PRODAT26A:P43/49/74/119'));
    }
    if (!outbound)
        return { issues, statuses }; // p119: local source knowledge is not sender validity.
    let selected: ReturnType<typeof copyReportingSelection> | null = null;
    try {
        if (input.facts?.reportingPermission != null)
            selected = copyReportingSelection(input.facts.reportingPermission);
    }
    catch {
        fail('EVIDENCE_INVALID', 'ogiltiga rapporteringsfakta');
    }
    if (problems.length || !groups.length)
        fail('SCOPE_INVALID', 'objekt/registerstruktur saknas eller är ogiltig');
    const owned = new Map<number, typeof groups[number]>();
    for (const group of groups)
        for (const token of group.segments)
            owned.set(token.index, group);
    for (const [i, token] of tokens.entries()) {
        if (isDate(token) || isPurpose(token)) {
            const group = owned.get(token.index), boundary = group?.segments.find(t => isDate(token) ? ['CCI', 'RFF', 'NAD'].includes(t.tag) : ['RFF', 'NAD'].includes(t.tag));
            if (!group || group.registerPosition !== 1 || boundary && token.index >= boundary.index)
                fail('SCOPE_INVALID', 'fältet ligger utanför sitt första SG8/SG14', isDate(token) ? '321' : '323');
        }
        if (isPurpose(token)) {
            const cav = tokens[i + 1], parts = c(token, 2), v = cav?.tag === 'CAV' ? c(cav, 1) : [];
            if (parts[0] !== 'Z24' || parts.slice(1).some(Boolean) || c(token, 1).some(Boolean) || unused(token, 2) || !cav || cav.tag !== 'CAV' || tokens[i + 2]?.tag === 'CAV' || !REPORTING_PURPOSES.includes(v[0] as typeof REPORTING_PURPOSES[number]) || v.slice(1).some(Boolean) || unused(cav, 1))
                fail('FORMAT_INVALID', 'exakt CCI Z24 / CAV B71–B76 utan andra komponenter krävs', '323');
        }
        if (token.tag === 'CAV' && REPORTING_PURPOSES.includes(c(token, 1)[0] as typeof REPORTING_PURPOSES[number]) && !(i > 0 && isPurpose(tokens[i - 1])))
            fail('SCOPE_INVALID', 'syfteskoden saknar eget intilliggande CCI Z24', '323');
    }
    const used = new Set<string>();
    for (const group of groups.filter(g => g.registerPosition === 1)) {
        const own = group.segments, dates = own.filter(isDate), purposes = own.filter(isPurpose);
        const reasons = own.filter(t => t.tag === 'CCI' && c(t, 2)[0]?.trim().toUpperCase() === 'Z13');
        const rt = reasons[0], ri = rt ? own.indexOf(rt) : -1, rv = ri >= 0 ? own[ri + 1] : null;
        const reason = rt && reasons.length === 1 && c(rt, 2)[0] === 'Z13' && !c(rt, 2).slice(1).some(Boolean) && !c(rt, 1).some(Boolean) && !unused(rt, 2) && rv?.tag === 'CAV' && !c(rv, 1).slice(1).some(Boolean) && !unused(rv, 1) && own[ri + 2]?.tag !== 'CAV' && !own.slice(0, ri).some(t => ['RFF', 'NAD'].includes(t.tag)) ? c(rv, 1)[0] : null;
        if (!reason || !['S17', 'S18', ...(input.code === 'Z14' ? ['Z96'] : [])].includes(reason)) {
            fail('UNDETERMINED', 'egen exakt transaktionsorsak saknas');
            continue;
        }
        if (dates.length > 1)
            fail('CARDINALITY_INVALID', 'flera egna rapportslut');
        if (purposes.length > 1)
            fail('CARDINALITY_INVALID', 'flera egna syften', '323');
        if (reason === 'Z96') {
            if (dates.length)
                fail('FORBIDDEN', 'Z14N får inte ange rapportslut');
            if (purposes.length)
                fail('FORBIDDEN', 'Z14N får inte ange syfte', '323');
            continue;
        }
        if (input.requireAuthority && (input.code === 'Z14' || selected?.source.kind !== 'tgt' || !input.reportingContext))
            fail('SOURCE_UNQUALIFIED', 'oberoende beständigt testunderlag saknas');
        const reference = (qualifier: string) => {
            const refs = own.filter(t => t.tag === 'RFF' && c(t, 1)[0]?.trim() === qualifier), r = refs[0], p = r ? c(r, 1) : [];
            return refs.length === 1 && p.length === 2 && p[0] === qualifier && p[1] && p[1] === p[1].trim() && p[1].length <= 35 && !unused(r, 1) && !own.slice(0, own.indexOf(r)).some(t => t.tag === 'NAD') ? p[1] : null;
        };
        const uds = own.filter(t => t.tag === 'NAD' && c(t, 1)[0]?.trim() === 'UD'), ud = uds[0], udParts = ud ? c(ud, 2) : [];
        const customer = uds.length === 1 && c(ud, 1).length === 1 && c(ud, 1)[0] === 'UD' && udParts.length === 3 ? JSON.stringify({ id: udParts[0], qualifier: udParts[1], agency: udParts[2] }) : null;
        const li = reference('LI'), anj = input.code === 'Z13' ? reference('ANJ') : null;
        const matches = selected?.objects.filter(o => o.code === input.code && o.li === li && JSON.stringify(o.customer) === customer && o.expectedReason === reason && (o.code === 'Z13' ? o.anj === anj && group.itemId === null : group.itemId === o.installation.id && group.identityAgency === o.installation.agency)) ?? [];
        const fact = matches.length === 1 ? matches[0] : null;
        if (!fact || used.has(fact.objectKey)) {
            fail('UNDETERMINED', 'objetet saknar entydigt oberoende request/LI/UD/ANJ-underlag');
            fail('UNDETERMINED', 'kundklassificering och bedömt syfte saknas', '323');
            continue;
        }
        used.add(fact.objectKey);
        const require = (field: string) => { if (statuses.get(field) !== 'undetermined')
            statuses.set(field, 'required'); };
        if (fact.term.kind === 'unknown')
            fail('UNDETERMINED', 'uttrycklig rapporteringsavsikt saknas');
        else if (fact.term.kind === 'indefinite') {
            if (dates.length || input.code === 'Z13' && reason === 'S18')
                fail('FORBIDDEN', 'tillsvidare får inte ange slut eller historisk begäran');
        }
        else {
            require('321');
            if (dates.length !== 1)
                fail('REQUIRED', 'oberoende begränsad period kräver rapportslut');
            const endMinute = fact.term.endMinute;
            if (dates.some(d => c(d, 1)[1] !== endMinute))
                fail('VALUE_MISMATCH', 'rapportslut avviker från avtalad gräns');
            if (input.code === 'Z13' && reason === 'S18')
                try {
                    const clock = input.reportingContext?.evaluationUtcMs ?? (selected && 'evaluationUtcMs' in selected ? selected.evaluationUtcMs : undefined);
                    if (fact.term.endMinute > reportingEvaluationMinute(clock))
                        fail('FUTURE_END', 'historiskt rapportslut är framtida');
                }
                catch {
                    fail('CLOCK_INVALID', 'oberoende utvärderingstid saknas');
                }
        }
        if (fact.classification.kind === 'unknown' || fact.purpose.kind === 'unknown') {
            fail('UNDETERMINED', 'kundklassificering/syftesbedömning saknas', '323');
            continue;
        }
        if (fact.classification.kind === 'private' && fact.purpose.kind === 'absent')
            fail('INCONSISTENT', 'privatkund kan inte sakna syfte', '323');
        if (fact.purpose.kind === 'assessed') {
            require('323');
            if (purposes.length !== 1)
                fail('REQUIRED', 'bedömt syfte saknas', '323');
            const expected = fact.purpose.code;
            if (purposes.some(t => { const next = own[own.indexOf(t) + 1]; return !next || next.tag !== 'CAV' || c(next, 1)[0] !== expected; }))
                fail('VALUE_MISMATCH', 'angivet syfte avviker från bedömningen', '323');
        }
        else if (purposes.length)
            fail('VALUE_MISMATCH', 'syfte deklarerat utelämnat', '323');
        if (fact.code === 'Z14' && !requestMatches(fact))
            fail('REQUEST_MISMATCH', 'svaret saknar exakt oberoende begäran eller avviker från dess syfte/objekt', '323');
    }
    for (const fact of selected?.objects ?? [])
        if (!used.has(fact.objectKey))
            fail('SOURCE_OBJECT_MISSING', 'valt källobjekt saknas i meddelandet');
    return { issues, statuses };
}
function requestMatches(f: Extract<ReportingObject, {
    code: 'Z14';
}>): boolean {
    const r = f.requestAssociation;
    if (r.kind !== 'known' || r.purpose.kind === 'unknown')
        return false;
    if (r.requestKey !== f.requestKey || r.requestRevision !== f.process.revision || r.li !== f.li || r.anj !== f.anj || JSON.stringify(r.process) !== JSON.stringify(f.process) || JSON.stringify(r.authorization) !== JSON.stringify(f.authorization) || JSON.stringify(r.customer) !== JSON.stringify(f.customer) || JSON.stringify(r.legalRequester) !== JSON.stringify(f.legalRequester) || r.reason !== f.expectedReason)
        return false;
    if (r.allowedInstallations.filter(i => i.id === f.installation.id && i.agency === f.installation.agency).length !== 1)
        return false;
    return r.purpose.kind === 'absent' ? f.classification.kind === 'nonprivate' && f.purpose.kind === 'absent' : f.purpose.kind === 'assessed' && f.purpose.code === r.purpose.code;
}
