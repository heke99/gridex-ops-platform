import { isProdatCalendarMinute, prodatDate203, prodatNowDate203 } from './render/dates';
import type { Party, Ref, Selector, SourceIdentity, Route, StepScope } from './prodatReportingPermissionTypes';
export const reportingInvalid = (): never => { throw new Error('prodat_register_evidence_reporting_invalid'); };
export function reportingRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return reportingInvalid();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(v, k) || v[k] === undefined))
        return reportingInvalid();
    return v;
}
export function reportingText(v: unknown, max = 200, empty = false): string {
    if (typeof v !== 'string' || (!empty && !v.length) || v.length > max || v !== v.trim() || /[\x00-\x1f\x7f]/.test(v))
        return reportingInvalid();
    return v;
}
export function reportingUuid(v: unknown): string { const s = reportingText(v, 36); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : reportingInvalid(); }
export function reportingEnum<T extends string>(v: unknown, values: readonly T[]): T { return typeof v === 'string' && values.includes(v as T) ? v as T : reportingInvalid(); }
export function reportingInteger(v: unknown, min = 1): number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : reportingInvalid(); }
export const reportingArray = (v: unknown): unknown[] => Array.isArray(v) && v.length <= 1000 ? v : reportingInvalid();
export function reportingBusinessMinute(value: unknown): string | null {
    if (typeof value !== 'string' || value !== value.trim())
        return null;
    if (isProdatCalendarMinute(value))
        return value;
    const match = value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:\d{2})?$/);
    return match && Number(match[1] ?? 0) === 0 && Number(match[2] ?? 0) === 0 ? prodatDate203(value) : null;
}
export function reportingMinute(v: unknown): string { const s = reportingText(v, 12); return isProdatCalendarMinute(s) ? s : reportingInvalid(); }
export function reportingEvaluationMinute(v: unknown): string {
    if (typeof v !== 'number' || !Number.isSafeInteger(v))
        return reportingInvalid();
    try {
        return prodatNowDate203(new Date(v));
    }
    catch {
        return reportingInvalid();
    }
}
export function copyReportingParty(v: unknown): Party { const r = reportingRecord(v, ['id', 'qualifier', 'agency']); return { id: reportingText(r.id, 35), qualifier: reportingText(r.qualifier, 3, true), agency: reportingText(r.agency, 3) }; }
export function copyReportingRef(v: unknown, kind: Ref['kind']): Ref { const r = reportingRecord(v, ['kind', 'key', 'revision', 'requestKey']); if (r.kind !== kind)
    return reportingInvalid(); return { kind, key: reportingUuid(r.key), revision: reportingUuid(r.revision), requestKey: reportingUuid(r.requestKey) }; }
export function copyReportingSelector(v: unknown): Selector { const r = reportingRecord(v, ['workbook', 'sheet', 'entityLabel', 'columnName', 'columnIndex']); return { workbook: reportingText(r.workbook), sheet: reportingText(r.sheet), entityLabel: reportingText(r.entityLabel), columnName: reportingText(r.columnName), columnIndex: reportingInteger(r.columnIndex, 0) }; }
export function copyReportingSourceIdentity(v: unknown): SourceIdentity {
    const r = reportingRecord(v, ['kind', 'id', 'revision', 'digest']), kind = reportingEnum(r.kind, ['builtin', 'dynamic']);
    const digest = reportingText(r.digest, 64);
    if (!/^[0-9a-f]{64}$/.test(digest))
        return reportingInvalid();
    return { kind, id: kind === 'dynamic' ? reportingUuid(r.id) : reportingText(r.id), revision: reportingText(r.revision), digest };
}
export function copyReportingRoute(v: unknown): Route {
    const r = reportingRecord(v, ['settingsId', 'actorSettingId', 'routeProfileId', 'communicationRouteId', 'transportProfileId', 'legalSender', 'legalRecipient', 'senderId', 'receiverId', 'senderQualifier', 'receiverQualifier', 'senderSubaddress', 'receiverSubaddress', 'applicationReference', 'transportType', 'mailbox', 'receiverEmail']);
    const nullable = (v: unknown) => v === null ? null : reportingText(v), id = (v: unknown) => v === null ? null : reportingUuid(v);
    return { settingsId: reportingUuid(r.settingsId), actorSettingId: reportingUuid(r.actorSettingId), routeProfileId: id(r.routeProfileId), communicationRouteId: id(r.communicationRouteId), transportProfileId: id(r.transportProfileId), legalSender: copyReportingParty(r.legalSender), legalRecipient: copyReportingParty(r.legalRecipient), senderId: reportingText(r.senderId), receiverId: reportingText(r.receiverId), senderQualifier: reportingText(r.senderQualifier, 3), receiverQualifier: reportingText(r.receiverQualifier, 3), senderSubaddress: nullable(r.senderSubaddress), receiverSubaddress: nullable(r.receiverSubaddress), applicationReference: reportingText(r.applicationReference), transportType: reportingEnum(r.transportType, ['manual_upload']), mailbox: nullable(r.mailbox), receiverEmail: nullable(r.receiverEmail) };
}
export function copyReportingScope(value: unknown): StepScope {
    const r = reportingRecord(value, ['companyId', 'runId', 'roleCode', 'caseCode', 'suite', 'stepNo', 'code', 'actor', 'direction', 'environment', 'runtimeSuite']);
    return { companyId: reportingUuid(r.companyId), runId: reportingUuid(r.runId), roleCode: reportingEnum(r.roleCode, ['esco']), caseCode: reportingEnum(r.caseCode, ['E3', 'E4', '8.1.1', '8.1.2', '8.1.3']), suite: reportingEnum(r.suite, ['PRODAT']), stepNo: reportingInteger(r.stepNo), code: reportingEnum(r.code, ['Z13']), actor: reportingEnum(r.actor, ['gridex']), direction: reportingEnum(r.direction, ['outbound']), environment: reportingEnum(r.environment, ['test']), runtimeSuite: reportingEnum(r.runtimeSuite, ['AGT', 'TGT']) };
}
