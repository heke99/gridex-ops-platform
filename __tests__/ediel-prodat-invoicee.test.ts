import { describe, it, expect } from 'vitest';
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator';
import { prodatInvoiceeNadSegment } from '@/lib/ediel/prodat/render/segments';
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { raw, alphabets, type Parts } from './fixtures/prodat-register';
const codes = ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'];
const fields = ['INVOICEE_GROUP', '250', '251', '252', '253', '317', '318'];
const address = (street = 'Street'): ProdatInvoiceeObject['endUser']['address'] => ({ lines: [street, '', ''], postalCode: '12345', city: 'Town', country: 'SE', representation: { convention: 'synthetic-postal-v1', reference: 'synthetic-address-selection', mode: 1 } });
export const invoiceeFact = (id = 'A', street = 'Street') => ({ meteringPointId: id, identityAgency: '89', endUser: { identity: { id: 'USER', qualifier: '', agency: '89' }, address: address() }, invoicee: { identity: { id: 'BILL', qualifier: '', agency: '89' }, nameLines: ['Synthetic'], address: address(street), availability: 'available' }, event: { state: 'none', reference: 'synthetic-no-change' }, source: { kind: 'caller_selection', companyId: 'tenant', reference: 'synthetic-source' } });
const body = (code: string, iv = true, street = 'Street', reason = 'E34'): Parts[] => [['LIN', '1', [''], ['A', '', '', '89']], ...(['Z06', 'Z09'].includes(code) ? [['CCI', '', 'Z13'], ['CAV', reason]] : []), ['NAD', 'UD', ['USER', '', '89'], '', 'Synthetic', 'Street', 'Town', '', '12345', 'SE'], ...(iv ? [['NAD', 'IV', ['BILL', '', '89'], '', 'Synthetic', street, 'Town', '', '12345', 'SE']] : [])];
function evaluate(code: string, parts: Parts[], facts: unknown = {}, direction: 'outbound' | 'inbound' = 'outbound', alphabet: readonly string[] = alphabets[0]) {
    const wire = tokenizeEdifact(raw(parts, code, alphabet));
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, direction, subtypeOrReasonCode: code === 'Z09' || code === 'Z06' ? 'E' : code === 'Z08' ? 'H' : 'L', referenceDate: '2026-09-19', applicationReference: '23-DDQ-PRODAT', mode: 'catalog_evidence', prodatDependentFacts: facts as ProdatDependentConditionFacts });
    return validateCanonicalPolicyFields({ policy: { ...policy, fieldRules: policy.fieldRules.filter(r => 'fieldNumber' in r && fields.includes(r.fieldNumber!)) }, rawSegments: wire.segments.map(s => s.raw), una: wire.una });
}
for (const code of codes)
    describe(code, () => {
        it('source-qualified equal inclusion is allowed', () => expect(evaluate(code, body(code), { invoiceeObjects: [invoiceeFact()] })).toEqual([]));
        it('source-qualified equal omission is allowed', () => expect(evaluate(code, body(code, false), { invoiceeObjects: [invoiceeFact()] })).toEqual([]));
        it('rootfalse and output cannot prove a source', () => expect(evaluate(code, body(code), { invoiceeAddressDiffersFromEndUser: false }).some(x => x.blocking)).toBe(true));
        it('independent different source requires omitted IV', () => expect(evaluate(code, body(code, false), { invoiceeObjects: [invoiceeFact('A', 'Other')] }).some(x => x.blocking)).toBe(true));
        it('present IV children remain required when not mandatory', () => expect(evaluate(code, body(code).map(p => p[0] === 'NAD' && p[1] === 'IV' ? [...p.slice(0, 4), '', ...p.slice(5)] : p), { invoiceeObjects: [invoiceeFact()] }).some(x => x.blocking)).toBe(true));
        it('inbound has no local source-knowledge failure', () => expect(evaluate(code, body(code), {}, 'inbound')).toEqual([]));
        for (const alphabet of alphabets)
            it(`qualified different ${alphabet.join('')}`, () => expect(evaluate(code, body(code, true, 'Other'), { invoiceeObjects: [invoiceeFact('A', 'Other')] }, 'outbound', alphabet)).toEqual([]));
    });
it('own Z09 non-E excludes IV despite root E and difference', () => expect(evaluate('Z09', body('Z09', true, 'Other', 'E64'), { invoiceeAddressDiffersFromEndUser: true, invoiceeObjects: [invoiceeFact('A', 'Other')] }).some(x => x.blocking)).toBe(true));
it('IV sparse source projects the p118 dot', () => expect(prodatInvoiceeNadSegment({ customerId: 'BILL', idAgency: '89', customerName: 'Synthetic', addressLines: ['', 'BOX', 'c/o Name'] })).toContain('+.:'));
import { copyProdatInvoiceeObjects, invoiceeAddressesDiffer, invoiceeMandatory, type ProdatInvoiceeObject } from '@/lib/ediel/prodat/prodatInvoicee';
import { createProdatRegisterEvidence, readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
const fact = () => copyProdatInvoiceeObjects([invoiceeFact()])[0];
describe('comparison and event provenance', () => {
    it('partial equal comparison is unknown', () => { const f = fact(); f.invoicee.address.city = null; expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBeNull(); });
    it('known differing postcode decides despite an unknown city', () => { const f = fact(); f.invoicee.address.city = null; f.invoicee.address.postalCode = '99999'; expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBe(true); });
    it('different representation mode is not differing address proof', () => { const f = fact(); f.invoicee.address.representation!.mode = 5; f.invoicee.address.city = 'Other'; expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBeNull(); });
    it('unavailable is not known empty', () => { const f = fact(); f.invoicee.address.lines = ['Street', { unavailable: true }, '']; expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBeNull(); });
    it('equal Z06E with unknown event remains unknown but other codes need no history', () => { const f = fact(); f.event = { state: 'unknown' }; expect(invoiceeMandatory(f, 'Z06', 'E')).toBeNull(); expect(invoiceeMandatory(f, 'Z03', 'L')).toBe(false); });
    it('source-selected changed-to-same requires both current parties', () => { const f = fact(); f.event = { state: 'changed_to_same', reference: 'old-billing-record', effectiveAt: '2026-09-19T00:00:00Z', process: 'grid_owner_to_supplier_z06e', previousInvoicee: address('Previous') }; expect(evaluate('Z06', body('Z06'), { invoiceeObjects: [f] })).toEqual([]); expect(evaluate('Z06', body('Z06', false), { invoiceeObjects: [f] }).some(i => i.code === 'PRODAT_INVOICEE_REQUIRED')).toBe(true); expect(() => invoiceeMandatory(f, 'Z09', 'E')).toThrow(); });
    it('rejects contradictory changed-to-same history', () => { const f = fact(); f.event = { state: 'changed_to_same', reference: 'source', effectiveAt: '2026-09-19', process: 'grid_owner_to_supplier_z06e', previousInvoicee: f.invoicee.address }; expect(() => copyProdatInvoiceeObjects([f])).toThrow(); });
    it('252 unavailable can coexist with known postcode difference', () => { const f = fact(); f.invoicee.availability = 'unavailable'; f.invoicee.address.lines = [null, null, null]; f.invoicee.address.postalCode = '99999'; const parts = body('Z03', true, '').map(p => p[0] === 'NAD' && p[1] === 'IV' ? [...p.slice(0, 8), '99999', p[9]] : p); expect(evaluate('Z03', parts, { invoiceeObjects: [f] })).toEqual([]); });
    it('unknown252 is protected despite an active IV', () => { const f = fact(); f.invoicee.availability = 'unknown'; expect(evaluate('Z03', body('Z03'), { invoiceeObjects: [f] }).some(i => i.blocking && i.scope === 'prodat_dependent')).toBe(true); });
    for (const reason of ['Z27', 'Z70', 'E64', 'E32'])
        it(`Z09 ${reason} excludes IV`, () => expect(evaluate('Z09', body('Z09', true, 'Street', reason), { invoiceeObjects: [fact()] }).some(i => i.code === 'PRODAT_INVOICEE_FORBIDDEN')).toBe(true));
    for (const modify of ['missing', 'duplicate', 'misplaced'])
        it(`own Z09 reason ${modify}`, () => { let b = body('Z09'); if (modify === 'missing')
            b = b.filter(p => !['CCI', 'CAV'].includes(p[0] as string)); if (modify === 'duplicate')
            b.splice(3, 0, ['CCI', '', 'Z13'], ['CAV', 'E34']); if (modify === 'misplaced') {
            b = b.filter(p => !['CCI', 'CAV'].includes(p[0] as string));
            b.push(['CCI', '', 'Z13'], ['CAV', 'E34']);
        } expect(evaluate('Z09', b, { invoiceeObjects: [fact()] }).some(i => i.blocking)).toBe(true); });
    for (const modify of ['extra', 'wrongagency', 'duplicate'])
        it(`source scope ${modify}`, () => { const f = fact(); if (modify === 'extra')
            f.meteringPointId = 'B'; if (modify === 'wrongagency')
            f.identityAgency = '9'; expect(evaluate('Z03', body('Z03'), { invoiceeObjects: modify === 'duplicate' ? [f, f] : [f] }).some(i => i.blocking)).toBe(true); });
    it('bound evidence rejects other company and stale body', () => { const t = tokenizeEdifact(raw(body('Z03'), 'Z03')), segments = t.segments.map(s => s.raw), evidence = createProdatRegisterEvidence({ code: 'Z03', rawSegments: segments, una: t.una, facts: { invoiceeObjects: [fact()] } }); const input = { code: 'Z03', rawSegments: segments, una: t.una, companyId: 'tenant', parsedPayload: { prodatEngine: { registerEvidence: evidence } } }; expect(readProdatRegisterEvidence(input)?.invoiceeObjects).toHaveLength(1); expect(() => readProdatRegisterEvidence({ ...input, companyId: 'other' })).toThrow(); expect(() => readProdatRegisterEvidence({ ...input, rawSegments: segments.map(s => s.replace('Street', 'Changed')) })).toThrow(); });
});
import { evaluateProdatInvoicee } from '@/lib/ediel/rulebook/prodatInvoiceePolicy';
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat';
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types';
import { selectedAddressFact } from './fixtures/prodat-ud';
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards';
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock';
import type { EdielMessageRow } from '@/lib/ediel/types';
const selected = () => ({ invoiceeObjects: [fact()], endUserAddressObjects: [selectedAddressFact('A', 'tenant', '89', 'USER', ['Street'])] });
const invoicee = { id: 'BILL', idAgency: '89' as const, name: 'Synthetic', addressLines: ['Street'], postalCode: '12345', city: 'Town', country: 'SE' };
const profile = (): ProdatEngineProductionContext => ({ code: 'Z03', bgmReference: 'DOC', transactionReference: 'CASE', senderEdielId: '12345', receiverEdielId: '54321', meterPointId: 'A', meterPointIdAgency: '89', customerId: 'USER', customerIdAgency: '89', customerName: 'Synthetic', customerAddress: 'Street', customerPostalCode: '12345', customerCity: 'Town', customerCountry: 'SE', startDate: '202610010000', reasonForTransaction: 'Z22', invoicee, dependentConditionFacts: selected() });
const generic = (): BuildProdatMessageInput => ({ companyId: 'tenant', role: 'supplier', businessCode: 'Z03', sender: { edielId: '12345' }, receiver: { edielId: '54321' }, meteringPoint: { id: 'A', identityAgency: '89' }, customer: { id: 'USER', idAgency: '89', name: 'Synthetic', addressLines: ['Street'], postalCode: '12345', city: 'Town', country: 'SE' }, dates: { startDate: '2026-10-01' }, references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z22' }, environment: 'test', invoicee, dependentConditionFacts: selected() });
const target = (v: {
    code: string;
}) => v.code.startsWith('PRODAT_INVOICEE_') || v.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED';
describe('actual builders retain choice separately from requiredness', () => {
    it('profile emits optional qualified IV and activates actual children', () => {
        const r = buildProfiledProdatSegments({ context: profile() });
        expect(r.segments.some(s => s.startsWith('NAD+IV'))).toBe(true);
        expect(r.issues.filter(target)).toEqual([]);
        expect(r.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({ fieldNumber: '250', status: 'required', decisionPhase: 'rendered_wire_invoicee' }));
        expect(r.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({ fieldNumber: 'INVOICEE_GROUP', status: 'not_required' }));
    });
    it('profile explicit clear cannot resurrect fallback', () => {
        const r = buildProfiledProdatSegments({ context: profile(), portalSnapshot: { invoicee: null } });
        expect(r.segments.some(s => s.startsWith('NAD+IV'))).toBe(false);
        expect(r.issues.filter(target)).toEqual([]);
    });
    it('generic carries native IV and evidence and preserves clear', () => {
        const r = buildProdatMessage(generic());
        expect(r.rawEdifact).toContain('NAD+IV+BILL::89');
        expect(r.registerEvidence.facts.invoiceeObjects).toHaveLength(1);
        expect(buildProdatMessage({ ...generic(), invoicee: null }).rawEdifact).not.toContain('NAD+IV');
    });
    it('generic cannot clear required IV or borrow another company', () => {
        const p = generic();
        p.dependentConditionFacts!.invoiceeObjects![0].invoicee.address.city = 'Other';
        expect(() => buildProdatMessage({ ...p, invoicee: null })).toThrow(/obligatorisk IV/);
        expect(() => buildProdatMessage({ ...generic(), companyId: 'OTHER' })).toThrow(/invoicee|address/);
    });
    it('mixed formatted postcodes remain unknown even with common convention', () => {
        const f = fact();
        f.endUser.address.postalCode = '123 45';
        expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBeNull();
        f.endUser.address.city = 'Other';
        expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBe(true);
    });
    it('unknown mandatory condition does not deactivate actual children', () => {
        const f = fact();
        f.endUser.address.city = null;
        const w = tokenizeEdifact(raw(body('Z03'), 'Z03'));
        const r = evaluateProdatInvoicee({ code: 'Z03', rawSegments: w.segments.map(s => s.raw), facts: { invoiceeObjects: [f] } });
        expect(r.statuses.get('INVOICEE_GROUP')).toBe('undetermined');
        expect(r.statuses.get('250')).toBe('required');
        expect(r.statuses.get('252')).toBe('required');
    });
});
function row(environment: 'test' | 'production', state: 'valid' | 'absent' | 'required-omitted' | 'tampered' | 'wrong-company'): EdielMessageRow {
    const payload = raw(body('Z03', state !== 'required-omitted'), 'Z03'), wire = tokenizeEdifact(payload), facts = selected();
    if (state === 'required-omitted')
        facts.invoiceeObjects[0].invoicee.address.city = 'Other';
    const evidence = createProdatRegisterEvidence({ code: 'Z03', rawSegments: wire.segments.map(s => s.raw), una: wire.una, facts: state === 'absent' ? {} : facts });
    return { company_id: state === 'wrong-company' ? 'OTHER' : 'tenant', message_family: 'PRODAT', message_code: 'Z03', message_version: '26A', direction: 'outbound', environment, message_standard: 'edifact', application_reference: '23-DDQ-PRODAT', raw_payload: state === 'tampered' ? payload.replace('Street', 'Changed') : payload, mime_type: 'application/EDIFACT', parsed_payload: { rulebookAllowInvalidSend: true, prodatEngine: { registerEvidence: evidence } } } as unknown as EdielMessageRow;
}
describe('normal and missing-snapshot catch guards protect invoicee qualification', () => {
    for (const environment of ['test', 'production'] as const)
        for (const state of ['absent', 'required-omitted', 'tampered', 'wrong-company'] as const)
            it(`${environment}/${state}: both guards reject despite override`, () => {
                const m = row(environment, state);
                expect(preflightEdielMessageRow(m, 'send').issues.some(i => i.severity === 'error')).toBe(true);
                expect(() => assertRulebookAllowsSend(m)).toThrow();
                expect(() => assertEdielSendLock(m)).toThrow();
            });
    it('valid test selection passes both existing override guards', () => { const m = row('test', 'valid'); expect(preflightEdielMessageRow(m, 'send').issues.filter(target)).toEqual([]); expect(() => assertRulebookAllowsSend(m)).not.toThrow(); expect(() => assertEdielSendLock(m)).not.toThrow(); });
});
for (const change of ['unknown-representation', 'country-alias', 'dot-source'] as const)
    it(`conservative source qualification ${change}`, () => {
        const f = fact();
        if (change === 'unknown-representation')
            f.invoicee.address.representation = null;
        if (change === 'country-alias')
            f.invoicee.address.country = 'SWE';
        if (change === 'dot-source')
            f.invoicee.address.lines = ['.', 'BOX', ''];
        if (change === 'dot-source')
            expect(() => copyProdatInvoiceeObjects([f])).toThrow();
        else
            expect(invoiceeAddressesDiffer(f.endUser.address, f.invoicee.address)).toBeNull();
    });
for (const [label, element, value] of [
    ['missing id', 2, ['', '', '89']], ['bad identity agency', 2, ['BILL', '', '260']], ['identity overflow', 2, ['B'.repeat(36), '', '89']],
    ['name overflow', 4, ['S'.repeat(36)]], ['extra name', 4, ['Synthetic', 'Second', 'Third']], ['missing first name', 4, ['', 'Second']],
    ['street overflow', 5, ['S'.repeat(36)]], ['extra street', 5, ['Street', '', '', 'Fourth']], ['dot without source', 5, ['.']],
    ['missing postcode', 8, ''], ['formatted IV postcode', 8, '123 45'], ['postcode overflow', 8, '1'.repeat(10)],
    ['missing city', 6, ''], ['city overflow', 6, 'C'.repeat(36)], ['missing country', 9, ''], ['country overflow', 9, 'SWEDEN'],
    ['unused C058', 3, 'Borrowed'], ['unused subdivision', 7, 'Borrowed'],
] as const)
    it(`actual active IV validates ${label}`, () => {
        const b = body('Z03').map(p => p[0] === 'NAD' && p[1] === 'IV' ? p.map((v, i) => i === element ? value : v) : p);
        expect(evaluate('Z03', b, { invoiceeObjects: [fact()] }).some(i => i.blocking)).toBe(true);
    });
it('first object cannot borrow sibling IV to satisfy known required parent', () => {
    const a = fact();
    a.invoicee.address.city = 'Other';
    const b = fact();
    b.meteringPointId = 'B';
    const parts = [...body('Z03', false), ...body('Z03').map(p => p[0] === 'LIN' ? ['LIN', '2', '', ['B', '', '', '89']] : p)];
    expect(evaluate('Z03', parts, { invoiceeObjects: [a, b] }).some(i => i.code === 'PRODAT_INVOICEE_REQUIRED')).toBe(true);
});
it('first register cannot borrow a later IV', () => {
    const a = fact();
    a.invoicee.address.city = 'Other';
    const parts = [...body('Z04', false).map(p => p[0] === 'LIN' ? ['LIN', '1', ['1', '9'], ['A', '', '', '89']] : p), ['LIN', '2', ['2', '9'], ['A', '', '', '89']], ['NAD', 'IV', ['BILL', '', '89'], '', 'Synthetic', 'Street', 'Other', '', '12345', 'SE']];
    expect(evaluate('Z04', parts, { invoiceeObjects: [a] }).some(i => i.blocking)).toBe(true);
});
it('a later unavailable252 does not deactivate another actual required252', () => {
    const a = fact(), b = fact();
    b.meteringPointId = 'B';
    b.invoicee.availability = 'unavailable';
    b.invoicee.address.lines = [null, null, null];
    b.invoicee.address.postalCode = '99999';
    const parts = [...body('Z03'), ...body('Z03', true, '').map(p => p[0] === 'LIN' ? ['LIN', '2', '', ['B', '', '', '89']] : p[0] === 'NAD' && p[1] === 'IV' ? [...p.slice(0, 8), '99999', p[9]] : p)];
    const wire = tokenizeEdifact(raw(parts, 'Z03'));
    const r = evaluateProdatInvoicee({ code: 'Z03', rawSegments: wire.segments.map(s => s.raw), facts: { invoiceeObjects: [a, b] } });
    expect(r.issues).toEqual([]);
    expect(r.statuses.get('252')).toBe('required');
});

it('invalid source evidence still checks actual parent children',()=>{
 const parts=body('Z03').map(p=>p[0]==='NAD'&&p[1]==='IV'?[...p.slice(0,4),'',...p.slice(5)]:p),wire=tokenizeEdifact(raw(parts,'Z03'));
 const r=evaluateProdatInvoicee({code:'Z03',rawSegments:wire.segments.map(s=>s.raw),facts:{invoiceeObjects:[{...fact(),identityAgency:'invalid'}] as unknown as ProdatInvoiceeObject[]}});
 expect(r.issues.some(i=>i.code==='PRODAT_INVOICEE_EVIDENCE_INVALID')).toBe(true);expect(r.issues.some(i=>i.code==='PRODAT_INVOICEE_FORMAT_INVALID')).toBe(true);expect(r.statuses.get('250')).toBe('required');expect(r.statuses.get('252')).toBe('undetermined');
})
it('unavailable cannot contradict selected nonempty street components',()=>{const f=fact();f.invoicee.availability='unavailable';expect(()=>copyProdatInvoiceeObjects([f])).toThrow()})
