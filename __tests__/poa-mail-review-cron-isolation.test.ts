// poa-mail-review: #9, #7
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { calls, stepFn } = vi.hoisted(() => {
  const calls = { ran: [] as string[], fail: new Set<string>() }
  const stepFn = (name: string, value: unknown = { ok: true }) => async () => {
    calls.ran.push(name)
    if (calls.fail.has(name)) throw new Error(`${name} exploded`)
    return value
  }
  return { calls, stepFn }
})

vi.mock('@/lib/ediel/flows/supplyMarketTransition', () => ({ advanceSupplyMarketDeadlines: stepFn('supplyMarketDeadlines') }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ advancePermissionMarketDeadlines: stepFn('permissionMarketDeadlines') }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: stepFn('customerOperations') }))
vi.mock('@/lib/customer-operations/automationConfig', () => ({
  validateAutomationUserConfig: async () => ({ ok: true, issue: null, message: null, userId: '55555555-5555-4555-8555-555555555555' }),
}))
vi.mock('@/lib/customer-operations/facilityLookupEdifactDispatch', () => ({ processReadyFacilityLookupEdifactDispatches: stepFn('facilityLookupDispatch') }))
vi.mock('@/lib/ediel/intent/resumeStuckIntents', () => ({ resumeStuckEdielIntents: stepFn('resumedIntents') }))
vi.mock('@/lib/ediel/operations/z01ResponseSlaWatchdog', () => ({ runZ01ResponseSlaWatchdog: stepFn('z01ResponseSla') }))
vi.mock('@/lib/operations/powerOfAttorneyExpiry', () => ({ expireOverduePowersOfAttorney: stepFn('poaExpiry') }))
vi.mock('@/lib/operations/supplierSwitchActivationSweep', () => ({ processReadySupplierSwitchActivations: stepFn('supplierSwitchActivations') }))
vi.mock('@/lib/website/customerApplicationReconciliation', () => ({ reconcileCustomerApplicationContinuationJobs: stepFn('customerApplicationReconciliation') }))
vi.mock('@/lib/customer-contracts/onlineSigning', () => ({ processPendingContractConfirmations: stepFn('contractConfirmations') }))
vi.mock('@/lib/website/legacyFacilityRequestReconciliation', () => ({ reconcileLegacyFacilityRequestLinks: stepFn('legacyFacilityRequestReconciliation') }))
vi.mock('@/lib/energy/pendingExactAddressResolution', () => ({ processPendingExactAddressResolutions: stepFn('exactAddressResolution') }))
vi.mock('@/lib/ediel/sla/checkAckDeadlines', () => ({ checkAckDeadlines: stepFn('inboundAckSla') }))
vi.mock('@/lib/ediel/operations/businessExpectationSweep', () => ({ sweepEdielBusinessExpectations: stepFn('businessExpectations') }))
vi.mock('@/lib/customer-operations/manualGridOwnerFollowUps', () => ({ runManualGridOwnerFollowUpWatchdog: stepFn('manualGridOwnerFollowUps') }))

import { POST } from '@/app/api/internal/customer-operations/cron/route'

const ALL = [
  'exactAddressResolution', 'legacyFacilityRequestReconciliation', 'customerApplicationReconciliation', 'contractConfirmations',
  'customerOperations', 'z01ResponseSla', 'inboundAckSla', 'permissionMarketDeadlines', 'supplyMarketDeadlines',
  'businessExpectations', 'facilityLookupDispatch', 'resumedIntents', 'poaExpiry', 'manualGridOwnerFollowUps', 'supplierSwitchActivations',
]

function call() {
  process.env.CUSTOMER_OPERATION_CRON_SECRET = 'cron-secret-for-tests'
  return POST(new NextRequest('https://ops.example/api/internal/customer-operations/cron', {
    method: 'POST', headers: { authorization: 'Bearer cron-secret-for-tests' },
  }))
}

beforeEach(() => {
  calls.ran = []
  calls.fail = new Set()
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
})
