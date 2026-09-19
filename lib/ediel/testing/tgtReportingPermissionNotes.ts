import { randomUUID } from 'node:crypto';
import { copyReportingObjects, reportingBusinessMinute, reportingEvaluationMinute, type ActiveStep, type ClearedStep, type OperatorAssertion, type ReportingClock, type Ref, type Route, type RunScope, type StoredAssertion, type StoredNotes } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { copyReportingRoute, copyReportingSourceIdentity, copyReportingSelector, reportingRecord as record, reportingUuid as uuid, reportingText as text, reportingArray as array, reportingInvalid as invalid } from '@/lib/ediel/prodat/prodatReportingPermissionStrict';
import { copyReportingAssertion, copyReportingCommand, reportingScenarios, resolveReportingSourceMinute, type ReportingSourceSelection, type ReportingScenario } from './tgtReportingPermissionAssertions';
import { getEdielTgtTestCaseByCode } from './tgtRegistry';
import type { EdielTestRunRow } from '@/lib/ediel/types';
type Run = Pick<EdielTestRunRow, 'id' | 'company_id' | 'role_code' | 'test_case_code' | 'test_suite' | 'notes'>;
export type ReportingNotesInput = {
    run: Run;
    stepNo: number;
    actorId: string;
    source: ReportingSourceSelection;
    route: Route;
    clock: ReportingClock;
    newId?: () => string;
    command: unknown;
};
export function reportingRunScope(run: Run, stepNo: number): RunScope {
    const definition = getEdielTgtTestCaseByCode(run.test_suite, run.role_code, run.test_case_code), step = definition?.expectedSteps.find(s => s.stepNo === stepNo);
    if (run.test_suite !== 'PRODAT' || run.role_code !== 'esco' || !['E3', 'E4', '8.1.1', '8.1.2', '8.1.3'].includes(run.test_case_code) || !step || step.actor !== 'gridex' || step.direction !== 'outbound' || step.code !== 'Z13' || step.family !== 'PRODAT')
        return invalid();
    return { companyId: uuid(run.company_id), runId: uuid(run.id), roleCode: 'esco', caseCode: run.test_case_code as RunScope['caseCode'], suite: 'PRODAT' };
}
function rawNotes(value: string | null): Record<string, unknown> {
    if (!value)
        return {};
    try {
        const v: unknown = JSON.parse(value);
        if (!v || typeof v !== 'object' || Array.isArray(v))
            return { text: value };
        return v as Record<string, unknown>;
    }
    catch {
        if (/^[\s]*[\[{]/.test(value))
            return invalid();
        return { text: value };
    }
}
function storedAssertion(value: unknown): StoredAssertion {
    const r = record(value, ['selector', 'assertion', 'resolutionAnchorUtcMs', 'resolvedEndMinute', 'sourceExpression', 'object']);
    reportingEvaluationMinute(r.resolutionAnchorUtcMs);
    const assertion = copyReportingAssertion(r.assertion), selector = copyReportingSelector(r.selector), object = copyReportingObjects([r.object])[0];
    if (object.code !== 'Z13' || JSON.stringify(selector) !== JSON.stringify(assertion.selector) || JSON.stringify(selector) !== JSON.stringify(object.selector))
        return invalid();
    const end = r.resolvedEndMinute === null ? null : text(r.resolvedEndMinute, 12), expression = r.sourceExpression === null ? null : text(r.sourceExpression, 2000);
    if ((object.term.kind === 'bounded' ? object.term.endMinute : null) !== end || (assertion.term.kind === 'bounded_source') !== (expression !== null))
        return invalid();
    return { selector, assertion, resolutionAnchorUtcMs: r.resolutionAnchorUtcMs as number, resolvedEndMinute: end, sourceExpression: expression, object };
}
function stepEntry(value: unknown): ActiveStep | ClearedStep {
    if (!value || typeof value !== 'object')
        return invalid();
    const active = (value as Record<string, unknown>).state === 'active', r = record(value, active ? ['state', 'code', 'factsRevision', 'source', 'routeAtApproval', 'actorId', 'sourceNote', 'recordedAtUtcMs', 'objects'] : ['state', 'code', 'factsRevision', 'actorId', 'sourceNote', 'recordedAtUtcMs']);
    if (r.code !== 'Z13' || !['active', 'cleared'].includes(String(r.state)))
        return invalid();
    reportingEvaluationMinute(r.recordedAtUtcMs);
    const base = { code: 'Z13' as const, factsRevision: uuid(r.factsRevision), actorId: uuid(r.actorId), sourceNote: text(r.sourceNote, 2000), recordedAtUtcMs: r.recordedAtUtcMs as number };
    if (!active)
        return { ...base, state: 'cleared' };
    const objects = array(r.objects).map(storedAssertion), routeAtApproval = copyReportingRoute(r.routeAtApproval);
    if (!objects.length || objects.some(o => o.object.process.revision !== base.factsRevision || JSON.stringify(o.object.legalRequester) !== JSON.stringify(routeAtApproval.legalSender)))
        return invalid();
    copyReportingObjects(objects.map(o => o.object));
    return { ...base, state: 'active', source: copyReportingSourceIdentity(r.source), routeAtApproval, objects };
}
function envelope(run: Run, stepNo: number): {
    raw: Record<string, unknown>;
    notes: StoredNotes;
} {
    const scope = reportingRunScope(run, stepNo), raw = rawNotes(run.notes);
    if (!Object.hasOwn(raw, 'prodatReportingPermission'))
        return { raw, notes: { version: 1, scope, steps: {} } };
    const r = record(raw.prodatReportingPermission, ['version', 'scope', 'steps']);
    if (r.version !== 1 || JSON.stringify(record(r.scope, ['companyId', 'runId', 'roleCode', 'caseCode', 'suite'])) !== JSON.stringify(scope))
        return invalid();
    if (!r.steps || typeof r.steps !== 'object' || Array.isArray(r.steps))
        return invalid();
    const steps: StoredNotes['steps'] = {};
    for (const [key, value] of Object.entries(r.steps)) {
        if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)))
            return invalid();
        reportingRunScope(run, Number(key));
        steps[key] = stepEntry(value);
    }
    return { raw, notes: { version: 1, scope, steps } };
}
function assemble(assertion: OperatorAssertion, scenario: ReportingScenario, route: Route, revision: string, anchor: number, newId: () => string, previous?: StoredAssertion): StoredAssertion {
    if (assertion.classification !== 'unknown' && scenario.classification && assertion.classification !== scenario.classification)
        return invalid();
    if (assertion.purpose.kind === 'assessed' && scenario.purposeCode && assertion.purpose.code !== scenario.purposeCode || assertion.purpose.kind === 'absent' && (scenario.purposeCode || assertion.classification === 'private'))
        return invalid();
    const prior = previous?.object, requestKey = prior?.requestKey ?? uuid(newId()), authKey = prior?.authorization.key ?? uuid(newId());
    const ref = (kind: Ref['kind'], old?: Ref): Ref => ({ kind, key: old?.key ?? uuid(newId()), revision, requestKey });
    const process: Ref = { kind: 'process', key: requestKey, revision, requestKey }, authorization: Ref = { kind: 'authorization', key: authKey, revision, requestKey };
    const declaration = assertion.term.kind === 'unknown' ? undefined : ref('declaration', prior?.term.kind === 'unknown' ? undefined : prior?.term.declaration);
    let end: string | null = null, expression: string | null = null;
    if (assertion.term.kind === 'bounded_source') {
        if (!scenario.sourceEnd)
            return invalid();
        expression = scenario.sourceEnd;
        end = resolveReportingSourceMinute(expression, anchor, assertion.term.minuteOfDay);
    }
    if (assertion.term.kind === 'bounded') {
        end = reportingBusinessMinute(assertion.term.end);
        if (!end || scenario.sourceEnd && reportingBusinessMinute(scenario.sourceEnd) !== end)
            return invalid();
    }
    if (assertion.term.kind === 'indefinite' && (scenario.sourceEnd || scenario.reason === 'S18'))
        return invalid();
    const object = copyReportingObjects([{ objectKey: requestKey, requestKey, selector: scenario.selector, process, authorization, li: scenario.li ?? prior?.li ?? `L${requestKey.replaceAll('-', '')}`, anj: scenario.anj ?? prior?.anj ?? `A${authKey.replaceAll('-', '')}`, customer: scenario.customer, legalRequester: route.legalSender, expectedReason: scenario.reason, code: 'Z13', installation: null, requestAssociation: null,
            term: assertion.term.kind === 'unknown' ? { kind: 'unknown' } : end ? { kind: 'bounded', endMinute: end, declaration } : { kind: 'indefinite', declaration },
            classification: assertion.classification === 'unknown' ? { kind: 'unknown' } : { kind: assertion.classification, record: ref('classification', prior?.classification.kind === 'unknown' ? undefined : prior?.classification.record) },
            purpose: assertion.purpose.kind === 'unknown' ? { kind: 'unknown' } : assertion.purpose.kind === 'absent' ? { kind: 'absent', declaration: ref('declaration', prior?.purpose.kind === 'absent' ? prior.purpose.declaration : undefined) } : { kind: 'assessed', code: assertion.purpose.code, assessment: ref('assessment', prior?.purpose.kind === 'assessed' ? prior.purpose.assessment : undefined), legalActor: route.legalSender, customer: scenario.customer } }])[0];
    return { selector: copyReportingSelector(scenario.selector), assertion: copyReportingAssertion(assertion), resolutionAnchorUtcMs: anchor, resolvedEndMinute: end, sourceExpression: expression, object };
}
export function readTgtReportingEntry(input: Pick<ReportingNotesInput, 'run' | 'stepNo' | 'source' | 'route'>): ActiveStep | null {
    const { notes } = envelope(input.run, input.stepNo), entry = notes.steps[String(input.stepNo)];
    if (!entry || entry.state === 'cleared')
        return null;
    if (JSON.stringify(entry.source) !== JSON.stringify(copyReportingSourceIdentity(input.source.identity)) || JSON.stringify(entry.routeAtApproval) !== JSON.stringify(copyReportingRoute(input.route)))
        return invalid();
    const scenarios = reportingScenarios(input.source, notes.scope);
    if (scenarios.length !== entry.objects.length)
        return invalid();
    for (const stored of entry.objects) {
        const matches = scenarios.filter(s => JSON.stringify(s.selector) === JSON.stringify(stored.selector));
        if (matches.length !== 1)
            return invalid();
        const built = assemble(stored.assertion, matches[0], entry.routeAtApproval, entry.factsRevision, stored.resolutionAnchorUtcMs, () => invalid(), stored);
        if (JSON.stringify(built) !== JSON.stringify(stored))
            return invalid();
    }
    return entry;
}
export function prepareTgtReportingNotes(input: ReportingNotesInput): string {
    const command = copyReportingCommand(input.command), { raw, notes } = envelope(input.run, input.stepNo), route = copyReportingRoute(input.route), actorId = uuid(input.actorId), now = input.clock.nowUtcMs(), newId = input.newId ?? randomUUID;
    reportingEvaluationMinute(now);
    const previous = notes.steps[String(input.stepNo)], scenarios = reportingScenarios(input.source, notes.scope);
    let entry: ActiveStep | ClearedStep;
    if (command.operation === 'clear')
        entry = { state: 'cleared', code: 'Z13', factsRevision: uuid(newId()), actorId, sourceNote: command.sourceNote, recordedAtUtcMs: now };
    else {
        if (command.objects.length !== scenarios.length)
            return invalid();
        const old = previous?.state === 'active' ? previous : null;
        const unchanged = !!old && JSON.stringify(old.source) === JSON.stringify(input.source.identity) && JSON.stringify(old.routeAtApproval.legalSender) === JSON.stringify(route.legalSender) && old.objects.length === scenarios.length && scenarios.every(s => old.objects.some(o => JSON.stringify(o.selector) === JSON.stringify(s.selector) && JSON.stringify(o.object.customer) === JSON.stringify(s.customer) && o.object.expectedReason === s.reason));
        if (unchanged && command.resolution === 'retain' && old.actorId === actorId && old.sourceNote === command.sourceNote && JSON.stringify(old.routeAtApproval) === JSON.stringify(route) && JSON.stringify(old.objects.map(o => o.assertion)) === JSON.stringify(command.objects)) {
            const current = readTgtReportingEntry(input);
            for (const o of current?.objects ?? [])
                if (o.object.expectedReason === 'S18' && o.resolvedEndMinute && o.resolvedEndMinute > reportingEvaluationMinute(now))
                    return invalid();
            return input.run.notes!;
        }
        const revision = uuid(newId()), objects = command.objects.map(a => { const matches = scenarios.filter(s => JSON.stringify(s.selector) === JSON.stringify(a.selector)); if (matches.length !== 1)
            return invalid(); const prior = unchanged ? old.objects.find(o => JSON.stringify(o.selector) === JSON.stringify(a.selector)) : undefined; return assemble(a, matches[0], route, revision, prior && command.resolution === 'retain' ? prior.resolutionAnchorUtcMs : now, newId, prior); });
        for (const o of objects)
            if (o.object.expectedReason === 'S18' && o.resolvedEndMinute && o.resolvedEndMinute > reportingEvaluationMinute(now))
                return invalid();
        copyReportingObjects(objects.map(o => o.object));
        entry = { state: 'active', code: 'Z13', factsRevision: revision, source: copyReportingSourceIdentity(input.source.identity), routeAtApproval: route, actorId, sourceNote: command.sourceNote, recordedAtUtcMs: now, objects };
    }
    const result = JSON.stringify({ ...raw, prodatReportingPermission: { ...notes, steps: { ...notes.steps, [input.stepNo]: entry } } });
    if (result.length > 65536)
        return invalid();
    return result;
}
