// poa-mail-review: #9, #7
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { calls, stepFn } = vi.hoisted(() => {
  const calls = { parentArgs: [] as unknown[], ran: [] as string[], fail: new Set<string>(), undeployed: new Set<string>(), configOk: true }
  const stepFn = (name: string, value: unknown = { ok: true }) => async () => {
    calls.ran.push(name)
    if (calls.fail.has(name)) throw new Error(`${name} exploded`)
    if (calls.undeployed.has(name)) throw Object.assign(new Error('function does not exist'), { code: 'PGRST202' })
    return value
  }
  return { calls, stepFn }
})

vi.mock('@/lib/ediel/flows/supplyMarketTransition', () => ({ advanceSupplyMarketDeadlines: stepFn('supplyMarketDeadlines') }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ advancePermissionMarketDeadlines: stepFn('permissionMarketDeadlines') }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: stepFn('customerOperations') }))
vi.mock('@/lib/customer-operations/automationConfig', () => ({
  validateAutomationUserConfig: async () => calls.configOk ? ({ ok: true, issue: null, message: null, userId: '55555555-5555-4555-8555-555555555555' }) : ({ok:false,issue:'missing_automation_user',message:null,userId:null}),
}))
vi.mock('@/lib/customer-operations/facilityLookupEdifactDispatch', () => ({ processReadyFacilityLookupEdifactDispatches: stepFn('facilityLookupDispatch') }))
vi.mock('@/lib/ediel/intent/resumeStuckIntents', () => ({ resumeStuckEdielIntents: stepFn('resumedIntents') }))
vi.mock('@/lib/ediel/operations/z01ResponseSlaWatchdog', () => ({ runZ01ResponseSlaWatchdog: stepFn('z01ResponseSla') }))
vi.mock('@/lib/ediel/operations/ackSlaMonitor', () => ({ runEdielAckSlaMonitor: stepFn('outboundAckSla') }))
vi.mock('@/lib/operations/powerOfAttorneyExpiry', () => ({ expireOverduePowersOfAttorney: stepFn('poaExpiry') }))
vi.mock('@/lib/operations/supplierSwitchActivationSweep', () => ({ processReadySupplierSwitchActivations: stepFn('supplierSwitchActivations') }))
vi.mock('@/lib/website/customerApplicationReconciliation', () => ({ reconcileCustomerApplicationContinuationJobs: stepFn('customerApplicationReconciliation') }))
vi.mock('@/lib/customer-contracts/onlineSigning', () => ({ processPendingContractConfirmations: stepFn('contractConfirmations') }))
vi.mock('@/lib/website/legacyFacilityRequestReconciliation', () => ({ reconcileLegacyFacilityRequestLinks: stepFn('legacyFacilityRequestReconciliation') }))
vi.mock('@/lib/energy/pendingExactAddressResolution', () => ({ processPendingExactAddressResolutions: stepFn('exactAddressResolution') }))
vi.mock('@/lib/ediel/sla/checkAckDeadlines', () => ({ checkAckDeadlines: stepFn('inboundAckSla') }))
vi.mock('@/lib/ediel/sla/inboundReviewAperakBudget', () => ({ runInboundReviewAperakEscalation: stepFn('inboundReviewAperak') }))
vi.mock('@/lib/ediel/operations/businessExpectationSweep', () => ({ sweepEdielBusinessExpectations: stepFn('businessExpectations') }))
vi.mock('@/lib/customer-operations/manualGridOwnerFollowUps', () => ({ runManualGridOwnerFollowUpWatchdog: stepFn('manualGridOwnerFollowUps') }))

vi.mock('@/lib/ediel/retention/decisionEvidenceRetention', () => ({advanceCompletedWitnessDisposition: stepFn('completedWitnessDisposition', {scanned:1,disposed:0,expired:0,held:1,clearedApprovals:0,authority:'none'}),advanceCompletedParent:async(input:{actorUserId:string;limit:number})=>{calls.parentArgs.push(input);return stepFn('completedParentDisposition',{scanned:2,disposed:0,held:1,clearedApprovals:1})()}}))

import { POST } from '@/app/api/internal/customer-operations/cron/route'

const ALL = [
  'exactAddressResolution', 'legacyFacilityRequestReconciliation', 'customerApplicationReconciliation', 'contractConfirmations',
  'customerOperations', 'z01ResponseSla', 'outboundAckSla', 'inboundAckSla', 'inboundReviewAperak', 'permissionMarketDeadlines', 'supplyMarketDeadlines',
  'businessExpectations', 'facilityLookupDispatch', 'resumedIntents', 'poaExpiry', 'manualGridOwnerFollowUps', 'supplierSwitchActivations', 'completedWitnessDisposition', 'completedParentDisposition',
]

function call() {
  process.env.CUSTOMER_OPERATION_CRON_SECRET = 'cron-secret-for-tests'
  return POST(new NextRequest('https://ops.example/api/internal/customer-operations/cron', {
    method: 'POST', headers: { authorization: 'Bearer cron-secret-for-tests' },
  }))
}

beforeEach(() => {
  calls.parentArgs = []
  calls.configOk = true
  calls.ran = []
  calls.fail = new Set()
  calls.undeployed = new Set()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('#9 cron steps are isolated', () => {
  it('runs every step including the follow-up watchdog when all succeed', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(calls.ran).toEqual(ALL)
  })

  it('a throwing early step does not skip POA expiry, Z01 SLA or switch activation', async () => {
    calls.fail.add('customerOperations')
    calls.fail.add('exactAddressResolution')
    const response = await call()
    expect(calls.ran).toEqual(ALL)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.failed_steps.map((s: { step: string }) => s.step)).toEqual(['exactAddressResolution', 'customerOperations'])
    expect(body.result.poaExpiry).toEqual({ ok: true })
    expect(body.result.customerOperations).toMatchObject({ failed: true, code: 'customer_operation_step_failed' })
    expect(JSON.stringify(body)).not.toContain('exploded')
  })

  it('a step whose schema is not deployed is skipped, not a failure', async () => {
    calls.undeployed.add('businessExpectations')
    const response = await call()
    expect(calls.ran).toEqual(ALL)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.businessExpectations).toEqual({ skippedReason: 'schema_not_deployed' })
  })
})

it('does not invoke completed witness worker without validated automation actor',async()=>{
 calls.configOk=false;const response=await call();expect(response.status).toBe(200);expect(calls.ran).not.toContain('completedWitnessDisposition');expect((await response.json()).result.completedWitnessDisposition).toMatchObject({configurationBlocked:true,disposed:0})
})
it('isolates a failed physical-disposition worker from all existing cron steps and returns sanitized failure',async()=>{
 calls.fail.add('completedWitnessDisposition');const response=await call();expect(calls.ran).toEqual(ALL);expect(response.status).toBe(500);const body=await response.json();expect(body.failed_steps.map((x:{step:string})=>x.step)).toEqual(['completedWitnessDisposition']);expect(JSON.stringify(body)).not.toContain('exploded')
})
it('unauthorized cron does not validate an actor or run any retention or other job',async()=>{
 process.env.CUSTOMER_OPERATION_CRON_SECRET='expected';delete process.env.CRON_SECRET
 const response=await POST(new NextRequest('https://ops.example/api/internal/customer-operations/cron',{method:'POST',headers:{authorization:'Bearer wrong'}}));expect(response.status).toBe(401);expect(calls.ran).toEqual([])
})

// Parent GC/physical execution is a separate source adapter, not a scheduled run.
it('returns distinct parent GC counts without inventing expiry, replay or policy cleanup',async()=>{const response=await call();expect((await response.json()).result.completedParentDisposition).toEqual({scanned:2,disposed:0,held:1,clearedApprovals:1})})
it('missing configured actor blocks parent worker as well as witness worker',async()=>{calls.configOk=false;const response=await call();expect(calls.ran).not.toContain('completedParentDisposition');expect((await response.json()).result.completedParentDisposition).toEqual({scanned:0,disposed:0,held:0,clearedApprovals:0,configurationBlocked:true})})
it('a parent-worker refusal is isolated from every old job and witness worker',async()=>{calls.fail.add('completedParentDisposition');const response=await call();expect(calls.ran).toEqual(ALL);expect(response.status).toBe(500);const body=await response.json();expect(body.failed_steps.map((s:{step:string})=>s.step)).toEqual(['completedParentDisposition']);expect(body.result.completedWitnessDisposition).toMatchObject({scanned:1,disposed:0});expect(JSON.stringify(body)).not.toContain('exploded')})
it('a missing parent schema is skipped without skipping any old worker',async()=>{calls.undeployed.add('completedParentDisposition');const response=await call();expect(response.status).toBe(200);expect(calls.ran).toEqual(ALL);expect((await response.json()).result.completedParentDisposition).toEqual({skippedReason:'schema_not_deployed'})})

it('actual cron passes only its validated actor and bounded request limit to the separate parent worker',async()=>{process.env.CUSTOMER_OPERATION_CRON_SECRET='cron-secret-for-tests';const response=await POST(new NextRequest('https://ops.example/api/internal/customer-operations/cron?limit=7',{method:'POST',headers:{authorization:'Bearer cron-secret-for-tests'}}));expect(response.status).toBe(200);expect(calls.parentArgs).toEqual([{actorUserId:'55555555-5555-4555-8555-555555555555',limit:7}])})
