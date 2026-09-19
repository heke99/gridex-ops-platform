'use server';
import { revalidatePath } from 'next/cache';
import { requireEdielWriteActionAccess } from '@/lib/ediel/actionAccess';
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards';
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance';
import { requireScopedEdielTestRunForAction } from './actions.part-1';
import { saveTgtReportingPermission } from '@/lib/ediel/testing/tgtReportingPermissionContext';
import { readReportingPermissionForm } from '@/lib/ediel/testing/tgtReportingPermissionForm';
export async function saveEdielTgtReportingPermissionAction(form: FormData) {
    const actor = await requireEdielWriteActionAccess(), input = readReportingPermissionForm(form);
    const run = await requireScopedEdielTestRunForAction(input.testRunId, actor);
    await requireCompanyScopedActionAccess(run.company_id, { anyOf: ['ediel_testing.write', 'communication.write'] });
    await requireCompanyOperationalForWrites(run.company_id);
    await saveTgtReportingPermission({ companyId: run.company_id, runId: run.id, stepNo: input.stepNo, expectedRunUpdatedAt: input.expectedRunUpdatedAt, actorId: actor.userId, command: input.command });
    revalidatePath(`/admin/ediel/system-tests/cases/${encodeURIComponent(run.test_case_code)}`);
}
