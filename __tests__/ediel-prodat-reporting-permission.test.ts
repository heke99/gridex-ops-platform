import { it, expect } from 'vitest';
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator';
import { copyProdatRegisterFacts, createProdatRegisterEvidence, readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
import { evaluateProdatDependentConditions, type ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import { reportingSelection, reportingSegments } from './fixtures/prodat-reporting-permission';
function check(segments: string[], selection: unknown = reportingSelection()) {
    const facts = { market: 'electricity', reportingPermission: selection } as ProdatDependentConditionFacts;
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: 'V', direction: 'outbound', referenceDate: '2026-09-19', applicationReference: '23-DGI-PRODAT', mode: 'catalog_evidence', prodatDependentFacts: facts });
    return validateCanonicalPolicyFields({ policy: { ...policy, fieldRules: policy.fieldRules.filter(r => 'fieldNumber' in r && ['321', '323'].includes(r.fieldNumber!)) }, rawSegments: segments });
}
it('independent bounded business request accepts B72 with identityless own scope', () => expect(check(reportingSegments())).toEqual([]));
it('missing independent reporting facts cannot be supplied by output', () => expect(check(reportingSegments(), null).some(i => i.blocking)).toBe(true));
it('bounded end must equal independently declared minute', () => expect(check(reportingSegments('S17', '202609191159')).some(i => i.blocking)).toBe(true));
it('own LI cannot borrow an otherwise matching request', () => expect(check(reportingSegments().map(s => s.startsWith('RFF+LI:') ? 'RFF+LI:OTHER' : s)).some(i => i.blocking)).toBe(true));
it('copies strict reporting facts instead of discarding authority', () => { const selected = reportingSelection(); const copied = copyProdatRegisterFacts({ reportingPermission: selected }); expect(copied).toHaveProperty('reportingPermission', selected); selected.objects[0].process.key = 'mutated'; expect(copied).not.toHaveProperty('reportingPermission.objects.0.process.key', 'mutated'); });
for (const change of [undefined, { kind: 'assessed', code: 'B72', authority: true }, null])
    it(`rejects malformed assessment ${JSON.stringify(change)}`, () => { const selected = reportingSelection(); expect(() => copyProdatRegisterFacts({ reportingPermission: { ...selected, objects: [{ ...selected.objects[0], purpose: change }] } })).toThrow(); });
for (const code of ['Z13', 'Z14'])
    it(`${code}: root facts cannot certify321/323`, () => { const decisions = evaluateProdatDependentConditions({ messageCode: code, facts: { byCell: { [`${code}:321`]: true }, customerKind: 'private' } }); expect(decisions.filter(x => ['321', '323'].includes(x.fieldNumber)).map(x => x.status)).toEqual(['undetermined', 'undetermined']); });
it('serialized pure selection never becomes persisted send authority', () => { const rawSegments = reportingSegments(); const facts = { reportingPermission: reportingSelection() } as ProdatDependentConditionFacts; const evidence = createProdatRegisterEvidence({ code: 'Z13', rawSegments, facts }); expect(() => readProdatRegisterEvidence({ code: 'Z13', rawSegments, companyId: 'company', parsedPayload: { prodatEngine: { registerEvidence: evidence } } })).toThrow(); });
import { reportingObject, reportingSource } from './fixtures/prodat-reporting-permission';
it('fabricated tgt envelope cannot replace independent persisted source read', () => { const rawSegments = reportingSegments(), facts = { reportingPermission: { source: reportingSource(), objects: [reportingObject()] } }; const evidence = createProdatRegisterEvidence({ code: 'Z13', rawSegments, facts }); expect(() => readProdatRegisterEvidence({ code: 'Z13', rawSegments, companyId: reportingSource().scope.companyId, parsedPayload: { prodatEngine: { registerEvidence: evidence } } })).toThrow(); });
it('serialized evidence does not retain a caller evaluation clock', () => { const evidence = createProdatRegisterEvidence({ code: 'Z13', rawSegments: reportingSegments(), facts: { reportingPermission: reportingSelection() } }); expect(evidence.facts.reportingPermission).not.toHaveProperty('evaluationUtcMs'); });
