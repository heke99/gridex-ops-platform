import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups';
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields';
import { prodatEndUserAddressWireLines } from '@/lib/ediel/prodat/prodatEndUserAddress';
import { INVOICEE_CODES, INVOICEE_FIELDS, copyProdatInvoiceeObjects, invoiceeMandatory, type InvoiceeAddress, type InvoiceeIdentity, type ProdatInvoiceeObject } from '@/lib/ediel/prodat/prodatInvoicee';
import type { ProdatDependentConditionFacts, ProdatDependentConditionStatus } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielRulebookIssue } from './rulebook';
import { prodatEndUserWireSubtype } from './prodatEndUserPolicy';
type Input = {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts | null;
    direction?: 'inbound' | 'outbound';
};
export function validateProdatInvoicee(input: Input) { return evaluateProdatInvoicee(input).issues; }
export function evaluateProdatInvoicee(input: Input): {
    issues: EdielRulebookIssue[];
    statuses: Map<string, ProdatDependentConditionStatus>;
} {
    const issues: EdielRulebookIssue[] = [], statuses = new Map<string, ProdatDependentConditionStatus>();
    for (const field of INVOICEE_FIELDS)
        statuses.set(field, 'not_required');
    const fail = (code: string, detail: string, field = 'INVOICEE_GROUP') => {
        issues.push({ scope: 'prodat_dependent', severity: 'error', blocking: true, code: code === 'UNDETERMINED' ? 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED' : `PRODAT_INVOICEE_${code}`, title: 'Fakturamottagaren saknar giltigt underlag', description: `${input.code}:${field}, P26.A s.23/82/109: ${detail}`, fieldPath: 'NAD+IV' });
        statuses.set(field, 'undetermined');
    };
    const outbound = input.direction !== 'inbound', una = input.una ?? parseUna(null), tokens = prodatRegisterMessageSegments(input.rawSegments, una);
    const iv = (s: EdifactTokenizedSegment) => s.tag === 'NAD' && segmentComposite(s, 1, una)[0]?.trim().toUpperCase() === 'IV';
    if (!INVOICEE_CODES.includes(input.code)) {
        if (outbound && tokens.some(iv))
            fail('FORBIDDEN', 'gruppen får inte skickas i denna funktion');
        return { issues, statuses };
    }
    let facts: ProdatInvoiceeObject[];
    try {
        facts = outbound && input.facts?.invoiceeObjects !== undefined ? copyProdatInvoiceeObjects(input.facts.invoiceeObjects) : [];
    }
    catch {
        fail('EVIDENCE_INVALID', 'ogiltiga källfakta');
        facts = [];
    }
    const grouped = prodatRegisterGroups(tokens, una, input.code), first = grouped.groups.filter(g => g.registerPosition === 1);
    if (grouped.problems.length)
        fail('SCOPE_INVALID', 'ogiltig registerstruktur');
    const seen = new Set<string>(), allowed = new Set(first.flatMap(g => g.segments.filter(iv).map(s => s.index)));
    // Later repeats are nonlocal per appendix2. They cannot satisfy the first register.
    const later = new Set(grouped.groups.filter(g => g.registerPosition > 1).flatMap(g => g.segments.filter(iv).map(s => s.index)));
    for (const party of tokens.filter(iv)) {
        if (!allowed.has(party.index) && !later.has(party.index))
            fail('SCOPE_INVALID', 'IV måste tillhöra ett objekt');
        const role = segmentComposite(party, 1, una);
        if (role.length !== 1 || role[0] !== 'IV' || segmentElementCount(party, una) > 9)
            fail('FORMAT_INVALID', 'ogiltig NAD-struktur');
        const limits: [
            [
                number,
                number[]
            ],
            ...[
                number,
                number[]
            ][]
        ] = [[2, [35, 3, 3]], [4, [35, 35]], [5, [35, 35, 35]], [6, [35]], [8, [9]], [9, [3]]];
        for (const [element, maxima] of limits) {
            const parts = segmentComposite(party, element, una);
            if (parts.length > maxima.length || parts.some((v, i) => v.length > maxima[i] || /[\x00-\x1f\x7f]/.test(v)))
                fail('FORMAT_INVALID', 'komponenter överskrider tillåtna positioner/längder');
        }
        if (prodatPartySyntaxIssues([party], una).length)
            fail('FORMAT_INVALID', 'angiven part saknar obligatoriska eller har ogiltiga komponenter');
        if (/\s/.test(segmentComposite(party, 8, una)[0] ?? ''))
            fail('FORMAT_INVALID', 'postnummer ska vara oredigerat', '253');
    }
    function matchIdentity(party: EdifactTokenizedSegment, id: InvoiceeIdentity) { const v = segmentComposite(party, 2, una); return v[0] === id.id && (v[1] ?? '') === id.qualifier && v[2] === id.agency; }
    function matchAddress(party: EdifactTokenizedSegment, a: InvoiceeAddress, includeLines: boolean) {
        if (includeLines) {
            const lines = a.lines.map(v => typeof v === 'string' ? v : null);
            if (lines.every(v => v !== null)) {
                const wire = segmentComposite(party, 5, una), expected = prodatEndUserAddressWireLines(lines as string[]);
                if ([0, 1, 2].some(i => (wire[i] ?? '') !== (expected[i] ?? '')))
                    fail('VALUE_MISMATCH', 'adressen avviker från vald källa', '252');
            }
        }
        for (const [index, value] of [[8, a.postalCode], [6, a.city], [9, a.country]] as const)
            if (typeof value === 'string' && (segmentComposite(party, index, una)[0] ?? '') !== value)
                fail('VALUE_MISMATCH', 'postuppgift avviker från vald källa');
    }
    for (const group of first) {
        const key = JSON.stringify([group.itemId, group.identityAgency]);
        seen.add(key);
        const parties = group.segments.filter(iv), subtype = ['Z06', 'Z09'].includes(input.code) ? prodatEndUserWireSubtype(input.code, group.segments, una) : null;
        if (input.code === 'Z09' && subtype === null) {
            if (outbound)
                fail('UNDETERMINED', 'exakt egen transaktionsorsak krävs');
            continue;
        }
        if (input.code === 'Z09' && subtype !== 'E') {
            if (outbound && parties.length)
                fail('FORBIDDEN', 'IV får endast skickas i Z09E');
            continue;
        }
        if (parties.length > 1)
            fail('CARDINALITY_INVALID', 'flera egna IV-grupper');
        for (const field of INVOICEE_FIELDS.slice(1).filter(field => field !== '252'))
            if (parties.length && statuses.get(field) !== 'undetermined')
                statuses.set(field, 'required');
        if (!outbound)
            continue;
        const fact = facts.find(f => f.meteringPointId === group.itemId && f.identityAgency === group.identityAgency);
        if (!fact) {
            if (parties.length) statuses.set('252', 'undetermined');
            fail('UNDETERMINED', `${key}: oberoende valt underlag saknas`);
            continue;
        }
        let mandatory: boolean | null;
        try {
            mandatory = invoiceeMandatory(fact, input.code, subtype);
        }
        catch {
            fail('EVIDENCE_INVALID', 'händelsen hör inte till egen process');
            continue;
        }
        if (mandatory === null)
            fail('UNDETERMINED', `${key}: adressjämförelse/händelse är okänd`);
        else if (mandatory) {
            if (statuses.get('INVOICEE_GROUP') !== 'undetermined')
                statuses.set('INVOICEE_GROUP', 'required');
            if (!parties.length)
                fail('REQUIRED', 'obligatorisk IV saknas');
        }
        const uds = group.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, una)[0] === 'UD');
        if (uds.length === 1) {
            if (!matchIdentity(uds[0], fact.endUser.identity))
                fail('IDENTITY_MISMATCH', 'vald UD avviker');
            matchAddress(uds[0], fact.endUser.address, true);
        }
        const udFact = input.facts?.endUserAddressObjects?.find(f => f.meteringPointId === group.itemId && f.identityAgency === group.identityAgency);
        if (udFact && ((['id', 'qualifier', 'agency'] as const).some(k => udFact.endUser[k] !== fact.endUser.identity[k]) || udFact.availability === 'available' && [0, 1, 2].some(i => typeof fact.endUser.address.lines[i] === 'string' && (udFact.addressLines[i] ?? '') !== fact.endUser.address.lines[i]) || udFact.availability === 'unavailable' && fact.endUser.address.lines.some(v => typeof v === 'string' && v !== '')))
            fail('EVIDENCE_INVALID', 'motstridiga UD-källor');
        if (!parties.length)
            continue;
        const party = parties[0], selected = fact.invoicee;
        if (!matchIdentity(party, selected.identity))
            fail('IDENTITY_MISMATCH', 'vald IV avviker', '250');
        const names = segmentComposite(party, 4, una);
        if ([0, 1].some(i => (names[i] ?? '') !== (selected.nameLines[i] ?? '')))
            fail('VALUE_MISMATCH', 'namn avviker', '251');
        if ([selected.address.postalCode, selected.address.city, selected.address.country].some(v => typeof v !== 'string' || !v))
            fail('UNDETERMINED', 'valda postuppgifter saknas');
        if (selected.availability === 'unknown')
            fail('UNDETERMINED', 'adressens tillgänglighet är okänd', '252');
        if (selected.availability === 'unavailable') {
            if (segmentComposite(party, 5, una).some(Boolean))
                fail('ADDRESS_FORBIDDEN', 'otillgänglig adress får inte fyllas i', '252');
        }
        if (selected.availability === 'available' && statuses.get('252') !== 'undetermined')
            statuses.set('252', 'required');
        matchAddress(party, selected.address, selected.availability === 'available');
    }
    if (outbound && !first.length)
        fail('SCOPE_INVALID', 'första objekt saknas');
    for (const fact of facts)
        if (!seen.has(JSON.stringify([fact.meteringPointId, fact.identityAgency])))
            fail('SOURCE_OBJECT_MISSING', 'valt objekt saknas i meddelandet');
    return { issues, statuses };
}
