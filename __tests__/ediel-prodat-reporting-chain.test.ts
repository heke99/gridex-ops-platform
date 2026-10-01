import {transportJournalFixture} from './fixtures/ediel-transport-journal';
import { beforeEach, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { reportingId, reportingNow, reportingPrepared } from './fixtures/prodat-reporting-permission';
import { createHash } from 'node:crypto';
import { encodeEdifactLatin1 } from '@/lib/ediel/core/edifactEncoding';
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
import { canonicalRegisteredEdielGuideScopes } from '@/lib/ediel/rulebook/canonicalEdielFacade';
const io = vi.hoisted(() => ({ from: vi.fn(), runtime: vi.fn(), send: vi.fn(), archive: vi.fn(), authorize: vi.fn(), operational: vi.fn(), company: vi.fn(),rpc:vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from,rpc:io.rpc } }));
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
type Row = Record<string, unknown>;let journal:ReturnType<typeof transportJournalFixture>;
let native: ReturnType<typeof reportingNativeBoundary>;
let db: Record<string, Row[]>, reads: Array<{
    table: string;
    filters: Array<[
        string,
        unknown
    ]>;
}>, seq: number;
/** Declared synthetic native boundary for these consumer regressions. The real
 * renderer, opaque fixture adapter, reporting/date/canonical validators and
 * tenant checks execute. This supplies no authentic original or native
 * acceptance evidence and cannot authorize production business effects. */
function reportingNativeBoundary() {
    const originals = new Map<string, { raw: string; qualification: Row }>();
    const prepared = new Map<string, { raw: string; qualification: Row; actor: string; consumed: boolean }>();
    const owners = new Map<string, { company: string; raw: string; fixtureWitness: string; consumed: boolean }>();
    const hash = (raw: string) => createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex');
    let registrationAvailable = true;
    const assertContext = (input: Row) => {
        const run = db.ediel_test_runs.find(r => r.id === input.runId && r.company_id === input.companyId);
        if (!run || input.companyId !== reportingId(10) || input.actorUserId !== reportingId(12) || input.stepNo !== 1 || run.status !== 'in_progress') throw Error('synthetic_positive_owner_scope');
        return run;
    };
    async function rpc(name: string, args: Row) {
        if (name === 'gridex_ediel_positive_fixture_read_v1') {
            if (!registrationAvailable) return { data: null, error: null };
            const input = args.p_context as Row, run = assertContext(input), raw = String(input.rawPayload);
            const wire = tokenizeEdifact(raw), unb = wire.segments.filter(s => s.tag === 'UNB');
            if (unb.length !== 1 || segmentComposite(unb[0], 11, wire.una)[0] !== '1') throw Error('synthetic_positive_test_only');
            const registrationId = reportingId(seq++), wireSha256 = hash(raw);
            const qualification = { kind: 'source_qualified_positive_fixture', version: 1, registrationId, companyId: input.companyId,
                runId: input.runId, roleCode: run.role_code, caseCode: run.test_case_code, suite: run.test_suite, revision: 'declared-synthetic-original-v1', stepNo: input.stepNo,
                wireSha256, originalFileSha256: wireSha256, expectedOutcome: 'positive', expectedDiagnosticCodes: [], testReceiverEdielId: segmentComposite(unb[0], 3, wire.una)[0],
                validUntil: '2026-12-01T00:00:00.000Z', sourceReference: 'declared consumer-test original boundary', ownerDecisionReference: 'synthetic publisher port only', authorizesBusinessEffect: false };
            originals.set(registrationId, { raw, qualification });
            return { data: qualification, error: null };
        }
        if (name === 'gridex_ediel_positive_fixture_prepare_v1') {
            const input = args.p_context as Row; assertContext(input);
            const original = originals.get(String(input.registrationId));
            if (!original || original.raw !== input.rawPayload) throw Error('synthetic_positive_original_required');
            const witnessId = reportingId(seq++);
            prepared.set(witnessId, { ...original, actor: String(input.actorUserId), consumed: false });
            return { data: { witnessId, qualification: original.qualification }, error: null };
        }
        if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
            const policy = resolveCanonicalEdielPolicy({ family: String(args.p_family), messageCode: String(args.p_message_code), subtypeOrReasonCode: String(args.p_transaction_subtype), direction: args.p_direction as 'outbound', referenceDate: String(args.p_business_date), mode: 'catalog_evidence' });
            const guide = canonicalRegisteredEdielGuideScopes().find(g => g.family === policy.family && g.canonicalGuideRevision === policy.guide.guideRevision);
            if (!guide) throw Error('synthetic_original_named_guide_required');
            const profileKey = `${policy.family}:${policy.code}:${policy.subtype}:${guide.guideVersion}:r${guide.guideRevision}`;
            const profile = { family: policy.family, messageCode: policy.code, guideVersion: guide.guideVersion, guideRevision: guide.guideRevision, canonicalDirection: policy.direction, transactionSubtype: policy.subtype, reasonForTransaction: policy.transactionReasonCode };
            const row = { rule_pack_id: reportingId(70), message_profile_id: reportingId(71), market: 'electricity', family: policy.family, guide_version: guide.guideVersion, guide_revision: guide.guideRevision,
                unh_association_code: policy.associationAssignedCode, valid_from: policy.guide.effectiveFrom, valid_to: policy.guide.effectiveTo, source_document: 'Declared synthetic named-registry boundary', source_hash: 'a'.repeat(64), field_matrix_version: null,
                profile_key: profileKey, business_process: policy.processGroup, phase: policy.phase, profile, parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true };
            return { data: [{ ...row, original_version: `${guide.guideVersion}:r${guide.guideRevision}`, original_snapshot: { rulePack: { id: row.rule_pack_id, source_hash: row.source_hash, guide_version: row.guide_version, guide_revision: row.guide_revision },
                messageProfile: { id: row.message_profile_id, rule_pack_id: row.rule_pack_id, profile_key: profileKey, profile }, guideSources: [] } }], error: null };
        }
        if (name === 'ediel_prepare_outbound_owner_witness_v1') {
            const input = args.p_input as Row, fixtureWitness = String(input.sourceQualifiedPositiveFixtureWitnessId), fixture = prepared.get(fixtureWitness);
            if (!fixture || fixture.consumed || fixture.raw !== input.rawPayload || fixture.actor !== input.actorUserId || fixture.qualification.companyId !== input.companyId || input.environment !== 'test') throw Error('synthetic_same_positive_token_required');
            const witnessId = reportingId(seq++);
            owners.set(witnessId, { company: String(input.companyId), raw: String(input.rawPayload), fixtureWitness, consumed: false });
            return { data: { version: 1, witnessId, evidence: input.rulePackEvidence }, error: null };
        }
        if (name === 'ediel_capture_source_rule_pack_basis_v1') {
            const message = db.ediel_messages.find(m => m.id === args.p_message_id && m.company_id === args.p_company_id);
            if (!message) throw Error('synthetic_owned_saved_original_required');
            return { data: { rulePackId: message.canonical_rule_pack_id, messageProfileId: message.rule_profile_version_id, profileKey: message.rule_profile_key,
                version: message.rule_profile_version, sourceHash: message.rule_pack_checksum, snapshot: message.rule_pack_snapshot }, error: null };
        }
        if (name === 'gridex_ediel_repair_accepted_transport_projection_v1') {
            const result = await journal.rpc(name, args);
            if (result.data) {
                const projection = result.data as Row;
                const message = db.ediel_messages.find(m => m.id === args.p_message_id && m.company_id === args.p_company_id && m.environment === args.p_environment);
                if (!message || createHash('sha256').update(String(message.raw_payload), 'utf8').digest('hex') !== projection.originalHash) throw Error('synthetic_frozen_projection_scope');
                if (!['acknowledged', 'delivered'].includes(String(message.status))) message.status = 'sent';
                message.message_sent_at ??= projection.observedAt;
            }
            return result;
        }
        if (name === 'ediel_project_accepted_source_state_v1') {
            const { data } = await journal.rpc('gridex_ediel_accepted_transport_projection_v1', args);
            const projection = data as Row | null;
            if (!projection || projection.originalHash !== args.p_expected_original_hash) throw Error('synthetic_source_projection_requires_private_acceptance');
            return { data: { status: 'source_projection', companyId: projection.companyId, environment: projection.environment, messageId: projection.messageId,
                originalHash: projection.originalHash, observedAt: projection.observedAt, authorizesProviderEntry: false }, error: null };
        }
        if (name === 'ediel_prodat_recovery_original_basis_v1') return { data: null, error: null };
        return journal.rpc(name, args);
    }
    function consume(message: Row) {
        const snapshot = message.execution_context_snapshot as Row, witness = owners.get(String(snapshot?.outboundOwnerWitnessId));
        const fixture = witness ? prepared.get(witness.fixtureWitness) : null;
        if (!witness || !fixture || witness.consumed || fixture.consumed || message.company_id !== witness.company || message.raw_payload !== witness.raw
            || snapshot.sourceQualifiedPositiveFixtureWitnessId !== witness.fixtureWitness) throw Error('synthetic_one_use_original_insert_required');
        witness.consumed = fixture.consumed = true;
    }
    return { rpc, consume, disableRegistration: () => { registrationAvailable = false; } };
}
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
            if (table === 'ediel_messages') values.forEach(native.consume);
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
beforeEach(() => { vi.clearAllMocks();journal=transportJournalFixture();native=reportingNativeBoundary();io.rpc.mockImplementation(native.rpc); vi.spyOn(Date, 'now').mockReturnValue(reportingNow); seq = 100; reads = []; const p = reportingPrepared(); db = { ediel_test_runs: [{ ...p.run, notes: null, status: 'in_progress', started_at: '2026-09-01T00:00:00.000Z', encryption_mode: 'none' }], ediel_messages: [], ediel_test_run_messages: [],user_profiles:[{id:reportingId(12),user_status:'active'}],company_memberships:[{company_id:reportingId(10),user_id:reportingId(12),status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}] }; io.from.mockImplementation(from); p.runtime.settings!.routeProfileId = reportingId(80); db.ediel_test_runs[0].route_profile_id = reportingId(80); db.ediel_route_profiles = [{ id: reportingId(80), company_id: reportingId(10), environment: 'test', is_enabled: true, is_active: true, communication_route_id: reportingId(81), transport_security_mode: 'unencrypted', encryption_mode: 'none', mailbox: 'tgt-file-engine' }]; io.runtime.mockResolvedValue(p.runtime); io.send.mockImplementation(async(input,entry)=>{await journal.beforeProvider(input,entry);return{ accepted: ['portal@example.invalid'], rejected: [], messageId: 'synthetic-provider-id' };}); io.archive.mockResolvedValue(undefined); });
it('a reporting assessment cannot replace a missing source-qualified positive original', async () => {
    await saveFromActiveForm(); native.disableRegistration();
    await expect(runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) })).rejects.toThrow('ediel_positive_fixture_original_required');
    expect(db.ediel_messages).toHaveLength(0); expect(db.ediel_test_run_messages).toHaveLength(0);
    expect(io.archive).not.toHaveBeenCalled(); expect(io.send).not.toHaveBeenCalled();
});
it('the actual opaque adapter rejects a private-original response for different bytes before insert', async () => {
    await saveFromActiveForm();
    io.rpc.mockImplementation(async (name: string, args: Row) => {
        const result = await native.rpc(name, args);
        return name === 'gridex_ediel_positive_fixture_read_v1' && result.data && typeof result.data === 'object'
            ? { ...result, data: { ...result.data, wireSha256: 'b'.repeat(64) } } : result;
    });
    await expect(runTgtAutopilotForRun({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) })).rejects.toThrow('ediel_positive_fixture_authority_scope_invalid');
    expect(db.ediel_messages).toHaveLength(0); expect(db.ediel_test_run_messages).toHaveLength(0);
    expect(io.archive).not.toHaveBeenCalled(); expect(io.send).not.toHaveBeenCalled();
});
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

function formText(node: ReactNode): string { if (Array.isArray(node)) return node.map(formText).join(' '); if (typeof node === 'string' || typeof node === 'number') return String(node); return node && typeof node === 'object' && 'props' in node ? formText((node as ReactElement<{children?:ReactNode}>).props.children) : ''; }
async function currentForm() { return EdielReportingPermissionForm({run:db.ediel_test_runs[0] as unknown as ReturnType<typeof reportingPrepared>['run']}); }
function formDefaults(tree: ReactNode) {
 const form=elements(tree).find(e=>e.type==='form')!, data=new FormData();
 for(const e of elements(form)) if(typeof e.props.name==='string') data.set(e.props.name,String(e.props.value??e.props.defaultValue??''));
 return {form,data};
}
it('active form reviews saved revision, anchor and assessments; note-only edit preserves facts',async()=>{
 await saveFromActiveForm();
 const before=JSON.parse(String(db.ediel_test_runs[0].notes)).prodatReportingPermission.steps['1'];
 const tree=await currentForm(), text=formText(tree),{form,data}=formDefaults(tree);
 expect(text).toContain(before.factsRevision);
 expect(text).toContain('202608010000');
 expect(text).toContain(new Date(before.objects[0].resolutionAnchorUtcMs).toISOString());
 expect(data.get('object.0.term')).toBe('bounded_source');expect(data.get('object.0.minuteOfDay')).toBe('00:00');
 expect(data.get('object.0.classification')).toBe('nonprivate');expect(data.get('object.0.purpose')).toBe('B72');
 expect(data.get('sourceNote')).toBe(before.sourceNote);
 data.set('sourceNote','Only the review note changed');await (form.props.action as (f:FormData)=>Promise<void>)(data);
 const after=JSON.parse(String(db.ediel_test_runs[0].notes)).prodatReportingPermission.steps['1'];
 expect(after.objects.map((o:{assertion:unknown})=>o.assertion)).toEqual(before.objects.map((o:{assertion:unknown})=>o.assertion));
 expect(after.objects[0].resolutionAnchorUtcMs).toBe(before.objects[0].resolutionAnchorUtcMs);
 expect(after.objects[0].object.requestKey).toBe(before.objects[0].object.requestKey);expect(after.factsRevision).not.toBe(before.factsRevision);
 expect(db.ediel_messages).toHaveLength(0);expect(db.ediel_test_run_messages).toHaveLength(0);expect(io.send).not.toHaveBeenCalled();
});
it('active form distinguishes missing and cleared revisions without repopulating revoked facts',async()=>{
 expect(formText(await currentForm())).toContain('Inget sparat rapporteringsunderlag');await saveFromActiveForm();
 const tree=await currentForm(),clear=elements(tree).filter(e=>e.type==='form')[1],data=new FormData();
 for(const e of elements(clear))if(typeof e.props.name==='string')data.set(e.props.name,String(e.props.value??''));
 data.set('sourceNote','Assessment withdrawn');await (clear.props.action as (f:FormData)=>Promise<void>)(data);
 const cleared=JSON.parse(String(db.ediel_test_runs[0].notes)).prodatReportingPermission.steps['1'],current=await currentForm();
 expect(formText(current)).toContain('Underlaget är rensat');expect(formText(current)).toContain(cleared.factsRevision);expect(formText(current)).toContain('Assessment withdrawn');
 expect(formDefaults(current).data.get('object.0.term')).toBe('unknown');expect(formDefaults(current).data.get('sourceNote')).toBe('');
 expect(db.ediel_messages).toHaveLength(0);expect(io.send).not.toHaveBeenCalled();
});
for(const change of ['source','route','invalid'] as const)it(`active form marks ${change} notes unusable without displaying stale saved declarations`,async()=>{
 await saveFromActiveForm();const revision=JSON.parse(String(db.ediel_test_runs[0].notes)).prodatReportingPermission.steps['1'].factsRevision;
 if(change==='source')db.ediel_tgt_test_data=[{id:reportingId(90),test_suite:'PRODAT',role_code:'esco',test_case_code:'8.1.3',updated_at:'2026-09-19',raw_text:'changed',parsed_payload:reportingPrepared().testData}];
 if(change==='route')db.ediel_route_profiles[0].mailbox='changed';
 if(change==='invalid')db.ediel_test_runs[0].notes='{invalid';
 const tree=await currentForm(),{data}=formDefaults(tree);
 expect(formText(tree)).toContain('Underlaget kan inte användas');expect(formText(tree)).not.toContain(revision);
 expect(data.get('object.0.term')).toBe('unknown');expect(data.get('object.0.classification')).toBe('unknown');expect(data.get('object.0.purpose')).toBe('unknown');expect(data.get('sourceNote')).toBe('');
 expect(db.ediel_messages).toHaveLength(0);expect(io.send).not.toHaveBeenCalled();
});

it('prescribed LI and ANJ service characters survive active notes, actual builder and shared SMTP guards',async()=>{
 const data=structuredClone(reportingPrepared().testData);
 for(const [field,value]of [['226',"REQ+ONE:TWO?THREE'UNT+1"],['261',"AUTH:ONE+TWO?THREE'UNT+1"]])data.groups[0].fields.find(f=>f.fieldCode===field)!.values['Testdata - Z13VH']=value;
 db.ediel_tgt_test_data=[{id:reportingId(90),test_suite:'PRODAT',role_code:'esco',test_case_code:'8.1.3',updated_at:'2026-09-19T11:00:00Z',raw_text:'Independent prescribed synthetic references',parsed_payload:data}];
 await saveFromActiveForm();const form=new FormData();form.set('testRunId',reportingId(11));form.set('testCaseCode','8.1.3');
 await expect(createAndSendSystemTestOutboundForRunAction(form)).rejects.toThrow(/ackStatus=sent/);
 expect(io.send).toHaveBeenCalledTimes(1);expect(db.ediel_test_run_messages).toHaveLength(1);
});
