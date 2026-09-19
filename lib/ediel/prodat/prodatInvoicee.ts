/** P26.A pp23,82,109,117-118. Independent protocol inputs, not live authority. */
export const INVOICEE_CODES: readonly string[] = ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'];
export const INVOICEE_FIELDS: readonly string[] = ['INVOICEE_GROUP', '250', '251', '252', '253', '317', '318'];
/** Empty string is positively known empty; null is unknown; unavailable is not empty. */
export type InvoiceeComponent = string | null | {
    unavailable: true;
};
export type InvoiceeAddress = {
    lines: readonly [
        InvoiceeComponent,
        InvoiceeComponent,
        InvoiceeComponent
    ];
    postalCode: InvoiceeComponent;
    city: InvoiceeComponent;
    country: InvoiceeComponent;
    representation: {
        convention: string;
        reference: string;
        mode: 1 | 2 | 3 | 4 | 5;
    } | null;
};
export type InvoiceeIdentity = {
    id: string;
    qualifier: '' | '1' | 'SE1' | 'SE2';
    agency: '89' | '260';
};
export type ProdatInvoiceeObject = {
    meteringPointId: string;
    identityAgency: '9' | '89';
    endUser: {
        identity: InvoiceeIdentity;
        address: InvoiceeAddress;
    };
    invoicee: {
        identity: InvoiceeIdentity;
        nameLines: readonly string[];
        address: InvoiceeAddress;
        availability: 'available' | 'unavailable' | 'unknown';
    };
    event: {
        state: 'unknown';
    } | {
        state: 'none';
        reference: string;
    } | {
        state: 'changed_to_same';
        reference: string;
        effectiveAt: string;
        process: 'grid_owner_to_supplier_z06e';
        previousInvoicee: InvoiceeAddress;
    };
    source: {
        kind: 'caller_selection' | 'tgt';
        companyId: string;
        reference: string;
        runId?: string;
        stepNo?: number;
        code?: string;
        sourceDigest?: string;
    };
};
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && (empty || v.length > 0) && v === v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const invalid = (): never => { throw new Error('prodat_invoicee_evidence_invalid'); };
function identity(v: unknown): InvoiceeIdentity {
    const r = record(v);
    if (!r || !text(r.id, 35) || typeof r.qualifier !== 'string' || !['', '1', 'SE1', 'SE2'].includes(r.qualifier) || !(r.qualifier === '' ? r.agency === '89' : r.agency === '260'))
        return invalid();
    return { id: r.id, qualifier: r.qualifier as InvoiceeIdentity['qualifier'], agency: r.agency as InvoiceeIdentity['agency'] };
}
function component(v: unknown, max: number): InvoiceeComponent {
    if (v === null)
        return null;
    if (text(v, max, true))
        return v;
    const r = record(v);
    if (r && r.unavailable === true && Object.keys(r).length === 1)
        return { unavailable: true };
    return invalid();
}
export function copyInvoiceeAddress(v: unknown): InvoiceeAddress {
    const r = record(v), rep = record(r?.representation);
    if (!r || !Array.isArray(r.lines) || r.lines.length !== 3 || r.representation !== null && (!rep || !text(rep.convention, 200) || !text(rep.reference, 2000) || !Number.isInteger(rep.mode) || !([1, 2, 3, 4, 5] as unknown[]).includes(rep.mode)))
        return invalid();
    const country = component(r.country, 3), postalCode = component(r.postalCode, 9);
    if (typeof country === 'string' && country && !/^[A-Z]{2,3}$/.test(country))
        return invalid();
    if (r.lines.some(v => v === '.'))
        return invalid();
    return { lines: r.lines.map(v => component(v, 35)) as [
            InvoiceeComponent,
            InvoiceeComponent,
            InvoiceeComponent
        ], postalCode, city: component(r.city, 35), country,
        representation: rep ? { convention: rep.convention as string, reference: rep.reference as string, mode: rep.mode as NonNullable<InvoiceeAddress['representation']>['mode'] } : null };
}
export function invoiceeAddressComponents(a: InvoiceeAddress): readonly InvoiceeComponent[] { return [...a.lines, a.postalCode, a.city, a.country]; }
/** Comparison is confined to an independently asserted common convention/mode.
 * This does not canonicalize arbitrary real-world address representations. */
export function invoiceeAddressesDiffer(a: InvoiceeAddress, b: InvoiceeAddress): boolean | null {
    if (!a.representation || !b.representation)
        return null;
    if (a.representation.convention !== b.representation.convention || a.representation.mode !== b.representation.mode)
        return null;
    const left = invoiceeAddressComponents(a), right = invoiceeAddressComponents(b);
    let unknown = false;
    for (let i = 0; i < left.length; i++) {
        if (typeof left[i] !== 'string' || typeof right[i] !== 'string') {
            unknown = true;
            continue;
        }
        if (left[i] !== right[i]) {
            // A formatted postcode is retained for compatibility, but its spelling
            // cannot prove a different postal destination. No normalization is used.
            if (i === 3 && (/\s/.test(left[i] as string) || /\s/.test(right[i] as string)) || i === 5 && (left[i] as string).length !== (right[i] as string).length) {
                unknown = true;
                continue;
            }
            return true;
        }
    }
    return unknown ? null : false;
}
export function copyProdatInvoiceeObjects(v: unknown): ProdatInvoiceeObject[] {
    if (!Array.isArray(v))
        return invalid();
    const seen = new Set<string>();
    return v.map(value => {
        const r = record(value), ud = record(r?.endUser), iv = record(r?.invoicee), source = record(r?.source), event = record(r?.event);
        if (!r || !ud || !iv || !source || !event || !text(r.meteringPointId, 25) || !['9', '89'].includes(String(r.identityAgency)) || typeof r.identityAgency !== 'string'
            || !Array.isArray(iv.nameLines) || iv.nameLines.length > 2 || iv.nameLines.some(v => !text(v, 35, true)) || !['available', 'unavailable', 'unknown'].includes(String(iv.availability)) || typeof iv.availability !== 'string'
            || !text(source.companyId, 200) || !text(source.reference, 2000) || !['caller_selection', 'tgt'].includes(String(source.kind)) || typeof source.kind !== 'string')
            return invalid();
        const key = JSON.stringify([r.meteringPointId, r.identityAgency]);
        if (seen.has(key))
            return invalid();
        seen.add(key);
        const endUser = { identity: identity(ud.identity), address: copyInvoiceeAddress(ud.address) };
        const invoicee = { identity: identity(iv.identity), nameLines: [...iv.nameLines] as string[], address: copyInvoiceeAddress(iv.address), availability: iv.availability as ProdatInvoiceeObject['invoicee']['availability'] };
        if (invoicee.availability === 'available' && (!invoicee.address.lines.every(v => typeof v === 'string') || !invoicee.address.lines.some(v => typeof v === 'string' && v !== '' && v !== '.')))
            return invalid();
        if (invoicee.availability === 'unavailable' && invoicee.address.lines.some(v => typeof v === 'string' && v !== ''))
            return invalid();
        let checkedEvent: ProdatInvoiceeObject['event'];
        if (event.state === 'unknown')
            checkedEvent = { state: 'unknown' };
        else if (event.state === 'none' && text(event.reference, 2000))
            checkedEvent = { state: 'none', reference: event.reference };
        else if (event.state === 'changed_to_same' && text(event.reference, 2000) && text(event.effectiveAt, 40) && Number.isFinite(Date.parse(event.effectiveAt)) && event.process === 'grid_owner_to_supplier_z06e') {
            checkedEvent = { state: 'changed_to_same', reference: event.reference, effectiveAt: event.effectiveAt, process: event.process, previousInvoicee: copyInvoiceeAddress(event.previousInvoicee) };
            if (invoiceeAddressesDiffer(checkedEvent.previousInvoicee, invoicee.address) === false || invoiceeAddressesDiffer(invoicee.address, endUser.address) === true)
                return invalid();
        }
        else
            return invalid();
        if (source.kind === 'tgt' && (!text(source.runId, 200) || !Number.isSafeInteger(source.stepNo) || Number(source.stepNo) < 1 || typeof source.code !== 'string' || !INVOICEE_CODES.includes(source.code) || typeof source.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceDigest)))
            return invalid();
        return { meteringPointId: r.meteringPointId, identityAgency: r.identityAgency as '9' | '89', endUser, invoicee, event: checkedEvent,
            source: { kind: source.kind as 'caller_selection' | 'tgt', companyId: source.companyId, reference: source.reference,
                ...(source.kind === 'tgt' ? { runId: source.runId as string, stepNo: source.stepNo as number, code: source.code as string, sourceDigest: source.sourceDigest as string } : {}) } };
    });
}
export function invoiceeMandatory(fact: ProdatInvoiceeObject, code: string, subtype: string | null): boolean | null {
    const different = invoiceeAddressesDiffer(fact.endUser.address, fact.invoicee.address);
    const event = fact.event;
    if (event.state === 'changed_to_same' && (code !== 'Z06' || subtype !== 'E'))
        return invalid();
    if (different === true)
        return true;
    if (code !== 'Z06')
        return different;
    if (subtype === null)
        return null;
    if (subtype !== 'E')
        return different;
    if (event.state === 'none')
        return different;
    if (event.state === 'unknown')
        return null;
    return invoiceeAddressesDiffer(event.previousInvoicee, fact.invoicee.address) === true && different === false ? true : null;
}
export function assertInvoiceeOwnership(objects: readonly ProdatInvoiceeObject[] | undefined, scope: {
    companyId?: string | null;
    runId?: string | null;
    stepNo?: number | null;
    code: string;
}) {
    for (const f of objects ?? [])
        if (!scope.companyId || f.source.companyId !== scope.companyId || f.source.kind === 'tgt' && (f.source.runId !== scope.runId || f.source.stepNo !== scope.stepNo || f.source.code !== scope.code))
            return invalid();
}
