import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna } from '@/lib/ediel/core/una';
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook';
type Row = {
    message_code?: string | null;
    message_family?: string | null;
    raw_payload?: string | null;
};
/** No currently registered outgoing Z10 producer. Raw OR row selection protects
 * both mismatches and malformed/caller-forged evidence; released tag text is data. */
export function meterChangeSendIssue(row: Row): EdielRulebookIssue | null {
    let detected = String(row.message_code ?? '').trim().toUpperCase() === 'Z10';
    const raw = (row.raw_payload ?? '').trimStart();
    // Dispatch by actual EDIFACT header/segment syntax, never format metadata.
    // List/XML data can contain literal release characters. Do not run the
    // EDIFACT codec on it; genuine (including malformed) EDIFACT still uses
    // that codec and retains its syntax failures. A row Z10 already blocks.
    const advice = parseUna(raw), literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const release = literal(advice.releaseCharacter), terminator = literal(advice.segmentTerminator), element = literal(advice.dataElementSeparator);
    // Only an actual service separator starts a header; UNH; in a list is
    // ordinary text. Released terminators cannot introduce header-like data.
    // Even release pairs retain real boundaries after malformed leading text.
    const header = new RegExp(`(?:^|(?<!${release})(?:${release}${release})*${terminator})\\s*(?:UNB|UNH|BGM)${element}`, 'i');
    const wire = !detected && (raw.toUpperCase().startsWith('UNA') || header.test(raw)) ? tokenizeEdifact(raw) : null;
    let family = String(row.message_family ?? '').trim().toUpperCase();
    if (wire) for (const token of wire.segments) {
        if (token.tag === 'UNH')
            family = segmentComposite(token, 2, wire.una)[0]?.trim().toUpperCase() ?? '';
        if (token.tag === 'BGM' && family === 'PRODAT' && segmentComposite(token, 1, wire.una)[0]?.trim().toUpperCase() === 'Z10')
            detected = true;
        if (token.tag === 'UNT')
            family = '';
    }
    return detected ? { scope: 'prodat_dependent', severity: 'error', blocking: true, code: 'PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED', title: 'Z10 saknar kvalificerad utgående producent', description: 'PC-254-Z10/PC-242-Z10: rena anroparfakta eller TGT-metadata ger ingen beständig sändbehörighet. Aktiv utgående Z10-producent saknas.', fieldPath: 'BGM' } : null;
}
export function assertMeterChangeSendBoundary(row: Row): void { const issue = meterChangeSendIssue(row); if (issue)
    throw new Error(`${issue.code}: ${issue.description}`); }
