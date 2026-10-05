import {buildEdielTgtDraft} from '@/lib/ediel/testing/tgtEdifact.part-4';
import {transportJournalFixture} from './fixtures/ediel-transport-journal';
import { beforeEach, it, expect, vi } from 'vitest';
import type { EdielMessageRow } from '@/lib/ediel/types';
import { reportingId, reportingPrepared } from './fixtures/prodat-reporting-permission';
const io = vi.hoisted(() => ({rpc:vi.fn(),from:vi.fn(),provider:vi.fn(()=>{throw Error('PROVIDER_BOUNDARY_REACHED')}),event:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc:io.rpc } }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.provider }));
vi.mock('@/lib/ediel/db', () => ({ getEdielRouteProfileByCommunicationRouteId: vi.fn(), createEdielMessageEvent: io.event, updateEdielMessageStatus: io.update }));
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockImplementation(transportJournalFixture().rpc)});
for (const label of ['Z13', 'Z04'])
    it(`actual SMTP blocks unsourced raw Z13 under row ${label}`, async () => {
        const q = { select: () => q, eq: () => q, limit: async () => ({ data: [], error: null }) };
        io.from.mockReturnValue(q);
        const p=reportingPrepared(),raw=buildEdielTgtDraft({actorUserId:reportingId(12),testSuite:p.run.test_suite,roleCode:p.run.role_code,testCaseCode:p.run.test_case_code,stepNo:1,testRunId:p.run.id,importedTestData:p.testData,registerFacts:{market:'electricity',reportingPermission:p.evidence},reportingContext:p.context,systemTestContext:p.runtime}).rawPayload;
        const row = { id: reportingId(90), company_id: reportingId(10), created_at: '2026-09-19T11:00:00Z', direction: 'outbound', environment: 'test', message_standard: 'edifact', message_family: 'PRODAT', message_code: label, receiver_email: 'portal@example.invalid', raw_payload:raw, parsed_payload: { rulebookAllowInvalidSend: true } } as unknown as EdielMessageRow;
        const before=structuredClone(row);
        // A conflicting row label may be held at the earlier physical profile
        // boundary; neither case may reach the provider without source authority.
        await expect(sendEdielMessageViaSmtp(row, { actorUserId: reportingId(12) })).rejects.toThrow(/PRODAT_(REPORTING|REGISTER|DEPENDENT|GAS_SOURCE_UNQUALIFIED)/);
        expect(io.rpc).toHaveBeenNthCalledWith(1,'gridex_ediel_accepted_transport_projection_v1',{p_company_id:reportingId(10),p_environment:'test',p_actor_user_id:reportingId(12),p_message_id:reportingId(90)});
        expect(io.provider).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled();expect(row).toEqual(before);
    });
