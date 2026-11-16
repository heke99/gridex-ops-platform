import { copyReportingCommand } from './tgtReportingPermissionAssertions';
import { reportingInvalid, reportingUuid, reportingInteger, reportingText } from '@/lib/ediel/prodat/prodatReportingPermissionStrict';
/** Ordinary operator fields only. All hidden selectors remain untrusted. */
export function readReportingPermissionForm(form: FormData) {
    const get = (key: string) => { const values = form.getAll(key); if (values.length !== 1 || typeof values[0] !== 'string')
        return reportingInvalid(); return values[0]; };
    const allowed = new Set(['testRunId', 'stepNo', 'expectedRunUpdatedAt', 'operation', 'resolution', 'sourceNote', 'objectCount']);
    const countRaw = form.get('objectCount'), count = typeof countRaw === 'string' && /^\d+$/.test(countRaw) ? Number(countRaw) : 0;
    if (count > 1000)
        return reportingInvalid();
    for (let i = 0; i < count; i++)
        for (const key of ['selector', 'term', 'end', 'minuteOfDay', 'classification', 'classificationRationale', 'purpose', 'purposeRationale'])
            allowed.add(`object.${i}.${key}`);
    for (const key of form.keys())
        if (!allowed.has(key) && !key.startsWith('$ACTION_'))
            return reportingInvalid();
    const operation = get('operation'), sourceNote = get('sourceNote');
    const command = operation === 'clear' ? { operation, sourceNote } : { operation, resolution: get('resolution'), sourceNote, objects: Array.from({ length: count }, (_, i) => {
            const field = (k: string) => get(`object.${i}.${k}`), kind = field('term'), purpose = field('purpose');
            const end = field('end'), minute = field('minuteOfDay');
            return { selector: JSON.parse(field('selector')) as unknown, term: kind === 'bounded' ? { kind, end: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end) ? end.replace(/[-T:]/g, '') : end } : kind === 'bounded_source' ? { kind, minuteOfDay: /^\d{2}:\d{2}$/.test(minute) ? minute.replace(':', '') : minute } : { kind }, classification: field('classification'), classificationRationale: field('classificationRationale'), purpose: purpose === 'unknown' || purpose === 'absent' ? { kind: purpose } : { kind: 'assessed', code: purpose, rationale: field('purposeRationale') } };
        }) };
    return { testRunId: reportingUuid(get('testRunId')), stepNo: reportingInteger(Number(get('stepNo')), 1), expectedRunUpdatedAt: reportingText(get('expectedRunUpdatedAt'), 40), command: copyReportingCommand(command) };
}
