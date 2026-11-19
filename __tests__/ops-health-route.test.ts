import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))

import { GET, POST } from '@/app/api/internal/system/health/route'

const sharedCheckKeys = [
  'queue:customer_operation_active_idempotency_duplicate',
  'queue:customer_operation_stale',
  'queue:email_delivery_uncertain',
  'queue:webhook_stale_processing',
  'queue:ediel_delivery_uncertain',
  'address_conflict:duplicate_open',
  'customer_site:unresolved_grid_context',
  'route:receiver_or_mailbox_missing',
  'route:required_receiver_subaddress_missing',
  'route:receiver_certificate_invalid_or_missing',
  'spot_current_day_missing',
  'spot_previous_day_missing',
  'spot_reference_window_incomplete',
  'spot_preview_stale',
  'spot_policy_fallback_conflict',
  'spot_cron_slower_than_freshness_policy',
]
const v3CheckKeys = [
  'masterdata:grid_area_ops_owner_mapping_missing',
  'masterdata:grid_owner_prodat_readiness_missing',
]
const v4CheckKeys = [
  ...v3CheckKeys,
  'route:candidate_receiver_or_mailbox_missing',
  'route:candidate_receiver_certificate_invalid_or_missing',
]
const v5CheckKeys = [
  'masterdata:grid_owner_prodat_action_required',
  'masterdata:grid_owner_prodat_out_of_scope_inventory',
  'masterdata:grid_area_ops_owner_mapping_review',
  'route:dynamic_receiver_candidate_templates',
  'route:dynamic_receiver_candidate_template_invalid',
  'route:static_candidate_receiver_or_mailbox_missing',
  'route:non_live_certificate_candidate_inventory',
  'route:static_candidate_receiver_certificate_invalid_or_missing',
]

function healthyRows(version: 'v3' | 'v4' | 'v5') {
  const versionKeys = version === 'v5' ? v5CheckKeys : version === 'v4' ? v4CheckKeys : v3CheckKeys
  return [...sharedCheckKeys, ...versionKeys].map(check_key => ({
    check_key,
    status: 'ok',
    issue_count: 0,
    details: {},
  }))
}

function request(method = 'GET') {
  return new NextRequest('https://ops.example.test/api/internal/system/health', {
    method,
    headers: { authorization: 'Bearer synthetic-health-credential' },
  })
}

function missingFunction(version: 'v3' | 'v4' | 'v5') {
  return {
    data: null,
    error: {
      code: 'PGRST202',
      message: `Could not find the function public.gridex_ops_health_checks_${version} without parameters in the schema cache`,
    },
  }
}

beforeEach(() => {
  vi.stubEnv('OPS_HEALTH_CRON_SECRET', 'synthetic-health-credential')
  vi.stubEnv('CRON_SECRET', undefined)
  rpc.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('OPS health runtime result', () => {
  it.each([
    ['ok', 'v5', 200],
    ['warning', 'v5', 200],
    ['blocking', 'v5', 503],
    ['warning', 'v4', 503],
  ] as const)('records the authenticated %s %s result, HTTP %i, without check details', async (status, version, httpStatus) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const rows = healthyRows(version)
    if (version === 'v4') rpc.mockResolvedValueOnce(missingFunction('v5'))
    if (version === 'v5') rows[0].status = status
    rows[0].details = { reference: 'synthetic-tenant-private-detail' }
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const response = await GET(request())
    const result = await response.json()

    expect(response.status).toBe(httpStatus)
    expect(info).toHaveBeenCalledOnce()
    const [line] = info.mock.calls[0]
    expect(JSON.parse(line)).toEqual({
      event: 'ops_health_result',
      checked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      method: 'GET',
      http_status: httpStatus,
      ok: result.ok,
      status,
      schema_ready: result.schema_ready,
      check_version: version,
      fallback: version === 'v4',
      blocking_count: result.blocking_count,
      warning_count: result.warning_count,
    })
    expect(line).not.toContain('synthetic-tenant-private-detail')
    expect(line).not.toContain('synthetic-health-credential')
  })

  it('emits no evaluation result for an unauthorized request', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await GET(new NextRequest('https://ops.example.test/api/internal/system/health'))
    expect(response.status).toBe(401)
    expect(info).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('OPS health HTTP contract', () => {
  it('returns validated current RPC data for the authenticated cron GET', async () => {
    const rows = healthyRows('v5')
    rpc.mockResolvedValueOnce({ data: rows, error: null })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true, status: 'ok', schema_ready: true, check_version: 'v5', fallback: false,
      blocking_count: 0, warning_count: 0, checks: rows,
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_ops_health_checks_v5')
  })

  it.each([['warning', 200, true], ['blocking', 503, false]] as const)(
    'retains HTTP and count semantics for a valid current %s',
    async (status, expectedStatus, ok) => {
      const rows = healthyRows('v5')
      const key = status === 'warning' ? 'queue:customer_operation_stale' : 'queue:customer_operation_active_idempotency_duplicate'
      const row = rows.find(check => check.check_key === key)!
      Object.assign(row, { status, issue_count: 2 })
      rpc.mockResolvedValueOnce({ data: rows, error: null })
      const response = await POST(request('POST'))
      expect(response.status).toBe(expectedStatus)
      expect(await response.json()).toMatchObject({
        ok, status, schema_ready: true, check_version: 'v5', fallback: false,
        blocking_count: status === 'blocking' ? 1 : 0,
        warning_count: status === 'warning' ? 1 : 0,
      })
    },
  )

  it.each([
    ['missing payload', null],
    ['non-array payload', {}],
    ['empty checks', []],
    ['missing current check', healthyRows('v5').slice(0, -1)],
    ['missing shared check', healthyRows('v5').slice(1)],
    ['missing live receiver certificate check', healthyRows('v5').filter(row => row.check_key !== 'route:receiver_certificate_invalid_or_missing')],
    ['missing address conflict check', healthyRows('v5').filter(row => row.check_key !== 'address_conflict:duplicate_open')],
    ['missing unresolved site check', healthyRows('v5').filter(row => row.check_key !== 'customer_site:unresolved_grid_context')],
    ['bad status', [{ ...healthyRows('v5')[0], status: 'unrecognized-private-value' }, ...healthyRows('v5').slice(1)]],
    ['bad issue count', [{ ...healthyRows('v5')[0], issue_count: '0' }, ...healthyRows('v5').slice(1)]],
    ['bad row shape', [null, ...healthyRows('v5')]],
  ])('returns HTTP 503 for %s without downgrading to an older check', async (_name, data) => {
    rpc.mockResolvedValueOnce({ data, error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result).toMatchObject({ ok: false, status: 'blocking', schema_ready: false, check_version: 'v5', fallback: false })
    expect(result.checks).toContainEqual(expect.objectContaining({ check_key: 'ops_health_invalid_result', status: 'blocking' }))
    expect(JSON.stringify(result)).not.toContain('unrecognized-private-value')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_ops_health_checks_v5')
  })

  it('keeps native schema blockers visible when missing relations prevent complete coverage', async () => {
    const check = { check_key: 'schema:ediel_route_runtime_v', status: 'blocking', issue_count: 1 }
    rpc.mockResolvedValueOnce({ data: [check], error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect((await response.json()).checks).toContainEqual(expect.objectContaining(check))
  })

  it('reports v4 diagnostics as degraded when the current function is absent', async () => {
    const data = healthyRows('v4')
    rpc.mockResolvedValueOnce(missingFunction('v5')).mockResolvedValueOnce({ data, error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      ok: false, status: 'warning', schema_ready: true, check_version: 'v4', fallback: true, checks: data,
    })
    expect(rpc.mock.calls).toEqual([['gridex_ops_health_checks_v5'], ['gridex_ops_health_checks_v4']])
  })

  it('reports v3 diagnostics after the exact missing functions in both data layers', async () => {
    rpc.mockResolvedValueOnce(missingFunction('v5'))
      .mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function public.gridex_ops_health_checks_v4() does not exist' } })
      .mockResolvedValueOnce({ data: healthyRows('v3'), error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ schema_ready: true, check_version: 'v3', fallback: true })
    expect(rpc.mock.calls).toEqual([['gridex_ops_health_checks_v5'], ['gridex_ops_health_checks_v4'], ['gridex_ops_health_checks_v3']])
  })

  it.each(['v3', 'v4'] as const)('marks incomplete legacy %s diagnostics when the grid-owner mapping check is absent', async version => {
    rpc.mockResolvedValueOnce(missingFunction('v5'))
    if (version === 'v3') rpc.mockResolvedValueOnce(missingFunction('v4'))
    const data = healthyRows(version).filter(row => row.check_key !== 'masterdata:grid_area_ops_owner_mapping_missing')
    rpc.mockResolvedValueOnce({ data, error: null })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, status: 'blocking', schema_ready: false, check_version: version, fallback: true })
  })

  it('returns no selected version when all supported functions are absent', async () => {
    rpc.mockResolvedValueOnce(missingFunction('v5')).mockResolvedValueOnce(missingFunction('v4')).mockResolvedValueOnce(missingFunction('v3'))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, status: 'blocking', schema_ready: false, check_version: null, fallback: false })
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it.each([
    { code: '42703', message: 'column internal_health_detail does not exist' },
    { code: '42883', message: 'function public.internal_dependency() does not exist' },
    { code: 'PGRST202', message: 'Could not find the function public.other_function without parameters in the schema cache' },
  ])('reports the installed check failure for $code without falling back or reflecting backend details', async error => {
    rpc.mockResolvedValue({ data: null, error })
    const response = await GET(request())
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result).toMatchObject({ ok: false, status: 'blocking', schema_ready: false, check_version: 'v5', fallback: false })
    expect(JSON.stringify(result)).not.toContain(error.message)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_ops_health_checks_v5')
  })

  it('returns HTTP 401 without accessing the checks when cron authentication is absent', async () => {
    const response = await GET(new NextRequest('https://ops.example.test/api/internal/system/health'))
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})
