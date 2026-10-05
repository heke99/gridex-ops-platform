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

function noWireUdSource(reason: 'E64' | 'E32') {
    const c = ctx(), f = facts();
    const caseCode = reason === 'E64' ? '2.1.1' : '2.1.3';
    const columnName = reason === 'E64' ? 'Z06F' : 'Z06G';
    c.code = 'Z06'; c.run.test_case_code = caseCode; c.testData.testCaseCode = caseCode;
    for (const group of c.testData.groups) {
        group.fields = group.fields.filter(field => !/^(227|228|229|231|232|316)([.-]|$)/.test(field.fieldCode));
        for (const column of group.columns) { column.name = columnName; column.testCase = caseCode; }
        for (const field of group.fields) field.values = { [columnName]: field.fieldCode === '223' ? reason : field.fieldCode === '217' ? 'Z06' : field.values.Z03D };
    }
    delete f.endUserAddressObjects;
    f.registerObjects = ['A', 'B'].map(id => ({ meteringPointId: id, identityAgency: '9', expectedRegisterCount: 1, meterReadingsSentInUtilts: false }));
    for (const row of f.invoiceeObjects!) {
        row.source.reference = `Independent current UD and IV records for ${row.meteringPointId}; UD is comparison-only`;
        row.endUser.address.representation!.reference = `Independent UD postal selection ${row.meteringPointId}`;
    }
    return { c, f, columnName, caseCode };
}
function saveAndDraft(c: ReturnType<typeof ctx>, f: ProdatDependentConditionFacts) {
    c.run.notes = buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent comparison-only UD selections A/B and original IV cells, qualified positional convention' });
    const read = readTgtRegisterFacts(c)!;
    const params = draft();
    params.testCaseCode = c.run.test_case_code; params.importedTestData = c.testData; params.registerFacts = read;
    return { read, built: buildEdielTgtDraft(params) };
}
for (const reason of ['E64', 'E32'] as const) {
    it(`${reason}: notes/read/draft retain independent UD comparison without emitting UD`, () => {
        const { c, f } = noWireUdSource(reason), { read, built } = saveAndDraft(c, f);
        expect(read.invoiceeObjects!.map(row => row.endUser)).toEqual(f.invoiceeObjects!.map(row => row.endUser));
        const wire = tokenizeEdifact(built.rawPayload);
        expect(wire.segments.some(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'UD')).toBe(false);
        expect(wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'IV').map(s => segmentComposite(s, 2, wire.una)[0])).toEqual(['BILL-A', 'BILL-B']);
        expect(built.validationIssues.filter(i => i.code.includes('INVOICEE'))).toEqual([]);
    });
    for (const [fieldCode, value] of [['227', 'OTHER'], ['227.QUALIFIER', 'SE1'], ['227.AGENCY', '89'], ['229-2', 'OTHER'], ['231', '00000'], ['232', 'Other'], ['316', 'NO']] as const)
        it(`${reason}: supplied comparison-only ${fieldCode} must match`, () => {
            const { c, f, columnName } = noWireUdSource(reason);
            c.testData.groups[0].fields = [...c.testData.groups[0].fields, { fieldCode, fieldName: fieldCode, values: { [columnName]: value } }];
            expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent current selections' })).toThrow();
        });
    it(`${reason}: unknown independent UD representation remains unknown`, () => {
        const { c, f } = noWireUdSource(reason);
        f.invoiceeObjects![0].endUser.address.representation = null;
        const { read, built } = saveAndDraft(c, f);
        expect(read.invoiceeObjects![0].endUser.address.representation).toBeNull();
        expect(built.validationIssues.some(i => i.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED' && i.description?.includes('INVOICEE_GROUP'))).toBe(true);
    });
}
for (const shape of ['absent', 'scalar-blank', 'positional-blank'] as const)
    it(`${shape}: equal selected source preserves actual TGT IV omission`, () => {
        const c = ctx(), f = facts();
        for (const row of f.invoiceeObjects!) row.invoicee.address = { ...row.endUser.address, lines: [...row.endUser.address.lines] };
        for (const group of c.testData.groups) {
            group.fields = group.fields.filter(field => !/^(250|251|252|253|317|318)([.-]|$)/.test(field.fieldCode));
            const blankFields = shape === 'absent' ? [] : shape === 'scalar-blank' ? ['250', '251', '252', '253', '317', '318'] : ['251-1', '251-2', '252-1', '252-2', '252-3'];
            group.fields = [...group.fields, ...blankFields.map(fieldCode => ({ fieldCode, fieldName: fieldCode, values: { Z03D: ' ' } }))];
        }
        const { built } = saveAndDraft(c, f);
        expect(built.rawPayload).not.toContain('NAD+IV');
        expect(built.validationIssues.filter(i => i.code.includes('INVOICEE'))).toEqual([]);
    });

for (const reason of ['E64', 'E32'] as const) {
    it(`${reason}: supplied partial UD matches while absent components retain independent values`, () => {
        const { c, f, columnName } = noWireUdSource(reason);
        c.testData.groups[0].fields = [...c.testData.groups[0].fields,
            { fieldCode: '227', fieldName: '227', values: { [columnName]: '199001011234' } },
            { fieldCode: '229-1', fieldName: '229-1', values: { [columnName]: 'Street' } },
            { fieldCode: '231', fieldName: '231', values: { [columnName]: '12345' } }];
        const { read, built } = saveAndDraft(c, f);
        expect(read.invoiceeObjects![0].endUser.address.city).toBe('Town');
        expect(built.rawPayload).not.toContain('NAD+UD');
        expect(built.validationIssues.filter(i => i.code.includes('INVOICEE'))).toEqual([]);
    });
    it(`${reason}: independent comparison still requires explicit source provenance`, () => {
        const { c, f } = noWireUdSource(reason); f.invoiceeObjects![0].source.reference = '';
        expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent selections' })).toThrow();
    });
}
for (const sourceReason of ['E34', 'E64 (Z06G)', 'E64 unknown'])
    it(`absent UD exception cannot be selected by ${sourceReason}`, () => {
        const { c, f, columnName } = noWireUdSource('E64');
        c.testData.groups[0].fields.find(field => field.fieldCode === '223')!.values[columnName] = sourceReason;
        expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent selections' })).toThrow();
    });
it('ordinary Z03 source still requires its selected UD identity', () => {
    const c = ctx(), f = facts(); delete f.endUserAddressObjects;
    c.testData.groups[0].fields = c.testData.groups[0].fields.filter(field => !field.fieldCode.startsWith('227'));
    expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent selections' })).toThrow();
});
for (const change of ['incomplete', 'excess-position', 'scalar-conflict'])
    it(`material IV selection still rejects ${change}`, () => {
        const c = ctx(), f = facts(), group = c.testData.groups[0];
        if (change === 'incomplete') group.fields = group.fields.filter(field => field.fieldCode !== '253');
        if (change === 'excess-position') group.fields = [...group.fields, { fieldCode: '252-4', fieldName: '252-4', values: { Z03D: 'Dropped?' } }];
        if (change === 'scalar-conflict') group.fields = [...group.fields, { fieldCode: '252', fieldName: '252', values: { Z03D: 'Conflict' } }];
        expect(() => buildTgtRegisterFactNotes({ ...c, facts: f, actorId: 'ACTOR', sourceNote: 'Independent selections' })).toThrow();
    });
import { getEdielTgtAvailableTestDataBlocks } from '@/lib/ediel/testing/tgtTestData';
it('built-in Testkund1 Z06F uses its annotated own reason with independently referenced absent UD', () => {
    const block = getEdielTgtAvailableTestDataBlocks().find(b => b.kind === 'PRODAT' && b.entityLabel === 'Testkund 1')!;
    const c = ctx(); c.code = 'Z06'; c.run.test_case_code = '2.1.2';
    c.testData = { ...c.testData, testCaseCode: '2.1.2', groups: [{ block, columns: block.columns, fields: block.fields }] };
    const selected = selectedInvoiceeFact('735999888000000017', 'tenant', '9', 'SYNTHETIC-UD', ['Independent selected street'], '', '11122', 'STOCKHOLM');
    selected.source.reference = 'Independent test UD selection, not another workbook column';
    selected.invoicee = { identity: { id: '10011', qualifier: '', agency: '89' }, nameLines: ['CONNY PAULSSON'], address: { ...selected.invoicee.address, lines: ['ÅGATAN 145', '', ''], postalCode: '11543' }, availability: 'available' };
    const f: ProdatDependentConditionFacts = { invoiceeObjects: [selected], registerObjects: [{ meteringPointId: '735999888000000017', identityAgency: '9', expectedRegisterCount: 1, meterReadingsSentInUtilts: false }] };
    const { read, built } = saveAndDraft(c, f);
    expect(read.invoiceeObjects![0].endUser.identity.id).toBe('SYNTHETIC-UD');
    expect(built.rawPayload).not.toContain('NAD+UD');
    expect(built.rawPayload).toContain('NAD+IV+10011::89');
    expect(built.validationIssues.filter(i => i.code.includes('INVOICEE'))).toEqual([]);
});
it('blank positional schema slots do not replace supplied scalar IV values', () => {
    const c = ctx(), f = facts();
    for (const row of f.invoiceeObjects!) { row.invoicee.nameLines = ['Invoicee']; row.invoicee.address.lines = ['Invoice street', '', '']; }
    for (const group of c.testData.groups) {
        for (const field of group.fields) if (/^25[12]-/.test(field.fieldCode)) field.values.Z03D = '';
        group.fields = [...group.fields,
            { fieldCode: '251', fieldName: '251', values: { Z03D: 'Invoicee' } },
            { fieldCode: '252', fieldName: '252', values: { Z03D: 'Invoice street' } }];
    }
    const { built } = saveAndDraft(c, f), wire = tokenizeEdifact(built.rawPayload);
    expect(wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'IV').map(s => segmentComposite(s, 5, wire.una))).toEqual([['Invoice street'], ['Invoice street']]);
    expect(built.validationIssues.filter(i => i.code.includes('INVOICEE'))).toEqual([]);
});
