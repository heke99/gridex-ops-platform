import { tenantDb } from '@/lib/supabase/tenantDb';
import { requireEdielSystemTestRuntimeContext, type EdielSystemTestRuntimeContext } from '@/lib/ediel/systemTestSettings';
import { isAgtSystemTestCase } from '@/lib/ediel/systemTestPackages';
import { resolveEdielTgtProdatApplicationReference } from '@/lib/ediel/fileEngine';
import { getEdielTgtTestCaseByCode } from './tgtRegistry';
import { getEdielTgtTestDataForCase, type EdielTgtCaseTestData } from './tgtTestData';
import { getEdielTgtDynamicTestDataForCase } from './tgtTestDataStore';
import { readTgtRegisterFacts, tgtHasDateEventFacts } from './tgtRegisterFacts';
import { copyProdatDateEventObjects, copyProdatDateEventSource, copyProdatDateEventRoute, type ProdatDateEventRoute } from '@/lib/ediel/prodat/prodatDateEvents';
import type { TgtDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority';
import type { EdielTestRunRow, EdielMessageRow, EdielRouteProfileRow, EdielTestRunMessageRow } from '@/lib/ediel/types';
// tenantDb has an intentionally unknown query return; describe only this read surface.
type ScopedSelect<T> = {
    eq(column: string, value: unknown): ScopedSelect<T>;
    maybeSingle(): PromiseLike<{data: T | null; error: unknown}>;
    limit(count: number): PromiseLike<{data: T[] | null; error: unknown}>;
};
type RunLink = Pick<EdielTestRunMessageRow, 'test_run_id' | 'step_no' | 'expected_family' | 'expected_code' | 'expected_direction'>;
const invalid = (): never => { throw new Error('PRODAT_DATE_EVENT_SOURCE_CONTEXT_INVALID'); };
const upper = (v: string | null) => v?.trim().toUpperCase() || null;
export function dateEventRuntimeSuite(run: EdielTestRunRow): 'AGT' | 'TGT' { return isAgtSystemTestCase({ runtimeTestSuite: String((run as EdielTestRunRow & {
        environment_type?: string;
    }).environment_type ?? '').toLowerCase().includes('agt') ? 'AGT' : null, testCaseCode: run.test_case_code, roleCode: run.role_code, suite: run.test_suite }) ? 'AGT' : 'TGT'; }
/** Only server-loaded run/runtime records enter here. Revalidated each operation. */
export async function resolveTgtDateEventRoute(run: EdielTestRunRow, code: string, runtime: EdielSystemTestRuntimeContext): Promise<ProdatDateEventRoute> {
    const settings = runtime.settings;
    if (runtime.companyId !== run.company_id || runtime.testSuite !== dateEventRuntimeSuite(run) || !settings?.id || settings.companyId !== run.company_id || settings.environment !== 'test' || !settings.isActive || !runtime.actorSettingId)
        return invalid();
    const selected = run.route_profile_id ?? settings.routeProfileId ?? null;
    if (run.route_profile_id && settings.routeProfileId && run.route_profile_id !== settings.routeProfileId)
        return invalid();
    let communicationRouteId: string | null = null, mailbox = 'tgt-file-engine';
    const senderId = upper(runtime.actorEdielId), receiverId = upper(runtime.testPortalEdielId), senderSubaddress = upper(runtime.senderSubaddress), receiverSubaddress = upper(runtime.defaultReceiverSubaddress);
    const applicationReference = resolveEdielTgtProdatApplicationReference({ roleCode: run.role_code, testCaseCode: run.test_case_code, messageCode: code });
    if (settings.applicationReference && settings.applicationReference !== applicationReference)
        return invalid();
    if (selected) {
        const { data, error } = await (tenantDb(run.company_id).from('ediel_route_profiles').select('*') as ScopedSelect<EdielRouteProfileRow>).eq('id', selected).maybeSingle();
        if (error)
            throw error;
        if (!data || data.company_id !== run.company_id || data.environment !== 'test' || data.is_enabled !== true || data.is_active === false)
            return invalid();
        for (const [value, want] of [[data.sender_ediel_id, senderId], [data.receiver_ediel_id, receiverId], [data.sender_sub_address, senderSubaddress], [data.receiver_sub_address, receiverSubaddress], [data.application_reference, applicationReference]] as const)
            if (value != null && value !== want)
                return invalid();
        communicationRouteId = data.communication_route_id || null;
        mailbox = data.mailbox || mailbox;
    }
    return copyProdatDateEventRoute({ settingsId: settings.id, actorSettingId: runtime.actorSettingId, routeProfileId: selected, communicationRouteId, transportProfileId: settings.transportProfileId, legalSender: { id: senderId, qualifier: '160', agency: 'SVK' }, legalRecipient: { id: receiverId, qualifier: '160', agency: 'SVK' }, senderId, receiverId, senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress, receiverSubaddress, transportType: 'manual_upload', mailbox, receiverEmail: runtime.testPortalEmail?.trim() || null, applicationReference, suppliers: [] });
}
export async function resolveTgtDateEventBuildContext(input: {
    run: EdielTestRunRow;
    stepNo: number;
    code: string;
    runtime: EdielSystemTestRuntimeContext;
    testData: EdielTgtCaseTestData | null | undefined;
}) {
    if (!tgtHasDateEventFacts(input.run, input.stepNo))
        return { facts: readTgtRegisterFacts(input), context: undefined };
    const dateEventRoute = await resolveTgtDateEventRoute(input.run, input.code, input.runtime);
    const facts = readTgtRegisterFacts({ ...input, dateEventRoute });
    let context: TgtDateEventValidationContext | undefined;
    if (facts?.dateEventSource?.kind === 'tgt') {
        const source = copyProdatDateEventSource(facts.dateEventSource);
        if (source.kind !== 'tgt') return invalid();
        context = { source, objects: copyProdatDateEventObjects(facts.dateEventObjects ?? []) };
    }
    return { facts, context };
}
/** The association is loaded independently of payload/evidence, with tenant filters. */
export async function loadTgtDateEventValidationContext(message: EdielMessageRow): Promise<TgtDateEventValidationContext | undefined> {
    if (message.environment !== 'test' || message.direction !== 'outbound' || message.message_family !== 'PRODAT' || !['Z06', 'Z09', 'Z10'].includes(message.message_code))
        return undefined;
    const { data: links, error: linkError } = await (tenantDb(message.company_id).from('ediel_test_run_messages').select('test_run_id,step_no,expected_family,expected_code,expected_direction') as ScopedSelect<RunLink>).eq('ediel_message_id', message.id).limit(2);
    if (linkError)
        throw linkError;
    if (!links?.length)
        return undefined;
    if (links.length !== 1)
        return invalid();
    const link = links[0];
    if (link.expected_family !== 'PRODAT' || link.expected_code !== message.message_code || link.expected_direction !== 'outbound' || !link.step_no)
        return invalid();
    const { data: run, error } = await (tenantDb(message.company_id).from('ediel_test_runs').select('*') as ScopedSelect<EdielTestRunRow>).eq('id', link.test_run_id).maybeSingle();
    if (error)
        throw error;
    if (!run || run.company_id !== message.company_id)
        return invalid();
    const typedRun = run as EdielTestRunRow, step = getEdielTgtTestCaseByCode(typedRun.test_suite, typedRun.role_code, typedRun.test_case_code)?.expectedSteps.find(s => s.stepNo === link.step_no);
    if (!step || step.actor !== 'gridex' || step.direction !== 'outbound' || step.family !== 'PRODAT' || step.code !== message.message_code)
        return invalid();
    const runtime = await requireEdielSystemTestRuntimeContext({ companyId: message.company_id, testSuite: dateEventRuntimeSuite(typedRun), actorRole: typedRun.role_code, messageFamily: 'PRODAT' });
    const testData = await getEdielTgtDynamicTestDataForCase(typedRun.test_suite, typedRun.role_code, typedRun.test_case_code) ?? getEdielTgtTestDataForCase(typedRun.test_suite, typedRun.role_code, typedRun.test_case_code);
    return (await resolveTgtDateEventBuildContext({ run: typedRun, stepNo: link.step_no, code: step.code, runtime, testData })).context;
}
