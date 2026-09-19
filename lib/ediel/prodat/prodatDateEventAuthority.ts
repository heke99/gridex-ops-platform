import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook';
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una';
import { prodatRegisterTokens } from './prodatRegisterFields';
import { copyProdatDateEventObjects, copyProdatDateEventSource, type ProdatDateEventObject, type TgtDateEventSource } from './prodatDateEvents';
import type { ProdatDependentConditionFacts } from './prodatDependentConditionEngine';
import type { EdielMessageRow } from '@/lib/ediel/types';
export class ProdatDateEventAuthorityError extends Error {
    readonly code: string;
    constructor(code: string) { super(`prodat_register_evidence_${code}`); this.code = code; }
}
export function prodatDateEventAuthorityIssue(error: unknown): EdielRulebookIssue | undefined {
    return error instanceof ProdatDateEventAuthorityError ? { scope: 'prodat_dependent', severity: 'error', blocking: true, code: error.code, title: 'PRODAT-händelseunderlag är inte auktoriserat', description: error.message } : undefined;
}
/** Supplied separately by a company-scoped server resolver, never parsed payload. */
export type TgtDateEventValidationContext = {
    source: TgtDateEventSource;
    objects: readonly ProdatDateEventObject[];
};
export type ProdatDateEventRow = Pick<EdielMessageRow, 'company_id' | 'environment' | 'direction' | 'message_code' | 'sender_ediel_id' | 'receiver_ediel_id' | 'sender_sub_address' | 'receiver_sub_address' | 'application_reference' | 'transport_type' | 'receiver_email' | 'communication_route_id' | 'route_profile_id' | 'mailbox'>;
export function assertProdatDateEventAuthority(input: {
    code: string;
    rawSegments: readonly string[];
    una?: EdifactServiceStringAdvice;
    facts?: ProdatDependentConditionFacts;
    row?: ProdatDateEventRow;
    expected?: TgtDateEventValidationContext;
    runId?: string | null;
    stepNo?: number | null;
}) {
    if (!input.facts?.dateEventObjects?.length && !input.facts?.dateEventSource)
        return;
    const invalid = (code = 'PRODAT_DATE_EVENT_EVIDENCE_INVALID'): never => { throw new ProdatDateEventAuthorityError(code); };
    const facts = input.facts, source = facts.dateEventSource && copyProdatDateEventSource(facts.dateEventSource), row = input.row, expected = input.expected;
    if (!source || source.kind !== 'tgt' || !expected || !row || row.environment !== 'test' || row.direction !== 'outbound' || facts.market !== 'electricity')
        return invalid('PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED');
    if (row.company_id !== source.companyId || row.message_code !== input.code || source.code !== input.code || input.runId !== source.runId || input.stepNo !== source.stepNo)
        return invalid('PRODAT_DATE_EVENT_SCOPE_MISMATCH');
    if (JSON.stringify(source) !== JSON.stringify(copyProdatDateEventSource(expected.source)) || JSON.stringify(copyProdatDateEventObjects(facts.dateEventObjects)) !== JSON.stringify(copyProdatDateEventObjects(expected.objects)))
        return invalid();
    const route = source.route, una = input.una ?? parseUna(null), tokens = prodatRegisterTokens(input.rawSegments, una);
    for (const [role, party] of [['FR', route.legalSender], ['DO', route.legalRecipient]] as const) {
        const matching = tokens.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, una)[0] === role);
        if (matching.length !== 1 || JSON.stringify(segmentComposite(matching[0], 2, una)) !== JSON.stringify([party.id, party.qualifier, party.agency]))
            return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    }
    const unbs = tokens.filter(s => s.tag === 'UNB');
    if (unbs.length !== 1)
        return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    for (const [position, id, qualifier, subaddress] of [[2, route.senderId, route.senderQualifier, route.senderSubaddress], [3, route.receiverId, route.receiverQualifier, route.receiverSubaddress]] as const) {
        const v = segmentComposite(unbs[0], position, una);
        if (v[0] !== id || v[1] !== qualifier || (v[2] || null) !== subaddress || v.slice(3).some(Boolean))
            return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    }
    if (segmentComposite(unbs[0], 7, una)[0] !== route.applicationReference)
        return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    if (row.sender_ediel_id !== route.senderId || row.receiver_ediel_id !== route.receiverId || row.sender_sub_address !== route.senderSubaddress || row.receiver_sub_address !== route.receiverSubaddress || row.application_reference !== route.applicationReference || row.transport_type !== route.transportType || row.mailbox !== route.mailbox || row.receiver_email !== route.receiverEmail || row.communication_route_id !== route.communicationRouteId || (row.route_profile_id ?? null) !== route.routeProfileId)
        return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    for (const fact of facts.dateEventObjects ?? []) {
        if (fact.kind !== 'change_before_supply')
            continue;
        const mappings = route.suppliers.filter(m => m.meteringPointId === fact.meteringPointId && m.identityAgency === fact.identityAgency);
        if (!fact.supplier || mappings.length !== 1 || JSON.stringify(mappings[0].supplier) !== JSON.stringify(fact.supplier) || JSON.stringify(mappings[0].recipient) !== JSON.stringify(route.legalRecipient))
            return invalid('PRODAT_DATE_EVENT_ROUTE_MISMATCH');
    }
}
/** Includes actual wire identity so a stale row label cannot skip the bounded gate. */
export function hasProdatDateEventMessage(message: Pick<EdielMessageRow, 'message_family' | 'message_code' | 'raw_payload'>): boolean {
    if (message.message_family === 'PRODAT' && ['Z06', 'Z09', 'Z10'].includes(message.message_code))
        return true;
    const wire = tokenizeEdifact(message.raw_payload ?? '');
    let family = '';
    for (const token of wire.segments) {
        if (token.tag === 'UNH')
            family = segmentComposite(token, 2, wire.una)[0] ?? '';
        if (token.tag === 'BGM' && family === 'PRODAT' && ['Z06', 'Z09', 'Z10'].includes(segmentComposite(token, 1, wire.una)[0]))
            return true;
    }
    return false;
}
