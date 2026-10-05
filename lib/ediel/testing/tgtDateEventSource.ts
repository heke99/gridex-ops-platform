import { copyProdatDateEventSource, copyProdatDateEventObjects, prodatEventMinute, type ProdatDateEventRoute, type TgtDateEventSource } from '@/lib/ediel/prodat/prodatDateEvents';
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
import type { EdielTestRunRow, CreateEdielMessageInput } from '@/lib/ediel/types';
import type { TgtProdatSourceColumn } from './tgtProdatSource';
import { assertProdatDateEventAuthority, type TgtDateEventValidationContext, type ProdatDateEventRow } from '@/lib/ediel/prodat/prodatDateEventAuthority';
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
const invalid = (): never => { throw new Error('PRODAT_DATE_EVENT_SOURCE_INVALID'); };
/** Only the authorized notes action supplies this scope and route, separate from JSON assertions. */
export function buildTgtDateEventSource(input: {
    run: Pick<EdielTestRunRow, 'id' | 'company_id' | 'role_code' | 'test_case_code' | 'test_suite'>;
    stepNo: number;
    code: string;
    sourceDigest: string;
    actorId: string;
    reference: string;
    route: ProdatDateEventRoute;
    facts: ProdatDependentConditionFacts;
}): TgtDateEventSource {
    const objects = copyProdatDateEventObjects(input.facts.dateEventObjects);
    const source = copyProdatDateEventSource({ kind: 'tgt', companyId: input.run.company_id, runId: input.run.id, roleCode: input.run.role_code, caseCode: input.run.test_case_code, suite: input.run.test_suite, stepNo: input.stepNo, code: input.code, sourceDigest: input.sourceDigest, actorId: input.actorId, reference: input.reference, route: { ...input.route, suppliers: objects.flatMap(o => o.kind === 'change_before_supply' && o.supplier ? [{ meteringPointId: o.meteringPointId, identityAgency: o.identityAgency, supplier: o.supplier, recipient: input.route.legalRecipient }] : []) } });
    if (source.kind !== 'tgt')
        return invalid();
    return source;
}
export function assertTgtDateEventSelection(code: string, objects: readonly (readonly TgtProdatSourceColumn[])[], facts: ProdatDependentConditionFacts) {
    if (!facts.dateEventObjects)
        return;
    if (!['Z06', 'Z09', 'Z10'].includes(code) || facts.market !== 'electricity' || facts.dateEventObjects.length !== objects.length)
        return invalid();
    for (const fact of facts.dateEventObjects) {
        const first = objects.find(rows => rows[0].fields['209'] === fact.meteringPointId && (rows[0].identityAgency ?? '9') === fact.identityAgency)?.[0];
        if (!first)
            return invalid();
        if ((code === 'Z09') !== (fact.kind === 'production_contract'))
            return invalid();
        if (fact.kind === 'production_contract' && first.fields['223'] !== 'Z70')
            return invalid();
        const selected = fact.kind === 'production_contract' ? fact.event.kind === 'signed' ? '210' : fact.event.kind === 'ceased' ? '211' : null : '210';
        if (selected && first.fields[selected] && fact.kind === 'production_contract' && fact.supplyBoundaryAt && prodatEventMinute(first.fields[selected]) !== prodatEventMinute(fact.supplyBoundaryAt))
            return invalid();
        if (fact.kind === 'change_before_supply')
            for (const [field, value] of [['210', fact.supplyStartsAt], ['216', fact.changeEffectiveAt]] as const)
                if (first.fields[field] && value && prodatEventMinute(first.fields[field]) !== prodatEventMinute(value))
                    return invalid();
    }
}
export function dateEventDraftRow(input: CreateEdielMessageInput): ProdatDateEventRow { return { company_id: input.companyId!, environment: input.environment!, direction: input.direction, message_code: input.messageCode, sender_ediel_id: input.senderEdielId ?? null, receiver_ediel_id: input.receiverEdielId ?? null, sender_sub_address: input.senderSubAddress ?? null, receiver_sub_address: input.receiverSubAddress ?? null, application_reference: input.applicationReference ?? null, transport_type: input.transportType!, mailbox: input.mailbox ?? null, receiver_email: input.receiverEmail ?? null, communication_route_id: input.communicationRouteId ?? null, route_profile_id: input.routeProfileId ?? null }; }
export function assertTgtDateEventDraft(input: CreateEdielMessageInput, context?: TgtDateEventValidationContext) {
    const wire = tokenizeEdifact(input.rawPayload ?? ''), payload = input.parsedPayload, engine = payload?.prodatEngine as {
        registerEvidence?: {
            facts?: ProdatDependentConditionFacts;
        };
    } | undefined;
    assertProdatDateEventAuthority({ code: input.messageCode, rawSegments: wire.segments.map(s => s.raw), una: wire.una, facts: engine?.registerEvidence?.facts, row: dateEventDraftRow(input), expected: context, runId: typeof payload?.testRunId === 'string' ? payload.testRunId : null, stepNo: typeof payload?.stepNo === 'number' ? payload.stepNo : null });
}
