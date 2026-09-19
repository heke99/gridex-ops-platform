import { isProdatCalendarMinute } from './render/dates';
/** P26.A r3 p69. Pure source vocabulary; no role or persisted producer authority. */
export const PRODAT_EL_AGGREGATION_PRODUCTS = Object.freeze(['L639Q', 'L640Q', 'L654Q', 'L917', 'L633Q', 'L634Q', 'L635Q', 'L636Q', 'L637Q', 'L638Q', 'L641Q', 'L642Q', 'L651Q', 'L652Q', 'L653Q'] as const);
export type MeterChangeProduct = typeof PRODAT_EL_AGGREGATION_PRODUCTS[number];
export type MeterChangeRef = {
    key: string;
    revision: string;
    eventKey: string;
    reference: string;
};
export type MeterChangeSourceDocument = {
    key: string;
    revision: string;
    reference: string;
};
export type MeterChangeKnown<T> = {
    kind: 'unknown';
} | {
    kind: 'known';
    value: T;
    evidence: MeterChangeRef;
};
export type MeterChangeParty = {
    id: string;
    qualifier: string;
    agency: string;
};
export type MeterChangeSelector = {
    workbookSha256: string;
    sheet: string;
    entityLabel: string;
    blockIndex: number;
    columnName: string;
    columnIndex: number;
};
export type MeterChangeThreshold = {
    kind: 'unknown';
} | {
    kind: 'applicable';
    below: boolean;
    regime: MeterChangeSourceDocument;
    assessment: MeterChangeRef & {
        regimeKey: string;
        regimeRevision: string;
    };
} | {
    kind: 'not_applicable';
    regime: MeterChangeSourceDocument;
    assessment: MeterChangeRef & {
        regimeKey: string;
        regimeRevision: string;
    };
};
export type MeterChangeObject = {
    objectKey: string;
    event: MeterChangeRef;
    customer: {
        kind: 'test_customer';
        selector: MeterChangeSelector;
    } | {
        kind: 'domain_customer';
        customerKey: string;
        revision: string;
    };
    installation: {
        id: string;
        agency: '9' | '89';
    };
    legalGridOwner: MeterChangeParty;
    legalSupplier: MeterChangeParty;
    reason: 'E58';
    effectiveMinute: string;
    li: string;
    oldMeter: {
        number: string;
        settlement: MeterChangeKnown<'Z31' | 'Z32'>;
        product: MeterChangeKnown<MeterChangeProduct>;
    };
    newMeter: {
        number: string;
        settlement: MeterChangeKnown<'Z31' | 'Z32'>;
        product: MeterChangeKnown<MeterChangeProduct>;
    };
    newMeterThreshold: MeterChangeThreshold;
};
/** Option A permits pure explicitly supplied context only. A TGT-shaped object
 * is not a qualified producer and is rejected, rather than silently downcast. */
export type MeterChangeSelection = {
    source: {
        kind: 'caller_selection';
        reference: string;
    };
    market: 'electricity';
    objects: MeterChangeObject[];
};
const invalid = (): never => { throw new Error('prodat_register_evidence_meter_change_invalid'); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return invalid();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(v, k) || v[k] === undefined))
        return invalid();
    return v;
}
function text(v: unknown, max = 200, empty = false): string {
    if (typeof v !== 'string' || (!empty && !v.length) || v !== v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v))
        return invalid();
    return v;
}
function choice<T extends string>(v: unknown, values: readonly T[]): T { return typeof v === 'string' && values.includes(v as T) ? v as T : invalid(); }
function integer(v: unknown): number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid(); }
function reference(v: unknown): MeterChangeRef { const r = record(v, ['key', 'revision', 'eventKey', 'reference']); return { key: text(r.key), revision: text(r.revision), eventKey: text(r.eventKey), reference: text(r.reference) }; }
function sourceDocument(v: unknown): MeterChangeSourceDocument { const r = record(v, ['key', 'revision', 'reference']); return { key: text(r.key), revision: text(r.revision), reference: text(r.reference) }; }
function party(v: unknown): MeterChangeParty { const r = record(v, ['id', 'qualifier', 'agency']); return { id: text(r.id, 35), qualifier: text(r.qualifier, 3, true), agency: text(r.agency, 3) }; }
function observed<T extends string>(v: unknown, values: readonly T[]): MeterChangeKnown<T> {
    if (v && typeof v === 'object' && 'kind' in v && v.kind === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    const r = record(v, ['kind', 'value', 'evidence']);
    choice(r.kind, ['known']);
    return { kind: 'known', value: choice(r.value, values), evidence: reference(r.evidence) };
}
function meter(v: unknown): MeterChangeObject['newMeter'] { const r = record(v, ['number', 'settlement', 'product']); return { number: text(r.number, 35), settlement: observed(r.settlement, ['Z31', 'Z32']), product: observed(r.product, PRODAT_EL_AGGREGATION_PRODUCTS) }; }
function threshold(v: unknown): MeterChangeThreshold {
    if (v && typeof v === 'object' && 'kind' in v && v.kind === 'unknown') {
        record(v, ['kind']);
        return { kind: 'unknown' };
    }
    const kind = choice((v as Record<string, unknown> | null)?.kind, ['applicable', 'not_applicable']);
    const r = record(v, kind === 'applicable' ? ['kind', 'below', 'regime', 'assessment'] : ['kind', 'regime', 'assessment']), regime = sourceDocument(r.regime);
    const a = record(r.assessment, ['key', 'revision', 'eventKey', 'reference', 'regimeKey', 'regimeRevision']);
    const assessment = { ...reference({ key: a.key, revision: a.revision, eventKey: a.eventKey, reference: a.reference }), regimeKey: text(a.regimeKey), regimeRevision: text(a.regimeRevision) };
    if (assessment.regimeKey !== regime.key || assessment.regimeRevision !== regime.revision)
        return invalid();
    if (kind === 'not_applicable')
        return { kind, regime, assessment };
    if (typeof r.below !== 'boolean')
        return invalid();
    return { kind, below: r.below, regime, assessment };
}
function customer(v: unknown): MeterChangeObject['customer'] {
    if (v && typeof v === 'object' && 'kind' in v && v.kind === 'domain_customer') {
        const r = record(v, ['kind', 'customerKey', 'revision']);
        return { kind: 'domain_customer', customerKey: text(r.customerKey), revision: text(r.revision) };
    }
    const r = record(v, ['kind', 'selector']);
    choice(r.kind, ['test_customer']);
    const s = record(r.selector, ['workbookSha256', 'sheet', 'entityLabel', 'blockIndex', 'columnName', 'columnIndex']), hash = text(s.workbookSha256, 64);
    if (!/^[a-f0-9]{64}$/.test(hash))
        return invalid();
    return { kind: 'test_customer', selector: { workbookSha256: hash, sheet: text(s.sheet), entityLabel: text(s.entityLabel), blockIndex: integer(s.blockIndex), columnName: text(s.columnName), columnIndex: integer(s.columnIndex) } };
}
function object(v: unknown): MeterChangeObject {
    const r = record(v, ['objectKey', 'event', 'customer', 'installation', 'legalGridOwner', 'legalSupplier', 'reason', 'effectiveMinute', 'li', 'oldMeter', 'newMeter', 'newMeterThreshold']);
    const i = record(r.installation, ['id', 'agency']), event = reference(r.event), effectiveMinute = text(r.effectiveMinute, 12);
    if (event.key !== event.eventKey || !isProdatCalendarMinute(effectiveMinute) || !effectiveMinute.endsWith('0000'))
        return invalid();
    const oldMeter = meter(r.oldMeter), newMeter = meter(r.newMeter), newMeterThreshold = threshold(r.newMeterThreshold);
    if (oldMeter.number === newMeter.number)
        return invalid();
    const refs = [oldMeter.settlement, oldMeter.product, newMeter.settlement, newMeter.product].flatMap(o => o.kind === 'known' ? [o.evidence] : []);
    if (newMeterThreshold.kind !== 'unknown')
        refs.push(newMeterThreshold.assessment);
    if (refs.some(ref => ref.eventKey !== event.eventKey || ref.revision !== event.revision))
        return invalid();
    return { objectKey: text(r.objectKey), event, customer: customer(r.customer), installation: { id: text(i.id, 25), agency: choice(i.agency, ['9', '89']) }, legalGridOwner: party(r.legalGridOwner), legalSupplier: party(r.legalSupplier), reason: choice(r.reason, ['E58']), effectiveMinute, li: text(r.li, 35), oldMeter, newMeter, newMeterThreshold };
}
export function copyMeterChangeSelection(value: unknown): MeterChangeSelection {
    const r = record(value, ['source', 'market', 'objects']), s = record(r.source, ['kind', 'reference']);
    if (!Array.isArray(r.objects) || !r.objects.length || r.objects.length > 1000)
        return invalid();
    const objects = r.objects.map(object), sets = Array.from({ length: 5 }, () => new Set<string>());
    for (const o of objects) {
        const keys = [o.objectKey, o.event.eventKey, JSON.stringify(o.installation), o.li, o.customer.kind === 'test_customer' ? JSON.stringify(o.customer.selector) : o.objectKey];
        keys.forEach((key, index) => { if (sets[index].has(key))
            invalid(); sets[index].add(key); });
    }
    return { source: { kind: choice(s.kind, ['caller_selection']), reference: text(s.reference) }, market: choice(r.market, ['electricity']), objects };
}
export const isMeterChangeField = (code: string, field: string) => code === 'Z10' && (field === '254' || field === '242');
function changed<T>(old: MeterChangeKnown<T>, next: MeterChangeKnown<T>): boolean | null { return old.kind === 'known' && next.kind === 'known' ? old.value !== next.value : null; }
export function meterChangeCondition(object: MeterChangeObject | undefined, field: string): boolean | null {
    if (!object)
        return null;
    if (field === '242')
        return changed(object.oldMeter.product, object.newMeter.product);
    const settlement = changed(object.oldMeter.settlement, object.newMeter.settlement), threshold = object.newMeterThreshold;
    const below = threshold.kind === 'unknown' ? null : threshold.kind === 'not_applicable' ? false : threshold.below;
    return settlement === true || below === true ? true : settlement === false && below === false ? false : null;
}
/** Aggregate diagnostic only; consumers must select each own first register. */
export function meterChangeAggregate(value: unknown, field: string): boolean | null {
    if (value == null)
        return null;
    try {
        const results = copyMeterChangeSelection(value).objects.map(o => meterChangeCondition(o, field));
        return results.includes(null) ? null : results.includes(true);
    }
    catch {
        return null;
    }
}
