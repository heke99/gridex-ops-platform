import { describe, expect, it } from 'vitest';
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator';
import { evaluateProdatDependentConditions, type ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import { copyProdatRegisterFacts, resolveProdatRegisterConditionFacts } from '@/lib/ediel/prodat/prodatRegisterEvidence';
const start = '202610010000', end = '202611010000';
const change = (at = '202609010000') => ({ meteringPointId: 'A', identityAgency: '89', kind: 'change_before_supply', change: { reference: 'change-A', revision: '1' }, contract: { reference: 'supply-A', revision: '1' }, changeEffectiveAt: at, supplyStartsAt: start, supplier: { id: '54321', qualifier: '160', agency: 'SVK' } });
const production = (event: 'signed' | 'ceased' = 'signed') => ({ meteringPointId: 'A', identityAgency: '89', kind: 'production_contract', direction: 'production', contract: { reference: 'production-A', revision: '1' }, event: { kind: event, reference: 'event-A', revision: '1', occurredAt: '202609010000' }, supplyBoundaryAt: event === 'signed' ? start : end });
const facts = <T>(object: T) => ({ market: 'electricity', dateEventObjects: [object], dateEventSource: { kind: 'caller_selection', reference: 'independent-test-scenario' } });
function check(code: string, reason: string, dates: string[], source: unknown = {}, direction: 'outbound' | 'inbound' = 'outbound') {
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: code === 'Z09' ? 'D' : code === 'Z06' ? 'G' : 'M', direction, referenceDate: '2026-09-19', applicationReference: '23-DDQ-PRODAT', mode: 'catalog_evidence', prodatDependentFacts: source as ProdatDependentConditionFacts });
    return validateCanonicalPolicyFields({ policy: { ...policy, fieldRules: policy.fieldRules.filter(r => 'fieldNumber' in r && ['210', '211'].includes(r.fieldNumber!)) }, rawSegments: ['UNH+M+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOC+9+AB`, 'NAD+FR+12345:160:SVK', 'NAD+DO+54321:160:SVK', 'LIN+1++A:::89', ...dates, 'CCI++Z13', `CAV+${reason}`] });
}
const dtm = (qualifier: string, value = start) => `DTM+${qualifier}:${value}:203`;
describe('four source-bound date conditions', () => {
    for (const code of ['Z06', 'Z10']) {
        it(`${code} ignores root false when before-start requires210`, () => expect(check(code, code === 'Z06' ? 'E32' : 'E58', [], { ...facts(change()), byCell: { [`${code}:210`]: false } }).some(i => i.blocking)).toBe(true));
        it(`${code} accepts independently sourced before-start210`, () => expect(check(code, code === 'Z06' ? 'E32' : 'E58', [dtm('92'), dtm('157', '202609010000')], facts(change()))).toEqual([]));
        it(`${code} false does not forbid actual matching210`, () => expect(check(code, code === 'Z06' ? 'E32' : 'E58', [dtm('92'), dtm('157', start)], facts(change(start)))).toEqual([]));
    }
    it('Z06E p109 excludes nonmandatory210', () => expect(check('Z06', 'E34', [dtm('92'), dtm('157', start)], facts(change(start))).some(i => i.blocking)).toBe(true));
    for (const event of ['signed', 'ceased'] as const) {
        it(`Z09D ${event} accepts selected boundary`, () => expect(check('Z09', 'Z70', [dtm(event === 'signed' ? '92' : '93', event === 'signed' ? start : end)], facts(production(event)))).toEqual([]));
        it(`Z09D ${event} rejects opposite date`, () => expect(check('Z09', 'Z70', [dtm(event === 'signed' ? '93' : '92')], facts(production(event))).some(i => i.blocking)).toBe(true));
    }
    it('Z09D XOR is independent of forged root statuses', () => expect(check('Z09', 'Z70', [dtm('92'), dtm('93', end)], { byCell: { 'Z09:210': true, 'Z09:211': true } }).some(i => i.blocking)).toBe(true));
    it('inbound single date does not require local event', () => expect(check('Z09', 'Z70', [dtm('92')], {}, 'inbound')).toEqual([]));
    it('inbound ownD still rejects both dates', () => expect(check('Z09', 'Z70', [dtm('92'), dtm('93', end)], {}, 'inbound').some(i => i.blocking)).toBe(true));
    it('inbound nonD ignores extra210', () => expect(check('Z09', 'Z27', [dtm('92')], {}, 'inbound')).toEqual([]));
    it('known temporal comparison cannot use a wrong boundary', () => expect(check('Z06', 'E32', [dtm('92', '202610020000'), dtm('157', '202609010000')], facts(change())).some(i => i.blocking)).toBe(true));
    it('byCell is not a prewire production event', () => expect(evaluateProdatDependentConditions({ messageCode: 'Z09', facts: { byCell: { 'Z09:210': true } } }).find(x => x.fieldNumber === '210')?.status).toBe('undetermined'));
    it('copies date-event domain independently of caller mutation', () => { const f = facts(production()); const copied = copyProdatRegisterFacts(f); expect(copied).toHaveProperty('dateEventObjects', f.dateEventObjects); f.dateEventObjects[0].event.reference = 'changed'; expect(copied).not.toEqual(f); });
    it('explicit clear never revives source', () => expect(resolveProdatRegisterConditionFacts(facts(production()) as ProdatDependentConditionFacts, { dependentConditionFacts: null })).toEqual({}));
    for (const at of ['2026-09-01', '2026-09-01T00:00:01Z', '2026-09-01T00:00:00.001Z'])
        it(`rejects unqualified precision ${at}`, () => expect(() => copyProdatRegisterFacts(facts(change(at)))).toThrow());
});
import { createProdatRegisterEvidence, readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards';
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock';
import type { EdielMessageRow } from '@/lib/ediel/types';
const guardSegments = ['UNH+M+PRODAT:D:97A:UN:E2SE6A', 'BGM+Z09+DOC+9+AB', 'LIN+1++A:::89', dtm('92'), 'CCI++Z13', 'CAV+Z70'];
for (const guard of [assertRulebookAllowsSend, assertEdielSendLock])
    it(`${guard.name} protects XOR despite invalid-send override`, () => {
        const segments = [...guardSegments, dtm('93', end)];
        const row: Partial<EdielMessageRow> = { company_id: 'tenant', direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z09', message_version: '26A', application_reference: '23-DDQ-PRODAT', message_standard: 'edifact', mime_type: 'application/edifact', raw_payload: segments.join("'") + "'UNT+8+M'", parsed_payload: { rulebookAllowInvalidSend: true } };
        expect(() => guard(row as EdielMessageRow)).toThrow();
    });
it('persisted caller facts cannot acquire lifecycle authority', () => {
    const evidence = createProdatRegisterEvidence({ code: 'Z09', rawSegments: guardSegments, facts: facts(production()) as ProdatDependentConditionFacts });
    expect(() => readProdatRegisterEvidence({ code: 'Z09', rawSegments: guardSegments, companyId: 'tenant', parsedPayload: { prodatEngine: { registerEvidence: evidence } } })).toThrow();
});
for (const value of ['DTM+ 92:202610010000:203', 'DTM+92 :202610010000:203', 'DTM+92:202610010000:203:X', 'DTM+92:202610010000:203+EXTRA'])
    it(`malformed210 stays protected: ${value}`, () => expect(check('Z09', 'Z70', [value], facts(production())).some(i => i.blocking && i.scope === 'prodat_dependent')).toBe(true));
it('padded own reason cannot certify a production event', () => expect(check('Z09', ' Z70 ', [dtm('92')], facts(production())).some(i => i.blocking && i.scope === 'prodat_dependent')).toBe(true));
it('inbound ownD malformed dates remain syntax errors, not local-source errors', () => expect(check('Z09', 'Z70', ['DTM+ 92:202610010000:203'], {}, 'inbound').some(i => i.code === 'PRODAT_DATE_EVENT_FORMAT_INVALID')).toBe(true));
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat';
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
const generic = (): BuildProdatMessageInput => ({ companyId: 'tenant', role: 'supplier', businessCode: 'Z09', transactionSubtype: 'F', sender: { edielId: '12345' }, receiver: { edielId: '54321' }, meteringPoint: { id: 'A', identityAgency: '89', gridArea: 'TES' }, dates: { contractStartDate: start }, references: { LI: 'CASE' }, codedAttributes: { Z13: 'Z70' }, environment: 'test', dependentConditionFacts: facts(production()) as ProdatDependentConditionFacts });
it('generic ownD date survives rootF while caller readiness remains unqualified', () => { const r = buildProdatMessage(generic()); expect(r.rawEdifact).toContain(dtm('92')); expect(r).toHaveProperty('dateEventReadiness', 'unqualified'); });
it('profile keeps assumed event policy separate from qualified readiness', () => { const r = buildProfiledProdatSegments({ context: { code: 'Z09', customerName: 'Synthetic', bgmReference: 'DOC', transactionReference: 'CASE', senderEdielId: '12345', receiverEdielId: '54321', meterPointId: 'A', meterPointIdAgency: '89', gridAreaId: 'TES', reasonForTransaction: 'Z70', contractStartDate: start, dependentConditionFacts: facts(production()) as ProdatDependentConditionFacts }, variant: 'D', mode: 'test' }); expect(r.issues.filter(i => i.code.startsWith('PRODAT_DATE_EVENT_'))).toEqual([]); expect(r.diagnostics).toHaveProperty('dateEventReadiness', 'unqualified'); });
import { prodatEventMinute } from '@/lib/ediel/prodat/prodatDateEvents';
for (const [value, expected] of [['2026-07-01T00:00:00+02:00', '202606302300'], ['2026-06-30T22:00:00Z', '202606302300'], ['2026-10-25T02:30:00+02:00', '202610250130'], ['2026-10-25T02:30:00+01:00', '202610250230'], ['2028-02-29T00:00', '202802290000'], ['2027-02-29T00:00', null], ['2026-12-31T23:00Z', '202701010000']] as const)
    it(`exact-minute standard time ${value}`, () => expect(prodatEventMinute(value)).toBe(expected));
for (const [at, required] of [['202609302359', true], ['202610010000', false], ['202610010001', false]] as const)
    it(`strict before ${at}`, () => expect(check('Z10', 'E58', [dtm('157', at)], facts(change(at))).some(i => i.code === 'PRODAT_DATE_EVENT_REQUIRED')).toBe(required));
it('missing event kind remains unknown despite210 presence', () => { const f = production(); const unknown = { ...f, event: { ...f.event, kind: null } }; expect(check('Z09', 'Z70', [dtm('92')], facts(unknown)).some(i => i.code === 'PRODAT_DATE_EVENT_UNDETERMINED')).toBe(true); });
it('source signing occurrence cannot substitute for supply start', () => expect(check('Z09', 'Z70', [dtm('92', '202609010000')], facts(production())).some(i => i.code === 'PRODAT_DATE_EVENT_VALUE_MISMATCH')).toBe(true));
it('unknown supplier does not erase known before field requirement', () => { const f = { ...change(), supplier: null }; expect(check('Z06', 'E32', [], facts(f)).map(i => i.code)).toContain('PRODAT_DATE_EVENT_REQUIRED'); });
it('Z10 physical replacement minute cannot substitute for p110 effective midnight', () => expect(check('Z10', 'E58', [dtm('92'), dtm('157', '202609011230')], facts(change('202609011230'))).some(i => i.code === 'PRODAT_DATE_EVENT_BOUNDARY_INVALID')).toBe(true));
for(const replacement of [undefined, 0, '', [], {reference:'x'}, {reference:'x',revision:'1',authority:true}])it(`rejects malformed reference shape ${JSON.stringify(replacement)}`,()=>{const f=change();expect(()=>copyProdatRegisterFacts(facts({...f,contract:replacement}))).toThrow()})
it('undefined snapshot falls back while explicit empty clears date facts',()=>{const f=facts(production()) as ProdatDependentConditionFacts;expect(resolveProdatRegisterConditionFacts(f,{dependentConditionFacts:undefined})).toEqual(f);expect(resolveProdatRegisterConditionFacts(f,{dependentConditionFacts:{}})).toEqual({})})
