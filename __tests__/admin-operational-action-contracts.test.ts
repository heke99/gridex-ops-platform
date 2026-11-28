import { beforeEach, describe, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ access: vi.fn(), scope: vi.fn(), operate: vi.fn(), createInfo: vi.fn(), createScope: vi.fn(), createPermission: vi.fn(), queueInfo: vi.fn(), queuePermission: vi.fn(), snapshot: vi.fn(), closeInfo: vi.fn(), manualSent: vi.fn(), complete: vi.fn(), selectProvider: vi.fn(), enableProvider: vi.fn(), revalidate: vi.fn(), platform: false, requestCompany: 'company-a', user: 'actor-a' }));
vi.mock('next/cache', () => ({ revalidatePath: s.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error('redirect:' + url); }, unstable_rethrow: () => { } }));
vi.mock('@/lib/admin/guards', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/admin/guards')>(), requireAdminActionAccess: s.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user ? { id: s.user } : null } }) } }) }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: s.requestCompany }, error: null }) }) }) }) } }));
vi.mock('@/lib/tenant/scope', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/tenant/scope')>(), assertUserCanOperateCompany: s.operate, requireOperationalCompanyId: s.scope, getOperationalCompanyScope: async () => ({ companyId: await s.scope() }) }));
vi.mock('@/lib/onboarding/infoRequests', () => ({ createCustomerInfoRequest: s.createInfo, createAuthorizationScope: s.createScope, createMeteringPermissionDraft: s.createPermission, queueCustomerInfoRequestForDispatch: s.queueInfo, queueMeteringPermissionForZ13: s.queuePermission, applyZ14SnapshotToMeteringPermission: s.snapshot, closeCustomerInfoRequest: s.closeInfo }));
vi.mock('@/lib/ediel/services/manualPermission', () => ({ parseManualServiceAssignmentSelection: (v: string | null) => ({ selection: v }) }));
vi.mock('@/lib/facility/facilityLookupWorkflow', () => ({ markFacilityLookupSentManually: s.manualSent }));
vi.mock('@/lib/customer-operations/facilityResponseOrchestrator', () => ({ completeFacilityLookupAndRunNextSteps: s.complete }));
vi.mock('@/lib/billing/providers/registry', () => ({ InvoiceProviderConfigError: class extends Error {
    }, selectTenantInvoiceProvider: s.selectProvider, setTenantInvoiceDispatchEnabled: s.enableProvider }));
vi.mock('@/lib/audit/actionLogger', () => ({}));
vi.mock('@/lib/billing/providerEventProcessor', () => ({}));
vi.mock('@/lib/integrations/billing/capway/auth', () => ({}));
vi.mock('@/lib/integrations/billing/capway/client', () => ({}));
import { createAuthorizationScopeAction, createCustomerInfoRequestAction, createMeteringPermissionDraftAction, queueCustomerInfoRequestAction, queueMeteringPermissionZ13Action, applyZ14SnapshotAction, closeCustomerInfoRequestAction } from '@/app/admin/customer-info-requests/actions';
import { completeFacilityLookupAction, markFacilityLookupSentManuallyAction } from '@/app/admin/facility-requests/actions';
import { selectInvoiceProviderAction, setInvoiceDispatchEnabledAction } from '@/app/admin/billing/integrations/actions';
import { TenantCompanyRequiredError, TENANT_COMPANY_REQUIRED_MESSAGE } from '@/lib/tenant/scope';
const form = (v: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, x] of Object.entries(v))
    for (const value of Array.isArray(x) ? x : [x])
        f.append(k, value); return f; };
beforeEach(() => { vi.resetAllMocks(); s.platform = false; s.requestCompany = 'company-a'; s.user = 'actor-a'; s.access.mockImplementation(async () => ({ userId: 'actor-a', roles: [], permissions: [], isAdmin: true, isPlatformAdmin: s.platform, companyId: await s.scope() })); s.scope.mockResolvedValue('company-a'); s.operate.mockImplementation(async (_userId, companyId) => companyId); s.closeInfo.mockResolvedValue({ status: 'cancelled' }); });
describe('information request buttons', () => {
    it('binds creation to the authenticated actor/company and redirects to the verified request', async () => {
        const requestId = 'a1000000-0000-4000-8000-000000000008';
        s.createInfo.mockResolvedValueOnce({ id: requestId, company_id: 'company-a', customer_id: 'customer-a' });
        const request = form({ customer_id: 'customer-a', company_id: 'company-forged', actor_user_id: 'forged', requested_data_categories: ['customer_masterdata', 'metering_data'], notes: '  Notering  ' });
        await expect(createCustomerInfoRequestAction(request)).rejects.toThrow(`redirect:/admin/customer-info-requests?request_id=${requestId}#info-request-${requestId}`);
        expect(s.createInfo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'company-a', actorUserId: 'actor-a', customerId: 'customer-a', requestedDataCategories: ['customer_masterdata', 'metering_data'], notes: 'Notering' }));
        expect(s.revalidate).toHaveBeenCalledWith('/admin/customer-info-requests');
    });
    it('keeps an unverified create receipt neutral without a second write', async () => {
        s.createInfo.mockRejectedValueOnce(new Error('customer_info_request_not_created'));
        await expect(createCustomerInfoRequestAction(form({ customer_id: 'customer-a', requested_data_categories: 'metering_data' }))).rejects.toThrow('redirect:/admin/customer-info-requests?request_status=unconfirmed');
        expect(s.createInfo).toHaveBeenCalledTimes(1);
    });
    it.each([
        ['request creation', createCustomerInfoRequestAction],
        ['authorization creation', createAuthorizationScopeAction],
        ['metering draft creation', createMeteringPermissionDraftAction],
        ['request preparation', queueCustomerInfoRequestAction],
        ['Z13 preparation', queueMeteringPermissionZ13Action],
        ['Z14 application', applyZ14SnapshotAction],
        ['request closure', closeCustomerInfoRequestAction],
    ] as const)('blocks %s when the selected company and action authority disagree', async (_name, action) => {
        s.scope.mockResolvedValue('company-b');
        s.access.mockResolvedValueOnce({ userId: 'actor-a', companyId: 'company-a' });
        await expect(action(form({ customer_id: 'customer-a', request_id: 'request-a', permission_id: 'permission-a', target_status: 'cancelled', reason: 'Provunderlag saknas', requested_data_categories: 'metering_data' }))).rejects.toThrow('Välj rätt bolag');
        for (const writer of [s.createInfo, s.createScope, s.createPermission, s.queueInfo, s.queuePermission, s.snapshot, s.closeInfo, s.revalidate]) {
            expect(writer).not.toHaveBeenCalled();
        }
    });
    it('keeps an authorized closure scoped to the same request', async () => {
        await expect(closeCustomerInfoRequestAction(form({ request_id: 'request-a', target_status: 'cancelled', reason: 'Provunderlag saknas' }))).rejects.toThrow('redirect:/admin/customer-info-requests?success=');
        expect(s.closeInfo).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-a', actorUserId: 'actor-a', requestId: 'request-a', targetStatus: 'cancelled', reason: 'Provunderlag saknas' });
    });
    it('preserves authorization checkboxes and validity dates', async () => { await createAuthorizationScopeAction(form({ customer_id: 'customer-a', covers_grid_owner_data: 'on', covers_metering_data: 'on', valid_from: '2026-10-05' })); expect(s.createScope).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', coversGridOwnerData: true, coversCurrentSupplierContract: false, coversMeteringData: true, validFrom: '2026-10-05' })); });
    it('keeps an unconfirmed authorization as a blocker on metering permission drafts', async () => { await createMeteringPermissionDraftAction(form({ customer_id: 'customer-a' })); expect(s.createPermission).toHaveBeenCalledWith(expect.objectContaining({ lastBlocker: expect.stringContaining('Fullmakt/avtal') })); });
    it('clears only the draft blocker when authorization is confirmed', async () => { await createMeteringPermissionDraftAction(form({ customer_id: 'customer-a', authorization_confirmed: 'on' })); expect(s.createPermission).toHaveBeenCalledWith(expect.objectContaining({ lastBlocker: null })); });
    it('queues information requests in the selected company and refreshes affected views', async () => { await queueCustomerInfoRequestAction(form({ request_id: 'request-a' })); expect(s.queueInfo).toHaveBeenCalledWith({ companyId: 'company-a', actorUserId: 'actor-a', requestId: 'request-a' }); expect(s.revalidate).toHaveBeenCalledWith('/admin/outbound'); });
    it('passes the selected service assignment to Z13 preparation', async () => { await queueMeteringPermissionZ13Action(form({ permission_id: 'permission-a', service_assignment_selection: 'assignment-a' })); expect(s.queuePermission).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', permissionId: 'permission-a', selection: 'assignment-a' })); });
    it('binds snapshot application to company, permission and selected source', async () => { await applyZ14SnapshotAction(form({ permission_id: 'permission-a', source_message_id: 'message-a' })); expect(s.snapshot).toHaveBeenCalledWith({ companyId: 'company-a', actorUserId: 'actor-a', permissionId: 'permission-a', sourceMessageId: 'message-a' }); });
    it.each([createCustomerInfoRequestAction, createAuthorizationScopeAction, createMeteringPermissionDraftAction])('rejects a missing customer before domain writes', async (action) => { await expect(action(new FormData())).rejects.toThrow('Välj kund'); expect(s.createInfo).not.toHaveBeenCalled(); expect(s.createScope).not.toHaveBeenCalled(); expect(s.createPermission).not.toHaveBeenCalled(); });
    it('rejects a missing authenticated actor before writes', async () => { s.user = ''; await expect(createCustomerInfoRequestAction(form({ customer_id: 'customer-a' }))).rejects.toThrow('inloggad'); expect(s.createInfo).not.toHaveBeenCalled(); });
});
describe('facility request buttons', () => {
    it('rejects a request owned by another company before sending or completion', async () => { s.requestCompany = 'company-b'; await expect(markFacilityLookupSentManuallyAction(form({ request_id: 'request-b' }))).rejects.toThrow('saknar åtkomst'); await expect(completeFacilityLookupAction(form({ request_id: 'request-b' }))).rejects.toThrow('saknar åtkomst'); expect(s.manualSent).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled(); });
    it.each([false, true])('keeps a paused request read-only for platform=%s', async (platform) => {
        s.platform = platform
        s.requestCompany = 'company-b'
        s.scope.mockResolvedValue('company-b')
        s.operate.mockRejectedValue(new Error('Bolaget är pausat'))
        const input = form({ request_id: 'request-b' })
        await expect(markFacilityLookupSentManuallyAction(input)).rejects.toThrow('pausat')
        await expect(completeFacilityLookupAction(input)).rejects.toThrow('pausat')
        expect(s.operate).toHaveBeenCalledWith('actor-a', 'company-b')
        expect(s.manualSent).not.toHaveBeenCalled()
        expect(s.complete).not.toHaveBeenCalled()
        expect(s.revalidate).not.toHaveBeenCalled()
    })
    it('does not replace the authenticated action company with a second selection', async () => {
        s.requestCompany = 'company-b'
        s.scope.mockResolvedValue('company-b')
        s.access.mockResolvedValue({ userId: 'actor-a', companyId: 'company-a', roles: [], isPlatformAdmin: false })
        await expect(markFacilityLookupSentManuallyAction(form({ request_id: 'request-b' }))).rejects.toThrow('saknar åtkomst')
        expect(s.operate).not.toHaveBeenCalled()
        expect(s.manualSent).not.toHaveBeenCalled()
    })
    it('uses the stored request company for platform administrators', async () => { s.platform = true; s.requestCompany = 'company-b'; await markFacilityLookupSentManuallyAction(form({ request_id: 'request-b', company_id: 'company-forged', manual_channel: 'phone', note: '  Ringde  ' })); expect(s.manualSent).toHaveBeenCalledWith({ companyId: 'company-b', requestId: 'request-b', actorUserId: 'actor-a', manualChannel: 'phone', note: 'Ringde' }); });
    it('maps invalid manual channels to other', async () => { await markFacilityLookupSentManuallyAction(form({ request_id: 'request-a', manual_channel: 'invalid' })); expect(s.manualSent).toHaveBeenCalledWith(expect.objectContaining({ manualChannel: 'other' })); });
    it('passes the entered facility response through the canonical orchestrator', async () => { await completeFacilityLookupAction(form({ request_id: 'request-a', facility_id: 'facility-a', metering_point_id: 'point-a', grid_area_code: 'NET', price_area_code: 'SE3' })); expect(s.complete).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', actorUserId: 'actor-a', source: 'manual', facilityId: 'facility-a', meteringPointId: 'point-a', priceAreaCode: 'SE3' })); });
});
describe('billing provider buttons', () => {
    it('uses the selected company and actor and redirects after provider selection', async () => { await expect(selectInvoiceProviderAction(form({ company_id: 'company-forged', provider: 'file_export', environment: 'test' }))).rejects.toThrow('redirect:/admin/billing/integrations?provider=selected'); expect(s.selectProvider).toHaveBeenCalledWith({ companyId: 'company-a', provider: 'file_export', environment: 'test', actorUserId: 'actor-a' }); });
    it('uses the explicit enabled flag and refreshes the integration view', async () => { await expect(setInvoiceDispatchEnabledAction(form({ enabled: 'false' }))).rejects.toThrow('provider=disabled'); expect(s.enableProvider).toHaveBeenCalledWith({ companyId: 'company-a', enabled: false, actorUserId: 'actor-a' }); expect(s.revalidate).toHaveBeenCalledWith('/admin/billing/integrations'); });
    it('requires a selected company before provider changes', async () => { s.scope.mockResolvedValue(null); const attempt = selectInvoiceProviderAction(form({ provider: 'capway_aptic' })); await expect(attempt).rejects.toThrow(TenantCompanyRequiredError); await expect(attempt).rejects.toMatchObject({ message: TENANT_COMPANY_REQUIRED_MESSAGE }); expect(s.selectProvider).not.toHaveBeenCalled(); });
});
