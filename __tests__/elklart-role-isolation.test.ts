import { describe, expect, it } from 'vitest'
import { validateIsolationTarget, evaluateRoleProbe, isRlsDenial, isolationCompanyCommand } from '../scripts/demo/elklart-role-isolation.mjs'
const first = '00000000-0000-0000-0000-000000000001'
const second = '00000000-0000-0000-0000-000000000002'
const customer = '00000000-0000-0000-0000-000000000003'
const foreign = '00000000-0000-0000-0000-000000000004'
const actor = '00000000-0000-0000-0000-000000000005'
const tenant = { companyId: first, actorUserId: actor, fictional: true }
const scope = { companyId: first, customerId: customer, foreignCompanyId: second, foreignCustomerId: foreign }
function probe() { return { context: { authorized: true, user_id: actor, selected_company_id: first, is_platform_admin: false, permissions: ['customers.read', 'cases.write'] }, ownRows: [{ id: customer, company_id: first }], foreignRows: [], foreignWriteRows: [], supportWriteRows: [], canWriteOwn: false, canWriteForeign: false, foreignContext: { user_id: actor, authorized: true, selected_company_id: first }, userId: actor } }
describe('actual role and tenant isolation guards', () => {
  it('requires a dedicated local data API and fictional canonical tenant', () => {
    expect(() => validateIsolationTarget({ API_URL: 'http://localhost:54321' }, tenant)).not.toThrow()
    for (const API_URL of ['https://example.supabase.co', 'http://localhost:55321', 'http://localhost:54321?x=1']) expect(() => validateIsolationTarget({ API_URL }, tenant)).toThrow()
    expect(() => validateIsolationTarget({ API_URL: 'http://localhost:54321' }, { ...tenant, fictional: false })).toThrow()
  })
  it('fails the matrix on cross-tenant reads, writes, context selection and elevated actors', () => {
    expect(evaluateRoleProbe('support', scope, probe()).pass).toBe(true)
    for (const change of [{ foreignRows: [{ id: foreign, company_id: second }] }, { foreignWriteRows: [{ id: foreign }] }, { supportWriteRows: [{ id: customer }] }, { canWriteForeign: true }, { foreignContext: { user_id: actor, authorized: true, selected_company_id: second } }, { foreignContext: null }, { context: { ...probe().context, is_platform_admin: true } }, { ownRows: [] }]) expect(evaluateRoleProbe('support', scope, { ...probe(), ...change }).pass).toBe(false)
  })
  it('derives the expected role permission differences without accepting missing schema as denial', () => {
    const handler = { ...probe(), ownWriteRows: [{ id: customer, company_id: first }], canWriteOwn: true, context: { ...probe().context, permissions: ['customers.read', 'customers.write'] } }
    expect(evaluateRoleProbe('handler', scope, handler).pass).toBe(true)
    expect(evaluateRoleProbe('handler', scope, { ...handler, ownWriteRows: [] }).pass).toBe(false)
    expect(evaluateRoleProbe('handler', scope, { ...handler, ownWriteRows: [{ id: foreign, company_id: second }] }).pass).toBe(false)
    expect(evaluateRoleProbe('support', scope, handler).pass).toBe(false)
    expect(isRlsDenial({ data: [], error: null })).toBe(true)
    expect(isRlsDenial({ data: null, error: { code: '42501' } })).toBe(true)
    expect(isRlsDenial({ data: null, error: { code: '42P01' } })).toBe(false)
    expect(isRlsDenial({ data: [{ id: foreign }], error: null })).toBe(false)
  })
  it('accepts the canonical null-selection foreign rejection but refuses invariant mismatches', () => {
    const foreignContext = { user_id: actor, authorized: true, selected_company_id: null, access_invariant_ok: false }
    expect(evaluateRoleProbe('support', scope, { ...probe(), foreignContext }).pass).toBe(true)
    expect(evaluateRoleProbe('support', scope, { ...probe(), foreignContext: { ...foreignContext, access_invariant_ok: true } }).pass).toBe(false)
    expect(evaluateRoleProbe('support', scope, { ...probe(), foreignContext: { ...foreignContext, user_id: foreign } }).pass).toBe(false)
    expect(evaluateRoleProbe('support', scope, { ...probe(), foreignContext: { ...foreignContext, selected_company_id: second } }).pass).toBe(false)
  })
  it('provisions only a distinct fictional onboarding tenant with a stable canonical command', () => {
    const command = isolationCompanyCommand(tenant)
    expect(command.actor_user_id).toBe(actor)
    expect(command.idempotency_key).toBe('elklart-local-demo:isolation:tenant:v1')
    expect(command.metadata.fictional).toBe(true)
    expect(command).not.toHaveProperty('status')
    expect(command.slug).toBe('elklart-demo-isolation')
  })
})
