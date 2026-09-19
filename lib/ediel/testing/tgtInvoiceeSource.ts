import { INVOICEE_CODES, type ProdatInvoiceeObject, type InvoiceeAddress } from '@/lib/ediel/prodat/prodatInvoicee';
import type { ProdatEngineInvoiceeContext } from '@/lib/ediel/prodat/types';
import type { TgtProdatSourceColumn } from './tgtProdatSource';
const invalid = (): never => { throw new Error('PRODAT_INVOICEE_SOURCE_INVALID'); };
const clean = (v: string | undefined) => !v?.trim() || v.trim() === '-' ? '' : v.trim();
export function tgtPartySourceLines(row: TgtProdatSourceColumn, field: string, max: number): string[] {
    const keys = Array.from({ length: max }, (_, i) => `${field}-${i + 1}`), split = keys.some(k => Object.hasOwn(row.rawFields, k));
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
        const verify = (a: InvoiceeAddress, field: string, postcode: string, city: string, country: string) => {
            const lines = tgtPartySourceLines(row, field, 3);
            for (let i = 0; i < 3; i++)
                if (typeof a.lines[i] === 'string' && a.lines[i] !== (lines[i] ?? ''))
                    return invalid();
            for (const [key, value] of [[postcode, a.postalCode], [city, a.city], [country, a.country]] as const)
                if (typeof value === 'string' && value !== clean(row.rawFields[key]))
                    return invalid();
        };
        if (row.fields['227'] !== f.endUser.identity.id)
            return invalid();
        if (row.fields['250'] && row.fields['250'] !== f.invoicee.identity.id)
            return invalid();
        for (const [field, id] of [['227', f.endUser.identity], ['250', f.invoicee.identity]] as const) {
            if (row.fields[`${field}.QUALIFIER`] !== undefined && row.fields[`${field}.QUALIFIER`] !== id.qualifier)
                return invalid();
            if (row.fields[`${field}.AGENCY`] !== undefined && row.fields[`${field}.AGENCY`] !== id.agency)
                return invalid();
        }
        verify(f.endUser.address, '229', '231', '232', '316');
        // An omitted optional IV can have a separately asserted comparison source.
        // Supplied current IV cells must match that selection exactly.
        if (['250', '251', '252', '253', '317', '318'].some(k => row.fields[k] !== undefined) || Object.keys(row.rawFields).some(k => /^25[12]-/.test(k))) {
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
    if (!['250', '251', '252', '253', '317', '318'].some(k => row.fields[k] !== undefined) && !Object.keys(row.rawFields).some(k => /^25[12]-/.test(k)))
        return null;
    return { id: row.fields['250'] ?? null, idCodeListQualifier: row.fields['250.QUALIFIER'] ?? fact?.invoicee.identity.qualifier,
        idAgency: (row.fields['250.AGENCY'] ?? fact?.invoicee.identity.agency) as '89' | '260' | undefined,
        name: '', nameLines: tgtPartySourceLines(row, '251', 2), addressLines: tgtPartySourceLines(row, '252', 3),
        city: row.fields['317'] ?? null, postalCode: row.fields['253'] ?? null, country: row.fields['318'] ?? null };
}
