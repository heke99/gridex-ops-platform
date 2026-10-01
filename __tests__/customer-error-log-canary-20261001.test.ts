import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { notFound, redirect } from 'next/navigation'
import { inspect } from 'node:util'

vi.mock('server-only', () => ({}))
const f = vi.hoisted(() => ({ error: {} as Record<string, unknown>, rpc: vi.fn(), status: vi.fn(), telemetry: vi.fn(),
  insertError: null as unknown, throwInsert: null as unknown, writes: [] as Array<{ table: string; payload: Record<string, unknown> }> }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'current-actor', companyId: 'company-a', isPlatformAdmin: false, permissions: ['billing_underlay.read'] }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'current-actor' } }, error: null }) } }) }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: 'company-a' }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from: (table: string) => {
    let inserted = false
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, in: () => query, or: () => query,
      insert: (payload: Record<string, unknown>) => { if (f.throwInsert) throw f.throwInsert; inserted = true; f.writes.push({ table, payload: structuredClone(payload) }); return query },
      maybeSingle: async () => ({ data: null, error: f.error }), single: async () => ({ data: null, error: f.error }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: inserted ? f.insertError : f.error }).then(resolve) }
    return query
  },
} }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext: () => null,
  requireIntegrationApiAccess: async () => ({ ok: true, context: { companyId: 'company-a' }, client: { id: 'client-a', company_id: 'company-a', scopes: ['website_switch_status.read'] } }),
  logIntegrationApiRequest: f.telemetry,
}))
vi.mock('@/lib/website/customerApplicationStatus', () => ({
  loadWebsiteCustomerApplicationStatus: f.status,
  WebsiteCustomerApplicationStatusError: class extends Error {},
}))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ getCapwayAccessToken: vi.fn(), resolveCapwayConnectionConfig: vi.fn() }))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, startedAt: Date.now(),
    client: { id: 'client-a', company_id: 'company-a' },
    identity: { customer_id: 'customer-a', customer_number: 'SYNTHETIC', external_customer_id: 'synthetic-external',
      provider: 'tenant_portal', match_strength: 'verified', email: null,
      customer: { id: 'customer-a', customer_type: 'private', status: 'active' } } }),
  logCustomerPortalSuccess: async () => undefined,
}))

import { GET as download } from '@/app/admin/billing/export-center/[id]/download/route'
import { GET as status } from '@/app/api/v1/website/customer-applications/[applicationId]/route'
import { GET as bundle } from '@/app/api/v1/customer/portal-bundle/route'
import { portalQueryErrorMetadata } from '@/lib/customer-portal/apiData'
import { supportApiError } from '@/lib/customer-cases/apiAdapter'
import { prepareProtectedSupportAttachmentRead } from '@/lib/customer-cases/attachmentProtectedRead'
import { executeSupportCommand } from '@/lib/customer-operations/supportCommand'
import { supportFormError } from '@/lib/customer-cases/formState'
import { CapwayApiError, CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { classifyInvoiceExportError } from '@/lib/integrations/billing/exportErrorClassification'
import { safeLogError } from '@/lib/logging/redaction'
import { toSafeCompanyProfileError, toSafeContractError, toSafeContractErrorPersisted } from '@/lib/errors/safeActionErrors'

const canaries = ['customer-canary@example.invalid', '+46 70 123 45 67', 'Customer Canary Fullname', 'Customer Canary Street 19', 'capway_api_key_canary_123456789', 'sb_secret_canary_123456789']
const raw = canaries.join(' | ')
let errorLog: ReturnType<typeof vi.spyOn>, warningLog: ReturnType<typeof vi.spyOn>
function absent(value: unknown) { const text = inspect(value, { depth: 10 }); for (const canary of canaries) expect(text).not.toContain(canary) }
beforeEach(() => {
  vi.clearAllMocks()
  f.writes = []
  f.insertError = null; f.throwInsert = null
  f.error = { code: '23505', message: `duplicate customer ${raw}`, details: `Key (contact) = (${raw}) already exists`, hint: `api_key=${canaries[4]}`, payload: { authorization: `Bearer ${canaries[4]}`, file: raw } }
  f.status.mockRejectedValue(f.error); f.rpc.mockResolvedValue({ data: null, error: f.error }); f.telemetry.mockResolvedValue(undefined)
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { errorLog.mockRestore(); warningLog.mockRestore(); vi.unstubAllGlobals() })

describe('actual customer/API/billing/provider error boundaries must not emit raw secret or unnecessary PII canaries', () => {
  it('actual guarded billing download keeps its generic500 and technical code while minimizing the actual database error log', async () => {
    const response = await download(new NextRequest('http://localhost/admin/billing/export-center/run-a/download'), { params: Promise.resolve({ id: 'run-a' }) })
    expect(response.status).toBe(500); expect(await response.text()).toBe('Kunde inte skapa exportfil.')
    expect(errorLog).toHaveBeenCalledOnce(); absent(errorLog.mock.calls)
    expect(inspect(errorLog.mock.calls)).toContain('23505')
  })
  it('actual website application status route retains its correlated unavailable response but logs no raw error body', async () => {
    const response = await status(new NextRequest('http://localhost/api/v1/website/customer-applications/application-safe'), { params: Promise.resolve({ applicationId: 'application-safe' }) })
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('application_status_unavailable'); expect(body.request_id).toBe(body.correlation_id)
    expect(errorLog).toHaveBeenCalledOnce(); absent(body); absent(errorLog.mock.calls)
    expect(inspect(errorLog.mock.calls)).toContain(body.request_id)
  })
  it('actual portal query diagnostic projection retains SQLSTATE but excludes raw message/details/hint customer data', () => {
    const metadata = portalQueryErrorMetadata(f.error)
    expect(metadata.code).toBe('23505'); absent(metadata)
  })
  it('actual portal bundle section failures consume safe diagnostics and preserve independently correlated unavailable sections', async () => {
    const response = await bundle(new NextRequest('http://localhost/api/v1/customer/portal-bundle'))
    expect(response.status).toBe(503)
    const body = await response.json()
    const warnings = body.data.bundle_status.warnings as Array<{ section: string; code: string; trace_id: string }>
    expect(body.data.bundle_status.complete).toBe(false)
    expect(warnings).toHaveLength(11)
    expect(errorLog).toHaveBeenCalledTimes(11)
    for (const warning of warnings) {
      expect(warning.code).toBe('section_unavailable')
      expect(warning.trace_id).toMatch(/^[a-f0-9-]{36}$/)
      expect(errorLog.mock.calls.some((call: unknown[]) => inspect(call).includes(warning.trace_id))).toBe(true)
    }
    expect(errorLog.mock.calls.every((call: unknown[]) => inspect(call).includes('23505'))).toBe(true)
    absent(body); absent(errorLog.mock.calls)
  })
  it('actual provider HTTP client and shared export classifier do not copy secret/PII response bodies into prospective attempt diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: raw, authorization: canaries[4], phone: canaries[1] }, { status: 422 })))
    const client = new CapwayApticClient({ companyId: 'company-a', provider: 'capway_aptic', environment: 'test',
      baseUrl: 'http://127.0.0.1:1', authMode: 'apikey', apiKey: 'synthetic-test-key', apiKeyHeader: 'X-API-Key', defaultService: 'invoice', defaultFinancingMode: 'invoice_service' })
    let actual: unknown
    try { await client.ping() } catch (error) { actual = error }
    const classification = classifyInvoiceExportError(actual)
    expect(classification).toMatchObject({ outcome: 'rejected', errorCode: 'provider_rejected_payload', httpStatus: 422, retryable: false })
    absent(classification)
  })
  it('shared exported error sanitizer must also exclude free-text provider keys, phones, names and addresses', () => {
    const error = Object.assign(new Error(`provider failed api_key=${raw}`), { code: 'PGRST205' })
    const safe = safeLogError(error)
    expect(safe.code).toBe('PGRST205'); absent(safe)
  })
  it.each(['23505', 'P0001', 'PGRST205', 'ECONNRESET'])('retains technical namespace code %s without copying any message/detail/hint', code => {
    expect(safeLogError({ ...f.error, code }).code).toBe(code)
    absent(safeLogError({ ...f.error, code }))
  })
  it.each([raw, 'customer_private_name', 'PGRST205 ' + raw])('rejects arbitrary code text rather than treating every code field as technical', code => {
    expect(safeLogError({ ...f.error, code })).toEqual({ code: null, message: 'technical_error' })
  })
  it.each(['Forbidden', 'Unauthorized'])('preserves exact existing %s guard diagnostics for safe error consumers', message => {
    expect(safeLogError(new Error(message))).toEqual({ code: null, message })
  })
  it.each([
    { error: () => new CapwayApiError({ message: raw, responseExcerpt: raw, kind: 'http', httpStatus: 409 }), code: 'provider_conflict', outcome: 'needs_review' },
    { error: () => new CapwayApiError({ message: raw, responseExcerpt: raw, kind: 'http', httpStatus: 401 }), code: 'provider_auth_failed', outcome: 'configuration_error' },
    { error: () => new CapwayApiError({ message: raw, responseExcerpt: raw, kind: 'http', httpStatus: 503 }), code: 'provider_server_error', outcome: 'failed_retryable' },
    { error: () => new CapwayApiError({ message: raw, responseExcerpt: raw, kind: 'network' }), code: 'provider_unreachable', outcome: 'failed_retryable' },
    { error: () => new Error(`Capway-kopplingen är inte färdigkonfigurerad ${raw}`), code: 'connection_not_configured', outcome: 'configuration_error' },
    { error: () => new Error(`Capway token kunde inte hämtas (503) ${raw}`), code: 'token_endpoint_error', outcome: 'failed_retryable' },
    { error: () => new Error(raw), code: 'export_unknown_error', outcome: 'failed' },
  ])('preserves $code classification without copying prospective provider diagnostics', ({ error, code, outcome }) => {
    const result = classifyInvoiceExportError(error())
    expect(result).toMatchObject({ errorCode: code, outcome, responseExcerpt: null })
    absent(result)
  })
  it('actual safe company profile error caller must also avoid copying free-text database details and hints into its log', () => {
    const message = toSafeCompanyProfileError(f.error, { action: 'synthetic-company-profile', companyId: 'company-a', userId: 'current-actor' })
    expect(message).toContain('Referens:')
    absent(message); absent(errorLog.mock.calls)
    expect(inspect(errorLog.mock.calls)).toContain('23505')
  })
  it('actual persisted contract error caller retains new technical audit reference without persisting free-text database details/hints', async () => {
    const companyId = '00000000-0000-4000-8000-000000000032', userId = '00000000-0000-4000-8000-000000000033'
    const message = await toSafeContractErrorPersisted(f.error, { action: 'save_contract_offer', companyId, userId })
    expect(message).toContain('Referens:')
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0].table).toBe('contract_lifecycle_operation_errors')
    expect(f.writes[0].payload).toMatchObject({ sqlstate: '23505', company_id: companyId, actor_user_id: userId, action: 'save_contract_offer' })
    expect(f.writes[0].payload.reference).toMatch(/^[A-F0-9]{12}$/)
    absent(f.writes); absent(errorLog.mock.calls); absent(message)
  })
  it('safe company diagnostic scope cannot copy malformed caller-supplied scope/action text', () => {
    toSafeCompanyProfileError(f.error, { action: raw, companyId: raw, userId: raw })
    absent(errorLog.mock.calls)
    expect(errorLog.mock.calls[0][1]).toMatchObject({ action: 'action_error', companyId: null, userId: null, code: '23505' })
  })
  it('new persisted diagnostics cannot copy malformed caller-supplied scope/action text', async () => {
    await toSafeContractErrorPersisted(f.error, { action: raw, companyId: raw, userId: raw })
    absent(f.writes); absent(errorLog.mock.calls)
    expect(f.writes[0].payload).toMatchObject({ action: 'action_error', company_id: null, actor_user_id: null, sqlstate: '23505' })
  })
  it('actual persisted contract diagnostics allow only current technical metadata shapes, including UUID references and fixed channel', async () => {
    const offerId = '00000000-0000-4000-8000-000000000031'
    await toSafeContractErrorPersisted(f.error, { action: 'save_contract_offer', companyId: 'company-a', userId: 'current-actor',
      metadata: { offerId, channel: 'website', allowed: false, assignmentId: raw, customer_note: raw, message: raw, nested: { stage: raw } } })
    expect(f.writes[0].payload).toMatchObject({ offer_id: offerId, metadata: { offerId, channel: 'website', allowed: false } })
    absent(f.writes); absent(errorLog.mock.calls)
  })
  it('actual unsuccessful diagnostic persistence keeps the safe original outcome and correlates only technical secondary failure fields', async () => {
    f.insertError = f.error
    const output = await toSafeContractErrorPersisted(f.error, { action: 'save_contract_offer' })
    expect(errorLog).toHaveBeenCalledTimes(2)
    expect(errorLog.mock.calls[1][0]).toBe('[safe-action-error-persistence-failed]')
    const primary = errorLog.mock.calls[0][1] as { reference: string }
    expect(errorLog.mock.calls[1][1]).toEqual({ reference: primary.reference, code: '23505', message: 'database_error' })
    absent(output); absent(f.writes); absent(errorLog.mock.calls)
  })
  it('installed framework control flow thrown while persisting diagnostics is rethrown unchanged', async () => {
    let actual: unknown
    try { redirect('/admin/contracts') } catch (error) { actual = error }
    f.throwInsert = actual
    await expect(toSafeContractErrorPersisted(f.error, { action: 'save_contract_offer' })).rejects.toBe(actual)
    expect(f.writes).toEqual([])
    expect(errorLog).toHaveBeenCalledOnce(); absent(errorLog.mock.calls)
  })
  it('company validation wording cannot make an arbitrary database error message safe to copy into a user outcome', () => {
    const message = toSafeCompanyProfileError({ ...f.error, message: `Bolagsnamn krävs ${raw}` }, { action: 'save_company_profile' })
    absent(message)
  })
  it('contract domain SQLSTATE cannot make an arbitrary raw domain message safe to copy into a user outcome', () => {
    const message = toSafeContractError({ ...f.error, code: 'P0001', message: `Ogiltig: ${raw}` }, { action: 'save_contract_offer' })
    absent(message)
  })
  it.each([
    { name: 'company', convert: (error: unknown) => toSafeCompanyProfileError(error, { action: 'save_company_profile' }) },
    { name: 'contract', convert: (error: unknown) => toSafeContractError(error, { action: 'save_contract_offer' }) },
    { name: 'persisted contract', convert: (error: unknown) => toSafeContractErrorPersisted(error, { action: 'save_contract_offer' }) },
  ])('actual $name converter rethrows the installed redirect/notFound control flow before any log or diagnostic write', async ({ convert }) => {
    for (const signal of [() => redirect('/admin/contracts'), () => notFound()]) {
      let actual: unknown
      try { signal() } catch (error) { actual = error }
      expect(actual).toBeInstanceOf(Error)
      let observed: unknown
      try { await convert(actual) } catch (error) { observed = error }
      expect(observed).toBe(actual)
    }
    expect(errorLog).not.toHaveBeenCalled(); expect(f.writes).toEqual([])
  })
  it('actual support API unknown-failure boundary already preserves generic error and trace without logging raw database data', async () => {
    const response = supportApiError({ request: new NextRequest('http://localhost/api/v1/customer/cases'),
      client: null as never, startedAt: Date.now(), error: f.error })
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('customer_portal_internal_error'); expect(body.request_id).toBeTruthy()
    absent(body); absent(errorLog.mock.calls)
  })
  it('actual protected file-read command keeps controlled forbidden outcome and emits no raw storage/database error', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { ...f.error, code: '42501' } })
    await expect(prepareProtectedSupportAttachmentRead({ companyId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002',
      actor: { kind: 'ops', userId: '00000000-0000-4000-8000-000000000003', sessionId: '00000000-0000-4000-8000-000000000004' } },
    '00000000-0000-4000-8000-000000000005')).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
    expect(errorLog).not.toHaveBeenCalled(); expect(warningLog).not.toHaveBeenCalled()
  })
  it('actual phone-support command plus form error consumer keeps the private caller body out of error output and console', async () => {
    let actual: unknown
    try { await executeSupportCommand({ companyId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002',
      actor: { kind: 'ops', userId: '00000000-0000-4000-8000-000000000003', sessionId: '00000000-0000-4000-8000-000000000004' },
      operation: 'create', interactionChannel: 'phone', expectedRevision: 0, idempotencyKey: 'phone-canary-123456', payload: { title: 'Synthetic phone error proof', body: raw } }) } catch (error) { actual = error }
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.rpc.mock.calls[0][1].p_command.channel).toBe('phone')
    const output = supportFormError(actual)
    expect(output.ok).toBe(false); absent(output)
    expect(errorLog).not.toHaveBeenCalled(); expect(warningLog).not.toHaveBeenCalled()
  })
})
