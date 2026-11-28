import { beforeEach, expect, it, vi } from 'vitest'
import {
  archiveSupplierSwitchEventFromAdminAction,
  bulkFinalizeReadySupplierSwitchesAction,
  updateSupplierSwitchStatusFromAdminAction,
  validateSupplierSwitchBeforeProcessingAction,
} from '@/app/admin/operations/actions'

const companyId = '11111111-1111-4111-8111-111111111111'
const otherCompanyId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const eventId = '55555555-5555-4555-8555-555555555555'
const customerId = '66666666-6666-4666-8666-666666666666'
const siteId = '77777777-7777-4777-8777-777777777777'
const updatedAt = '2026-10-01T12:00:00Z'

const io = vi.hoisted(() => ({
  audit: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  getSwitch: vi.fn(),
  validationWrite: vi.fn(),
  archive: vi.fn(),
  selectReady: vi.fn(),
  finalize: vi.fn(),
  isPlatform: false,
}))

vi.mock('next/cache', () => ({revalidatePath: () => {}}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async (permissions: string[]) => {
    expect(permissions).toEqual(['masterdata.write'])
    return {userId:actorId, companyId, isPlatformAdmin:io.isPlatform}
  },
  isPlatformAdminContext: (actor: {isPlatformAdmin:boolean}) => actor.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope', () => ({getOperationalCompanyScope: () => { throw Error('unexpected fallback scope') }}))
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: async () => ({
  rpc:io.rpc, auth:{getUser:async () => ({data:{user:{id:actorId}}})},
})}))
vi.mock('@/lib/supabase/service', async () => {
  const {createClient} = await import('@supabase/supabase-js')
  const supabaseService = createClient('http://127.0.0.1:65431','fixture-key',{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:async (request, init) => {
      expect(new URL(String(request)).pathname).toBe('/rest/v1/audit_logs')
      expect(init?.method).toBe('POST')
      io.audit.push(JSON.parse(String(init?.body)))
      return new Response(null,{status:201})
    }},
  })
  return {supabaseService}
})
vi.mock('@/lib/operations/db', () => ({
  getSupplierSwitchRequestById:io.getSwitch,
  archiveSupplierSwitchEvent:io.archive,
  updateSupplierSwitchValidationSnapshot:io.validationWrite,
  findCustomerSiteById:async () => ({id:siteId,status:'draft'}),
  listMeteringPointsForSite:async () => [],
  listPowersOfAttorneyByCustomerId:async () => [],
  createSupplierSwitchEvent:async () => {},
  syncCustomerOperationsForCustomer:async () => {},
  finalizeSupplierSwitchExecution:io.finalize,
}))
vi.mock('@/lib/operations/readiness', () => ({evaluateSiteSwitchReadiness:() => ({isReady:false,issues:[]})}))
vi.mock('@/lib/operations/supplierSwitchActivation', () => ({getSupplierSwitchActivationReadiness:() => ({ready:true})}))
vi.mock('@/lib/operations/readyBulkCandidates', () => ({readCompleteBulkReadySelection:io.selectReady}))
vi.mock('@/lib/operations/switchActivationAuthority', () => ({
  readSwitchActivationCompanyIds: async (_client:unknown, actor:string, companies:string[]) => {
    expect(actor).toBe(actorId)
    return new Set(companies)
  },
}))

function submitted(fields:Record<string,string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key,value)
  return data
}

function request(owner = companyId) {
  return {id:requestId, company_id:owner, customer_id:customerId, site_id:siteId, status:'draft', updated_at:updatedAt}
}

beforeEach(() => {
  vi.resetAllMocks()
  io.isPlatform = false
  io.audit.length = 0
})

const manualForm = () => submitted({request_id:requestId, status:'queued', expected_status:'draft', expected_updated_at:updatedAt})

it('attributes a manual status change to the company accepted by the ordinary exact native mutation', async () => {
  io.getSwitch.mockResolvedValue(request())
  io.rpc.mockResolvedValue({data:{request:{...request(),status:'queued'}},error:null})
  await updateSupplierSwitchStatusFromAdminAction(manualForm())
  expect(io.rpc).toHaveBeenCalledWith('gridex_update_manual_supplier_switch_status_v1',
    expect.objectContaining({p_company_id:companyId,p_request_id:requestId,p_status:'queued'}))
  expect(io.audit).toMatchObject([{
    actor_user_id:actorId, company_id:companyId, entity_id:requestId,
    action:'supplier_switch_request_status_updated_from_admin_operations',
  }])
})

it('does not write a manual status audit when the native mutation refuses', async () => {
  io.getSwitch.mockResolvedValue(request())
  io.rpc.mockResolvedValue({data:null,error:{code:'PT409',message:'manual_supplier_switch_status_stale'}})
  await expect(updateSupplierSwitchStatusFromAdminAction(manualForm())).rejects.toThrow('Ladda om')
  expect(io.audit).toEqual([])
})

it('attributes platform readiness validation to the saved request company', async () => {
  io.isPlatform = true
  io.getSwitch.mockResolvedValue(request(otherCompanyId))
  io.validationWrite.mockResolvedValue(request(otherCompanyId))
  await validateSupplierSwitchBeforeProcessingAction(submitted({request_id:requestId}))
  expect(io.validationWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({requestId}))
  expect(io.audit).toMatchObject([{
    actor_user_id:actorId, company_id:otherCompanyId, entity_id:requestId,
    action:'supplier_switch_request_validated_before_processing',
  }])
})

it.each([false,true])('attributes per-request waiting and the correct bulk scope, platform=%s', async platform => {
  io.isPlatform = platform
  const targetCompany = platform ? otherCompanyId : companyId
  const accepted = {...request(targetCompany),status:'accepted'}
  io.selectReady.mockResolvedValue({ready:[accepted],accepted:[accepted]})
  io.finalize.mockImplementation(async (_client:unknown, options:{authorizeTargetCompany:(company:string)=>Promise<void>}) => {
    await options.authorizeTargetCompany(targetCompany)
    throw {code:'P0001',message:'normal_supply_activation_not_due'}
  })
  await bulkFinalizeReadySupplierSwitchesAction()
  expect(io.selectReady).toHaveBeenCalledWith(expect.anything(), platform ? null : companyId)
  expect(io.audit).toMatchObject([
    {actor_user_id:actorId, company_id:targetCompany, entity_id:requestId, action:'supplier_switch_request_execution_waiting'},
    {actor_user_id:actorId, company_id:platform ? null : companyId, entity_id:actorId,
      action:'supplier_switch_ready_queue_bulk_execution_ran', metadata:{waitingCount:1,completedCount:0}},
  ])
})

it.each([otherCompanyId,null])('uses the returned event ownership on archive, including null=%s', async owner => {
  io.isPlatform = true
  io.archive.mockResolvedValue({id:eventId,company_id:owner,switch_request_id:owner ? requestId : null,archive_reason:'Review complete'})
  await archiveSupplierSwitchEventFromAdminAction(submitted({event_id:eventId,archive_reason:'Review complete'}))
  expect(io.archive).toHaveBeenCalledWith(expect.anything(),{eventId,actorUserId:actorId,reason:'Review complete'})
  expect(io.audit).toMatchObject([{
    actor_user_id:actorId, company_id:owner, entity_id:eventId,
    action:'supplier_switch_event_archived_from_admin_operations',
  }])
})
