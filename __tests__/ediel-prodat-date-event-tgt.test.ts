import { it, expect } from 'vitest';
import { buildTgtRegisterFactNotes, readTgtRegisterFacts } from '@/lib/ediel/testing/tgtRegisterFacts';
import { buildEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4';
import type { EdielTestRunRow } from '@/lib/ediel/types';
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData';
import type { ProdatDateEventRoute } from '@/lib/ediel/prodat/prodatDateEvents';
const data = (): EdielTgtCaseTestData => {
    const columns = [{ name: 'Z09D', index: 0, sourceOrder: 0, testCase: '2.5.3' }];
    const fields = Object.entries({ '209': 'A', '223': 'Z70', '210': '202610010000', '260': 'TES', '262': '11111' }).map(([fieldCode, value]) => ({ fieldCode, fieldName: fieldCode, values: { Z09D: value } }));
    return { suite: 'PRODAT', roleCode: 'supplier', testCaseCode: '2.5.3', title: 'Synthetic', sourceNote: 'Synthetic', groups: [{ columns, fields, block: { kind: 'PRODAT', sourceWorkbook: 'synthetic', sourceSheet: 'synthetic', entityLabel: 'A', entityNumbers: ['1'], columns, fields } }] };
};
const route = (): ProdatDateEventRoute => ({ settingsId: 'SETTINGS', actorSettingId: 'ACTORSETTING', routeProfileId: null, communicationRouteId: null, transportProfileId: null, legalSender: { id: '12345', qualifier: '160', agency: 'SVK' }, legalRecipient: { id: '54321', qualifier: '160', agency: 'SVK' }, senderId: '12345', receiverId: '54321', senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress: null, receiverSubaddress: 'PRODAT', transportType: 'manual_upload', mailbox: 'tgt-file-engine', receiverEmail: null, applicationReference: '23-DDQ-PRODAT', suppliers: [] });
const facts = () => ({ market: 'electricity', dateEventObjects: [{ meteringPointId: 'A', identityAgency: '9', kind: 'production_contract', direction: 'production', contract: { reference: 'contract', revision: '1' }, event: { kind: 'signed', reference: 'signing', revision: '1', occurredAt: '202609010000' }, supplyBoundaryAt: '202610010000' }] });
const context = () => ({ run: { id: 'RUN', company_id: 'tenant', role_code: 'supplier', test_case_code: '2.5.3', test_suite: 'PRODAT', notes: null } as EdielTestRunRow, stepNo: 1, code: 'Z09', testData: data(), dateEventRoute: route() });
it('authorized TGT notes stamp one source separate from asserted facts', () => { const c = context(); c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: facts(), actorId: 'ACTOR', sourceNote: 'Independent contract signing' }); expect(readTgtRegisterFacts(c)?.dateEventSource).toMatchObject({ kind: 'tgt', companyId: 'tenant', runId: 'RUN', code: 'Z09', route: { settingsId: 'SETTINGS' } }); });
it('operator source-kind cannot be silently relabeled as TGT', () => { const c = context(); expect(() => buildTgtRegisterFactNotes({ ...c, facts: { ...facts(), dateEventSource: { kind: 'caller_selection', reference: 'caller' } }, actorId: 'ACTOR', sourceNote: 'Independent' })).toThrow(); });
it('TGT source assertion without server route fails', () => { const c = context(); expect(() => buildTgtRegisterFactNotes({ ...c, dateEventRoute: undefined, facts: facts(), actorId: 'ACTOR', sourceNote: 'Independent' })).toThrow(); });
it('TGT draft without independent event does not become ready', () => { const c = context(); const draft = buildEdielTgtDraft({ actorUserId: 'ACTOR', testRunId: 'RUN', testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: '2.5.3', stepNo: 1, importedTestData: c.testData, systemTestContext: { companyId: 'tenant', testSuite: 'TGT', actorSettingId: null, actorEdielId: '12345', actorName: null, senderSubaddress: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: 'PRODAT', testBrpEdielId: '11111', testBrpName: null, settings: null } }); expect(draft.validationIssues.some(i => i.code.startsWith('PRODAT_DATE_EVENT_') && i.severity === 'error')).toBe(true); });
it('a draft cannot promote copied TGT facts without separately loaded expected context', () => { const c = context(); c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: facts(), actorId: 'ACTOR', sourceNote: 'Independent signing' }); expect(() => buildEdielTgtDraft({ actorUserId: 'ACTOR', testRunId: 'RUN', testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: '2.5.3', stepNo: 1, importedTestData: c.testData, registerFacts: readTgtRegisterFacts(c), systemTestContext: { companyId: 'tenant', testSuite: 'TGT', actorSettingId: 'ACTORSETTING', actorEdielId: '12345', actorName: null, senderSubaddress: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: 'PRODAT', testBrpEdielId: '11111', testBrpName: null, settings: null } })).toThrow(); });
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator';
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards';
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock';
import { dateEventDraftRow } from '@/lib/ediel/testing/tgtDateEventSource';
import type { EdielMessageRow } from '@/lib/ediel/types';
import type { TgtDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority';
function prepared() {
    const c = context();
    c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: facts(), actorId: 'ACTOR', sourceNote: 'Independent signing' });
    const f = readTgtRegisterFacts(c)!;
    if (f.dateEventSource?.kind !== 'tgt')
        throw new Error('expected test source');
    const trusted: TgtDateEventValidationContext = { source: f.dateEventSource, objects: f.dateEventObjects! };
    const draft = buildEdielTgtDraft({ actorUserId: 'ACTOR', testRunId: 'RUN', testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: '2.5.3', stepNo: 1, importedTestData: c.testData, registerFacts: f, dateEventContext: trusted, systemTestContext: { companyId: 'tenant', testSuite: 'TGT', actorSettingId: 'ACTORSETTING', actorEdielId: '12345', actorName: null, senderSubaddress: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: 'PRODAT', testBrpEdielId: '11111', testBrpName: null, settings: null } });
    const row: Partial<EdielMessageRow> = { ...dateEventDraftRow(draft.messageInput), id: 'MSG', message_family: 'PRODAT', message_version: '26A', message_standard: 'edifact', mime_type: 'application/EDIFACT', raw_payload: draft.rawPayload, parsed_payload: { ...draft.messageInput.parsedPayload, rulebookAllowInvalidSend: true } };
    return { row: row as EdielMessageRow, trusted, draft, c };
}
it('authorized actual TGT draft passes both persisted guards with separately supplied scope', () => { const { row, trusted, draft } = prepared(); expect(draft.validationIssues.filter(i => i.code.includes('DATE_EVENT'))).toEqual([]); expect(preflightEdielMessageRow(row, 'send', trusted).issues.filter(i => i.code.includes('DATE_EVENT') || i.code.includes('EVIDENCE_INVALID'))).toEqual([]); expect(() => assertRulebookAllowsSend(row, trusted)).not.toThrow(); expect(() => assertEdielSendLock(row, trusted)).not.toThrow(); });
for (const mutation of ['missing_context', 'production', 'company', 'run', 'step', 'legal', 'unb', 'row_receiver', 'subaddress', 'route', 'source_kind', 'event'] as const)
    it(`normal and missing-snapshot guards reject ${mutation}`, () => {
        const { row, trusted } = prepared();
        let expected: TgtDateEventValidationContext | undefined = trusted;
        if (mutation === 'missing_context')
            expected = undefined;
        if (mutation === 'production')
            row.environment = 'production';
        if (mutation === 'company')
            row.company_id = 'OTHER';
        if (mutation === 'run')
            row.parsed_payload!.testRunId = 'OTHER';
        if (mutation === 'step')
            row.parsed_payload!.stepNo = 2;
        if (mutation === 'legal')
            row.raw_payload = row.raw_payload!.replace('NAD+DO+54321', 'NAD+DO+99999');
        if (mutation === 'unb')
            row.raw_payload = row.raw_payload!.replace('54321:ZZ', '99999:ZZ');
        if (mutation === 'row_receiver')
            row.receiver_ediel_id = '99999';
        if (mutation === 'subaddress')
            row.receiver_sub_address = 'OTHER';
        if (mutation === 'route')
            row.communication_route_id = 'OTHER';
        if (mutation === 'source_kind' || mutation === 'event') {
            const payload = JSON.parse(JSON.stringify(row.parsed_payload));
            if (mutation === 'source_kind')
                payload.prodatEngine.registerEvidence.facts.dateEventSource = { kind: 'caller_selection', reference: 'changed' };
            else
                payload.prodatEngine.registerEvidence.facts.dateEventObjects[0].event.reference = 'forged';
            row.parsed_payload = payload;
        }
        for (const snapshot of [false, true]) {
            if (snapshot)
                row.parsed_payload = { ...row.parsed_payload, prodatEngine: { ...(row.parsed_payload?.prodatEngine as object), dependentConditionStatuses: [{ id: 'Z09:210', status: 'not_required' }] } };
            expect(validateEdielMessageRowWithRulebook(row, 'send', expected).issues.some(i => i.scope === 'prodat_register' || i.scope === 'prodat_dependent')).toBe(true);
            expect(() => assertRulebookAllowsSend(row, expected)).toThrow();
            expect(() => assertEdielSendLock(row, expected)).toThrow();
        }
    });
it('changing the currently selected route invalidates notes before build', () => { const { c } = prepared(); c.dateEventRoute.receiverId = 'OTHER'; expect(() => readTgtRegisterFacts(c)).toThrow(); });
it('retained authorized values survive nested caller mutation', () => { const c = context(), f = facts(); c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent signing' }); f.dateEventObjects[0].event.reference = 'changed'; c.dateEventRoute.legalRecipient.id = 'changed'; expect(JSON.parse(c.run.notes).prodatRegisterFacts.steps['1'].facts.dateEventObjects[0].event.reference).toBe('signing'); });
for (const key of ['authority', 'testSubstitution', 'route', 'environment', 'source', 'isAuthorized'])
    it(`operator cannot inject ${key}`, () => { const c = context(); expect(() => buildTgtRegisterFactNotes({ ...c, facts: { ...facts(), [key]: true }, actorId: 'ACTOR', sourceNote: 'Independent' })).toThrow(); });
for (const key of ['unknown', 'source', 'authority'])
    it(`nested domain ${key} cannot be hidden by a copier`, () => { const c = context(), f = facts(); Object.assign(f.dateEventObjects[0], { [key]: true }); expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent' })).toThrow(); });
import { assertTgtDateEventDraft } from '@/lib/ediel/testing/tgtDateEventSource';
it('post-attachment mailbox cannot inherit prebuild approval', () => { const { draft, trusted } = prepared(); draft.messageInput.mailbox = 'CHANGED'; expect(() => assertTgtDateEventDraft(draft.messageInput, trusted)).toThrow(); });
for (const custom of [false, true])
    for (const value of ['DTM+ 92:202610010000:203', 'DTM+92:202610010000:203:X', 'DTM+92:202610010000:203\'DTM+92:202610010000:203'])
        it(`both guards protect malformed/duplicate own date with custom UNA=${custom}: ${value}`, () => {
            const { row, trusted } = prepared();
            row.raw_payload = row.raw_payload!.replace('DTM+92:202610010000:203', value);
            if (custom)
                row.raw_payload = 'UNA^*.,!~' + row.raw_payload!.replace(/^UNA.{6}/, '').replaceAll(':', '^').replaceAll('+', '*').replaceAll("'", '~');
            for (const fallback of [false, true]) {
                if (fallback)
                    row.parsed_payload = { ...row.parsed_payload, prodatEngine: { ...(row.parsed_payload?.prodatEngine as object), registerEvidence: null } };
                expect(validateEdielMessageRowWithRulebook(row, 'send', trusted).issues.some(i => i.blocking && (i.scope === 'prodat_register' || i.scope === 'prodat_dependent'))).toBe(true);
                expect(() => assertRulebookAllowsSend(row, trusted)).toThrow();
                expect(() => assertEdielSendLock(row, trusted)).toThrow();
            }
        });
import {copyProdatDateEventSource} from '@/lib/ediel/prodat/prodatDateEvents'
for(const alteration of [{route:{...route(),extra:'unknown'}},{stepNo:'1'},{code:{toString:()=> 'Z09'}},{authority:true}])it(`strict copied source rejects ${JSON.stringify(alteration)}`,()=>{const {trusted}=prepared();expect(()=>copyProdatDateEventSource({...trusted.source,...alteration})).toThrow()})
it('copied trusted route and domain retain no nested source aliases',()=>{const {trusted}=prepared();const source=copyProdatDateEventSource(trusted.source);trusted.source.route.legalRecipient.id='MUTATED';expect(source).toMatchObject({route:{legalRecipient:{id:'54321'}}})})
