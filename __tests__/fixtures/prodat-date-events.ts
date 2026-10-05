import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
import type { ProdatDateEventObject, TgtDateEventSource } from '@/lib/ediel/prodat/prodatDateEvents';
import type { TgtDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority';
import type { EdielMessageRow } from '@/lib/ediel/types';
/** Independent fixed scenario: existing supply began September 1, change is October 1.
 * Test-boundary expected context only; this helper is not a server producer receipt. */
export const changeDateFact = (meteringPointId = 'A', identityAgency: '9' | '89' = '89'): ProdatDateEventObject => ({ meteringPointId, identityAgency, kind: 'change_before_supply', change: { reference: 'synthetic-change', revision: '1' }, contract: { reference: 'synthetic-supply', revision: '1' }, changeEffectiveAt: '202610010000', supplyStartsAt: '202609010000', supplier: { id: '54321', qualifier: '160', agency: 'SVK' } });
export function qualifyDateEventTestRow(row: EdielMessageRow, objects: ProdatDateEventObject[] = [changeDateFact()]): TgtDateEventValidationContext {
    if (!row.company_id)
        throw new Error('fixture company required');
    if (row.environment !== 'test')
        throw new Error('fixture cannot authorize production');
    const code = row.message_code;
    if (!['Z06', 'Z09', 'Z10'].includes(code))
        throw new Error('unsupported fixture');
    const wire = tokenizeEdifact(row.raw_payload!), c = wire.una.componentDataElementSeparator, e = wire.una.dataElementSeparator, t = wire.una.segmentTerminator;
    const source: TgtDateEventSource = { kind: 'tgt', companyId: row.company_id, runId: 'SYNTHETIC-RUN', roleCode: 'supplier', caseCode: 'SYNTHETIC-CASE', suite: 'PRODAT', stepNo: 1, code: code as TgtDateEventSource['code'], sourceDigest: 'synthetic-independent-source', actorId: 'SYNTHETIC-ACTOR', reference: 'fixed source boundary test', route: { settingsId: 'SYNTHETIC-SETTINGS', actorSettingId: 'SYNTHETIC-ACTOR-SETTING', routeProfileId: null, communicationRouteId: null, transportProfileId: null, legalSender: { id: '12345', qualifier: '160', agency: 'SVK' }, legalRecipient: { id: '54321', qualifier: '160', agency: 'SVK' }, senderId: '12345', receiverId: '54321', senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress: null, receiverSubaddress: null, transportType: 'manual_upload', mailbox: 'tgt-file-engine', receiverEmail: null, applicationReference: '23-DDQ-PRODAT', suppliers: objects.flatMap(o => o.kind === 'change_before_supply' && o.supplier ? [{ meteringPointId: o.meteringPointId, identityAgency: o.identityAgency, supplier: o.supplier, recipient: { id: '54321', qualifier: '160', agency: 'SVK' } }] : []) } };
    const segments = wire.segments.flatMap(s => s.tag === 'UNB' ? [`UNB${e}UNOC${c}3${e}12345${c}ZZ${e}54321${c}ZZ${e}260919${c}1200${e}I${e}${e}23-DDQ-PRODAT`] : s.tag === 'BGM' ? [s.raw, `NAD${e}FR${e}12345${c}160${c}SVK`, `NAD${e}DO${e}54321${c}160${c}SVK`] : s.tag === 'UNT' ? [s.raw.replace(/(?<=^[^+;|]+[+;|])\d+/, v => String(Number(v) + 2))] : [s.raw]);
    row.raw_payload = wire.una.raw + segments.join(t) + t;
    Object.assign(row, { sender_ediel_id: '12345', receiver_ediel_id: '54321', sender_sub_address: null, receiver_sub_address: null, transport_type: 'manual_upload', mailbox: 'tgt-file-engine', receiver_email: null, communication_route_id: null, route_profile_id: null });
    const engine = row.parsed_payload?.prodatEngine as {
        registerEvidence?: {
            facts?: object;
        };
    } | undefined;
    const facts = { ...engine?.registerEvidence?.facts, market: 'electricity' as const, dateEventObjects: objects, dateEventSource: source };
    row.parsed_payload = { ...row.parsed_payload, testRunId: source.runId, stepNo: 1, prodatEngine: { ...engine, registerEvidence: createProdatRegisterEvidence({ code, rawSegments: segments, una: wire.una, facts }) } };
    return { source: structuredClone(source), objects: structuredClone(objects) };
}
