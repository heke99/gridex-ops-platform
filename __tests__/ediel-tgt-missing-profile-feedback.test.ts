// local/052: actual start action; IO mocked; not TGT acceptance.
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ guard: vi.fn(), operational: vi.fn(), runtime: vi.fn(), requiredRuntime: vi.fn(), create: vi.fn(), redirect: vi.fn(), scope: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.guard, isPlatformAdminContext: () => true }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.operational }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.scope }))
vi.mock('@/lib/ediel/systemTestSettings', () => ({ getEdielSystemTestSettings: async () => null, getEdielSystemTestRuntimeContext: io.runtime, requireEdielSystemTestRuntimeContext: io.requiredRuntime }))
vi.mock('@/lib/ediel/db', () => ({ createEdielTestRun: io.create }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('next/navigation', () => ({ redirect: io.redirect, unstable_rethrow: vi.fn() }))
import { createEdielTgtRunFromTemplateAction } from '@/app/admin/ediel/actions.part-2'
const form = () => { const f = new FormData(); for (const [k,v] of Object.entries({ companyId:'selected-company',testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.1' })) f.set(k,v); return f }
beforeEach(() => {
 vi.clearAllMocks(); io.guard.mockResolvedValue({userId:'actor'});io.scope.mockResolvedValue({companyId:'other-active-company'});io.operational.mockResolvedValue(undefined);io.runtime.mockResolvedValue(null);io.requiredRuntime.mockRejectedValue(new Error('Systemtest kräver en aktiv, tenant- och rollscopad testprofil med explicit testpaket, Ediel-aktör och systemtestportal. Konfigurera profilen under Ediel & Go-live innan testet körs.'));io.redirect.mockImplementation((url:string) => { throw new Error('REDIRECT:'+url) });io.create.mockRejectedValue(new Error('UNEXPECTED_RUN_CREATION'))
})
it('redirects missing profile to actionable case feedback and creates no run', async () => {
 await expect(createEdielTgtRunFromTemplateAction(form())).rejects.toThrow('REDIRECT:/admin/ediel/system-tests/cases/1.2.1?companyId=selected-company&startStatus=missing_test_profile')
 expect(io.operational).toHaveBeenCalledWith('selected-company');expect(io.runtime).toHaveBeenCalledWith({companyId:'selected-company',testSuite:'TGT',actorRole:'supplier'});expect(io.create).not.toHaveBeenCalled()
})
it('propagates unexpected runtime read failure instead of replacing it with missing profile', async () => {
 const e = new Error('synthetic database permission failure');io.runtime.mockRejectedValue(e);io.requiredRuntime.mockRejectedValue(e)
 await expect(createEdielTgtRunFromTemplateAction(form())).rejects.toBe(e);expect(io.redirect).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})
it('still denies unauthorized actor before any runtime lookup', async () => {
 const e=new Error('synthetic forbidden');io.guard.mockRejectedValue(e);await expect(createEdielTgtRunFromTemplateAction(form())).rejects.toBe(e);expect(io.runtime).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})
it('still denies non-operational company before runtime lookup', async () => {
 const e=new Error('synthetic company denied');io.operational.mockRejectedValue(e);await expect(createEdielTgtRunFromTemplateAction(form())).rejects.toBe(e);expect(io.runtime).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})
