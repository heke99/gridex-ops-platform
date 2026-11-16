import type { OperatorAssertion, OperatorCommand, OperatorTerm, OperatorPurpose, Selector, Party, SourceIdentity } from '@/lib/ediel/prodat/prodatReportingPermissionTypes';
import { REPORTING_PURPOSES, reportingBusinessMinute, reportingEvaluationMinute } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { reportingRecord as record, reportingText as text, reportingEnum as oneOf, reportingArray as array, reportingInvalid as invalid, copyReportingSelector, copyReportingSourceIdentity } from '@/lib/ediel/prodat/prodatReportingPermissionStrict';
import { readTgtProdatSourceColumns } from './tgtProdatSource';
import type { EdielTgtCaseTestData } from './tgtTestData';
export type ReportingSourceSelection = {
    identity: SourceIdentity;
    data: EdielTgtCaseTestData;
};
export type ReportingScenario = {
    selector: Selector;
    customer: Party;
    reason: 'S17' | 'S18';
    sourceEnd: string | null;
    purposeCode: string | null;
    li: string | null;
    anj: string | null;
    classification: 'private' | 'nonprivate' | null;
};
const tag = (v: unknown) => v && typeof v === 'object' ? (v as Record<string, unknown>).kind : invalid();
function operatorTerm(value: unknown): OperatorTerm {
    const kind = tag(value);
    if (kind === 'unknown' || kind === 'indefinite') {
        record(value, ['kind']);
        return { kind };
    }
    if (kind === 'bounded') {
        const r = record(value, ['kind', 'end']), end = reportingBusinessMinute(r.end);
        if (!end)
            return invalid();
        return { kind, end };
    }
    const r = record(value, ['kind', 'minuteOfDay']);
    if (r.kind !== 'bounded_source' || typeof r.minuteOfDay !== 'string' || !/^([01]\d|2[0-3])[0-5]\d$/.test(r.minuteOfDay))
        return invalid();
    return { kind: 'bounded_source', minuteOfDay: r.minuteOfDay };
}
function operatorPurpose(value: unknown): OperatorPurpose {
    const kind = tag(value);
    if (kind === 'unknown' || kind === 'absent') {
        record(value, ['kind']);
        return { kind };
    }
    const r = record(value, ['kind', 'code', 'rationale']);
    if (r.kind !== 'assessed')
        return invalid();
    return { kind: 'assessed', code: oneOf(r.code, REPORTING_PURPOSES), rationale: text(r.rationale, 2000) };
}
export function copyReportingAssertion(value: unknown): OperatorAssertion {
    const r = record(value, ['selector', 'term', 'classification', 'classificationRationale', 'purpose']), classification = oneOf(r.classification, ['unknown', 'private', 'nonprivate']);
    return { selector: copyReportingSelector(r.selector), term: operatorTerm(r.term), classification, classificationRationale: text(r.classificationRationale, 2000, classification === 'unknown'), purpose: operatorPurpose(r.purpose) };
}
export function copyReportingCommand(value: unknown): OperatorCommand {
    if (!value || typeof value !== 'object')
        return invalid();
    const v = value as Record<string, unknown>;
    if (v.operation === 'clear') {
        const r = record(v, ['operation', 'sourceNote']);
        return { operation: 'clear', sourceNote: text(r.sourceNote, 2000) };
    }
    const r = record(v, ['operation', 'resolution', 'sourceNote', 'objects']);
    if (r.operation !== 'save')
        return invalid();
    const objects = array(r.objects).map(copyReportingAssertion);
    if (!objects.length || new Set(objects.map(x => JSON.stringify(x.selector))).size !== objects.length)
        return invalid();
    return { operation: 'save', resolution: oneOf(r.resolution, ['retain', 'refresh']), sourceNote: text(r.sourceNote, 2000), objects };
}
export function reportingScenarios(source: ReportingSourceSelection, scope: {
    suite: string;
    roleCode: string;
    caseCode: string;
}): ReportingScenario[] {
    copyReportingSourceIdentity(source.identity);
    const data = source.data;
    if (data.suite !== scope.suite || data.roleCode !== scope.roleCode || data.testCaseCode !== scope.caseCode)
        return invalid();
    const rows = readTgtProdatSourceColumns(data, 'Z13');
    if (!rows.length)
        return invalid();
    const scenarios = rows.map(row => {
        if (row.fields['209'] || row.registerIndex !== null)
            return invalid();
        const field = row.group.fields.find(f => f.fieldCode === '227'), qualifier = row.fields['227.QUALIFIER'] ?? field?.fieldName.match(/1131=(SE1|SE2)/)?.[1], agency = row.fields['227.AGENCY'] ?? field?.fieldName.match(/3055=(260)/)?.[1];
        if (!qualifier || !agency)
            return invalid();
        const coded = (value: string | undefined, allowed: readonly string[]) => { if (value === undefined)
            return null; return allowed.find(code => value === code || new RegExp(`^${code} \\([^()]+\\)$`).test(value)) ?? invalid(); };
        const reference = (value: string | undefined) => value === 'sätts av avsändaren' || value === 'sätts av systemet' ? null : value ? text(value, 35) : invalid();
        return { selector: copyReportingSelector({ workbook: row.group.block.sourceWorkbook, sheet: row.group.block.sourceSheet, entityLabel: row.group.block.entityLabel, columnName: row.column.name, columnIndex: row.column.index }), customer: { id: text(row.fields['227'], 35), qualifier, agency }, reason: oneOf(coded(row.fields['223'], ['S17', 'S18']), ['S17', 'S18']), sourceEnd: row.fields['321'] ?? null, purposeCode: coded(row.fields['323'], REPORTING_PURPOSES), li: reference(row.fields['226']), anj: reference(row.fields['261']), classification: source.identity.kind === 'builtin' ? (scope.caseCode === '8.1.3' ? 'nonprivate' as const : 'private' as const) : null };
    });
    if (new Set(scenarios.map(s => JSON.stringify(s.selector))).size !== scenarios.length)
        return invalid();
    return scenarios;
}
/** Finite original source-expression vocabulary; explicit minute supplied by assertion. */
export function resolveReportingSourceMinute(raw: string, anchor: number, minute: string): string {
    const wall = reportingEvaluationMinute(anchor), year = Number(wall.slice(0, 4)), month = Number(wall.slice(4, 6));
    let y = year, m = month, d = 1;
    if (raw === 'sätts av avsändaren (1:a i föregående månad)' || raw === 'sätts av avsändaren (15:e i föregående månad)') {
        m--;
        if (m === 0) {
            m = 12;
            y--;
        }
        d = raw.includes('15:e') ? 15 : 1;
    }
    else if (raw === 'sätts av avsändaren (1:a i samma månad föregående år)')
        y--;
    else
        return invalid();
    const result = `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}${minute}`;
    return reportingBusinessMinute(result) ?? invalid();
}
