import { createHash } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), guard: vi.fn(), scope: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: io.session }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: io.guard }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.scope }))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))

const companyId = '10000000-0000-4000-8000-000000000001', customerId = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001', userId = '40000000-0000-4000-8000-000000000001'
const sessionId = '50000000-0000-4000-8000-000000000001', nonce = '60000000-0000-4000-8000-000000000001'
const actor = { kind: 'ops' as const, userId, sessionId }
const issuer = 'https://isolated-support-identity.example.test', subject = 'stable-isolated-caller'
const request = { companyId, customerId, caseId, expectedCaseRevision: 1, expectedContactRevision: 0,
  idempotencyKey: 'sensitive-support-contact-0001', reason: 'Verified phone contact correction', changes: { phone: '+4600999' } }
let privateKey: CryptoKey, configuration: string
afterEach(() => vi.unstubAllEnvs())

beforeEach(async () => {
  io.rpc.mockReset().mockResolvedValue({ data: { companyId, customerId, caseId, caseRevision: 2, contactRevision: 1, changed: true, replayed: false }, error: null })
  io.session.mockReset().mockResolvedValue(actor)
  io.guard.mockReset().mockResolvedValue({ userId, companyId })
  io.scope.mockReset().mockResolvedValue({ companyId })
  io.revalidate.mockReset()
  const keys = await generateKeyPair('RS256', { extractable: true })
  privateKey = keys.privateKey as CryptoKey
  configuration = JSON.stringify({ [companyId]: { issuer, audience: 'gridex-support-sensitive-contact',
    actions: ['customer.support.contact.change.v1'], bindings: { [issuer]: { [subject]: customerId } },
    jwks: { keys: [{ ...await exportJWK(keys.publicKey), alg: 'RS256', use: 'sig', kid: 'isolated-support-key' }] } } })
  vi.stubEnv('GRIDEX_SUPPORT_SENSITIVE_PROOF_TRUST', configuration)
})

async function token(overrides: Record<string, unknown> = {}, options: { nonce?: string; issuedAt?: number; expiresAt?: number; typ?: string; issuer?: string; audience?: string } = {}) {
  const { supportContactRequestBinding } = await import('@/lib/customer-portal/supportSensitiveProof')
  const binding = supportContactRequestBinding(request, actor)
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ purpose: 'gridex_support_sensitive_contact_v1', channel: 'phone', company_id: companyId, customer_id: customerId,
    case_id: caseId, actor_user_id: userId, session_id: sessionId, action: 'customer.support.contact.change.v1',
    request_sha256: createHash('sha256').update(binding).digest('hex'), ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'isolated-support-key', typ: options.typ ?? 'gridex-support-sensitive+jwt' })
    .setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? 'gridex-support-sensitive-contact').setSubject(subject).setJti(options.nonce ?? nonce)
    .setIssuedAt(options.issuedAt ?? now).setExpirationTime(options.expiresAt ?? now + 120).sign(privateKey)
}

it('derives real current staff/session and sends only server-verified proof hashes to one atomic RPC', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  const proofToken = await token()
  await expect(changeContactAfterSupportVerification({ ...request, proofToken }, userId)).resolves.toMatchObject({ contactRevision: 1 })
  expect(io.session).toHaveBeenCalledWith('ops', userId)
  expect(io.rpc).toHaveBeenCalledWith('gridex_support_sensitive_contact_v1', {
    p_command: expect.objectContaining({ actorUserId: userId, sessionId, caseId, changes: request.changes }),
    p_proof: expect.objectContaining({ action: 'customer.support.contact.change.v1', nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
  })
  expect(JSON.stringify(io.rpc.mock.calls)).not.toContain(proofToken)
  expect(JSON.stringify(io.rpc.mock.calls)).not.toContain(subject)
})

it.each([
  { name: 'expired proof', options: { issuedAt: Math.floor(Date.now()/1000)-100, expiresAt: Math.floor(Date.now()/1000)-1 } },
  { name: 'excess lifetime', options: { expiresAt: Math.floor(Date.now()/1000)+600 } },
  { name: 'future issuance', options: { issuedAt: Math.floor(Date.now()/1000)+30 } },
  { name: 'noncanonical nonce', options: { nonce: 'client-selected-label' } },
  { name: 'ordinary token header', options: { typ: 'JWT' } },
  { name: 'wrong issuer', options: { issuer: 'https://untrusted.example.test' } },
  { name: 'wrong audience', options: { audience: 'ordinary-api' } },
])('rejects $name cryptographically before any command', async ({ options }) => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  await expect(changeContactAfterSupportVerification({ ...request, proofToken: await token({},options) }))
    .rejects.toMatchObject({ code: 'support_sensitive_proof_invalid', status: 403 })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('binds the saved contact/case revision and complete changes rather than a generic permission', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  const proofToken = await token()
  for (const changes of [{ expectedCaseRevision: 2 }, { expectedContactRevision: 1 }, { changes: { phone: '+4600001' } }, { idempotencyKey: 'changed-key-0001' }]) {
    await expect(changeContactAfterSupportVerification({ ...request, ...changes, proofToken })).rejects.toMatchObject({ code: 'support_sensitive_proof_invalid' })
  }
  expect(io.rpc).not.toHaveBeenCalled()
})

it.each([
  { name: 'wrong purpose', claims: { purpose: 'ordinary_customer_delegation' } },
  { name: 'wrong action', claims: { action: 'customer.billing.change' } },
  { name: 'wrong customer', claims: { customer_id: caseId } },
  { name: 'wrong case', claims: { case_id: customerId } },
  { name: 'wrong staff', claims: { actor_user_id: customerId } },
  { name: 'wrong session', claims: { session_id: customerId } },
  { name: 'wrong payload', claims: { request_sha256: '0'.repeat(64) } },
  { name: 'wrong channel', claims: { channel: 'api' } },
])('rejects $name before RPC', async ({ claims }) => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  await expect(changeContactAfterSupportVerification({ ...request, proofToken: await token(claims) }))
    .rejects.toMatchObject({ code: 'support_sensitive_proof_invalid', status: 403 })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('the internal action denies a switched company and duplicate proof parts before mutation', async () => {
  const { changeSupportContactWithVerificationAction } = await import('@/app/admin/customer-cases/sensitive-contact-action')
  const form = new FormData()
  for (const [key,value] of Object.entries({ customer_id: customerId, case_id: caseId, expected_case_revision: '1', expected_contact_revision: '0',
    idempotency_key: request.idempotencyKey, reason: request.reason, phone: request.changes.phone, proof_token: await token() })) form.append(key,value)
  io.scope.mockResolvedValue({ companyId: customerId })
  expect(await changeSupportContactWithVerificationAction(form)).toMatchObject({ ok: false, code: 'support_actor_forbidden' })
  expect(io.session).not.toHaveBeenCalled()
  form.append('proof_token',String(form.get('proof_token')))
  expect(await changeSupportContactWithVerificationAction(form)).toMatchObject({ ok: false, code: 'invalid_support_sensitive_command' })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('rechecks current trusted issuer binding and denies an unenrolled issuer without fallback', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  const proofToken = await token()
  for (const config of ['', JSON.stringify({ ...JSON.parse(configuration), [companyId]: { ...JSON.parse(configuration)[companyId], bindings: {} } })]) {
    vi.stubEnv('GRIDEX_SUPPORT_SENSITIVE_PROOF_TRUST', config)
    await expect(changeContactAfterSupportVerification({ ...request, proofToken })).rejects.toMatchObject({ code: 'support_sensitive_proof_invalid' })
  }
  expect(io.rpc).not.toHaveBeenCalled()
})

it('rejects a forged actor, verified flag or sensitive billing/login field in the command', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  const proofToken = await token()
  for (const candidate of [{ ...request, actor, proofToken }, { ...request, verified: true, proofToken },
    { ...request, changes: { invoice_email: 'new@example.invalid' }, proofToken }, { ...request, changes: { login_email: 'new@example.invalid' }, proofToken }]) {
    await expect(changeContactAfterSupportVerification(candidate as Parameters<typeof changeContactAfterSupportVerification>[0]))
      .rejects.toMatchObject({ code: 'invalid_support_sensitive_command', status: 422 })
  }
  expect(io.rpc).not.toHaveBeenCalled()
})

it('does not report confirmation on spent proof, schema absence or mismatched persisted resource', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  const input = { ...request, proofToken: await token() }
  io.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'support_sensitive_proof_replayed' } })
  await expect(changeContactAfterSupportVerification(input)).rejects.toMatchObject({ code: 'support_sensitive_proof_replayed', status: 403 })
  io.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'schema cache' } })
  await expect(changeContactAfterSupportVerification(input)).rejects.toMatchObject({ code: 'support_schema_unavailable', status: 503 })
  io.rpc.mockResolvedValueOnce({ data: { companyId, customerId, caseId: customerId, caseRevision: 2, contactRevision: 1, changed: true, replayed: false }, error: null })
  await expect(changeContactAfterSupportVerification(input)).rejects.toMatchObject({ code: 'support_result_invalid', status: 503 })
})

it('classifies a completed sensitive command as conflict rather than an unavailable database', async () => {
  const { changeContactAfterSupportVerification } = await import('@/lib/customer-operations/supportSensitiveContact')
  io.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'support_sensitive_command_already_completed' } })
  await expect(changeContactAfterSupportVerification({ ...request, proofToken: await token() }))
    .rejects.toMatchObject({ code: 'support_sensitive_command_already_completed', status: 409 })
})

it('the internal action uses actual selected-company guard/session and does not accept actor or verification flags', async () => {
  const { changeSupportContactWithVerificationAction } = await import('@/app/admin/customer-cases/sensitive-contact-action')
  const form = new FormData()
  for (const [key,value] of Object.entries({ customer_id: customerId, case_id: caseId, expected_case_revision: '1', expected_contact_revision: '0',
    idempotency_key: request.idempotencyKey, reason: request.reason, phone: request.changes.phone, proof_token: await token() })) form.append(key,value)
  expect(await changeSupportContactWithVerificationAction(form)).toMatchObject({ ok: true, revision: 2 })
  expect(io.guard).toHaveBeenCalledWith({ allOf: ['cases.write', 'masterdata.write'] })
  expect(io.session).toHaveBeenCalledWith('ops', userId)
  io.rpc.mockClear()
  form.append('verified','true')
  expect(await changeSupportContactWithVerificationAction(form)).toMatchObject({ ok: false, code: 'invalid_support_sensitive_command' })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('the internal action preserves its committed receipt when cache refresh fails', async () => {
  const { changeSupportContactWithVerificationAction } = await import('@/app/admin/customer-cases/sensitive-contact-action')
  const form = new FormData()
  for (const [key,value] of Object.entries({ customer_id: customerId, case_id: caseId, expected_case_revision: '1', expected_contact_revision: '0',
    idempotency_key: request.idempotencyKey, reason: request.reason, phone: request.changes.phone, proof_token: await token() })) form.append(key,value)
  io.revalidate.mockImplementation(() => { throw new Error('cache_refresh_failed') })
  expect(await changeSupportContactWithVerificationAction(form)).toEqual({ ok: true, revision: 2,
    message: 'Kontaktändringen är sparad efter handlingsbunden verifiering. Läs om sidan för aktuella uppgifter.' })
  expect(io.rpc).toHaveBeenCalledTimes(1)
})
