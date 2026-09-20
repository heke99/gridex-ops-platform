import {prodatComponentEvidence,type ProdatFailureEvidence} from '@/lib/ediel/prodat/prodatFailureEvidence'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { copyMeterChangeSelection, meterChangeCondition, PRODAT_EL_AGGREGATION_PRODUCTS, type MeterChangeObject } from '@/lib/ediel/prodat/prodatMeterChangeFacts';
import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups';
import { prodatRegisterTokens } from '@/lib/ediel/prodat/prodatRegisterFields';
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields';
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
import { validateFieldMatrixPayload } from './fieldMatrix';
import type { ProdatDependentConditionFacts, ProdatDependentConditionStatus } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielRulebookIssue } from './rulebook';
export type MeterChangePolicyInput = {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts | null;
    direction?: 'inbound' | 'outbound';
    applicationReference?: string | null;
};
type MeterChangeIssue = EdielRulebookIssue & {
    meteringPointId?: string | null;
    lineItemReference?: string | null;
};
export function validateProdatMeterChange(input: MeterChangePolicyInput) { return evaluateProdatMeterChange(input).issues; }
/** P119 gate precedes every selected field check. U code controls are the bounded
 * p119/p122 inference approved in the source audit, never a history inference. */
export function evaluateProdatMeterChange(input: MeterChangePolicyInput) {
    const issues: MeterChangeIssue[] = [], statuses = new Map<string, ProdatDependentConditionStatus>();
    if (input.code !== 'Z10')
        return { issues, statuses };
    const outbound = input.direction !== 'inbound', una = input.una ?? parseUna(null), all = prodatRegisterTokens(input.rawSegments, una);
    const tokens = prodatRegisterMessageSegments(input.rawSegments, una), grouped = prodatRegisterGroups(tokens, una, 'Z10');
    const fields = ['254', '242'] as const;
    let occurrence: {
        meteringPointId: string | null;
        lineItemReference: string | null;
    } | undefined;
    let diagnosticScope: string[] = [];
    const fail = (code: string, detail: string, field = '254', blocking = true, kind: 'missing' | 'invalid' | 'local_evidence' = 'invalid',failureEvidence?:ProdatFailureEvidence) => issues.push({ prodatDiagnostic:kind === 'local_evidence' ? prodatLocalDiagnostic(kind,'PRODAT26A:meter-change',detail) : prodatFieldDiagnostic(field,kind,input,diagnosticScope,'PRODAT26A:P20/67–69/119/122',undefined,undefined,failureEvidence), ...occurrence, scope: 'prodat_dependent', severity: blocking ? 'error' : 'warning', blocking, code: `PRODAT_METER_CHANGE_${code}`, title: 'PRODAT mätarbyte', description: `Z10:${field}, P26.A s.20,67–69,119,122: ${detail}`, fieldPath: field === '254' ? 'CCI++Z15/CAV' : 'CCI++Z14/CAV' });
    let objects: MeterChangeObject[] = [];
    try {
        if (input.facts?.meterChange != null)
            objects = copyMeterChangeSelection(input.facts.meterChange).objects;
    }
    catch {
        fail('EVIDENCE_INVALID', 'ogiltig oberoende bedömning', '254', outbound, 'local_evidence');
    }
    const unbs = all.filter(t => t.tag === 'UNB'), full = all.some(t => ['UNB', 'UNH', 'UNT', 'UNZ'].includes(t.tag));
    const ref = full ? (unbs.length === 1 ? segmentComposite(unbs[0], 7, una) : []) : [input.applicationReference ?? ''];
    const el = ref.length === 1 && ['23-DDQ-PRODAT', '23-DGI-PRODAT'].includes(ref[0] ?? '');
    const first = grouped.groups.filter(g => g.registerPosition === 1), seen = new Set<string>();
    if (!first.length && outbound)
        fail('SCOPE_INVALID', 'eget första register saknas');
    for (const field of fields)
        statuses.set(field, first.length ? 'not_required' : 'undetermined');
    const one = (scope: EdifactTokenizedSegment[], tag: string, qualifier: string, element = 1) => {
        const selected = scope.filter(t => t.tag === tag && segmentComposite(t, element, una)[0] === qualifier);
        return selected.length === 1 ? segmentComposite(selected[0], element, una) : [];
    };
    const party = (role: string, p: MeterChangeObject['legalSupplier']) => {
        const header = tokens.slice(0, tokens.findIndex(t => t.tag === 'LIN'));
        const selected = header.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, una)[0] === role);
        return selected.length === 1 && JSON.stringify(segmentComposite(selected[0], 2, una)) === JSON.stringify([p.id, p.qualifier, p.agency]);
    };
    for (const group of first) {
        diagnosticScope = group.segments.map(t=>t.raw);
        occurrence = { meteringPointId: group.itemId, lineItemReference: one(group.segments, 'RFF', 'LI')[1] ?? null };
        const key = JSON.stringify([group.itemId, group.identityAgency]);
        seen.add(key);
        const boundary = group.segments.findIndex(t => ['RFF', 'NAD'].includes(t.tag)), common = boundary < 0 ? group.segments : group.segments.slice(0, boundary);
        const reasons = prodatCharacteristicValues('223', common, una);
        // Occurrence/market/function derive from independent envelope/LIN/reason,
        // never from selected254/242 contents or the root byCell snapshot.
        const bgms = tokens.filter(t => t.tag === 'BGM'), ownFunction = bgms.length === 0 || bgms.length === 1 && segmentComposite(bgms[0], 1, una)[0] === 'Z10';
        const scope = el && ownFunction && Boolean(group.itemId) && ['9', '89'].includes(group.identityAgency ?? '') && group.validRegisterChain && reasons.length === 1 && reasons[0] === 'E58';
        let fact = objects.find(o => o.installation.id === group.itemId && o.installation.agency === group.identityAgency);
        if (fact) {
            const ownRefs = group.segments.slice(0, group.segments.findIndex(t => t.tag === 'NAD') < 0 ? undefined : group.segments.findIndex(t => t.tag === 'NAD'));
            const identity = scope && one(ownRefs, 'RFF', 'MG')[1] === fact.newMeter.number && one(ownRefs, 'RFF', 'Z02')[1] === fact.oldMeter.number && one(ownRefs, 'RFF', 'LI')[1] === fact.li
                && JSON.stringify(one(common, 'DTM', '157')) === JSON.stringify(['157', fact.effectiveMinute, '203']) && party('FR', fact.legalGridOwner) && party('DO', fact.legalSupplier);
            if (!identity) {
                fail('CONTEXT_MISMATCH', 'bedömningens objekt/händelse/LI/datum/mätare/juridiska parter avviker', '254', outbound, 'local_evidence');
                fact = undefined;
            }
        }
        const decisions = Object.fromEntries(fields.map(field => [field, scope ? meterChangeCondition(fact, field) : null]));
        for (const field of fields) {
            const condition = decisions[field], qualifier = field === '254' ? 'Z15' : 'Z14', position = field === '254' ? 0 : 3;
            if (condition === null)
                statuses.set(field, 'undetermined');
            else if (condition && statuses.get(field) !== 'undetermined')
                statuses.set(field, 'required');
            if (!outbound && condition === false)
                continue; // p119: even wrong extra content cannot reject.
            if (outbound && condition === null) {
                fail('UNDETERMINED', 'oberoende ändrings-/tröskelfakta saknas', field, true, 'local_evidence');
                continue;
            }
            if (!scope) {
                fail('SCOPE_UNDETERMINED', 'förekomst/EL/funktion kan inte avgöras', field, outbound, 'local_evidence');
                continue;
            }
            const supplied = group.segments.filter((t, index) => {
                if (t.tag !== 'CCI' || segmentComposite(t, 2, una)[0]?.trim().toUpperCase() !== qualifier)
                    return false;
                const cav = group.segments[index + 1], parts = cav?.tag === 'CAV' ? segmentComposite(cav, 1, una) : [];
                // P68: fifth-component506 is independently present, not evidence
                // of absent fourth-component242. Leave the sibling's own controls intact.
                return field !== '242' || Boolean(parts[3]?.trim()) || !parts[4]?.trim();
            });
            if (!supplied.length) {
                if (condition === true)
                    fail('REQUIRED', 'obligatoriskt eget fält saknas', field, true, 'missing');
                continue;
            }
            // Reuse unchanged matrix rules only AFTER applicability. Do not put these
            // cells through the old generic D/content loop as well.
            const rule = canonicalProdat26AFieldRules('Z10').find(r => r.fieldNumber === field)!;
            const failures = validateFieldMatrixPayload({ family: 'PRODAT', code: 'Z10', rawSegments: common.map(t => t.raw), una, mode: 'parse' }, [{ ...rule, requirement: 'required' }]);
            if (failures.length)
                fail('FIELD_INVALID', 'angivet fält följer inte fältregeln', field);
            const cci = supplied[0], index = group.segments.indexOf(cci), cav = group.segments[index + 1], parts = cav?.tag === 'CAV' ? segmentComposite(cav, 1, una) : [];
            const value = parts[position] ?? '', allowed: readonly string[] = field === '254' ? ['Z31', 'Z32'] : PRODAT_EL_AGGREGATION_PRODUCTS;
            const trailing = (t: EdifactTokenizedSegment | undefined, last: number) => t ? Array.from({ length: Math.max(0, segmentElementCount(t, una) - last) }, (_, i) => segmentComposite(t, last + i + 1, una)).flat().some(v => v.trim()) : false;
            const malformed = supplied.length !== 1 || !common.includes(cci) || !allowed.includes(value) || segmentComposite(cci, 2, una)[0] !== qualifier || segmentComposite(cci, 1, una).some(v => v.trim()) || segmentComposite(cci, 2, una).slice(1).some(v => v.trim()) || trailing(cci, 2) || trailing(cav, 1) || group.segments[index + 2]?.tag === 'CAV'
                || parts.some((v, i) => i !== position && i !== 2 && !(field === '242' && i === 4) && v.trim()) || (parts[2]?.length ?? 0) > 3
                || outbound && Boolean(parts[2]?.trim()); // P67/68: outgoing3055 is X, even for optional supplied values.
            if (malformed) {
                const evidence=supplied.flatMap(t=>{
                    const v=group.segments[group.segments.indexOf(t)+1],p=v?.tag==='CAV'?segmentComposite(v,1,una):[];
                    const failed=p.flatMap((value,i)=>i===position?(!allowed.includes(value)||value.length>35?[i]:[]):i===2?(value.length>3||outbound&&Boolean(value.trim())?[i]:[]):field==='242'&&i===4?[]:value.trim()?[i]:[]);
                    const cciFault=segmentComposite(t,2,una)[0]!==qualifier||segmentComposite(t,1,una).some(x=>x.trim())||segmentComposite(t,2,una).slice(1).some(x=>x.trim())||trailing(t,2);
                    if(cciFault)return prodatComponentEvidence(t.raw,'CCI',Array.from({length:segmentElementCount(t,una)},(_,i)=>segmentComposite(t,i+1,una)).flat());
                    if(v?.tag==='CAV'&&trailing(v,1))return prodatComponentEvidence(v.raw,'CAV/C889',Array.from({length:segmentElementCount(v,una)},(_,i)=>segmentComposite(v,i+1,una)).flat());
                    const extra=group.segments[group.segments.indexOf(t)+2];
                    if(v?.tag==='CAV'&&extra?.tag==='CAV')return [v,extra].flatMap(candidate=>prodatComponentEvidence(candidate.raw,'CAV/C889',segmentComposite(candidate,1,una)));
                    return prodatComponentEvidence((v?.tag==='CAV'?v:t).raw,rule.segmentPath??'CAV/C889',v?.tag==='CAV'?p:segmentComposite(t,2,una),supplied.length===1?failed:undefined);
                });
                fail('FIELD_INVALID', 'kod, komponent, par, placering eller kardinalitet är ogiltig', field,true,'invalid',evidence);
            }
            if (outbound && fact) {
                const next = field === '254' ? fact.newMeter.settlement : fact.newMeter.product;
                if (next.kind !== 'known' || next.value !== value)
                    fail('VALUE_MISMATCH', 'angivet värde avviker från oberoende nyvärde', field);
            }
        }
        const products = prodatCharacteristicValues('242', common, una), settlements = prodatCharacteristicValues('254', common, una), methods = prodatCharacteristicValues('217', common, una);
        if (products.length === 1 && (PRODAT_EL_AGGREGATION_PRODUCTS as readonly string[]).includes(products[0])) {
            const monthly = products[0] === 'L917', badMethod = methods.length === 1 && !(monthly ? ['Z01', 'Z04'] : ['Z04']).includes(methods[0]), badSettlement = settlements.length === 1 && settlements[0] !== (monthly ? 'Z31' : 'Z32');
            if (outbound || decisions['242'] !== false) {
                if (badMethod)
                    fail('COMPATIBILITY', 'angiven produkt behöver förenlig mätmetod', '242', outbound || scope && decisions['242'] === true);
                if (badSettlement && (outbound || decisions['254'] !== false))
                    fail('COMPATIBILITY', 'angiven produkt behöver förenlig avräkningsmetod', '242', outbound || scope && decisions['242'] === true && decisions['254'] === true);
            }
        }
    }
    if (outbound)
        for (const object of objects)
            if (!seen.has(JSON.stringify([object.installation.id, object.installation.agency])))
                fail('SOURCE_OBJECT_MISSING', 'valt oberoende objekt saknas');
    return { issues, statuses };
}
