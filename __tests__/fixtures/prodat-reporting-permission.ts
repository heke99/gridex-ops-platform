/** Fixed independent synthetic request, never inferred from rendered output. */
export const reportingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const reportingNow = Date.parse('2026-09-19T11:00:59.999Z');
export function reportingObject() {
    const requestKey = reportingId(1), revision = reportingId(2);
    const ref = (kind: 'process' | 'authorization' | 'declaration' | 'classification' | 'assessment', n: number) => ({ kind, key: reportingId(n), revision, requestKey });
    return { objectKey: requestKey, requestKey, selector: { workbook: 'original.xlsx', sheet: 'ESCO', entityLabel: 'Synthetic business', columnName: 'Z13V', columnIndex: 2 },
        code: 'Z13' as const, process: ref('process', 1), authorization: ref('authorization', 3), li: 'L00000000000040008000000000000001', anj: 'A00000000000040008000000000000003',
        customer: { id: 'SYNTHETIC-CUSTOMER', qualifier: 'SE1', agency: '260' }, legalRequester: { id: '12345', qualifier: '160', agency: 'SVK' }, expectedReason: 'S17' as const,
        installation: null, requestAssociation: null, term: { kind: 'bounded' as const, endMinute: '202609191200', declaration: ref('declaration', 4) },
        classification: { kind: 'nonprivate' as const, record: ref('classification', 5) }, purpose: { kind: 'assessed' as const, code: 'B72' as const, assessment: ref('assessment', 6), legalActor: { id: '12345', qualifier: '160', agency: 'SVK' }, customer: { id: 'SYNTHETIC-CUSTOMER', qualifier: 'SE1', agency: '260' } } };
}
export const reportingSelection = () => ({ source: { kind: 'caller_selection' as const, reference: 'independent synthetic request' }, objects: [reportingObject()], evaluationUtcMs: reportingNow });
export function reportingSegments(reason = 'S17', end = '202609191200', purpose = 'B72') {
    return ['UNH+M+PRODAT:D:97A:UN:E2SE6A', 'BGM+Z13+DOC+9+AB', 'NAD+FR+12345:160:SVK', 'NAD+DO+54321:160:SVK', 'LIN+1', ...(end ? [`DTM+91:${end}:203`] : []), 'CCI++Z13', `CAV+${reason}`, ...(purpose ? ['CCI++Z24', `CAV+${purpose}`] : []), 'RFF+LI:L00000000000040008000000000000001', 'RFF+ANJ:A00000000000040008000000000000003', 'NAD+UD+SYNTHETIC-CUSTOMER:SE1:260'];
}
export function reportingSource() { return { kind: 'tgt' as const, scope: { companyId: reportingId(10), runId: reportingId(11), roleCode: 'esco' as const, caseCode: '8.1.3' as const, suite: 'PRODAT' as const, stepNo: 1, code: 'Z13' as const, actor: 'gridex' as const, direction: 'outbound' as const, environment: 'test' as const, runtimeSuite: 'TGT' as const }, source: { kind: 'builtin' as const, id: 'PRODAT/esco/8.1.3', revision: 'reporting-source-v1', digest: 'a'.repeat(64) }, factsRevision: reportingId(2), actorId: reportingId(12), sourceNote: 'independent synthetic test assessment', route: { settingsId: reportingId(13), actorSettingId: reportingId(14), routeProfileId: null, communicationRouteId: null, transportProfileId: null, legalSender: { id: '12345', qualifier: '160', agency: 'SVK' }, legalRecipient: { id: '54321', qualifier: '160', agency: 'SVK' }, senderId: '12345', receiverId: '54321', senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress: null, receiverSubaddress: null, applicationReference: '23-DGI-PRODAT', transportType: 'manual_upload' as const, mailbox: 'tgt-file-engine', receiverEmail: 'portal@example.invalid' } }; }
import { tgtDateRuntime, tgtDateRun } from './tgt-date-events';
import { prodatEscoPermissionData } from '@/lib/ediel/testing/tgtTestData.part-3';
import { prepareTgtReportingNotes, readTgtReportingEntry } from '@/lib/ediel/testing/tgtReportingPermissionNotes';
export function reportingPrepared() {
    const source = reportingSource(), runtime = tgtDateRuntime(), run = { ...tgtDateRun(), id: source.scope.runId, company_id: source.scope.companyId, role_code: 'esco' as const, test_case_code: '8.1.3', notes: null as string | null, route_profile_id: null, updated_at: '2026-09-01T00:00:00.000Z' };
    runtime.companyId = run.company_id;
    runtime.actorSettingId = source.route.actorSettingId;
    runtime.defaultReceiverSubaddress = null;
    runtime.testPortalEmail = source.route.receiverEmail;
    runtime.settings = { ...runtime.settings!, id: source.route.settingsId, companyId: run.company_id, routeProfileId: null, actorRole: 'esco', applicationReference: source.route.applicationReference, defaultReceiverSubaddress: null };
    const testData = prodatEscoPermissionData('8.1.3'), selection = { identity: source.source, data: testData };
    const selector = { workbook: 'TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx', sheet: 'Testkund 70 - 76 - ESCO', entityLabel: 'Testkund 73', columnName: 'Testdata - Z13VH', columnIndex: 2 };
    const command = { operation: 'save', resolution: 'retain', sourceNote: 'Original business synthetic test assessment', objects: [{ selector, term: { kind: 'bounded_source', minuteOfDay: '0000' }, classification: 'nonprivate', classificationRationale: 'Original business scenario', purpose: { kind: 'assessed', code: 'B72', rationale: 'Original8.1.3 contract purpose' } }] };
    let n = 30;
    run.notes = prepareTgtReportingNotes({ run, stepNo: 1, actorId: source.actorId, source: selection, route: source.route, clock: { nowUtcMs: () => reportingNow }, newId: () => reportingId(n++), command });
    const entry = readTgtReportingEntry({ run, stepNo: 1, source: selection, route: source.route })!;
    source.factsRevision = entry.factsRevision;
    source.sourceNote = entry.sourceNote;
    const evidence = { source, objects: entry.objects.map(o => o.object) }, context = { ...structuredClone(evidence), evaluationUtcMs: reportingNow };
    return { run, runtime, testData, command, evidence, context };
}
import type { ReportingObject, PureSelection } from '@/lib/ediel/prodat/prodatReportingPermissionTypes';
/** Fixed request preceding a synthetic Z14 response; no response-derived facts. */
export function reportingZ14Selection(reason: 'S17' | 'S18' = 'S17', agency: '9' | '89' = '9'): PureSelection {
    const b = reportingObject(), declaration = { ...b.term.declaration }, purpose = { kind: 'absent' as const, declaration };
    const object: ReportingObject = { ...b, code: 'Z14', objectKey: reportingId(7), li: 'CASE', customer: { id: 'ID', qualifier: '', agency: '89' }, expectedReason: reason, term: { kind: 'indefinite', declaration }, purpose, installation: { id: 'A', agency }, requestAssociation: { kind: 'known', origin: { kind: 'pure_fixture', reference: 'Independent nonprivate original request' }, requestKey: b.requestKey, requestRevision: b.process.revision, li: 'CASE', anj: b.anj, customer: { id: 'ID', qualifier: '', agency: '89' }, legalRequester: b.legalRequester, process: { ...b.process }, authorization: { ...b.authorization }, reason, purpose: { kind: 'absent' }, allowedInstallations: [{ id: 'A', agency }] } };
    return { source: { kind: 'caller_selection', reference: 'Fixed independent response fixture' }, objects: [object], evaluationUtcMs: reportingNow };
}
