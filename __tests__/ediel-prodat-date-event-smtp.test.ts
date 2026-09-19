import { beforeEach, it, expect, vi } from 'vitest';
import { tgtDateRun, tgtDateData, tgtDateRuntime } from './fixtures/tgt-date-events';
import { resolveTgtDateEventRoute, resolveTgtDateEventBuildContext } from '@/lib/ediel/testing/tgtDateEventContext';
import { buildTgtRegisterFactNotes } from '@/lib/ediel/testing/tgtRegisterFacts';
import { buildEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4';
import { dateEventDraftRow } from '@/lib/ediel/testing/tgtDateEventSource';
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
import type { EdielMessageRow } from '@/lib/ediel/types';
const io = vi.hoisted(() => ({ from: vi.fn(), runtime: vi.fn(), imported: vi.fn(), send: vi.fn(), archive: vi.fn(), event: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }));
vi.mock('@/lib/ediel/systemTestSettings', () => ({ requireEdielSystemTestRuntimeContext: io.runtime }));
vi.mock('@/lib/ediel/testing/tgtTestDataStore', () => ({ getEdielTgtDynamicTestDataForCase: io.imported }));
vi.mock('@/lib/ediel/db', () => ({ getEdielRouteProfileByCommunicationRouteId: vi.fn().mockResolvedValue(null), createEdielMessageEvent: io.event, updateEdielMessageStatus: io.status }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: () => ({ from: 'sender@example.invalid', provider: 'synthetic' }) }));
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.send }));
vi.mock('@/lib/ediel/transport/index.part-1', async (original) => ({ ...await original<typeof import('@/lib/ediel/transport/index.part-1')>(), storeTransportPayloadSnapshot: io.archive }));
let records: Record<string, unknown>;
beforeEach(() => { vi.clearAllMocks(); records = {}; io.event.mockResolvedValue(undefined); io.status.mockResolvedValue(undefined); io.archive.mockResolvedValue(undefined); io.send.mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [], messageId: 'synthetic-provider-id' }); io.from.mockImplementation((table: string) => { const q = { select: () => q, eq: () => q, update: () => q, maybeSingle: async () => ({ data: records[table], error: null }), limit: async () => ({ data: records[table], error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }; return q; }); });
async function prepared() {
    const run = tgtDateRun(), runtime = tgtDateRuntime(), testData = tgtDateData();
    run.route_profile_id = null;
    runtime.settings!.routeProfileId = null;
    runtime.testPortalEmail = 'recipient@example.invalid';
    const route = await resolveTgtDateEventRoute(run, 'Z09', runtime);
    run.notes = buildTgtRegisterFactNotes({ run, stepNo: 1, code: 'Z09', testData, dateEventRoute: route, actorId: 'ACTOR', sourceNote: 'Independent signing', facts: { market: 'electricity', dateEventObjects: [{ meteringPointId: 'A', identityAgency: '9', kind: 'production_contract', direction: 'production', contract: { reference: 'contract', revision: '1' }, event: { kind: 'signed', reference: 'event', revision: '1' }, supplyBoundaryAt: '202610010000' }] } });
    const build = await resolveTgtDateEventBuildContext({ run, stepNo: 1, code: 'Z09', runtime, testData });
    const draft = buildEdielTgtDraft({ actorUserId: 'ACTOR', testRunId: run.id, testSuite: run.test_suite, roleCode: run.role_code, testCaseCode: run.test_case_code, stepNo: 1, systemTestContext: runtime, importedTestData: testData, registerFacts: build.facts, dateEventContext: build.context });
    records.ediel_test_runs = run;
    records.ediel_test_run_messages = [{ test_run_id: 'RUN', step_no: 1, expected_family: 'PRODAT', expected_code: 'Z09', expected_direction: 'outbound' }];
    io.runtime.mockResolvedValue(runtime);
    io.imported.mockResolvedValue(testData);
    const row: Partial<EdielMessageRow> = { ...dateEventDraftRow(draft.messageInput), id: 'MSG', message_family: 'PRODAT', message_version: '26A', message_standard: 'edifact', mime_type: 'application/EDIFACT', raw_payload: draft.rawPayload, file_name: 'synthetic.edi', parsed_payload: { ...draft.messageInput.parsedPayload, rulebookAllowInvalidSend: true } };
    return row as EdielMessageRow;
}
it('actual SMTP reloads independent test context and reaches mocked provider once', async () => { const row = await prepared(); await expect(sendEdielMessageViaSmtp(row, { actorUserId: 'ACTOR', smtpMimeMode: 'nodemailer-attachment' })).resolves.toMatchObject({ messageId: 'synthetic-provider-id' }); expect(io.send).toHaveBeenCalledTimes(1); });
for (const change of ['source', 'route', 'environment', 'missingLink'])
    it(`SMTP rejects ${change} before archive or provider`, async () => { const row = await prepared(); if (change === 'source')
        records.ediel_test_runs = { ...(records.ediel_test_runs as object), notes: null }; if (change === 'route')
        row.receiver_ediel_id = 'OTHER'; if (change === 'environment')
        row.environment = 'production'; if (change === 'missingLink')
        records.ediel_test_run_messages = []; await expect(sendEdielMessageViaSmtp(row, { actorUserId: 'ACTOR' })).rejects.toThrow(); expect(io.send).not.toHaveBeenCalled(); expect(io.archive).not.toHaveBeenCalled(); });
