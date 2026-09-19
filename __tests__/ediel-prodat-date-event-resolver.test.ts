import { beforeEach, it, expect, vi } from 'vitest';
import { resolveTgtDateEventRoute, loadTgtDateEventValidationContext } from '@/lib/ediel/testing/tgtDateEventContext';
import { buildTgtRegisterFactNotes } from '@/lib/ediel/testing/tgtRegisterFacts';
import type { EdielSystemTestRuntimeContext, EdielSystemTestSettings } from '@/lib/ediel/systemTestSettings';
import type { EdielTestRunRow, EdielMessageRow } from '@/lib/ediel/types';
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData';
const io = vi.hoisted(() => ({ from: vi.fn(), runtime: vi.fn(), imported: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }));
vi.mock('@/lib/ediel/systemTestSettings', () => ({ requireEdielSystemTestRuntimeContext: io.runtime }));
vi.mock('@/lib/ediel/testing/tgtTestDataStore', () => ({ getEdielTgtDynamicTestDataForCase: io.imported }));
let records: Record<string, unknown>, filters: Record<string, unknown>[];
const run = () => ({ id: 'RUN', company_id: 'tenant', role_code: 'supplier', test_case_code: '2.5.3', test_suite: 'PRODAT', notes: null, route_profile_id: 'ROUTE' } as EdielTestRunRow);
const data = (): EdielTgtCaseTestData => {
    const columns = [{ name: 'Z09D', index: 0, sourceOrder: 0, testCase: '2.5.3' }];
    const fields = Object.entries({ '209': 'A', '223': 'Z70', '210': '202610010000', '260': 'TES', '262': '11111' }).map(([fieldCode, value]) => ({ fieldCode, fieldName: fieldCode, values: { Z09D: value } }));
    return { suite: 'PRODAT', roleCode: 'supplier', testCaseCode: '2.5.3', title: 'Synthetic', sourceNote: 'Synthetic', groups: [{ columns, fields, block: { kind: 'PRODAT', sourceWorkbook: 'synthetic', sourceSheet: 'synthetic', entityLabel: 'A', entityNumbers: ['1'], columns, fields } }] };
};
const runtime = (): EdielSystemTestRuntimeContext => ({ companyId: 'tenant', testSuite: 'TGT', actorSettingId: 'ACTORSETTING', actorEdielId: '12345', actorName: null, senderSubaddress: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: 'PRODAT', testBrpEdielId: null, testBrpName: null, settings: { id: 'SETTINGS', companyId: 'tenant', environment: 'test', testSuite: 'TGT', routeProfileId: 'ROUTE', transportProfileId: null, isActive: true, applicationReference: '23-DDQ-PRODAT', metadata: { unrelatedConfiguration: 'must not copy' }, testPortalCounterpartyId: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, testBrpCounterpartyId: null, testBrpEdielId: null, testBrpName: null, defaultReceiverSubaddress: 'PRODAT', defaultSenderSubaddress: null, setupPackage: null, actorRole: 'supplier', messageFamily: 'PRODAT', environmentType: 'tgt', certificateEnvironment: null, transportEnvironment: null, smtpProvider: null } satisfies EdielSystemTestSettings });
const row = () => ({ id: 'MSG', company_id: 'tenant', message_family: 'PRODAT', message_code: 'Z09', environment: 'test', direction: 'outbound' } as EdielMessageRow);
beforeEach(() => { vi.clearAllMocks(); filters = []; records = { ediel_route_profiles: { id: 'ROUTE', company_id: 'tenant', environment: 'test', is_enabled: true, is_active: true, communication_route_id: 'COMM', sender_ediel_id: '12345', receiver_ediel_id: '54321', sender_sub_address: null, receiver_sub_address: 'PRODAT', application_reference: '23-DDQ-PRODAT' }, ediel_test_run_messages: [{ test_run_id: 'RUN', step_no: 1, expected_family: 'PRODAT', expected_code: 'Z09', expected_direction: 'outbound' }] }; io.from.mockImplementation((table: string) => { const f: Record<string, unknown> = { table }; filters.push(f); const q = { select: () => q, eq: (key: string, value: unknown) => { f[key] = value; return q; }, maybeSingle: async () => ({ data: records[table], error: null }), limit: async () => ({ data: records[table], error: null }) }; return q; }); io.runtime.mockResolvedValue(runtime()); io.imported.mockResolvedValue(data()); });
it('source snapshot includes explicit route values without unrelated settings', async () => { const r = await resolveTgtDateEventRoute(run(), 'Z09', runtime()); expect(r).toMatchObject({ settingsId: 'SETTINGS', actorSettingId: 'ACTORSETTING', communicationRouteId: 'COMM', senderId: '12345', receiverSubaddress: 'PRODAT' }); expect(JSON.stringify(r)).not.toContain('unrelatedConfiguration'); expect(filters).toEqual([{ table: 'ediel_route_profiles', id: 'ROUTE', company_id: 'tenant' }]); });
it('production route cannot be substituted into an authorized test run', async () => { Object.assign(records.ediel_route_profiles!, { environment: 'production' }); await expect(resolveTgtDateEventRoute(run(), 'Z09', runtime())).rejects.toThrow(); });
for (const change of ['company', 'settingsCompany', 'settingsId', 'actor', 'routeSelection', 'rawRoute', 'missingRoute'] as const)
    it(`route resolver rejects ${change}`, async () => { const r = run(), rt = runtime(); if (change === 'company')
        rt.companyId = 'OTHER'; if (change === 'settingsCompany')
        rt.settings!.companyId = 'OTHER'; if (change === 'settingsId')
        rt.settings!.id = null; if (change === 'actor')
        rt.actorSettingId = null; if (change === 'routeSelection')
        rt.settings!.routeProfileId = 'OTHER'; if (change === 'rawRoute')
        Object.assign(records.ediel_route_profiles!, { receiver_ediel_id: 'OTHER' }); if (change === 'missingRoute')
        records.ediel_route_profiles = null; await expect(resolveTgtDateEventRoute(r, 'Z09', rt)).rejects.toThrow(); });
async function saved() { const r = run(), rt = runtime(), route = await resolveTgtDateEventRoute(r, 'Z09', rt); r.notes = buildTgtRegisterFactNotes({ run: r, stepNo: 1, code: 'Z09', testData: data(), dateEventRoute: route, actorId: 'ACTOR', sourceNote: 'Independent production signing', facts: { market: 'electricity', dateEventObjects: [{ meteringPointId: 'A', identityAgency: '9', kind: 'production_contract', direction: 'production', contract: { reference: 'contract', revision: '1' }, event: { kind: 'signed', reference: 'event', revision: '1' }, supplyBoundaryAt: '202610010000' }] } }); records.ediel_test_runs = r; return r; }
it('persisted context loads company-owned association and notes independently of payload', async () => { await saved(); const m = row(); m.parsed_payload = { testRunId: 'FORGED', prodatEngine: { registerEvidence: { facts: { dateEventSource: { kind: 'tgt' } } } } }; const context = await loadTgtDateEventValidationContext(m); expect(context?.source.runId).toBe('RUN'); expect(context?.objects[0]).toMatchObject({ supplyBoundaryAt: '202610010000' }); expect(filters).toContainEqual({ table: 'ediel_test_run_messages', company_id: 'tenant', ediel_message_id: 'MSG' }); expect(filters).toContainEqual({ table: 'ediel_test_runs', company_id: 'tenant', id: 'RUN' }); });
for (const change of ['runCompany', 'step', 'duplicate', 'source', 'route'] as const)
    it(`persisted resolver fails ${change} drift`, async () => { const r = await saved(); if (change === 'runCompany')
        r.company_id = 'OTHER'; if (change === 'step')
        records.ediel_test_run_messages = [{ test_run_id: 'RUN', step_no: 99, expected_family: 'PRODAT', expected_code: 'Z09', expected_direction: 'outbound' }]; if (change === 'duplicate')
        records.ediel_test_run_messages = [{}, {}]; if (change === 'source') {
        const d = data();
        d.groups[0].fields[0].values.Z09D = 'OTHER';
        io.imported.mockResolvedValue(d);
    } if (change === 'route')
        Object.assign(records.ediel_route_profiles!, { communication_route_id: 'CHANGED' }); await expect(loadTgtDateEventValidationContext(row())).rejects.toThrow(); });
it('no resolver can make a production lifecycle source', async () => { expect(await loadTgtDateEventValidationContext({ ...row(), environment: 'production' })).toBeUndefined(); expect(filters).toEqual([]); });
it('persisted tenant scope is required before any service-role read', async () => {
    await expect(loadTgtDateEventValidationContext({ ...row(), company_id: '' })).rejects.toThrow('Bolag krävs');
    expect(io.from).not.toHaveBeenCalled();
});
for (const table of ['ediel_route_profiles', 'ediel_test_run_messages', 'ediel_test_runs']) it(`scoped ${table} read preserves database errors`, async () => {
    const error = new Error(`synthetic ${table} unavailable`);
    io.from.mockImplementation((selected: string) => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: records[selected], error: selected === table ? error : null }), limit: async () => ({ data: records[selected], error: selected === table ? error : null }) };
        return q;
    });
    const result = table === 'ediel_route_profiles' ? resolveTgtDateEventRoute(run(), 'Z09', runtime()) : loadTgtDateEventValidationContext(row());
    await expect(result).rejects.toBe(error);
});
import {resolveTgtDateEventBuildContext} from '@/lib/ediel/testing/tgtDateEventContext'
import {buildEdielTgtDraft} from '@/lib/ediel/testing/tgtEdifact.part-4'
for(const side of ['facts','context'] as const)for(const nested of ['event','source','route'] as const)it(`resolved ${side} ${nested} mutation cannot change its independently retained peer`,async()=>{
 const r=await saved(),rt=runtime(),result=await resolveTgtDateEventBuildContext({run:r,stepNo:1,code:'Z09',runtime:rt,testData:data()})
 const before=JSON.stringify(side==='facts'?result.context:result.facts)
 const source=side==='facts'?result.facts!.dateEventSource!:result.context!.source
 const objects=side==='facts'?result.facts!.dateEventObjects!:result.context!.objects
 if(nested==='event'){const o=objects[0];if(o.kind!=='production_contract')throw new Error('wrong fixture');o.event.reference='MUTATED'}
 if(nested==='source')source.reference='MUTATED'
 if(nested==='route'){if(source.kind!=='tgt')throw new Error('wrong fixture');source.route.legalRecipient.id='MUTATED'}
 expect(JSON.stringify(side==='facts'?result.context:result.facts)).toBe(before)
 expect(()=>buildEdielTgtDraft({actorUserId:'ACTOR',testRunId:r.id,testSuite:r.test_suite,roleCode:r.role_code,testCaseCode:r.test_case_code,stepNo:1,systemTestContext:rt,importedTestData:data(),registerFacts:result.facts,dateEventContext:result.context})).toThrow()
})
