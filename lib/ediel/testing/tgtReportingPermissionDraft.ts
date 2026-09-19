import type { CreateEdielMessageInput } from '@/lib/ediel/types';
import type { ExpectedContext, ReportingObject } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { copyReportingSelection } from '@/lib/ediel/prodat/prodatReportingPermissionContext';
import { assertReportingAuthority, ProdatReportingAuthorityError } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority';
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy';
import { readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
import { dateEventDraftRow } from './tgtDateEventSource';
import type { TestDataLookupParams, TgtPortalCustomerData } from './tgtEdifact.part-1';
import type { TgtProdatSourceColumn } from './tgtProdatSource';
export function reportingPortalObject(params: TestDataLookupParams, column: TgtProdatSourceColumn): ReportingObject | null {
    const selection = params.registerFacts?.reportingPermission;
    if (selection == null)
        return null;
    const checked = copyReportingSelection(selection), block = column.group.block;
    const objects = checked.objects.filter(o => o.code === 'Z13' && o.selector.workbook === block.sourceWorkbook && o.selector.sheet === block.sourceSheet && o.selector.entityLabel === block.entityLabel && o.selector.columnName === column.column.name && o.selector.columnIndex === column.column.index);
    if (objects.length !== 1)
        throw new ProdatReportingAuthorityError('PRODAT_REPORTING_SOURCE_OBJECT_MISSING');
    return objects[0];
}
export function applyReportingPortalObject(portal: TgtPortalCustomerData, object: ReportingObject | null): TgtPortalCustomerData {
    if (!object)
        return portal;
    return { ...portal, reportingRequest: true, meteringPointId: '', lineReference: object.li, powerOfAttorneyReference: object.anj, customerId: object.customer.id, customerIdCodeListQualifier: object.customer.qualifier, reasonForTransaction: object.expectedReason, reportEndDate: object.term.kind === 'bounded' ? object.term.endMinute : null, permissionPurpose: object.purpose.kind === 'assessed' ? object.purpose.code : null };
}
/** Called again after actual route attachment and before persistence. */
export function assertTgtReportingDraft(input: CreateEdielMessageInput, context?: ExpectedContext) {
    if (input.messageFamily !== 'PRODAT' || !['Z13', 'Z14'].includes(input.messageCode))
        return;
    const wire = tokenizeEdifact(input.rawPayload ?? ''), payload = input.parsedPayload, row = dateEventDraftRow(input);
    const params = { code: input.messageCode, rawSegments: wire.segments.map(s => s.raw), una: wire.una, parsedPayload: payload, companyId: input.companyId, runId: typeof payload?.testRunId === 'string' ? payload.testRunId : null, stepNo: typeof payload?.stepNo === 'number' ? payload.stepNo : null, dateEventRow: row, reportingContext: context };
    const facts = readProdatRegisterEvidence(params);
    assertReportingAuthority({ ...params, facts, row, expected: context });
    const failures = validateProdatReportingPermission({ ...params, facts, requireAuthority: true });
    if (failures.length)
        throw new ProdatReportingAuthorityError(failures.map(f => f.code).join('|'));
}
