import { beforeEach, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), or: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: read.from } }))
vi.mock('@/lib/ediel/core/kernel', () => ({}))
vi.mock('@/lib/cis/db', () => ({}))
vi.mock('@/lib/ediel/db', () => ({}))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({}))
vi.mock('@/lib/ediel/prodat/customerMasterdataDraft', () => ({}))

import { resolveOutboundRuntimeEnvironment } from '@/lib/ediel/flows/shared'

const companyId = '1f4b6e02-2b9a-7f02-a01b-cc478a12d4e3'
const otherCompanyId = '6abaedb1-0d5a-4fa0-b536-cdcae89a02c8'
const preferredRouteId = 'route'
type Route = {
  id: string; company_id: string | null; is_active: boolean; environment_type: string | null
  target_system: string | null; target_email: string | null
}

function fromRows(rows: (Omit<Route, 'company_id'> & Partial<Pick<Route, 'company_id'>>)[]) {
  read.maybeSingle.mockImplementation(async () => {
    const matches = rows.map(row => ({ company_id: companyId, ...row })).filter(row =>
      read.eq.mock.calls.every(([field, value]) => row[field as keyof Route] === value) &&
      read.or.mock.calls.every(([filter]) => filter === `company_id.is.null,company_id.eq."${companyId}"` &&
        (row.company_id === null || row.company_id === companyId)),
    )
    return { data: matches[0] ?? null, error: null }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  const query = { select: read.select, eq: read.eq, or: read.or, maybeSingle: read.maybeSingle }
  read.from.mockReturnValue(query)
  read.select.mockReturnValue(query)
  read.eq.mockReturnValue(query)
  read.or.mockReturnValue(query)
  fromRows([])
})

it.each(['test', 'production'] as const)('honors explicit %s without a route lookup', async explicitEnvironment => {
  await expect(resolveOutboundRuntimeEnvironment({ companyId, explicitEnvironment, preferredRouteId })).resolves.toBe(explicitEnvironment)
  expect(read.from).not.toHaveBeenCalled()
})

it('retains refusal when neither a route nor explicit environment is supplied', async () => {
  await expect(resolveOutboundRuntimeEnvironment({ companyId })).rejects.toThrow('environment_not_resolved')
  expect(read.from).not.toHaveBeenCalled()
})

it.each([false, null])('refuses an unavailable preferred route (%s)', async active => {
  if (active !== null) fromRows([{ id: preferredRouteId, is_active: active, environment_type: null, target_system: 'TEST', target_email: null }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).rejects.toThrow('environment_not_resolved')
  expect(read.from).toHaveBeenCalledExactlyOnceWith('communication_routes')
  expect(read.eq).toHaveBeenCalledWith('id', preferredRouteId)
  expect(read.maybeSingle).toHaveBeenCalledOnce()
})

it.each([
  ['TGT', null, 'test'],
  ['Partner TEST', null, 'test'],
  [null, 'fixture@ediel.se', 'test'],
  ['direct', 'fixture@example.invalid', 'production'],
] as const)('retains the environment for an active route with target %s and email %s', async (target_system, target_email, expected) => {
  fromRows([{ id: preferredRouteId, is_active: true, environment_type: null, target_system, target_email }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).resolves.toBe(expected)
})

it.each(['tgt_test', 'agt_test', 'bilateral_test'] as const)('uses a declared %s route without legacy TEST markers', async environment_type => {
  fromRows([{ id: preferredRouteId, is_active: true, environment_type, target_system: 'direct', target_email: 'fixture@example.invalid' }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).resolves.toBe('test')
})

it('uses declared production for an unambiguous production route', async () => {
  fromRows([{ id: preferredRouteId, is_active: true, environment_type: 'production', target_system: 'direct', target_email: 'fixture@example.invalid' }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).resolves.toBe('production')
})

it.each([
  ['TGT', null],
  ['Partner TEST', null],
  [null, 'fixture@ediel.se'],
] as const)('refuses declared production with conflicting target %s and email %s', async (target_system, target_email) => {
  fromRows([{ id: preferredRouteId, is_active: true, environment_type: 'production', target_system, target_email }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).rejects.toThrow('environment_not_resolved')
})

it('propagates a route read error', async () => {
  const error = new Error('route read failed')
  read.maybeSingle.mockResolvedValue({ data: null, error })
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).rejects.toBe(error)
})

it.each([companyId, null])('allows an active route with company ownership %s', async company_id => {
  fromRows([{
    id: preferredRouteId, company_id, is_active: true, environment_type: 'bilateral_test',
    target_system: 'direct', target_email: null,
  }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).resolves.toBe('test')
  expect(read.or).toHaveBeenCalledExactlyOnceWith(`company_id.is.null,company_id.eq."${companyId}"`)
})

it('gives the generic unavailable result for a route outside the company scope', async () => {
  fromRows([{
    id: preferredRouteId, company_id: otherCompanyId, is_active: true, environment_type: 'bilateral_test',
    target_system: 'direct', target_email: null,
  }])
  await expect(resolveOutboundRuntimeEnvironment({ companyId, preferredRouteId })).rejects.toThrow(
    'environment_not_resolved: vald Ediel-route saknas eller är inte aktiv.',
  )
})

it('refuses inference without a valid company UUID before reading routes', async () => {
  await expect(resolveOutboundRuntimeEnvironment({ companyId: 'invalid-company', preferredRouteId })).rejects.toThrow(
    'environment_not_resolved',
  )
  expect(read.from).not.toHaveBeenCalled()
})
