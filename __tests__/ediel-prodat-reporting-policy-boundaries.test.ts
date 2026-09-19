import { it, expect } from 'vitest';
import { validateProdatReportingPermission as validate } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy';
import { copyReportingSelection, reportingBusinessMinute, reportingEvaluationMinute, type ReportingObject, type PureSelection } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { reportingSelection, reportingSegments, reportingNow, reportingZ14Selection, reportingId } from './fixtures/prodat-reporting-permission';
import { alphabets, raw, input, type Parts } from './fixtures/prodat-register';
function z14Wire(reason = 'S17') { return ['LIN+1++A:::9', 'CCI++Z13', `CAV+${reason}`, 'RFF+LI:CASE', 'NAD+UD+ID::89']; }
function check(selection: PureSelection, segments: string[], code = 'Z13') { return validate({ code, rawSegments: segments, facts: { reportingPermission: selection } }); }
for (const [value, expected] of [['202609191200', '202609191200'], ['2026-09-19T11:00:00.000Z', '202609191200'], ['2026-03-29T00:00:00Z', '202603290100'], ['2026-10-25T00:00:00Z', '202610250100'], ['2026-09-19', null], ['20260919120001', null], ['2026-09-19T11:00:01Z', null], ['2026-09-19T11:00:00.001Z', null], ['202602290000', null], [' 202609191200', null]] as const)
    it(`exact business minute ${value}`, () => expect(reportingBusinessMinute(value)).toBe(expected));
it('fixed UTC+1 rounds evaluation down to its minute', () => expect(reportingEvaluationMinute(reportingNow)).toBe('202609191200'));
for (const relation of ['past', 'equal', 'future'] as const)
    it(`historical Z13 ${relation} end with current minute`, () => { const selection: PureSelection = reportingSelection(); selection.objects[0].expectedReason = 'S18'; if (selection.objects[0].term.kind !== 'bounded')
        throw Error('fixture'); selection.objects[0].term.endMinute = relation === 'past' ? '202609191159' : relation === 'equal' ? '202609191200' : '202609191201'; expect(check(selection, reportingSegments('S18', selection.objects[0].term.endMinute)).length > 0).toBe(relation === 'future'); });
it('explicit indefinite nonprivate omission qualifies', () => { const selection: PureSelection = reportingSelection(), o = selection.objects[0]; o.term = { kind: 'indefinite', declaration: { ...reportingSelection().objects[0].term.declaration } }; o.purpose = { kind: 'absent', declaration: { ...reportingSelection().objects[0].term.declaration } }; expect(check(selection, reportingSegments('S17', '', ''))).toEqual([]); });
for (const field of ['term', 'classification', 'purpose'] as const)
    it(`unknown ${field} remains blocked`, () => { const s: PureSelection = reportingSelection(); s.objects[0][field] = { kind: 'unknown' }; expect(check(s, reportingSegments()).length).toBeGreaterThan(0); });
it('positive Z14 independently correlates absent request purpose', () => expect(check(reportingZ14Selection(), z14Wire(), 'Z14')).toEqual([]));
it('Z14 historical response does not inherit Z13 future-end ban', () => { const s = reportingZ14Selection('S18'); s.objects[0].term = { kind: 'bounded', declaration: reportingSelection().objects[0].term.declaration, endMinute: '202710010000' }; const wire = z14Wire('S18'); wire.splice(1, 0, 'DTM+91:202710010000:203'); expect(check(s, wire, 'Z14')).toEqual([]); });
for (const change of ['requestMissing', 'purposePresent', 'privateAbsent', 'requestRevision', 'installationAgency', 'requestCustomer', 'requestLI'] as const)
    it(`positive Z14 rejects ${change}`, () => { const s = reportingZ14Selection(), o = s.objects[0] as Extract<ReportingObject, {
        code: 'Z14';
    }>, r = o.requestAssociation; if (r.kind !== 'known')
        throw Error('fixture'); if (change === 'requestMissing')
        o.requestAssociation = { kind: 'unknown' }; if (change === 'purposePresent')
        r.purpose = { kind: 'present', code: 'B72' }; if (change === 'privateAbsent')
        o.classification = { kind: 'private', record: reportingSelection().objects[0].classification.record }; if (change === 'requestRevision')
        r.requestRevision = reportingId(99); if (change === 'installationAgency')
        r.allowedInstallations[0].agency = '89'; if (change === 'requestCustomer')
        r.customer.id = 'OTHER'; if (change === 'requestLI')
        r.li = 'OTHER'; expect(check(s, z14Wire(), 'Z14').length).toBeGreaterThan(0); });
it('matching independently assessed request purpose is required on Z14', () => { const s = reportingZ14Selection(), o = s.objects[0] as Extract<ReportingObject, {
    code: 'Z14';
}>; if (o.requestAssociation.kind !== 'known')
    throw Error('fixture'); o.requestAssociation.purpose = { kind: 'present', code: 'B72' }; o.purpose = { ...reportingSelection().objects[0].purpose, customer: { ...o.customer } }; const wire = z14Wire(); wire.splice(3, 0, 'CCI++Z24', 'CAV+B72'); expect(check(s, wire, 'Z14')).toEqual([]); expect(check(s, z14Wire(), 'Z14').length).toBeGreaterThan(0); });
it('pure positive Z14 is still unqualified at persisted send boundary', () => expect(validate({ code: 'Z14', rawSegments: z14Wire(), facts: { reportingPermission: reportingZ14Selection() }, requireAuthority: true }).some(i => i.code === 'PRODAT_REPORTING_SOURCE_UNQUALIFIED')).toBe(true));
for (const alphabet of alphabets)
    it(`physical321/323 across UNA ${alphabet.join('')}`, () => {
        const source = reportingSelection(), o = source.objects[0], body: Parts[] = [['LIN', '1'], ['DTM', ['91', o.term.endMinute, '203']], ['CCI', '', 'Z13'], ['CAV', 'S17'], ['CCI', '', 'Z24'], ['CAV', 'B72'], ['RFF', ['LI', o.li]], ['RFF', ['ANJ', o.anj]], ['NAD', 'UD', [o.customer.id, o.customer.qualifier, o.customer.agency]]];
        const v = (parts: Parts[]) => { const wire = input(raw(parts, 'Z13', alphabet), 'Z13'); return validate({ code: 'Z13', rawSegments: wire.rawSegments, una: wire.una, facts: { reportingPermission: source } }); };
        expect(v(body)).toEqual([]);
        for (const bad of [[['DTM', ['91', o.term.endMinute, '203']], ...body], body.concat([['CCI', '', 'Z24'], ['CAV', 'B72']]), body.map(p => p[0] === 'DTM' ? ['DTM', [' 91', o.term.endMinute, '203']] : p), body.map(p => p[0] === 'CAV' && p[1] === 'B72' ? ['CAV', ['B72', 'EXTRA']] : p)] as Parts[][])
            expect(v(bad).length).toBeGreaterThan(0);
        const n = input(raw([['LIN', '1'], ['CCI', '', 'Z13'], ['CAV', 'Z96']], 'Z14', alphabet), 'Z14');
        expect(validate({ code: 'Z14', rawSegments: n.rawSegments, una: n.una, requireAuthority: true })).toEqual([]);
    });
it('incoming local unknown is not sender-invalid while Gregorian syntax remains checked', () => { expect(validate({ code: 'Z13', rawSegments: reportingSegments(), direction: 'inbound' })).toEqual([]); expect(validate({ code: 'Z13', rawSegments: reportingSegments('S17', '202602290000'), direction: 'inbound' }).length).toBeGreaterThan(0); });
it('strict aggregate rejects unknown nested keys and duplicate objects', () => { const s = reportingSelection(); expect(() => copyReportingSelection({ ...s, objects: [...s.objects, ...s.objects] })).toThrow(); expect(() => copyReportingSelection({ ...s, objects: [{ ...s.objects[0], process: { ...s.objects[0].process, liveAuthority: true } }] })).toThrow(); });
