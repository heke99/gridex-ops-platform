import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { beforeEach, expect, it } from 'vitest'
import { getAdminPageRequirement, hasPermissionRequirement, type PermissionRequirement } from '@/lib/admin/accessModel'

type Row = Record<string, unknown>
type Requirement = string[] | PermissionRequirement
let permissions: string[], platform: boolean, writable: boolean, companyAdmin: boolean
let guardError: unknown
let selectedCompanyStatus: string
let selectedCompanyId: string | null
let companyStatuses: Record<string, string>
let companyReadError: unknown
let records: Record<string, Row[]>
let guardCalls: Array<{ requirement: Requirement; companyId?: string }>
let labelReads: Array<{ table: string; filters: Array<[string, unknown]> }>
const companyId = 'company-a'
const readerPermissions: Record<string, string> = {
  'partner-exports': 'partner_exports.read', 'operations/perioder': 'customers.write',
  'operations/tasks': 'metering.read', outbound: 'switching.read', billing: 'billing_underlay.read',
  'webhooks/deliveries': 'integrations.read', 'website-applications': 'customers.read',
}
const context = () => ({ userId: 'staff-a', companyId: selectedCompanyId, permissions, roles: [], isPlatformAdmin: platform })
const isPlatform = (value: { isPlatformAdmin?: boolean }) => value.isPlatformAdmin === true
const guard = async (requirement: Requirement) => {
  guardCalls.push({ requirement })
  if (guardError) throw guardError
  if (platform) return context()
  if (!writable) throw new Error('Bolaget är pausat eller inte operativt. Ändringar är blockerade tills bolaget återaktiveras.')
  if (!hasPermissionRequirement(permissions, Array.isArray(requirement) ? { anyOf: requirement } : requirement)) throw new Error('Forbidden')
  return context()
}
const scopedGuard = async (company: string, requirement: Requirement) => {
  const result = await guard(requirement)
  guardCalls[guardCalls.length - 1].companyId = company
  if (!platform && (!companyAdmin || company !== companyId)) throw new Error('Du saknar aktiv ändringsbehörighet för valt bolag.')
  return result
}
const scopes = {
  resolveAdminTenantReadScope: async () => ({ companyId: platform ? null : companyId, companyName: 'Syntetiskt bolag', isPlatformAdmin: platform }),
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: selectedCompanyId, companyName: 'Syntetiskt bolag', isPlatformAdmin: platform }),
}
const inertAction = async () => { throw new Error('An action must never execute in a presentation test') }
const actions = new Proxy({}, { get: () => inertAction })
function query(table: string) {
  const read = { table, filters: [] as Array<[string, unknown]> }
  labelReads.push(read)
  const q = new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: records[table] ?? [], error: null }))
    : (...args: unknown[]) => { if (key === 'eq') read.filters.push([String(args[0]), args[1]]); return q } })
  return q
}
const client = { from: query, auth: { getUser: async () => ({ data: { user: { id: 'staff-a' } } }) } }
function load(relative: string): Record<string, (...args: never[]) => unknown> {
  const code = fs.readFileSync(path.resolve(relative), 'utf8')
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loadedModule = { exports: {} }
  const requireModule = (name: string): unknown => {
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'server-only') return {}
    if (name === '@/lib/admin/actionPresentation') return load('lib/admin/actionPresentation.ts')
    if (name === '@/lib/admin/accessModel') return { hasPermissionRequirement, getAdminPageRequirement }
    if (name === '@/lib/admin/guards') return { requireAdminActionAccess: guard, requireCompanyScopedActionAccess: scopedGuard, requireAdminPageKeyAccess: async () => context(), requireAdminPageAccess: async () => context(), isPlatformAdminContext: isPlatform }
    if (name === '@/lib/auth/requirePermissionServer') return { requirePermissionServer: async () => context() }
    if (name === '@/lib/tenant/adminScope') return scopes
    if (name === '@/lib/tenant/governance') return {
      getCompanyById: async (id: string) => { if (companyReadError) throw companyReadError; return { status: companyStatuses[id] ?? selectedCompanyStatus } },
      isCompanyOperationalForWrites: (status: string) => ['active', 'onboarding'].includes(status),
    }
    if (name === '@/lib/supabase/server') return { createSupabaseServerClient: async () => client }
    if (name === 'next/link') return { default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }
    if (name === '@/components/admin/AdminHeader') return { default: ({ title }: { title: string }) => React.createElement('h1', null, title) }
    if (name === '@/components/admin/CustomerName') return { default: () => React.createElement('span', null, 'Syntetisk kund') }
    if (name === '@/components/admin/ui/AdminActionsMenu') return { default: ({ label = 'Mer', children }: { label?: string; children: React.ReactNode }) => React.createElement('div', null, React.createElement('span', null, label), children) }
    if (name === '@/components/admin/ui/AdminDisclosurePanel') return { default: ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => React.createElement('details', { id }, React.createElement('summary', null, title), children) }
    if (name === '@/lib/ui/format') return load('lib/ui/format.ts')
    if (name === '@/lib/time/stockholm') return load('lib/time/stockholm.ts')
    if (name === '@/lib/website/applicationState') return load('lib/website/applicationState.ts')
    if (name === '@/lib/cis/db') return {
      listAllPartnerExports: async () => records.exports ?? [], listAllBillingUnderlays: async () => [],
      listOutboundRequests: async () => records.outbound ?? [], listOutboundDispatchEventsByRequestIds: async () => [],
    }
    if (name === '@/lib/operations/db') return { listAllOperationTasks: async () => records.tasks ?? [], listAllSupplierSwitchRequests: async () => [] }
    if (name === '@/lib/masterdata/db') return { listMeteringPointsBySiteIds: async () => [] }
    if (name === '@/lib/operations/taskResolution') return { isTaskLikelyResolved: () => false }
    if (name === '@/lib/operations/controlTower') return { getBillingExportReadiness: () => ({ isReady: false, issues: [] }) }
    if (name === '@/lib/operations/batch2cAutomation') return { listBatch2CDriftQueue: async () => records.gaps ?? [] }
    if (name === '@/lib/facility/workQueue') return { listFacilityWorkQueue: async () => records.facilityQueue ?? [], facilityStatusLabel: (v: string) => v, facilityMissingFieldLabel: (v: string) => v }
    if (name === '@/lib/billing/invoiceReviewData') return { listInvoiceReviewRows: async () => records.invoices ?? [] }
    if (name === '@/lib/billing/invoiceFileExport') return { listInvoiceFileCandidates: async () => records.candidates ?? [], listInvoiceFiles: async () => [] }
    if (name === '@/lib/billing/providers/registry') return { loadTenantInvoiceProviderSelection: async () => ({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test', invoice_export_enabled: true }), isFileProvider: () => true }
    if (name === '@/lib/admin/websiteIntegrationOps') return { listWebhookDeliveries: async () => records.deliveries ?? [], listWebhookSubscriptions: async () => records.subscriptions ?? [], listWebsiteApplications: async () => records.applications ?? [] }
    if (name === '@/lib/customers/statusLabels') return new Proxy({}, { get: () => (v: string) => v })
    if (name === '@/lib/customer-portal/labels') return new Proxy({}, { get: () => (v: string) => v })
    if (name === '@/lib/operations/actionableStatus') return new Proxy({}, { get: () => (v: string) => v })
    if (name.endsWith('/actions') || name.endsWith('/control-actions') || name === './actions' || name === '../actions') return actions
    throw new Error(`Unexpected page dependency ${name}`)
  }
  vm.runInNewContext(js, { module: loadedModule, exports: loadedModule.exports, require: requireModule, React, Date, Intl, URLSearchParams, console, Error }, { filename: relative })
  return loadedModule.exports
}
async function render(page: string, params: Record<string, string> = {}) {
  const Page = load(`app/admin/${page}/page.tsx`).default
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) } as never) as React.ReactElement)
}
beforeEach(() => {
  permissions = []; platform = false; writable = true; companyAdmin = true; guardError = undefined; guardCalls = []; labelReads = []
  selectedCompanyStatus = 'active'; selectedCompanyId = companyId; companyStatuses = {}; companyReadError = undefined
  records = {
    exports: [{ id: 'export-a', company_id: companyId, customer_id: 'customer-a', status: 'queued', export_kind: 'billing_underlay', queued_at: '2026-11-16T10:00:00Z' }],
    subscriptions: [{ id: 'subscription-a', company_id: companyId, name: 'Syntetisk anslutning', endpoint_url: 'https://example.invalid', event_types: [], status: 'active' }],
    deliveries: [{ id: 'delivery-a', company_id: companyId, event_type: 'customer.changed', status: 'failed', payload: { private_fixture: 'raw-marker' }, attempts: 1, max_attempts: 3 }],
    invoices: [{ id: 'invoice-a', underlayId: 'underlay-a', customerId: 'customer-a', status: 'ready_for_review', customerName: 'Syntetisk kund' }],
    candidates: [{ id: 'invoice-a' }],
    tasks: [],
  }
})

it.each([
  ['partner-exports', 'Uppdatera exportstatus'], ['operations/perioder', 'Starta periodkontroll'],
  ['operations/tasks', 'Kör automatisk uppföljning'], ['outbound', 'Förbered fakturaexporter'],
  ['billing', 'Skapa fakturafil'], ['webhooks/deliveries', 'Skicka testhändelse'],
])('does not offer %s write actions to a reader', async (page, actionLabel) => {
  permissions = [readerPermissions[page]]
  const html = await render(page)
  expect(html).not.toContain(actionLabel)
})
it('does not offer billing approval to a billing reader', async () => {
  permissions = ['billing_underlay.read']
  expect(await render('billing')).not.toContain('Godkänn och skicka')
  expect(await render('billing')).not.toContain('Godkänn 1 klara fakturor')
})
it('hides website log link when its destination permissions are absent', async () => {
  permissions = ['customers.read']
  const html = await render('website-applications')
  expect(html).not.toContain('href="/admin/webhooks/deliveries"')
  expect(html).not.toContain('>Resurser<')
  permissions = ['customers.read', 'integrations.read']
  expect(await render('website-applications')).toContain('href="/admin/webhooks/deliveries"')
})
it('shows a controlled result after a webhook action without exposing raw payload to a company', async () => {
  permissions = ['integrations.read']
  const html = await render('webhooks/deliveries', { success: 'Webhook delivery köades om.' })
  expect(html).toContain('role="status"')
  expect(html).toContain('lagts i kö igen')
  expect(html).not.toContain('raw-marker')
  expect(html).not.toContain('Payload')
})
it('retains platform diagnostics and permitted webhook controls', async () => {
  platform = true
  const html = await render('webhooks/deliveries')
  expect(html).toContain('raw-marker')
  expect(html).toContain('Skicka test')
  expect(html).toContain('Ignorera')
})

const policy = () => load('lib/admin/actionPresentation.ts') as unknown as {
  canPresentAdminAction: (requirement: Requirement, options?: { companyId: string }) => Promise<boolean>
  canPresentOperationalAction: (requirement: Requirement, companyId: string | null | undefined) => Promise<boolean>
  canPresentAdminLink: (access: ReturnType<typeof context>, requirement: PermissionRequirement) => boolean
  webhookActionNotice: (value: unknown) => { kind: string; message: string } | null
}
it('delegates action anyOf/allOf unchanged to the actual guard port', async () => {
  permissions = ['metering.write']
  const requirement = { anyOf: ['switching.write', 'metering.write'], allOf: ['metering.write'] }
  expect(await policy().canPresentAdminAction(requirement)).toBe(true)
  expect(guardCalls[0].requirement).toEqual(requirement)
  expect(await policy().canPresentAdminAction({ allOf: ['metering.write', 'switching.write'] })).toBe(false)
})
it('keeps company-admin membership and writability in the presentation boundary', async () => {
  permissions = ['integrations.write']
  companyAdmin = false
  expect(await policy().canPresentAdminAction(['integrations.write'], { companyId })).toBe(false)
  companyAdmin = true
  writable = false
  expect(await policy().canPresentAdminAction(['integrations.write'], { companyId })).toBe(false)
  platform = true
  expect(await policy().canPresentAdminAction(['integrations.write'], { companyId })).toBe(true)
})
it.each([new Error('membership read failed'), { message: 'Forbidden', code: 'upstream_failure' }, Object.assign(new Error('Forbidden'), { code: 'upstream_failure' })])('propagates unexpected guard failure %j instead of presenting read-only access', async failure => {
  guardError = failure
  await expect(policy().canPresentAdminAction(['integrations.write'])).rejects.toBe(failure)
})
it('does not infer global platform access from role spelling against an authoritative false flag', () => {
  const access = { ...context(), roles: ['super_admin'], isPlatformAdmin: false }
  expect(policy().canPresentAdminLink(access, { anyOf: ['integrations.read'] })).toBe(false)
})
it.each([
  ['partner-exports', 'partner_exports.write', 'Uppdatera exportstatus'],
  ['operations/perioder', 'cases.write', 'Starta periodkontroll'],
  ['operations/tasks', 'masterdata.write', 'Kör automatisk uppföljning'],
  ['outbound', 'partner_exports.write', 'Förbered fakturaexporter'],
  ['billing', 'billing_underlay.export', 'Skapa fakturafil'],
  ['webhooks/deliveries', 'integrations.write', 'Skicka testhändelse'],
])('preserves %s controls for the corresponding allowed writer', async (page, permission, actionLabel) => {
  permissions = [permission, readerPermissions[page]]
  expect(await render(page)).toContain(actionLabel)
})
it('does not show outbound status editing just because billing queueing is permitted', async () => {
  permissions = ['partner_exports.write', 'partner_exports.read']
  records.outbound = [{ id: 'outbound-a', customer_id: 'customer-a', status: 'queued', request_type: 'billing_export', channel_type: 'file_export', attempts_count: 0 }]
  let html = await render('outbound')
  expect(html).toContain('Förbered fakturaexporter')
  expect(html).not.toContain('name="dispatch_step"')
  permissions = ['metering.write', 'metering.read']
  html = await render('outbound')
  expect(html).toContain('name="dispatch_step"')
  expect(html).not.toContain('Förbered fakturaexporter')
})
it('checks membership and paused-company state for rendered webhook actions', async () => {
  permissions = ['integrations.write']; companyAdmin = false
  expect(await render('webhooks/deliveries')).not.toContain('Skicka testhändelse')
  companyAdmin = true; writable = false
  expect(await render('webhooks/deliveries')).not.toContain('Skicka igen')
})
it('keeps direct facility handling write-only and preserves its submitted field names', async () => {
  permissions = ['metering.read']
  records.grid_owner_information_requests = [{ id: 'facility-a', company_id: companyId, customer_id: 'customer-a', status: 'draft', requested_fields: ['facility_id'], created_at: '2026-11-16T10:00:00Z' }]
  expect(await render('facility-requests')).not.toContain('name="facility_id"')
  permissions = ['customers.write', 'metering.read']
  const html = await render('facility-requests')
  expect(html).toContain('name="facility_id"')
  expect(html).toContain('name="request_id" value="facility-a"')
  expect(html).toContain('Registrera svar från nätägare')
})
it('only accepts known webhook action results and never infers globally missing fanout from a zero queue result', () => {
  const helper = policy()
  expect(helper.webhookActionNotice('__proto__')).toBeNull()
  expect(helper.webhookActionNotice(['Webhook delivery köades om.'])).toBeNull()
  expect(helper.webhookActionNotice('<script>untrusted</script>')).toBeNull()
  const notice = helper.webhookActionNotice('Testevent skapades men ingen aktiv webhook matchade vald endpoint.')
  expect(notice?.kind).toBe('check')
  expect(notice?.message).toContain('kan redan ha leveranser')
})

it('keeps partner exports compact, labelled and free of raw diagnostic identifiers for the company', async () => {
  permissions = ['partner_exports.write', 'partner_exports.read']
  const html = await render('partner-exports')
  expect(html).toContain('<details')
  expect(html).toContain('aria-label="Sök exportreferens"')
  expect(html).toContain('aria-label="Exportstatus"')
  expect(html).toContain('aria-label="Exporttyp"')
  expect(html).not.toContain('>Queued<')
  expect(html).not.toContain('>customer-a<')
  expect(html).not.toContain('billing_underlay</span>')
  platform = true
  expect(await render('partner-exports')).toContain('customer-a')
})
it('uses authorized company-scoped customer and facility labels without displaying another customer site', async () => {
  permissions = ['customers.read', 'partner_exports.read']
  records.exports[0].site_id = 'site-a'
  records.customers = [{ id: 'customer-a', full_name: 'Kundnamn', customer_number: 'K-123' }]
  records.customer_sites = [{ id: 'site-a', customer_id: 'customer-a', street: 'Exempelgatan', facility_id: '735000000000000001' }]
  let html = await render('partner-exports')
  expect(html).toContain('Kundnamn · K-123')
  expect(html).toContain('735000000000000001')
  expect(labelReads.filter(read => ['customers', 'customer_sites'].includes(read.table)).every(read => read.filters.some(([key, value]) => key === 'company_id' && value === companyId))).toBe(true)
  records.customer_sites[0].customer_id = 'another-customer'
  html = await render('partner-exports')
  expect(html).not.toContain('735000000000000001')
})
it('shows plain Swedish period handling and business identifiers instead of internal references', async () => {
  permissions = ['metering.write', 'customers.read', 'metering.read']
  records.gaps = [{ queue_type: 'metering_period_gap', source_id: 'gap-internal-a', customer_id: 'customer-a', metering_point_id: 'meter-internal-a', payload: { period_month: '2026-10' } }]
  records.customers = [{ id: 'customer-a', full_name: 'Periodkund', customer_number: 'K-2' }]
  records.metering_points = [{ id: 'meter-internal-a', meter_point_id: '735000000000000002' }]
  const html = await render('operations/perioder')
  expect(html).toContain('Periodkund · K-2')
  expect(html).toContain('735000000000000002')
  expect(html).toContain('Starta periodkontroll')
  expect(html).not.toContain('periodmotor')
  expect(html).not.toContain('requests/cases')
  expect(html).not.toContain('meter-internal-a')
})
it('preserves the per-task write boundary and collapses allowed status actions', async () => {
  permissions = ['metering.read']
  records.tasks = [{ id: 'task-a', title: 'Syntetisk uppgift', status: 'open', priority: 'normal', customer_id: 'customer-a', task_type: 'missing_poa' }]
  let html = await render('operations/tasks')
  expect(html).not.toContain('name="task_id"')
  permissions = ['masterdata.write', 'metering.read']
  html = await render('operations/tasks')
  expect(html).toContain('Hantera uppgift')
  expect(html).toContain('name="task_id" value="task-a"')
  expect(html).not.toContain('>In progress<')
})
it('keeps website inline review behind its actual company action policy', async () => {
  permissions = ['customers.read']
  records.applications = [{ id: 'application-a', company_id: companyId, source_table: 'website_customer_applications', status: 'needs_information', payload: {} }]
  let html = await render('website-applications')
  expect(html).not.toContain('name="application_id"')
  permissions = ['customers.write', 'customers.read']
  html = await render('website-applications')
  expect(html).toContain('name="application_id" value="application-a"')
  companyAdmin = false
  expect(await render('website-applications')).not.toContain('name="application_id"')
})

it('does not let another active membership or platform bypass the selected-company operational predicate', async () => {
  permissions = ['billing_underlay.export']; selectedCompanyStatus = 'paused'
  expect(await policy().canPresentOperationalAction(['billing_underlay.export'], companyId)).toBe(false)
  platform = true
  expect(await policy().canPresentOperationalAction(['billing_underlay.export'], companyId)).toBe(false)
  selectedCompanyStatus = 'active'
  expect(await policy().canPresentOperationalAction(['billing_underlay.export'], companyId)).toBe(true)
  expect(await policy().canPresentOperationalAction(['billing_underlay.export'], null)).toBe(false)
})
it('propagates operational company read errors without turning them into a denial', async () => {
  permissions = ['billing_underlay.export']; companyReadError = new Error('company_read_failed')
  await expect(policy().canPresentOperationalAction(['billing_underlay.export'], companyId)).rejects.toBe(companyReadError)
})

it('hides billing and period mutations for the selected paused company even when the action guard permits another membership', async () => {
  permissions = ['billing_underlay.read', 'billing_underlay.export', 'metering.write']
  selectedCompanyStatus = 'paused'
  expect(await render('billing')).not.toContain('Skapa fakturafil')
  expect(await render('billing')).not.toContain('Godkänn 1 klara fakturor')
  expect(await render('operations/perioder')).not.toContain('Starta periodkontroll')
})
it('keeps global platform reading while checking each row company and requiring a selected company for bulk operations', async () => {
  platform = true; selectedCompanyId = null
  records.outbound = [
    { id: 'active-outbound', company_id: companyId, customer_id: 'customer-a', status: 'queued', request_type: 'billing_export', channel_type: 'file_export', attempts_count: 0 },
    { id: 'paused-outbound', company_id: 'company-b', customer_id: 'customer-b', status: 'queued', request_type: 'billing_export', channel_type: 'file_export', attempts_count: 0 },
  ]
  companyStatuses['company-b'] = 'paused'
  const html = await render('outbound')
  expect(html).toContain('Välj ett bolag innan')
  expect(html).toContain('name="outbound_request_id" value="active-outbound"')
  expect(html).not.toContain('name="outbound_request_id" value="paused-outbound"')
  expect(html).not.toContain('Förbered fakturaexporter')
})

it('does not send facility readers to forbidden customer tabs or offer unpermitted registration', async () => {
  permissions = ['metering.read']
  records.grid_owner_information_requests = [{ id: 'facility-a', company_id: companyId, customer_id: 'customer-a', status: 'draft', requested_fields: [], customer: { full_name: 'Anläggningskund' } }]
  let html = await render('facility-requests')
  expect(html).not.toContain('href="/admin/customers/customer-a')
  expect(html).not.toContain('href="/admin/customers/intake"')
  permissions.push('customers.read')
  html = await render('facility-requests')
  expect(html).toContain('href="/admin/customers/customer-a"')
  expect(html).not.toContain('?tab=data-requests')
})

function exactFunction(relative: string, name: string, bindings: Record<string, unknown>) {
  const source = fs.readFileSync(path.resolve(relative), 'utf8')
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  if (!node) throw new Error(`Function not found: ${name}`)
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loadedModule = { exports: {} as Record<string, (...args: never[]) => Promise<unknown>> }
  vm.runInNewContext(code, { ...bindings, module: loadedModule, exports: loadedModule.exports, Date, Error }, { filename: relative })
  return loadedModule.exports[name]
}

// Execute both real functions across an inert update boundary. In particular,
// do not emulate the new omission policy in the test database.
function partnerMutation() {
  let saved: Row = { id: 'export-a', company_id: companyId, customer_id: 'customer-a', status: 'failed', failure_reason: 'RAW-FAILURE-MARKER' }
  const writes: Row[] = []
  const dataUpdate = exactFunction('lib/cis/db-data.ts', 'updatePartnerExportStatus', {
    supabaseService: { from: (table: string) => {
      expect(table).toBe('partner_exports')
      const q = {
        update(payload: Row) { writes.push(payload); saved = { ...saved, ...payload }; return q },
        eq(key: string, value: string) { expect([key, value]).toEqual(['id', 'export-a']); return q },
        select() { return q },
        single: async () => ({ data: saved, error: null }),
      }
      return q
    } },
  })
  let authorized = true
  const action = exactFunction('app/admin/cis/actions.ts', 'updatePartnerExportStatusAction', {
    requireAdminActionAccess: async (requirement: string[]) => { expect(requirement).toEqual(['partner_exports.write']); if (!authorized) throw new Error('Forbidden'); return context() },
    getActor: async () => ({ id: 'staff-a' }),
    formValue: (form: FormData, key: string) => String(form.get(key) ?? '').trim() || null,
    assertEntityCompanyAccess: async () => companyId,
    updatePartnerExportStatus: dataUpdate,
    insertAuditLog: async () => {}, syncCustomerOperationsAfterCisChange: async () => {}, revalidatePath: () => {},
  })
  const form = (reason?: string) => {
    const value = new FormData()
    value.set('export_id', 'export-a'); value.set('customer_id', 'customer-a'); value.set('status', 'acknowledged')
    if (reason !== undefined) value.set('failure_reason', reason)
    return value
  }
  return { writes, saved: () => saved, action: (reason?: string) => action(form(reason) as never), dataUpdate,
    deny: () => { authorized = false } }
}

it('preserves an untouched partner failure reason atomically when the form omits it', async () => {
  const mutation = partnerMutation()
  await mutation.action()
  expect(mutation.saved().failure_reason).toBe('RAW-FAILURE-MARKER')
  expect(mutation.writes[0]).not.toHaveProperty('failure_reason')
})
it.each([['', null], ['Ny kontrollerad orsak', 'Ny kontrollerad orsak']])('keeps explicit partner reason update %j', async (input, expected) => {
  const mutation = partnerMutation()
  await mutation.action(input ?? '')
  expect(mutation.saved().failure_reason).toBe(expected)
})
it('retains the old helper default for callers that do not request preservation', async () => {
  const mutation = partnerMutation()
  await mutation.dataUpdate({ actorUserId: 'staff-a', exportId: 'export-a', status: 'acknowledged' } as never)
  expect(mutation.writes[0]).toHaveProperty('failure_reason', null)
})
it('does not update any partner export when the existing action guard denies it', async () => {
  const mutation = partnerMutation(); mutation.deny()
  await expect(mutation.action()).rejects.toThrow('Forbidden')
  expect(mutation.writes).toEqual([])
})
it('does not send raw partner diagnostics to a company writer, while retaining the platform reason editor', async () => {
  permissions = ['partner_exports.read', 'partner_exports.write']
  records.exports[0].failure_reason = 'RAW-FAILURE-MARKER'
  let html = await render('partner-exports')
  expect(html).not.toContain('RAW-FAILURE-MARKER')
  expect(html).not.toContain('name="failure_reason"')
  platform = true
  html = await render('partner-exports')
  expect(html).toContain('RAW-FAILURE-MARKER')
  expect(html).toContain('name="failure_reason"')
})

it('keeps outbound company rendering in business language and excludes stored diagnostics even for a writer', async () => {
  permissions = ['metering.read', 'metering.write', 'customers.read']
  records.outbound = [{ id: 'outbound-a', company_id: companyId, customer_id: 'customer-a', status: 'failed', request_type: 'meter_values', channel_type: 'unresolved', attempts_count: 3, site_id: 'RAW-SITE-MARKER', metering_point_id: 'RAW-METER-MARKER', communication_route_id: 'RAW-ROUTE-MARKER', failure_reason: 'RAW-FAILURE-MARKER', dispatch_batch_key: 'RAW-BATCH-MARKER', period_start: '2026-10-01', period_end: '2026-10-31' }]
  const html = await render('outbound')
  expect(html).toContain('Mätvärden')
  expect(html).toContain('Kräver åtgärd')
  expect(html).toContain('2026-10-01')
  expect(html).toContain('href="/admin/customers/customer-a"')
  expect(html).not.toContain('RAW-')
  const visibleText = html.replace(/<[^>]*>/g, '')
  for (const raw of ['dispatch', 'route', 'sweep', 'Outbound', 'unresolved', 'meter_values']) expect(visibleText).not.toContain(raw)
  expect(html).not.toContain('name="failure_reason"')
})
it('retains the outbound platform diagnostics and its permitted technical status editor', async () => {
  platform = true
  records.outbound = [{ id: 'outbound-a', company_id: companyId, customer_id: 'customer-a', status: 'failed', request_type: 'meter_values', channel_type: 'unresolved', attempts_count: 3, failure_reason: 'RAW-FAILURE-MARKER', dispatch_batch_key: 'RAW-BATCH-MARKER' }]
  const html = await render('outbound')
  expect(html).toContain('RAW-FAILURE-MARKER')
  expect(html).toContain('RAW-BATCH-MARKER')
  expect(html).toContain('Uppdatera dispatch-status')
})
it('does not offer an outbound customer link or reveal customer names without the target read policy', async () => {
  permissions = ['metering.read']
  records.outbound = [{ id: 'outbound-a', company_id: companyId, customer_id: 'customer-a', status: 'acknowledged', request_type: 'meter_values', channel_type: 'ediel_partner', attempts_count: 1 }]
  const html = await render('outbound')
  expect(html).not.toContain('href="/admin/customers/customer-a"')
  expect(html).not.toContain('Syntetisk kund')
  expect(html).toContain('Kvitterad')
  expect(html).not.toContain('Ärendet är avslutat')
})
it('retains all transport states with a compact, guarded company action disclosure', async () => {
  permissions = ['metering.read', 'metering.write', 'customers.read']
  records.outbound = ['queued', 'prepared', 'sent', 'acknowledged', 'failed', 'cancelled', 'future_unknown'].map((status, i) => ({ id: `outbound-${i}`, company_id: companyId, customer_id: 'customer-a', status, request_type: 'meter_values', channel_type: 'unresolved', attempts_count: 3, failure_reason: 'RAW-FAILURE-MARKER', communication_route_id: 'RAW-ROUTE-MARKER', source_id: null, dispatch_batch_key: 'RAW-BATCH-MARKER', period_start: '2026-10-01', period_end: '2026-10-31', external_reference: 'Extern kundreferens '+ 'lång'.repeat(100) }))
  const writer = await render('outbound')
  expect(writer.match(/<article /g)).toHaveLength(7)
  expect(writer.match(/<summary/g)).toHaveLength(3)
  expect(writer).toContain('Status behöver kontrolleras')
  expect(writer).not.toContain('RAW-')
  permissions = ['metering.read', 'customers.read']
  const reader = await render('outbound')
  expect(reader.match(/<article /g)).toHaveLength(7)
  expect(reader).not.toContain('name="dispatch_step"')
  records.outbound = []
  const empty = await render('outbound')
  expect(empty).toContain('Inga utskick matchar urvalet.')
  if (process.env.GRIDEX_ACTION_FIXTURE_DIR) {
    for (const [name, html] of Object.entries({ writer, reader, empty })) fs.writeFileSync(path.join(process.env.GRIDEX_ACTION_FIXTURE_DIR, `outbound-${name}.html`), html)
  }
})
