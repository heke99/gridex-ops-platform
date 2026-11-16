import { createHash } from 'node:crypto';
import { tenantDb } from '@/lib/supabase/tenantDb';
import { requireEdielSystemTestRuntimeContext, type EdielSystemTestRuntimeContext } from '@/lib/ediel/systemTestSettings';
import { dateEventRuntimeSuite, resolveTgtDateEventRoute } from './tgtDateEventContext';
import { getEdielTgtTestDataForCase } from './tgtTestData';
import { listEdielTgtDynamicTestData } from './tgtTestDataStore';
import { reportingRunScope, prepareTgtReportingNotes, readTgtReportingEntry, readTgtReportingReviewEntry } from './tgtReportingPermissionNotes';
import { reportingScenarios, type ReportingSourceSelection } from './tgtReportingPermissionAssertions';
import { copyReportingExpected, copyReportingSelection, reportingEvaluationMinute, type ExpectedContext, type ReportingClock, type ServerSource } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { copyReportingRoute, reportingInvalid as invalid } from '@/lib/ediel/prodat/prodatReportingPermissionStrict';
import { hasReportingPermissionMessage, ProdatReportingAuthorityError } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority';
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer';
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielTestRunRow, EdielTestRunMessageRow, EdielMessageRow } from '@/lib/ediel/types';
export const reportingServerClock: ReportingClock = { nowUtcMs: () => Date.now() };
type Result<T> = {
    data: T | null;
    error: unknown;
};
type ScopedQuery<T> = {
    eq(column: string, value: unknown): ScopedQuery<T>;
    is(column: string, value: null): ScopedQuery<T>;
    select(columns: string): ScopedQuery<T>;
    limit(count: number): PromiseLike<Result<T[]>>;
    maybeSingle(): PromiseLike<Result<T>>;
};
const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(sort(v))).digest('hex');
const invalidAssociation = (): never => { throw new ProdatReportingAuthorityError('PRODAT_REPORTING_ASSOCIATION_INVALID'); };
export async function loadTgtReportingSourceSelection(run: EdielTestRunRow, stepNo: number): Promise<ReportingSourceSelection> {
    const scope = reportingRunScope(run, stepNo), rows = (await listEdielTgtDynamicTestData()).filter(r => r.testSuite === scope.suite && r.roleCode === scope.roleCode && r.testCaseCode === scope.caseCode);
    if (rows.length > 1)
        return invalid();
    const row = rows[0], data = row ? row.parsedPayload : ['8.1.1', '8.1.2', '8.1.3'].includes(scope.caseCode) ? getEdielTgtTestDataForCase(scope.suite, scope.roleCode, scope.caseCode) : null;
    if (!data)
        return invalid();
    const source: ReportingSourceSelection = { data, identity: row ? { kind: 'dynamic', id: row.id, revision: row.updatedAt, digest: digest({ rawText: row.rawText, data }) } : { kind: 'builtin', id: `${scope.suite}/${scope.roleCode}/${scope.caseCode}`, revision: 'reporting-source-v1', digest: digest({ data, adapter: 'reporting-source-v1', original: '475131fa17fe0b4a611bae4ecf3f42cd78c9565b963a7c7cbd918213721332c7' }) } };
    reportingScenarios(source, scope);
    return source;
}
export async function resolveTgtReportingRoute(run: EdielTestRunRow, runtime: EdielSystemTestRuntimeContext) {
    const { suppliers: _suppliers, ...route } = await resolveTgtDateEventRoute(run, 'Z13', runtime);
    void _suppliers;
    return copyReportingRoute(route);
}
/** Display only: parent authorizes run visibility; writes and sends independently reload authority. */
export async function loadTgtReportingReviewState(run: EdielTestRunRow, stepNo: number) {
    try {
        const source = await loadTgtReportingSourceSelection(run, stepNo);
        const runtime = await requireEdielSystemTestRuntimeContext({ companyId: run.company_id, testSuite: dateEventRuntimeSuite(run), actorRole: run.role_code, messageFamily: 'PRODAT' });
        const route = await resolveTgtReportingRoute(run, runtime);
        const entry = readTgtReportingReviewEntry({ run, stepNo, source, route });
        return entry ? { state: entry.state, entry } : { state: 'missing' as const, entry: null };
    } catch {
        return { state: 'unusable' as const, entry: null };
    }
}
export async function resolveTgtReportingBuildContext(input: {
    run: EdielTestRunRow;
    stepNo: number;
    runtime: EdielSystemTestRuntimeContext;
    clock?: ReportingClock;
}) {
    const scope = reportingRunScope(input.run, input.stepNo), source = await loadTgtReportingSourceSelection(input.run, input.stepNo), route = await resolveTgtReportingRoute(input.run, input.runtime), entry = readTgtReportingEntry({ ...input, source, route }), evaluationUtcMs = (input.clock ?? reportingServerClock).nowUtcMs();
    reportingEvaluationMinute(evaluationUtcMs);
    if (!entry)
        throw new ProdatReportingAuthorityError('PRODAT_REPORTING_SOURCE_UNQUALIFIED');
    const serverSource: ServerSource = { kind: 'tgt', scope: { ...scope, stepNo: input.stepNo, code: 'Z13', actor: 'gridex', direction: 'outbound', environment: 'test', runtimeSuite: dateEventRuntimeSuite(input.run) }, source: entry.source, factsRevision: entry.factsRevision, actorId: entry.actorId, sourceNote: entry.sourceNote, route };
    const evidence = copyReportingSelection({ source: serverSource, objects: entry.objects.map(o => o.object) });
    const context = copyReportingExpected({ source: serverSource, objects: entry.objects.map(o => o.object), evaluationUtcMs });
    const facts: ProdatDependentConditionFacts = { market: 'electricity', reportingPermission: evidence };
    return { facts, context, testData: source.data };
}
async function messageScope(message: EdielMessageRow) {
    if (message.environment !== 'test' || message.direction !== 'outbound' || message.message_family !== 'PRODAT' || message.message_code !== 'Z13')
        return invalidAssociation();
    const wire = tokenizeEdifact(message.raw_payload ?? ''), headers = wire.segments.filter(s => s.tag === 'UNH'), bgms = wire.segments.filter(s => s.tag === 'BGM');
    if (headers.length !== 1 || segmentComposite(headers[0], 2, wire.una)[0] !== 'PRODAT' || bgms.length !== 1 || segmentComposite(bgms[0], 1, wire.una)[0] !== 'Z13')
        return invalidAssociation();
    const { data: links, error: linkError } = await (tenantDb(message.company_id).from('ediel_test_run_messages').select('*') as ScopedQuery<EdielTestRunMessageRow>).eq('ediel_message_id', message.id).limit(2);
    if (linkError)
        throw linkError;
    if (links?.length !== 1)
        return invalidAssociation();
    const link = links[0];
    if (link.company_id !== message.company_id || link.ediel_message_id !== message.id || !link.step_no || link.expected_family !== 'PRODAT' || link.expected_code !== 'Z13' || link.expected_direction !== 'outbound')
        return invalidAssociation();
    const { data: run, error } = await (tenantDb(message.company_id).from('ediel_test_runs').select('*') as ScopedQuery<EdielTestRunRow>).eq('id', link.test_run_id).maybeSingle();
    if (error)
        throw error;
    if (!run || run.company_id !== message.company_id)
        return invalidAssociation();
    reportingRunScope(run, link.step_no);
    return { run, stepNo: link.step_no };
}
export async function loadTgtReportingValidationContext(message: EdielMessageRow, clock: ReportingClock = reportingServerClock): Promise<ExpectedContext | undefined> {
    if (!hasReportingPermissionMessage(message, ['Z13']))
        return undefined; // positive persisted Z14 has no producer; policy fails closed, N needs no facts.
    const { run, stepNo } = await messageScope(message), runtime = await requireEdielSystemTestRuntimeContext({ companyId: run.company_id, testSuite: dateEventRuntimeSuite(run), actorRole: run.role_code, messageFamily: 'PRODAT' });
    return (await resolveTgtReportingBuildContext({ run, stepNo, runtime, clock })).context;
}
/** Caller already authenticated/authorized the company; selectors never establish the link. */
export async function requireTgtReportingSendAssociation(companyId: string, messageId: string, selected: {
    runId?: string | null;
    caseCode?: string | null;
    stepNo?: number | null;
}) {
    const { data: message, error } = await (tenantDb(companyId).from('ediel_messages').select('*') as ScopedQuery<EdielMessageRow>).eq('id', messageId).maybeSingle();
    if (error)
        throw error;
    if (!message || message.company_id !== companyId)
        return invalidAssociation();
    const { run, stepNo } = await messageScope(message);
    if (selected.runId != null && selected.runId !== run.id || selected.caseCode != null && selected.caseCode !== run.test_case_code || selected.stepNo != null && selected.stepNo !== stepNo)
        return invalidAssociation();
    await loadTgtReportingValidationContext(message);
    return { companyId, runId: run.id, messageId: message.id, caseCode: run.test_case_code, stepNo };
}
/** Notes-only write; all new tenant reads/writes use the real wrapper and atomic CAS. */
export async function saveTgtReportingPermission(input: {
    companyId: string;
    runId: string;
    stepNo: number;
    expectedRunUpdatedAt: string;
    actorId: string;
    command: unknown;
    clock?: ReportingClock;
}) {
    const { data: run, error } = await (tenantDb(input.companyId).from('ediel_test_runs').select('*') as ScopedQuery<EdielTestRunRow>).eq('id', input.runId).maybeSingle();
    if (error)
        throw error;
    if (!run || run.company_id !== input.companyId || run.updated_at !== input.expectedRunUpdatedAt)
        throw new Error('PRODAT_REPORTING_CONCURRENT_UPDATE');
    reportingRunScope(run, input.stepNo);
    const runtime = await requireEdielSystemTestRuntimeContext({ companyId: input.companyId, testSuite: dateEventRuntimeSuite(run), actorRole: run.role_code, messageFamily: 'PRODAT' }), source = await loadTgtReportingSourceSelection(run, input.stepNo), route = await resolveTgtReportingRoute(run, runtime);
    const now = (input.clock ?? reportingServerClock).nowUtcMs();
    reportingEvaluationMinute(now);
    const notes = prepareTgtReportingNotes({ run, stepNo: input.stepNo, actorId: input.actorId, source, route, clock: { nowUtcMs: () => now }, command: input.command });
    if (notes === run.notes)
        return;
    const old = Date.parse(input.expectedRunUpdatedAt);
    if (!Number.isFinite(old))
        return invalid();
    const updatedAt = new Date(Math.max(now, Math.floor(old) + 1)).toISOString();
    let query = (tenantDb(input.companyId).from('ediel_test_runs').update({ notes, updated_by: input.actorId, updated_at: updatedAt }) as ScopedQuery<Pick<EdielTestRunRow, 'id' | 'updated_at'>>).eq('id', run.id).eq('updated_at', input.expectedRunUpdatedAt);
    query = run.notes === null ? query.is('notes', null) : query.eq('notes', run.notes);
    const { data: receipt, error: writeError } = await query.select('id,updated_at').maybeSingle();
    if (writeError)
        throw writeError;
    if (!receipt)
        throw new Error('PRODAT_REPORTING_CONCURRENT_UPDATE');
}
