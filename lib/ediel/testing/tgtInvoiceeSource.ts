import { INVOICEE_CODES, type ProdatInvoiceeObject, type InvoiceeAddress } from '@/lib/ediel/prodat/prodatInvoicee';
import type { ProdatEngineInvoiceeContext } from '@/lib/ediel/prodat/types';
import type { TgtProdatSourceColumn } from './tgtProdatSource';
const invalid = (): never => { throw new Error('PRODAT_INVOICEE_SOURCE_INVALID'); };
const clean = (v: string | undefined) => !v?.trim() || v.trim() === '-' ? '' : v.trim();
/** Empty scalar/positional schema slots are not an invoicee choice. */
function hasInvoiceeSourceChoice(row: TgtProdatSourceColumn): boolean {
    return Object.entries(row.rawFields).some(([field, value]) =>
        (['250', '251', '252', '253', '317', '318'].includes(field) || /^25[12]-/.test(field)) && Boolean(clean(value)));
}
/** Only these own source reasons omit UD on the wire. Preserve the existing
 * independently referenced selection; never obtain it from IV or another column.
 * The built-in workbook annotates its exact reason as "E64 (Z06F)". */
function allowsIndependentEndUser(code: string, row: TgtProdatSourceColumn): boolean {
    if (code !== 'Z06') return false;
    const reason = row.fields['223'];
    const subtype = reason === 'E64' || reason === 'E64 (Z06F)' ? 'F'
        : reason === 'E32' || reason === 'E32 (Z06G)' ? 'G' : null;
    const columnSubtype = row.column.name.match(/\bZ06([A-Z])\b/i)?.[1]?.toUpperCase();
    return subtype !== null && (!columnSubtype || columnSubtype === subtype);
}
export function tgtPartySourceLines(row: TgtProdatSourceColumn, field: string, max: number): string[] {
    const keys = Array.from({ length: max }, (_, i) => `${field}-${i + 1}`), split = keys.some(k => Boolean(clean(row.rawFields[k])));
    if (Object.keys(row.rawFields).some(key => key.startsWith(`${field}-`) && !keys.includes(key) && clean(row.rawFields[key]))) return invalid();
    const lines = split ? keys.map(k => clean(row.rawFields[k])) : [clean(row.rawFields[field])];
    if (lines.some(v => v.length > 35 || /[\x00-\x1f\x7f]/.test(v)))
        return invalid();
    if (split && clean(row.rawFields[field]) && (clean(row.rawFields[field]) !== lines[0] || lines.slice(1).some(Boolean)))
        return invalid();
    while (lines.length && !lines[lines.length - 1])
        lines.pop();
    return lines;
}
/** Current values come from original cells, selection/unknown declarations from
 * authorized notes. Empty cells alone never establish known-empty or unavailable. */
export function assertTgtInvoiceeSource(code: string, rows: readonly TgtProdatSourceColumn[][], facts: readonly ProdatInvoiceeObject[] | undefined) {
    if (!facts)
        return;
    if (!INVOICEE_CODES.includes(code))
        return invalid();
    for (const f of facts) {
        const row = rows.find(r => r[0].fields['209'] === f.meteringPointId && (r[0].identityAgency ?? '9') === f.identityAgency)?.[0];
        if (!row)
            return invalid();
        if (f.event.state === 'changed_to_same' && (code !== 'Z06' || row.fields['223'] !== 'E34'))
            return invalid();
        const independentEndUser = allowsIndependentEndUser(code, row);
        const verify = (a: InvoiceeAddress, field: string, postcode: string, city: string, country: string, suppliedOnly = false) => {
            const lines = tgtPartySourceLines(row, field, 3);
            for (let i = 0; i < 3; i++)
                if (typeof a.lines[i] === 'string' && (!suppliedOnly || Boolean(lines[i])) && a.lines[i] !== (lines[i] ?? ''))
                    return invalid();
            for (const [key, value] of [[postcode, a.postalCode], [city, a.city], [country, a.country]] as const)
                if (typeof value === 'string' && (!suppliedOnly || Boolean(clean(row.rawFields[key]))) && value !== clean(row.rawFields[key]))
                    return invalid();
        };
        if ((!independentEndUser || row.fields['227']) && row.fields['227'] !== f.endUser.identity.id)
            return invalid();
        if (row.fields['250'] && row.fields['250'] !== f.invoicee.identity.id)
            return invalid();
        for (const [field, id] of [['227', f.endUser.identity], ['250', f.invoicee.identity]] as const) {
            if (row.fields[`${field}.QUALIFIER`] !== undefined && row.fields[`${field}.QUALIFIER`] !== id.qualifier)
                return invalid();
            if (row.fields[`${field}.AGENCY`] !== undefined && row.fields[`${field}.AGENCY`] !== id.agency)
                return invalid();
        }
        // copyProdatInvoiceeObjects already requires the independent source reference
        // and retains the UD representation reference (or explicit unknown). The
        // authorized notes bind that assertion to this exact run/source column.
        verify(f.endUser.address, '229', '231', '232', '316', independentEndUser);
        // An omitted optional IV can have a separately asserted comparison source.
        // Supplied current IV cells must match that selection exactly.
        if (hasInvoiceeSourceChoice(row)) {
            verify(f.invoicee.address, '252', '253', '317', '318');
            const names = tgtPartySourceLines(row, '251', 2);
            if ([0, 1].some(i => (f.invoicee.nameLines[i] ?? '') !== (names[i] ?? '')))
                return invalid();
            if (f.invoicee.availability === 'unavailable' && tgtPartySourceLines(row, '252', 3).some(Boolean))
                return invalid();
        }
        // Prior history and representation convention remain explicit source-note
        // assertions; they are not inferred from current workbook cells.
    }
}
export function tgtInvoiceeChoice(row: TgtProdatSourceColumn, fact: ProdatInvoiceeObject | undefined): ProdatEngineInvoiceeContext | null {
    if (!hasInvoiceeSourceChoice(row))
        return null;
    return { id: row.fields['250'] ?? null, idCodeListQualifier: row.fields['250.QUALIFIER'] ?? fact?.invoicee.identity.qualifier,
        idAgency: (row.fields['250.AGENCY'] ?? fact?.invoicee.identity.agency) as '89' | '260' | undefined,
        name: '', nameLines: tgtPartySourceLines(row, '251', 2), addressLines: tgtPartySourceLines(row, '252', 3),
        city: row.fields['317'] ?? null, postalCode: row.fields['253'] ?? null, country: row.fields['318'] ?? null };
}
