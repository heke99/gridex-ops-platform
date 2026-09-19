import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterTokens } from './prodatRegisterFields';
import { copyReportingExpected, copyReportingSelection, type ExpectedContext } from './prodatReportingPermissionContext';
import type { ProdatDependentConditionFacts } from './prodatDependentConditionEngine';
import type { ProdatDateEventRow } from './prodatDateEventAuthority';
import type { EdielMessageRow } from '@/lib/ediel/types';
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook';
export class ProdatReportingAuthorityError extends Error {
    readonly code: string;
    constructor(code: string) { super(`prodat_register_evidence_${code}`); this.code = code; }
}
export function reportingAuthorityIssue(error: unknown): EdielRulebookIssue | undefined { return error instanceof ProdatReportingAuthorityError ? { scope: 'prodat_dependent', severity: 'error', blocking: true, code: error.code, title: 'Rapporteringsunderlag saknar auktoriserad källa', description: error.message } : undefined; }
export function assertReportingAuthority(input: {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts;
    row?: ProdatDateEventRow;
    expected?: ExpectedContext;
    runId?: string | null;
    stepNo?: number | null;
}) {
    if (!input.facts?.reportingPermission)
        return;
    const invalid = (code = 'PRODAT_REPORTING_EVIDENCE_INVALID'): never => { throw new ProdatReportingAuthorityError(code); };
    let evidence, expected;
    try {
        evidence = copyReportingSelection(input.facts.reportingPermission);
        expected = input.expected && copyReportingExpected(input.expected);
    }
    catch {
        return invalid();
    }
    const row = input.row;
    if (evidence.source.kind !== 'tgt' || !expected || !row || row.direction !== 'outbound' || row.environment !== 'test')
        return invalid('PRODAT_REPORTING_SOURCE_UNQUALIFIED');
    const source = evidence.source, scope = source.scope;
    if (input.code !== 'Z13' || row.message_code !== input.code || scope.code !== input.code || row.company_id !== scope.companyId || input.runId !== scope.runId || input.stepNo !== scope.stepNo)
        return invalid('PRODAT_REPORTING_SCOPE_MISMATCH');
    if (JSON.stringify(source) !== JSON.stringify(expected.source) || JSON.stringify(evidence.objects) !== JSON.stringify(expected.objects))
        return invalid();
    const route = source.route, una = input.una ?? parseUna(null), tokens = prodatRegisterTokens(input.rawSegments, una);
    for (const [role, party] of [['FR', route.legalSender], ['DO', route.legalRecipient]] as const) {
        const own = tokens.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, una)[0] === role);
        if (own.length !== 1 || JSON.stringify(segmentComposite(own[0], 2, una)) !== JSON.stringify([party.id, party.qualifier, party.agency]))
            return invalid('PRODAT_REPORTING_ROUTE_MISMATCH');
    }
    const unb = tokens.filter(t => t.tag === 'UNB');
    if (unb.length !== 1)
        return invalid('PRODAT_REPORTING_ROUTE_MISMATCH');
    for (const [pos, id, qualifier, subaddress] of [[2, route.senderId, route.senderQualifier, route.senderSubaddress], [3, route.receiverId, route.receiverQualifier, route.receiverSubaddress]] as const) {
        const v = segmentComposite(unb[0], pos, una);
        if (v[0] !== id || v[1] !== qualifier || (v[2] || null) !== subaddress || v.slice(3).some(Boolean))
            return invalid('PRODAT_REPORTING_ROUTE_MISMATCH');
    }
    if (segmentComposite(unb[0], 7, una)[0] !== route.applicationReference)
        return invalid('PRODAT_REPORTING_ROUTE_MISMATCH');
    if (row.sender_ediel_id !== route.senderId || row.receiver_ediel_id !== route.receiverId || row.sender_sub_address !== route.senderSubaddress || row.receiver_sub_address !== route.receiverSubaddress || row.application_reference !== route.applicationReference || row.transport_type !== route.transportType || row.mailbox !== route.mailbox || row.receiver_email !== route.receiverEmail || row.communication_route_id !== route.communicationRouteId || (row.route_profile_id ?? null) !== route.routeProfileId)
        return invalid('PRODAT_REPORTING_ROUTE_MISMATCH');
}
/** Select from row OR actual wire; the authority comparison rejects disagreements. */
export function hasReportingPermissionMessage(message: Pick<EdielMessageRow, 'message_family' | 'message_code' | 'raw_payload'>, codes: readonly string[] = ['Z13', 'Z14']): boolean {
    if (message.message_family === 'PRODAT' && codes.includes(message.message_code))
        return true;
    const wire = tokenizeEdifact(message.raw_payload ?? '');
    let family = '';
    for (const t of wire.segments) {
        if (t.tag === 'UNH')
            family = segmentComposite(t, 2, wire.una)[0] ?? '';
        if (t.tag === 'BGM' && family === 'PRODAT' && codes.includes(segmentComposite(t, 1, wire.una)[0]))
            return true;
    }
    return false;
}
