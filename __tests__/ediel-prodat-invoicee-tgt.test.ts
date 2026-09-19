import { it, expect } from 'vitest';
import { buildTgtRegisterFactNotes, readTgtRegisterFacts } from '@/lib/ediel/testing/tgtRegisterFacts';
import { buildEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4';
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer';
import { copyProdatInvoiceeObjects } from '@/lib/ediel/prodat/prodatInvoicee';
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData';
import type { EdielTgtDraftBuildParams } from '@/lib/ediel/testing/tgtEdifact.part-1';
import type { EdielTestRunRow, EdielMessageRow } from '@/lib/ediel/types';
import { selectedInvoiceeFact, selectedAddressFact } from './fixtures/prodat-ud';
const data = (): EdielTgtCaseTestData => ({ suite: 'PRODAT', roleCode: 'supplier', testCaseCode: '1.2.5', title: 'Synthetic', sourceNote: 'Synthetic', groups: ['A', 'B'].map(id => {
        const column = { name: 'Z03D', index: 0, sourceOrder: 0, testCase: '1.2.5' };
        const values: Record<string, string> = { '209': id, '227': '199001011234', '227.AGENCY': '260', '227.QUALIFIER': 'SE2', '228': 'Synthetic', '229': 'Street', '231': '12345', '232': 'Town', '316': 'SE', '250': `BILL-${id}`, '250.AGENCY': '89', '251-1': 'Invoicee', '251-2': "Second :+?'", '252-1': '', '252-2': `BOX ${id}`, '252-3': "c/o :+?'", '253': '99999', '317': 'Other', '318': 'NO', '223': 'Z70', '210': '202610010000', '217': 'Z03', '261': 'POA' };
        const fields = Object.entries(values).map(([fieldCode, value]) => ({ fieldCode, fieldName: fieldCode, values: { Z03D: value } }));
        return { columns: [column], fields, block: { kind: 'PRODAT', sourceWorkbook: 'synthetic', sourceSheet: id, entityLabel: id, entityNumbers: [id], columns: [column], fields } };
    }) });
const run = (): EdielTestRunRow => ({ id: 'RUN', company_id: 'tenant', role_code: 'supplier', test_case_code: '1.2.5', test_suite: 'PRODAT', notes: null, approval_version: null, title: 'Synthetic', status: 'draft', customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null, started_at: null, completed_at: null, failure_reason: null, created_at: '2026-09-19T00:00:00Z', updated_at: '2026-09-19T00:00:00Z', created_by: null, updated_by: null });
const facts = (): ProdatDependentConditionFacts => ({ invoiceeObjects: ['A', 'B'].map(id => {
        const f = selectedInvoiceeFact(id, 'tenant', '9', '199001011234', ['Street'], 'SE2', '12345', 'Town');
        f.invoicee = { identity: { id: `BILL-${id}`, qualifier: '', agency: '89' }, nameLines: ['Invoicee', "Second :+?'"], address: { ...f.invoicee.address, lines: ['', `BOX ${id}`, "c/o :+?'"], postalCode: '99999', city: 'Other', country: 'NO' }, availability: 'available' };
        return f;
    }), endUserAddressObjects: ['A', 'B'].map(id => selectedAddressFact(id, 'tenant', '9', '199001011234', ['Street'], 'SE2')) });
const ctx = () => ({ run: run(), testData: data(), code: 'Z03', stepNo: 1 });
const saved = () => { const c = ctx(); c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: facts(), actorId: 'ACTOR', sourceNote: 'Selected positional mode 1 sources; comparable components, independent no-event record' }); return c; };
const draft = (): EdielTgtDraftBuildParams & {
    importedTestData: EdielTgtCaseTestData;
} => { const c = saved(); return { actorUserId: 'actor', testRunId: 'RUN', testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: '1.2.5', stepNo: 1, importedTestData: c.testData, registerFacts: readTgtRegisterFacts(c), systemTestContext: { companyId: 'tenant', testSuite: 'PRODAT', actorSettingId: null, actorEdielId: '12345', actorName: null, senderSubaddress: null, testPortalEdielId: '54321', testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: 'PRODAT', testBrpEdielId: '11111', testBrpName: null, settings: null } }; };
it('actual TGT draft carries each selected IV and bound source evidence to preflight', () => {
    const d = buildEdielTgtDraft(draft()), wire = tokenizeEdifact(d.rawPayload);
    const iv = wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'IV');
    expect(iv.map(s => segmentComposite(s, 2, wire.una)[0])).toEqual(['BILL-A', 'BILL-B']);
    expect(iv.map(s => segmentComposite(s, 5, wire.una))).toEqual(['A', 'B'].map(id => ['.', `BOX ${id}`, "c/o :+?'"]));
    expect(iv.map(s => segmentComposite(s, 4, wire.una))).toEqual(['A', 'B'].map(() => ['Invoicee', "Second :+?'"]));
    expect(d.validationIssues.filter(i => i.code.includes('INVOICEE') || i.code.includes('UNDETERMINED'))).toEqual([]);
    const row = { company_id: 'tenant', message_family: 'PRODAT', message_code: 'Z03', message_standard: 'edifact', direction: 'outbound', environment: 'test', mime_type: 'application/EDIFACT', raw_payload: d.rawPayload, parsed_payload: d.messageInput.parsedPayload } as EdielMessageRow;
    expect(preflightEdielMessageRow(row).issues.filter(i => i.code.includes('INVOICEE') || i.code.includes('EVIDENCE_INVALID'))).toEqual([]);
    row.parsed_payload = { ...row.parsed_payload, testRunId: 'OTHER' };
    expect(preflightEdielMessageRow(row).issues.some(i => i.code.includes('EVIDENCE_INVALID'))).toBe(true);
});
for (const change of ['company', 'run', 'role', 'case', 'source', 'step', 'code'] as const)
    it(`TGT persisted selection rejects ${change} drift`, () => {
        const c = saved();
        if (change === 'company')
            c.run.company_id = 'OTHER';
        if (change === 'run')
            c.run.id = 'OTHER';
        if (change === 'role')
            c.run.role_code = 'grid_owner';
        if (change === 'case')
            c.run.test_case_code = 'OTHER';
        if (change === 'source')
            c.testData.groups[0].fields.find(f => f.fieldCode === '253')!.values.Z03D = '00000';
        if (change === 'step')
            c.stepNo = 2;
        if (change === 'code')
            c.code = 'Z08';
        if (change === 'step')
            expect(readTgtRegisterFacts(c)).toBeUndefined();
        else
            expect(() => readTgtRegisterFacts(c)).toThrow();
    });
for (const change of ['identity', 'name', 'street', 'postcode', 'country', 'unavailable', 'extra', 'duplicate'] as const)
    it(`TGT refuses inconsistent ${change} assertion`, () => {
        const c = ctx(), f = facts(), iv = f.invoiceeObjects![0];
        if (change === 'identity')
            iv.invoicee.identity.id = 'OTHER';
        if (change === 'name')
            iv.invoicee.nameLines = ['Wrong'];
        if (change === 'street')
            iv.invoicee.address.lines = ['OTHER', '', ''];
        if (change === 'postcode')
            iv.invoicee.address.postalCode = '00000';
        if (change === 'country')
            iv.invoicee.address.country = 'SE';
        if (change === 'unavailable')
            iv.invoicee.availability = 'unavailable';
        if (change === 'extra')
            iv.meteringPointId = 'OTHER';
        if (change === 'duplicate')
            f.invoiceeObjects = [...f.invoiceeObjects!, iv];
        expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Source selection' })).toThrow();
    });
it('TGT does not manufacture knowledge or comparability from nonempty cells', () => {
    const c = ctx(), f = facts();
    f.invoiceeObjects![0].invoicee.address.representation = null;
    f.invoiceeObjects![0].invoicee.address.city = null;
    c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Current representation not qualified' });
    const read = readTgtRegisterFacts(c)!.invoiceeObjects![0];
    expect(read.invoicee.address.representation).toBeNull();
    expect(read.invoicee.address.city).toBeNull();
});
it('copying evidence cannot alias caller data', () => { const f = facts().invoiceeObjects!, copy = copyProdatInvoiceeObjects(f); f[0].invoicee.nameLines = ['Changed']; expect(copy[0].invoicee.nameLines[0]).toBe('Invoicee'); });
for (const change of ['caller', 'company', 'run', 'source'] as const)
    it(`actual draft rejects ${change} evidence drift`, () => {
        const p = draft();
        if (change === 'caller')
            p.registerFacts = facts();
        if (change === 'company')
            p.systemTestContext.companyId = 'OTHER';
        if (change === 'run')
            p.testRunId = 'OTHER';
        if (change === 'source')
            p.importedTestData.groups[0].fields.find(f => f.fieldCode === '253')!.values.Z03D = '00000';
        expect(() => buildEdielTgtDraft(p)).toThrow();
    });
function eventSource() {
    const c = ctx();
    c.code = 'Z06';
    const f = facts();
    f.registerObjects = ['A', 'B'].map(id => ({ meteringPointId: id, identityAgency: '9', expectedRegisterCount: 1, meterReadingsSentInUtilts: false }));
    for (const g of c.testData.groups) {
        for (const col of g.columns)
            col.name = 'Z06E';
        for (const field of g.fields) {
            let value = field.values.Z03D;
            if (field.fieldCode === '223')
                value = 'E34';
            if (field.fieldCode === '217')
                value = 'Z06';
            if (field.fieldCode === '252-1')
                value = 'Street';
            if (['252-2', '252-3'].includes(field.fieldCode))
                value = '';
            if (field.fieldCode === '253')
                value = '12345';
            if (field.fieldCode === '317')
                value = 'Town';
            if (field.fieldCode === '318')
                value = 'SE';
            field.values = { Z06E: value };
        }
    }
    for (const row of f.invoiceeObjects!) {
        row.invoicee.address = { ...row.endUser.address, lines: [...row.endUser.address.lines] };
        row.event = { state: 'changed_to_same', reference: 'Independent prior invoice-address revision', effectiveAt: '2026-10-01T00:00:00Z', process: 'grid_owner_to_supplier_z06e', previousInvoicee: { ...row.endUser.address, lines: ['Previous street', '', ''] } };
    }
    return { c, f };
}
it('authorized TGT notes retain independent previous/current event values and provenance', () => {
    const { c, f } = eventSource();
    c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Selected Z06E grid-owner to supplier change event, independent revision source' });
    const saved = readTgtRegisterFacts(c)!.invoiceeObjects!;
    expect(saved.map(v => v.event)).toEqual(f.invoiceeObjects!.map(v => v.event));
    expect(saved[0].source.kind).toBe('tgt');
    expect(saved[0].invoicee.address.lines).toEqual(['Street', '', '']);
    c.testData.groups[0].fields.find(v => v.fieldCode === '253')!.values.Z06E = '00000';
    expect(() => readTgtRegisterFacts(c)).toThrow();
});
for (const change of ['wrong-reason', 'prior-equal', 'current-different', 'missing-provenance'] as const)
    it(`TGT event refuses ${change}`, () => {
        const { c, f } = eventSource(), row = f.invoiceeObjects![0];
        if (change === 'wrong-reason')
            c.testData.groups[0].fields.find(v => v.fieldCode === '223')!.values.Z06E = 'E64';
        if (change === 'prior-equal' && row.event.state === 'changed_to_same')
            row.event.previousInvoicee = row.invoicee.address;
        if (change === 'current-different')
            row.invoicee.address.city = 'Other';
        if (change === 'missing-provenance' && row.event.state === 'changed_to_same')
            row.event.reference = '';
        expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent change event' })).toThrow();
    });
