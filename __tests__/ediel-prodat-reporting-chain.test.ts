import { beforeEach, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { reportingId, reportingNow, reportingPrepared } from './fixtures/prodat-reporting-permission';
const io = vi.hoisted(() => ({ from: vi.fn(), runtime: vi.fn(), send: vi.fn(), archive: vi.fn(), authorize: vi.fn(), operational: vi.fn(), company: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }));
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: '00000000-0000-4000-8000-000000000012' }), requireCompanyScopedActionAccess: io.authorize, isPlatformAdminContext: () => true }));
vi.mock('@/lib/ediel/actionAccess', () => ({ requireEdielWriteActionAccess: async () => ({ userId: '00000000-0000-4000-8000-000000000012' }) }));
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: io.company }));
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.operational }));
vi.mock('@/lib/ediel/systemTestSettings', () => ({ requireEdielSystemTestRuntimeContext: io.runtime }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: () => ({ from: 'sender@example.invalid', provider: 'synthetic' }) }));
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.send }));
vi.mock('@/lib/ediel/transport/index.part-1', async (original) => ({ ...await original<typeof import('@/lib/ediel/transport/index.part-1')>(), storeTransportPayloadSnapshot: io.archive }));
import EdielReportingPermissionForm from '@/app/admin/ediel/system-tests/EdielReportingPermissionForm';
import { createAndSendSystemTestOutboundForRunAction, sendSystemTestOutboundMessageAction } from '@/app/admin/ediel/system-tests/actions.part-4';
import { runTgtAutopilotForRun } from '@/lib/ediel/testing/tgtAutopilot';
import { loadTgtReportingValidationContext } from '@/lib/ediel/testing/tgtReportingPermissionContext';
import type { EdielMessageRow } from '@/lib/ediel/types';
type Row = Record<string, unknown>;
let db: Record<string, Row[]>, reads: Array<{
    table: string;
    filters: Array<[
        string,
        unknown
    ]>;
}>, seq: number;
function from(table: string) {
    const filters: Array<[
        string,
        unknown
    ]> = [], predicates: Array<(r: Row) => boolean> = [];
    let operation = 'read', values: Row[] = [], one = false, cap = Infinity, executed: unknown;
    const run = () => {
        if (executed)
            return executed;
        reads.push({ table, filters: [...filters] });
        const all = db[table] ??= [], found = all.filter(r => predicates.every(p => p(r))).slice(0, cap);
        let result = found;
        if (operation === 'insert') {
            result = values.map(v => ({ id: reportingId(seq++), created_at: new Date(reportingNow).toISOString(), updated_at: new Date(reportingNow).toISOString(), ...v }));
            db[table] = [...all, ...result];
        }
        if (operation === 'update') {
            found.forEach(r => Object.assign(r, values[0]));
            result = found;
        }
        executed = { data: structuredClone(one ? result[0] ?? null : result), error: null };
        return executed;
    };
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); predicates.push(r => r[k] === v); return q; }, is: (k: string, v: unknown) => q.eq(k, v), neq: (k: string, v: unknown) => { predicates.push(r => r[k] !== v); return q; }, in: (k: string, v: unknown[]) => { predicates.push(r => v.includes(r[k])); return q; }, or: () => q, order: () => q, limit: (n: number) => { cap = n; return q; }, range: () => q, not: () => q, insert: (v: Row | Row[]) => { operation = 'insert'; values = Array.isArray(v) ? v : [v]; return q; }, upsert: (v: Row | Row[]) => q.insert(v), update: (v: Row) => { operation = 'update'; values = [v]; return q; }, delete: () => q, maybeSingle: () => { one = true; return Promise.resolve(run()); }, single: () => { one = true; return Promise.resolve(run()); }, then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject) };
    return q;
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(node))
    return node.flatMap(elements); if (!node || typeof node !== 'object' || !('props' in node))
    return []; const element = node as ReactElement<Record<string, unknown>>; return [element, ...elements(element.props.children as ReactNode)]; }
async function saveFromActiveForm(overrides:Record<string,string>={}) {
    const run = db.ediel_test_runs[0] as unknown as ReturnType<typeof reportingPrepared>['run'], tree = await EdielReportingPermissionForm({ run }), form = elements(tree).find(e => e.type === 'form')!;
    expect(form).toBeTruthy();
    const data = new FormData();
    for (const e of elements(form))
        if (typeof e.props.name === 'string' && e.props.type === 'hidden')
            data.set(e.props.name, String(e.props.value));
    const assertions = reportingPrepared().command.objects;
    for (const [i, o] of assertions.entries())
        for (const [key, value] of Object.entries({ term: 'bounded_source', end: '', minuteOfDay: '00:00', classification: o.classification, classificationRationale: o.classificationRationale, purpose: o.purpose.code, purposeRationale: o.purpose.rationale }))
            data.set(`object.${i}.${key}`, value);
    for(const [key,value]of Object.entries(overrides))data.set(key,value);
    data.set('sourceNote', 'Original business synthetic test assessment');
    data.set('resolution', 'retain');
    await (form.props.action as (f: FormData) => Promise<void>)(data);
    expect(db.ediel_messages).toHaveLength(0);
    expect(db.ediel_test_run_messages).toHaveLength(0);
    expect(io.send).not.toHaveBeenCalled();
    return data;
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(reportingNow); seq = 100; reads = []; const p = reportingPrepared(); db = { ediel_test_runs: [{ ...p.run, notes: null, status: 'in_progress', started_at: '2026-09-01T00:00:00.000Z', encryption_mode: 'none' }], ediel_messages: [], ediel_test_run_messages: [] }; io.from.mockImplementation(from); p.runtime.settings!.routeProfileId = reportingId(80); db.ediel_test_runs[0].route_profile_id = reportingId(80); db.ediel_route_profiles = [{ id: reportingId(80), company_id: reportingId(10), environment: 'test', is_enabled: true, is_active: true, communication_route_id: reportingId(81), transport_security_mode: 'unencrypted', encryption_mode: 'none', mailbox: 'tgt-file-engine' }]; io.runtime.mockResolvedValue(p.runtime); io.send.mockResolvedValue({ accepted: ['portal@example.invalid'], rejected: [], messageId: 'synthetic-provider-id' }); io.archive.mockResolvedValue(undefined); });
it('active form/action saves notes then actual create-send chain keeps one exact association and reaches mocked provider', async () => { await saveFromActiveForm(); const form = new FormData(); form.set('testRunId', String(db.ediel_test_runs[0].id)); form.set('testCaseCode', '8.1.3'); await expect(createAndSendSystemTestOutboundForRunAction(form)).rejects.toThrow(/REDIRECT:.*ackStatus=sent/); expect(db.ediel_test_run_messages).toHaveLength(1); expect(db.ediel_test_run_messages[0].step_no).toBe(1); expect(io.send).toHaveBeenCalledTimes(1); });
it('real autopilot association supports direct-send with omitted step and no reattachment', async () => { await saveFromActiveForm(); const draft = await runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) }); expect(draft.action).toBe('created_gridex_draft'); const form = new FormData(); form.set('edielMessageId', draft.messageId!); form.set('testRunId', reportingId(11)); await expect(sendSystemTestOutboundMessageAction(form)).rejects.toThrow(/REDIRECT:.*ackStatus=sent/); expect(db.ediel_test_run_messages).toHaveLength(1); expect(io.send).toHaveBeenCalledTimes(1); });
it('owner reload checks tenant-filtered exact link before run filtering', async () => { await saveFromActiveForm(); const draft = await runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) }); expect(draft.action).toBe('created_gridex_draft'); await loadTgtReportingValidationContext(db.ediel_messages[0] as unknown as EdielMessageRow); expect(reads.some(r => r.table === 'ediel_test_run_messages' && r.filters.some(([k, v]) => k === 'company_id' && v === reportingId(10)) && r.filters.some(([k, v]) => k === 'ediel_message_id' && v === draft.messageId) && !r.filters.some(([k]) => k === 'test_run_id' || k === 'step_no'))).toBe(true); });
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
import { saveEdielTgtReportingPermissionAction } from '@/app/admin/ediel/reporting-permission-action';
async function prepareRealDraft() { await saveFromActiveForm(); const draft = await runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) }); expect(draft.action).toBe('created_gridex_draft'); return db.ediel_messages[0] as unknown as EdielMessageRow; }
for (const change of ['missingLink', 'duplicateLink', 'wrongStep', 'wrongCompany', 'staleRowLabel', 'notesCleared', 'sourceChanged', 'routeChanged', 'freshClock', 'pureEvidence', 'missingEvidence', 'alteredLI'] as const)
    it(`actual SMTP rejects ${change} before archive/provider`, async () => {
        const message = await prepareRealDraft();
        if (change === 'missingLink')
            db.ediel_test_run_messages = [];
        if (change === 'duplicateLink')
            db.ediel_test_run_messages.push({ ...db.ediel_test_run_messages[0], step_no: null, id: reportingId(999) });
        if (change === 'wrongStep')
            db.ediel_test_run_messages[0].step_no = 2;
        if (change === 'wrongCompany')
            message.company_id = reportingId(99);
        if (change === 'staleRowLabel')
            message.message_code = 'Z04';
        if (change === 'notesCleared')
            db.ediel_test_runs[0].notes = null;
        if (change === 'sourceChanged')
            db.ediel_tgt_test_data = [{ id: reportingId(90), test_suite: 'PRODAT', role_code: 'esco', test_case_code: '8.1.3', updated_at: '2026-09-19', raw_text: 'changed', parsed_payload: reportingPrepared().testData }];
        if (change === 'routeChanged')
            db.ediel_route_profiles[0].mailbox = 'changed';
        if (change === 'freshClock')
            vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-01T00:00Z'));
        if (change === 'pureEvidence')
            message.parsed_payload = { ...message.parsed_payload, prodatEngine: { registerEvidence: { version: 1, code: 'Z13', bodyBinding: 'forged', facts: { reportingPermission: { source: { kind: 'caller_selection', reference: 'forged' } } } } } };
        if (change === 'missingEvidence')
            message.parsed_payload = { rulebookAllowInvalidSend: true, testRunId: reportingId(11), stepNo: 1 };
        if (change === 'alteredLI')
            message.raw_payload = message.raw_payload!.replace('RFF+LI:L', 'RFF+LI:X');
        message.parsed_payload = { ...message.parsed_payload, rulebookAllowInvalidSend: true };
        await expect(sendEdielMessageViaSmtp(message, { actorUserId: reportingId(12) })).rejects.toThrow();
        expect(io.archive).not.toHaveBeenCalled();
        expect(io.send).not.toHaveBeenCalled();
    });
for (const action of ['create', 'direct'] as const)
    for (const change of ['wrongCompany', 'wrongStep', 'duplicate', 'missingLink'] as const)
        it(`${action} active action rejects ${change} without reattaching or sending`, async () => {
            const message = await prepareRealDraft(), form = new FormData();
            form.set('testRunId', reportingId(11));
            form.set('testCaseCode', '8.1.3');
            form.set('edielMessageId', message.id);
            if (change === 'wrongCompany')
                message.company_id = reportingId(99);
            if (change === 'wrongStep')
                form.set('stepNo', '2');
            if (change === 'duplicate')
                db.ediel_test_run_messages.push({ ...db.ediel_test_run_messages[0], step_no: null, id: reportingId(999) });
            if (change === 'missingLink')
                db.ediel_test_run_messages = [];
            const before = db.ediel_test_run_messages.length;
            await expect((action === 'create' ? createAndSendSystemTestOutboundForRunAction : sendSystemTestOutboundMessageAction)(form)).rejects.toThrow(/PRODAT_REPORTING_ASSOCIATION_INVALID/);
            expect(db.ediel_test_run_messages).toHaveLength(before);
            expect(io.send).not.toHaveBeenCalled();
        });
it('repeat active direct action does not duplicate a successful send or association', async () => { const message = await prepareRealDraft(), form = new FormData(); form.set('edielMessageId', message.id); await expect(sendSystemTestOutboundMessageAction(form)).rejects.toThrow(/ackStatus=sent/); await expect(sendSystemTestOutboundMessageAction(form)).rejects.toThrow(/oskickat/); expect(io.send).toHaveBeenCalledTimes(1); expect(db.ediel_test_run_messages).toHaveLength(1); });
it('stale form CAS cannot overwrite saved notes', async () => { const form = await saveFromActiveForm(), before = db.ediel_test_runs[0].notes; await expect(saveEdielTgtReportingPermissionAction(form)).rejects.toThrow(/CONCURRENT_UPDATE/); expect(db.ediel_test_runs[0].notes).toBe(before); });
it('active clear action leaves a tombstone and never creates or sends', async () => { await saveFromActiveForm(); const form = new FormData(); form.set('testRunId', reportingId(11)); form.set('stepNo', '1'); form.set('expectedRunUpdatedAt', String(db.ediel_test_runs[0].updated_at)); form.set('operation', 'clear'); form.set('sourceNote', 'Revoked synthetic scenario'); await saveEdielTgtReportingPermissionAction(form); expect(JSON.parse(String(db.ediel_test_runs[0].notes)).prodatReportingPermission.steps['1'].state).toBe('cleared'); expect(db.ediel_messages).toHaveLength(0); expect(io.send).not.toHaveBeenCalled(); });
it('actual post-autopilot route attachment is checked again before message insert', async () => { await saveFromActiveForm(); let routeReads = 0; io.from.mockImplementation((table: string) => { if (table === 'ediel_route_profiles' && ++routeReads === 2)
    db.ediel_route_profiles[0].mailbox = 'changed-during-route-attach'; return from(table); }); await expect(runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) })).resolves.toMatchObject({ action: 'blocked' }); expect(db.ediel_messages).toHaveLength(0); expect(io.send).not.toHaveBeenCalled(); });
import { loadTgtReportingSourceSelection, resolveTgtReportingBuildContext } from '@/lib/ediel/testing/tgtReportingPermissionContext';
for (const invalid of ['malformed', 'mismatchedCase', 'duplicate'] as const)
    it(`selected dynamic ${invalid} cannot fall back to built-in`, async () => { const p = reportingPrepared(), dynamic = { id: reportingId(90), test_suite: 'PRODAT', role_code: 'esco', test_case_code: '8.1.3', updated_at: '2026-09-19T12:00Z', raw_text: 'selected independent source', parsed_payload: invalid === 'malformed' ? null : { ...p.testData, testCaseCode: invalid === 'mismatchedCase' ? '8.1.2' : '8.1.3' } }; db.ediel_tgt_test_data = [dynamic, ...(invalid === 'duplicate' ? [{ ...dynamic, id: reportingId(91) }] : [])]; await expect(loadTgtReportingSourceSelection(p.run, 1)).rejects.toThrow(); });
it('server expected context is independent of serialized facts and returned snapshots', async () => { await saveFromActiveForm(); const run = db.ediel_test_runs[0] as unknown as ReturnType<typeof reportingPrepared>['run'], runtime = await io.runtime(); const build = await resolveTgtReportingBuildContext({ run, stepNo: 1, runtime }); const expected = JSON.stringify(build.context), stored = db.ediel_test_runs[0].notes; build.facts.reportingPermission!.objects[0].li = 'MUTATED'; expect(JSON.stringify(build.context)).toBe(expected); expect(db.ediel_test_runs[0].notes).toBe(stored); });
it('actual notes CAS rejects an update between read and write', async () => { await saveFromActiveForm(); const run = db.ediel_test_runs[0], form = new FormData(); form.set('testRunId', reportingId(11)); form.set('stepNo', '1'); form.set('expectedRunUpdatedAt', String(run.updated_at)); form.set('operation', 'clear'); form.set('sourceNote', 'Concurrent clear'); const previous = run.notes; io.from.mockImplementation((table: string) => { const q = from(table); if (table === 'ediel_test_runs') {
    const update = q.update;
    q.update = (value: Row) => { run.updated_at = '2026-09-20T00:00:00.000Z'; return update(value); };
} return q; }); await expect(saveEdielTgtReportingPermissionAction(form)).rejects.toThrow(/CONCURRENT_UPDATE/); expect(run.notes).toBe(previous); });
it('denied company permission stops the public save action before notes mutation', async () => { io.authorize.mockRejectedValueOnce(new Error('DENIED')); await expect(saveFromActiveForm()).rejects.toThrow('DENIED'); expect(db.ediel_test_runs[0].notes).toBeNull(); expect(db.ediel_messages).toHaveLength(0); });
import { createEdielTgtDraftAction } from '@/app/admin/ediel/actions.part-2';
it('authorized manual draft action uses the same saved source and separate send path', async () => { await saveFromActiveForm(); const form = new FormData(); for (const [k, v] of Object.entries({ testSuite: 'PRODAT', roleCode: 'esco', testCaseCode: '8.1.3', stepNo: '1', testRunId: reportingId(11), companyId: reportingId(10) }))
    form.set(k, v); await createEdielTgtDraftAction(form); expect(db.ediel_messages).toHaveLength(1); expect(db.ediel_test_run_messages).toHaveLength(1); expect(io.send).not.toHaveBeenCalled(); const send = new FormData(); send.set('edielMessageId', String(db.ediel_messages[0].id)); await expect(sendSystemTestOutboundMessageAction(send)).rejects.toThrow(/ackStatus=sent/); expect(io.send).toHaveBeenCalledTimes(1); });
it('company authorization precedes active reporting create/autopilot effects', async () => { await saveFromActiveForm(); io.authorize.mockRejectedValueOnce(new Error('DENIED')); const form = new FormData(); form.set('testRunId', reportingId(11)); form.set('testCaseCode', '8.1.3'); await expect(createAndSendSystemTestOutboundForRunAction(form)).rejects.toThrow('DENIED'); expect(db.ediel_messages).toHaveLength(0); expect(db.ediel_test_run_messages).toHaveLength(0); expect(io.send).not.toHaveBeenCalled(); });
for(const caseCode of ['8.1.1','8.1.2'])it(`original private ${caseCode} has explicit indefinite term and B71 in the actual chain`,async()=>{db.ediel_test_runs[0].test_case_code=caseCode;await saveFromActiveForm({'object.0.term':'indefinite','object.0.classification':'private','object.0.classificationRationale':'Original private test customer','object.0.purpose':'B71','object.0.purposeRationale':'Explicit synthetic consent assessment'});const form=new FormData();form.set('testRunId',reportingId(11));form.set('testCaseCode',caseCode);await expect(createAndSendSystemTestOutboundForRunAction(form)).rejects.toThrow(/ackStatus=sent/);expect(String(db.ediel_messages[0].raw_payload)).toContain("LIN+1'");expect(String(db.ediel_messages[0].raw_payload)).not.toContain('DTM+91:');expect(io.send).toHaveBeenCalledTimes(1)})
