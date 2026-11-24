import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { beforeEach, expect, it } from 'vitest'
import { hasPermissionRequirement, type PermissionRequirement } from '@/lib/admin/accessModel'

let permissions: string[], platform: boolean, operational: boolean, siteReady: boolean
let intakeUI: Record<string, unknown>
let receivedNextStepAccess: unknown
let pushedUrls: string[]
let contract: Record<string, unknown>
let signatureCompany: Record<string, unknown>
let replacementTargets: Array<{ id: string }>
const context = () => ({ userId: 'staff', companyId: 'company-a', permissions, roles: [], isPlatformAdmin: platform })
const guard = async (requirement: string[] | PermissionRequirement) => {
  if (platform || operational && hasPermissionRequirement(permissions, Array.isArray(requirement) ? { anyOf: requirement } : requirement)) return context()
  throw new Error('Forbidden')
}
const client = {
  auth: { getUser: async () => ({ data: { user: { email: 'staff@example.invalid' } } }) },
  from(table: string) {
    const result = table === 'customers' ? { customer_number: '1001', full_name: 'Syntetisk kund', email: 'kund@example.invalid' } : table === 'customer_contracts' ? contract : table === 'companies' ? signatureCompany : []
    let replacementLookup = false
    const q: unknown = new Proxy({}, { get: (_, key) => {
      if (key === 'select') return (columns: string) => { replacementLookup = table === 'customer_contract_signature_requests' && columns === 'id'; return q }
      if (key === 'then') return (resolve: (v: unknown) => void) => Promise.resolve({ data: replacementLookup ? replacementTargets : result, error: null }).then(resolve)
      return () => q
    } })
    return q
  },
}
const inertAction = async () => { throw new Error('No mutation may execute in a presentation test') }
function load(file: string) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loadedModule = { exports: {} as Record<string, (...args: never[]) => unknown> }
  const requireModule = (name: string): unknown => {
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'node:crypto') return { randomUUID }
    if (name === 'react') return { useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useActionState: () => [intakeUI, inertAction, false] }
    if (name === 'next/navigation') return { useRouter: () => ({ push: (url: string) => pushedUrls.push(url) }) }
    if (name === 'server-only') return {}
    if (name === '@/lib/admin/actionPresentation') return load('lib/admin/actionPresentation.ts')
    if (name === '@/lib/admin/accessModel') return { hasPermissionRequirement }
    if (name === '@/lib/admin/masterdataPermissions') return load('lib/admin/masterdataPermissions.ts')
    if (name === '@/lib/admin/guards') return { requireAdminPageAccess: async () => context(), requireAdminActionAccess: guard, isPlatformAdminContext: () => platform }
    if (name === '@/lib/tenant/governance') return {
      ...load('lib/tenant/governance.ts'),
      getCompanyById: async () => ({ status: operational ? 'active' : 'paused' }),
      isCompanyOperationalForWrites: (s: string) => s === 'active',
    }
    if (name === '@/lib/performance/mapWithConcurrency') return load('lib/performance/mapWithConcurrency.ts')
    if (name === '@/lib/tenant/adminScope') return { resolveAdminTenantReadScope: async () => ({ companyId: 'company-a', companyName: 'Syntetiskt bolag', isPlatformAdmin: platform }) }
    if (name === '@/lib/supabase/server') return { createSupabaseServerClient: async () => client }
    if (name === '@/lib/supabase/service') return { supabaseService: client }
    if (name === '@/lib/tenant/entityGuards') return { loadCustomerTenantContext: async () => ({ companyId: 'company-a' }), assertContractTenant: async () => {} }
    if (name === '@/lib/customer-contracts/autoSendSigningLink') return { contractHasValidSigningSite: async () => siteReady, SIGNING_LINK_SITE_REQUIRED_MESSAGE: 'Välj anläggning' }
    if (name === '@/lib/ui/format') return { formatStatusLabel: (s: string) => s }
    if (name === 'next/link') return { default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }
    if (name === '@/components/admin/AdminHeader') return { default: () => null }
    if (name === '@/components/admin/customers/CustomerActionsMenu') return { default: ({ children }: { children: React.ReactNode }) => children }
    if (name === '@/components/admin/customers/CustomerIntakeForm') return { default: (props: { nextStepAccess?: unknown }) => { receivedNextStepAccess = props.nextStepAccess; return React.createElement('form', { 'data-intake': 'manual' }) } }
    if (name === '@/components/admin/customers/CustomerBulkImportPanel') return { default: () => React.createElement('form', { 'data-intake': 'bulk' }) }
    if (name === '@/components/admin/customers/CustomerIntakeWorkspace') return { default: ({ manual, bulk }: { manual: React.ReactNode; bulk: React.ReactNode }) => React.createElement('section', null, manual, bulk) }
    if (name === '@/lib/masterdata/db') return { listElectricitySuppliers: async () => [], listGridOwners: async () => [], listPriceAreas: async () => [] }
    if (name === '@/lib/customer-contracts/db') return { listContractOffers: async () => [] }
    if (name === '@/lib/ediel/platformGoLive') return { getCompanyGoLiveSetupSummary: async () => null }
    if (name === '@/lib/customer-contracts/signingMethod') return load('lib/customer-contracts/signingMethod.ts')
    if (name === './CustomerActionsMenu') return { default: ({ children }: { children: React.ReactNode }) => children }
    if (name === '@/components/admin/customers/CustomerIntakeEnhancer') return { default: () => null }
    if (name === '@/app/admin/customers/actions') return { createCustomerAction: inertAction }
    if (name === '@/app/admin/customers/[id]/actions') return { createCustomerDataRequestPackageAction: inertAction }
    if (name === '@/app/admin/customers/actionState') return { initialIntakeActionState: { status: 'idle', values: {}, fieldErrors: {} } }
    if (name === './actions') return { sendContractSignatureLinkAction: inertAction }
    if (name === './policy') return load('app/admin/customers/[id]/contracts/[contractId]/signature/policy.ts')
    throw new Error(`Unexpected test dependency ${name}`)
  }
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: requireModule, React, Error, Date, Intl, console, URLSearchParams }, { filename: file })
  return loadedModule.exports
}
async function signature() {
  return renderToStaticMarkup(await load('app/admin/customers/[id]/contracts/[contractId]/signature/page.tsx').default({ params: Promise.resolve({ id: 'customer-a', contractId: 'contract-a' }), searchParams: Promise.resolve({}) } as never) as React.ReactElement)
}
async function intake(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await load('app/admin/customers/intake/page.tsx').default({ searchParams: Promise.resolve(params) } as never) as React.ReactElement)
}
beforeEach(() => {
  permissions = []; platform = false; operational = true; siteReady = true; pushedUrls = []; receivedNextStepAccess = undefined; intakeUI = { status: "success", message: "Kund skapad", createdCustomerId: "customer-a", values: {}, fieldErrors: {} }
  signatureCompany = { is_active: true, lifecycle_status: 'active', suspended_at: null }
  replacementTargets = []
  contract = { id: 'contract-a', status: 'draft', signed_at: null, contract_name: 'Elavtal', contract_number: 'A1' }
})
it('keeps intake registration and import forms out of the masterdata reader view', async () => {
  permissions = ['masterdata.read']
  const html = await intake()
  expect(html).not.toContain('data-intake=')
  expect(html).toContain('behörig')
})
it.each([false, true])('retains intake commands for an authorized writer/platform=%s', async admin => {
  platform = admin; permissions = admin ? [] : ['customers.write']
  const html = await intake()
  expect(html).toContain('data-intake="manual"')
  expect(html).toContain('data-intake="bulk"')
})
it('retains signature details for a reader without offering a send command', async () => {
  permissions = ['contracts.read']
  const html = await signature()
  expect(html).toContain('Signeringshistorik')
  expect(html).toContain('1001')
  expect(html).not.toContain('name="recipient_email"')
  expect(html).toContain('behörig')
})
it.each(['contracts.write', 'contracts.create'])('keeps history but hides signing for a company actor with only %s', async permission => {
  permissions = ['contracts.read', permission]
  const html = await signature()
  expect(html).toContain('Signeringshistorik')
  expect(html).not.toContain('name="recipient_email"')
})
it.each([
  [false, { is_active: true, lifecycle_status: 'suspended', suspended_at: null }],
  [false, { is_active: true, lifecycle_status: 'active', suspended_at: '2026-11-14T00:00:00Z' }],
  [true, { is_active: false, lifecycle_status: 'active', suspended_at: null }],
])('hides signing for a non-operational contract company, platform=%s and company=%j', async (admin, company) => {
  platform = admin
  permissions = admin ? [] : ['contracts.read', 'contracts.write', 'contracts.create']
  signatureCompany = company
  const html = await signature()
  expect(html).toContain('Signeringshistorik')
  expect(html).not.toContain('name="recipient_email"')
})
it.each([false, true])('retains allowed signing controls for writer/platform=%s', async admin => {
  platform = admin; permissions = admin ? [] : ['contracts.write', 'contracts.create']
  expect(await signature()).toContain('name="recipient_email"')
})
it('binds a replaceable sign request even when the bounded history does not contain it', async () => {
  permissions = ['contracts.write', 'contracts.create']
  const id = '00171173-0000-4000-8000-000000000041'
  replacementTargets = [{ id }]
  const html = await signature()
  expect(html).toContain('name="signature_command_id"')
  expect(html).toContain(`name="expected_signature_request_id" value="${id}"`)
})
it('preserves history and withholds replacement when two open requests compete', async () => {
  permissions = ['contracts.write', 'contracts.create']
  replacementTargets = [{ id: '00171173-0000-4000-8000-000000000041' }, { id: '00171173-0000-4000-8000-000000000042' }]
  const html = await signature()
  expect(html).toContain('Signeringshistorik')
  expect(html).toContain('fastställa vilken signeringslänk')
  expect(html).not.toContain('name="recipient_email"')
})
it.each(['signed', 'cancelled', 'active'])('does not offer signing for disallowed contract status %s', async status => {
  permissions = ['contracts.write', 'contracts.create']; contract.status = status
  expect(await signature()).not.toContain('name="recipient_email"')
})
it('preserves the required signing site boundary for a writer', async () => {
  permissions = ['contracts.write', 'contracts.create']; siteReady = false
  expect(await signature()).not.toContain('name="recipient_email"')
})
it('does not offer company writes when the company is paused', async () => {
  operational = false; permissions = ['customers.write', 'contracts.write']
  expect(await intake()).not.toContain('data-intake=')
  expect(await signature()).not.toContain('name="recipient_email"')
})

function exactFunction(file: string, name: string, bindings: Record<string, unknown>) {
  const source = fs.readFileSync(file, 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const node = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  if (!node) throw new Error(`Missing actual function ${name}`)
  const code = ts.transpileModule(node.getText(parsed), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loadedModule = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> }
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, FormData, Date, Error, URLSearchParams, ...bindings })
  return loadedModule.exports[name]
}
function packageAction(options: { poa?: boolean; coverage?: boolean; rawStatus?: string; deny?: boolean } = {}) {
  const calls: string[] = []
  const coverage = { coverage: { coversGridOwnerData: options.coverage !== false, coversCurrentSupplierContract: options.coverage !== false }, signedScopes: ['synthetic'] }
  const noEffect = async () => {}
  const actual = exactFunction('app/admin/customers/[id]/actions.part-3.ts', 'createCustomerDataRequestPackageAction', {
    requireAdminActionAccess: async (value: unknown) => { expect(value).toEqual(['masterdata.write']); if (options.deny) throw new Error('Forbidden'); return context() },
    MASTERDATA_PERMISSIONS: { WRITE: 'masterdata.write' },
    normalizeUuidOrNull: (value: unknown) => value || null,
    formValue: (form: FormData, key: string) => form.get(key),
    requireCustomerMutationContext: async () => ({ companyId: 'company-a' }),
    normalizeDataRequestTarget: () => 'both',
    assertCustomerSiteTenant: noEffect, assertMeteringPointTenant: noEffect, assertPowerOfAttorneyTenant: noEffect,
    getLatestSignedPowerOfAttorneyForCustomer: async () => options.poa === false ? null : { id: 'poa-a' },
    recordCustomerActionResult: noEffect, createMissingPowerOfAttorneyBlocker: noEffect, insertAuditLog: noEffect, revalidatePath: noEffect,
    getSignedPowerOfAttorneyCoverage: async () => coverage,
    ensureAuthorizationScopeFromPowerOfAttorney: async () => 'scope-a',
    resolveCustomerBlockersAfterSignedPowerOfAttorney: async () => ({ resolved: 0 }),
    createCustomerInfoRequest: async (input: { requestType: string }) => { calls.push(input.requestType); return { id: `request-${calls.length}` } },
    queueCustomerInfoRequestForDispatch: async () => ({ status: options.rawStatus ?? 'ready_to_send', blockerReason: null }),
    normalizeSimpleRequestStatus: (value: string) => value,
  })
  const form = new FormData(); form.set('customer_id', 'customer-a')
  return { run: () => actual(form), calls }
}
it('returns a blocked outcome without queueing when a signed power of attorney is missing', async () => {
  const action = packageAction({ poa: false })
  expect(await action.run()).toMatchObject({ status: 'blocked_missing_poa' })
  expect(action.calls).toEqual([])
})
it('returns a scope blocker without queueing an uncovered request', async () => {
  const action = packageAction({ coverage: false })
  expect(await action.run()).toMatchObject({ status: 'blocked_scope' })
  expect(action.calls).toEqual([])
})
it('returns queued only after actual request creation and queue qualification', async () => {
  const action = packageAction()
  expect(await action.run()).toMatchObject({ status: 'queued' })
  expect(action.calls).toEqual(['z01_customer_masterdata', 'current_supplier_contract_info'])
})
it.each(['manual_review_required', 'future_unknown', 'failed'])('does not report sent or queued for uncertain status %s', async rawStatus => {
  expect(await packageAction({ rawStatus }).run()).toMatchObject({ status: 'needs_review' })
})
it('retains the original action permission denial before any request creation', async () => {
  const action = packageAction({ deny: true })
  await expect(action.run()).rejects.toThrow('Forbidden')
  expect(action.calls).toEqual([])
})

it('distinguishes prepared requests from actual queue qualification', async () => {
  expect(await packageAction({ rawStatus: 'z01_prepared' }).run()).toMatchObject({ status: 'prepared' })
})
function facadeResult(status: string | undefined, submit = 'customer_data_requests') {
  let completed = false
  const redirect = (url: string) => { expect(completed).toBe(true); throw new Error(`REDIRECT:${url}`) }
  const action = exactFunction('app/admin/customers/[id]/actions.ts', 'createCustomerDataRequestPackageAction', {
    formText: (form: FormData, key: string) => form.get(key),
    implementation3: {
      createCustomerDataRequestPackageAction: async () => {
        await Promise.resolve()
        completed = true
        return status ? { status } : undefined
      },
    },
    redirect,
  })
  const form = new FormData(); form.set('customer_id', 'customer-a'); form.set('redirect_after_submit', submit)
  return action(form)
}
it.each(['queued', 'prepared', 'blocked_missing_poa', 'blocked_scope', 'blocked_reference', 'needs_review'])('returns intake to a typed result after the complete existing action chain: %s', async status => {
  await expect(facadeResult(status)).rejects.toThrow(`REDIRECT:/admin/customers/intake?request_result=${status}&customer_id=customer-a`)
})
it('does not redirect existing customer-card callers or honor arbitrary redirect text', async () => {
  await expect(facadeResult('queued', 'https://foreign.invalid')).resolves.toBeUndefined()
})
it('does not turn an unknown action outcome into a queued confirmation', async () => {
  await expect(facadeResult('future_unknown')).rejects.toThrow('request_result=needs_review')
})

it.each([
  ['blocked_missing_poa', 'Begäran stoppades eftersom signerad fullmakt saknas.'],
  ['blocked_scope', 'Fullmaktens omfattning behöver kontrolleras innan uppgifter kan begäras.'],
  ['blocked_reference', 'Fullmakten behöver granskas innan uppgifter kan begäras.'],
  ['queued', 'Begäran har lagts i kö.'],
  ['prepared', 'Begäran är förberedd.'],
  ['needs_review', 'Begäran behöver granskas.'],
])('shows the allowlisted result on actual intake readback: %s', async (request_result, message) => {
  permissions = ['customers.write', 'customers.read']
  const html = await intake({ request_result, customer_id: 'customer-a' })
  expect(html).toContain(message)
  expect(html).toContain('href="/admin/customers/customer-a"')
})
it('does not echo unknown result text as a success notice', async () => {
  permissions = ['customers.write']
  expect(await intake({ request_result: 'RAW-INTERNAL-ERROR', customer_id: 'customer-a' })).not.toContain('RAW-INTERNAL-ERROR')
})

it.each(['new', 'current'])('preserves reset identity when changing between manual and bulk mode: %s', resetKey => {
  const Workspace = load('components/admin/customers/CustomerIntakeWorkspace.tsx').default
  const tree = Workspace({ mode: 'manual', resetKey, manual: null, bulk: null } as never) as React.ReactElement<{ children: React.ReactElement[] }>
  const label = tree.props.children[0] as React.ReactElement<{ children: React.ReactElement[] }>
  const select = label.props.children[1] as React.ReactElement<{ onChange: (event: { target: { value: string } }) => void }>
  select.props.onChange({ target: { value: 'bulk' } })
  select.props.onChange({ target: { value: 'manual' } })
  const suffix = resetKey === 'new' ? '&new=1' : ''
  expect(pushedUrls).toEqual([`/admin/customers/intake?mode=bulk${suffix}`, `/admin/customers/intake?mode=manual${suffix}`])
})

type NextStepAccess = { canReadCustomer: boolean; canReadContracts: boolean; canReadInfoRequests: boolean; canRequestData: boolean }
function createdForm(access?: NextStepAccess) {
  const Form = load('components/admin/customers/CustomerIntakeForm.tsx').default
  return renderToStaticMarkup(React.createElement(Form as unknown as React.ComponentType<Record<string, unknown>>, { gridOwners: [], electricitySuppliers: [], priceAreas: [], contractOffers: [], ...(access ? { nextStepAccess: access } : {}) }))
}
it.each(Array.from({ length: 16 }, (_, bits) => ({ canReadCustomer: !!(bits & 1), canReadContracts: !!(bits & 2), canReadInfoRequests: !!(bits & 4), canRequestData: !!(bits & 8) })))('renders actual next steps with only their authorized destinations and command: %j', access => {
  const html = createdForm(access)
  expect(html.includes('href="/admin/customers/customer-a"')).toBe(access.canReadCustomer)
  expect(html.includes('href="/admin/customer-info-requests?customer_id=customer-a#create-info-request"')).toBe(access.canReadInfoRequests)
  expect(html.includes('name="redirect_after_submit"')).toBe(access.canRequestData)
  expect(html.includes('name="postCreateActionOverride"')).toBe(access.canRequestData)
  expect(html).not.toContain('tab=data-requests')
})
it('defaults actual form next-step access to false when no access props are supplied', () => {
  const html = createdForm()
  expect(html).not.toContain('name="redirect_after_submit"')
  expect(html).not.toContain('href="/admin/customers/customer-a"')
  expect(html).not.toContain('/admin/customer-info-requests')
})
it.each([
  { canReadCustomer: false, canReadContracts: false, expected: null },
  { canReadCustomer: false, canReadContracts: true, expected: null },
  { canReadCustomer: true, canReadContracts: false, expected: '/admin/customers/customer-a' },
  { canReadCustomer: true, canReadContracts: true, expected: '/admin/customers/customer-a?tab=contracts#contracts' },
])('keeps committed-review recovery on an authorized customer tab: %j', ({ canReadCustomer, canReadContracts, expected }) => {
  intakeUI.status = 'committed_review'
  const html = createdForm({ canReadCustomer, canReadContracts, canReadInfoRequests: false, canRequestData: false })
  expect(html.includes('href="/admin/customers/customer-a')).toBe(expected !== null)
  if (expected) expect(html).toContain(`href="${expected}"`)
  expect(html).not.toContain('name="redirect_after_submit"')
})
it.each([
  { rights: ['customers.write'], customer: false, contracts: false, info: false, request: false },
  { rights: ['customers.write', 'masterdata.write'], customer: false, contracts: false, info: false, request: true },
  { rights: ['customers.write', 'poa.read'], customer: false, contracts: false, info: true, request: false },
  { rights: ['customers.write', 'contracts.write'], customer: false, contracts: false, info: false, request: false },
  { rights: ['customers.write', 'contracts.read'], customer: false, contracts: false, info: false, request: false },
  { rights: ['customers.write', 'customers.read', 'contracts.read'], customer: true, contracts: true, info: true, request: false },
])('derives serializable next-step access from exact parent guard requirements: $rights', async ({ rights, customer, contracts, info, request }) => {
  permissions = rights
  await intake()
  expect(receivedNextStepAccess).toEqual({ canReadCustomer: customer, canReadContracts: contracts, canReadInfoRequests: info, canRequestData: request })
})
it('retains the actual platform exception for all next-step access flags', async () => {
  platform = true
  await intake()
  expect(receivedNextStepAccess).toEqual({ canReadCustomer: true, canReadContracts: true, canReadInfoRequests: true, canRequestData: true })
})
