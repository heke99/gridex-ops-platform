import type { Classification, Installation, Purpose, ReportingObject, ReportingSelection, RequestAssociation, RequestOrigin, RequestPurpose, ServerSource, Term, ExpectedContext } from './prodatReportingPermissionTypes';
import { copyReportingParty as party, copyReportingRef as ref, copyReportingSelector as selector, copyReportingSourceIdentity as identity, copyReportingScope, copyReportingRoute, reportingRecord as record, reportingText as text, reportingUuid as uuid, reportingEnum as oneOf, reportingArray as array, reportingInvalid as invalid, reportingMinute, reportingEvaluationMinute } from './prodatReportingPermissionStrict';
export * from './prodatReportingPermissionTypes';
export { reportingBusinessMinute, reportingEvaluationMinute } from './prodatReportingPermissionStrict';
export const REPORTING_PURPOSES = ['B71', 'B72', 'B73', 'B74', 'B75', 'B76'] as const;
const kind = (v: unknown): unknown => v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>).kind : invalid();
function term(v: unknown): Term {
    if (kind(v) === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    if (kind(v) === 'indefinite') {
        const r = record(v, ['kind', 'declaration']);
        return { kind: 'indefinite', declaration: ref(r.declaration, 'declaration') };
    }
    const r = record(v, ['kind', 'endMinute', 'declaration']);
    if (r.kind !== 'bounded')
        return invalid();
    return { kind: 'bounded', endMinute: reportingMinute(r.endMinute), declaration: ref(r.declaration, 'declaration') };
}
function classification(v: unknown): Classification {
    if (kind(v) === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    const r = record(v, ['kind', 'record']);
    return { kind: oneOf(r.kind, ['private', 'nonprivate']), record: ref(r.record, 'classification') };
}
function purpose(v: unknown): Purpose {
    if (kind(v) === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    if (kind(v) === 'absent') {
        const r = record(v, ['kind', 'declaration']);
        return { kind: 'absent', declaration: ref(r.declaration, 'declaration') };
    }
    const r = record(v, ['kind', 'code', 'assessment', 'legalActor', 'customer']);
    if (r.kind !== 'assessed')
        return invalid();
    return { kind: 'assessed', code: oneOf(r.code, REPORTING_PURPOSES), assessment: ref(r.assessment, 'assessment'), legalActor: party(r.legalActor), customer: party(r.customer) };
}
const installation = (v: unknown): Installation => { const r = record(v, ['id', 'agency']); return { id: text(r.id, 25), agency: oneOf(r.agency, ['9', '89']) }; };
function requestPurpose(v: unknown): RequestPurpose {
    const k = kind(v);
    if (k === 'unknown' || k === 'absent') {
        record(v, ['kind']);
        return { kind: k };
    }
    const r = record(v, ['kind', 'code']);
    if (r.kind !== 'present')
        return invalid();
    return { kind: 'present', code: oneOf(r.code, REPORTING_PURPOSES) };
}
function origin(v: unknown): RequestOrigin {
    if (kind(v) === 'pure_fixture') {
        const r = record(v, ['kind', 'reference']);
        return { kind: 'pure_fixture', reference: text(r.reference) };
    }
    const r = record(v, ['kind', 'companyId', 'runId', 'messageId', 'source', 'bodyDigest']);
    if (r.kind !== 'persisted_request' || !/^[0-9a-f]{64}$/.test(String(r.bodyDigest)))
        return invalid();
    return { kind: 'persisted_request', companyId: uuid(r.companyId), runId: uuid(r.runId), messageId: uuid(r.messageId), source: identity(r.source), bodyDigest: text(r.bodyDigest, 64) };
}
function association(v: unknown): RequestAssociation {
    if (kind(v) === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    const r = record(v, ['kind', 'origin', 'requestKey', 'requestRevision', 'li', 'anj', 'customer', 'legalRequester', 'process', 'authorization', 'reason', 'purpose', 'allowedInstallations']);
    if (r.kind !== 'known')
        return invalid();
    const allowed = array(r.allowedInstallations).map(installation);
    if (new Set(allowed.map(i => JSON.stringify(i))).size !== allowed.length)
        return invalid();
    return { kind: 'known', origin: origin(r.origin), requestKey: uuid(r.requestKey), requestRevision: uuid(r.requestRevision), li: text(r.li, 35), anj: text(r.anj, 35), customer: party(r.customer), legalRequester: party(r.legalRequester), process: ref(r.process, 'process'), authorization: ref(r.authorization, 'authorization'), reason: oneOf(r.reason, ['S17', 'S18']), purpose: requestPurpose(r.purpose), allowedInstallations: allowed };
}
export function copyReportingObjects(value: unknown): ReportingObject[] {
    const objects = array(value).map((v): ReportingObject => {
        const r = record(v, ['objectKey', 'requestKey', 'selector', 'process', 'authorization', 'li', 'anj', 'customer', 'legalRequester', 'expectedReason', 'term', 'classification', 'purpose', 'code', 'installation', 'requestAssociation']);
        const base = { objectKey: uuid(r.objectKey), requestKey: uuid(r.requestKey), selector: selector(r.selector), process: ref(r.process, 'process'), authorization: ref(r.authorization, 'authorization'), li: text(r.li, 35), anj: text(r.anj, 35), customer: party(r.customer), legalRequester: party(r.legalRequester), expectedReason: oneOf(r.expectedReason, ['S17', 'S18']), term: term(r.term), classification: classification(r.classification), purpose: purpose(r.purpose) };
        const refs = [base.process, base.authorization, ...(base.term.kind === 'unknown' ? [] : [base.term.declaration]), ...(base.classification.kind === 'unknown' ? [] : [base.classification.record]), ...(base.purpose.kind === 'unknown' ? [] : base.purpose.kind === 'absent' ? [base.purpose.declaration] : [base.purpose.assessment])];
        if (base.process.key !== base.requestKey || refs.some(x => x.requestKey !== base.requestKey || x.revision !== base.process.revision))
            return invalid();
        if (base.purpose.kind === 'assessed' && (JSON.stringify(base.purpose.customer) !== JSON.stringify(base.customer) || JSON.stringify(base.purpose.legalActor) !== JSON.stringify(base.legalRequester)))
            return invalid();
        if (r.code === 'Z13') {
            if (r.installation !== null || r.requestAssociation !== null || base.objectKey !== base.requestKey)
                return invalid();
            return { ...base, code: 'Z13', installation: null, requestAssociation: null };
        }
        if (r.code !== 'Z14')
            return invalid();
        return { ...base, code: 'Z14', installation: installation(r.installation), requestAssociation: association(r.requestAssociation) };
    });
    if (new Set(objects.map(x => x.objectKey)).size !== objects.length || new Set(objects.filter(x => x.code === 'Z13').map(x => x.li)).size !== objects.filter(x => x.code === 'Z13').length)
        return invalid();
    return objects;
}
export function copyReportingSource(value: unknown): ServerSource {
    const r = record(value, ['kind', 'scope', 'source', 'factsRevision', 'actorId', 'sourceNote', 'route']);
    if (r.kind !== 'tgt')
        return invalid();
    return { kind: 'tgt', scope: copyReportingScope(r.scope), source: identity(r.source), factsRevision: uuid(r.factsRevision), actorId: uuid(r.actorId), sourceNote: text(r.sourceNote, 2000), route: copyReportingRoute(r.route) };
}
export function copyReportingSelection(value: unknown): ReportingSelection {
    const s = value && typeof value === 'object' ? (value as Record<string, unknown>).source : null;
    if (kind(s) === 'caller_selection') {
        const r = record(value, ['source', 'objects', 'evaluationUtcMs']), source = record(r.source, ['kind', 'reference']);
        reportingEvaluationMinute(r.evaluationUtcMs);
        return { source: { kind: 'caller_selection', reference: text(source.reference) }, objects: copyReportingObjects(r.objects), evaluationUtcMs: r.evaluationUtcMs as number };
    }
    const r = record(value, ['source', 'objects']), source = copyReportingSource(r.source), objects = copyReportingObjects(r.objects);
    if (objects.some(o => o.code !== 'Z13' || o.process.revision !== source.factsRevision || JSON.stringify(o.legalRequester) !== JSON.stringify(source.route.legalSender)))
        return invalid();
    return { source, objects };
}
export function copyReportingExpected(value: unknown): ExpectedContext {
    const r = record(value, ['source', 'objects', 'evaluationUtcMs']);
    reportingEvaluationMinute(r.evaluationUtcMs);
    const e = copyReportingSelection({ source: r.source, objects: r.objects });
    if (e.source.kind !== 'tgt')
        return invalid();
    return { source: e.source, objects: e.objects, evaluationUtcMs: r.evaluationUtcMs as number };
}
export const isReportingPermissionField = (code: string, field: string) => ['Z13', 'Z14'].includes(code) && ['321', '323'].includes(field);
