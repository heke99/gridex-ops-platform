import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'
import type { CustomerOpsReadiness } from '@/lib/opsMaster/readiness'

const actorPort = vi.hoisted(() => ({ enabled: false, companyStatus: 'active', reads: [] as Array<{ path: string; query: string; body: unknown }> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      if (!actorPort.enabled) throw new Error('No database read is authorized in the synchronous POA composition')
      const url = new URL(input instanceof Request ? input.url : String(input))
      const body = init?.body ? JSON.parse(String(init.body)) : null
      actorPort.reads.push({ path: url.pathname, query: url.searchParams.toString(), body })
      if (url.pathname.endsWith('/rpc/gridex_get_user_roles') && init?.method === 'POST') {
        if (body?.p_user_id !== actor) throw new Error('Foreign actor is not qualified')
        return new Response(JSON.stringify(['platform_admin']), { headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.endsWith('/companies') && (!init?.method || init.method === 'GET')
        && url.searchParams.get('id') === `eq.${company}`) {
        return new Response(JSON.stringify({ id: company, status: actorPort.companyStatus }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected actor read or write: ${url.pathname}`)
    } },
  }) }
})
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/customers/[id]/business-actions', () => ({ dryRunZ01RepairAction: async () => {}, repairZ01CustomerInfoRequestAction: async () => {} }))
vi.mock('@/app/admin/customers/[id]/actions', () => ({ createCustomerDataRequestPackageAction: async () => {}, registerCurrentSupplierResponseAction: async () => {} }))
vi.mock('@/components/admin/customers/CustomerOperationAutomationForm', () => ({ default: ({ kind, siteId }: { kind: string; siteId: string }) => React.createElement('form', { 'data-operation': kind, 'data-site': siteId }) }))

import { buildCustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import { hasExternallySendablePoa, hasLegalPoaAcceptance } from '@/lib/customers/poaReadiness'
import { buildCustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import { buildCustomerBusinessActionPlan } from '@/lib/customer-operations/customerBusinessActions'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { manualPoaIsCurrentlyValid, poaScopeAllows } from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { buildSitePoaReadiness, buildCustomerCardSitePoaReadiness, type SitePoaReadContext } from '@/lib/customers/sitePoaReadiness.server'
import BusinessCard from '@/components/admin/customers/CustomerBusinessActionsCard'
import LegalCard from '@/components/admin/customers/CustomerLegalReadinessCard'
import FacilityCard from '@/components/admin/customers/CustomerFacilityWorkflowCard'
import DataRequestsCard from '@/components/admin/customers/CustomerDataRequestsCard'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { readResult } from '@/lib/read-models/readResult'

type Row = Record<string, unknown>
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), actor = uuid(3), siteA = uuid(4), siteB = uuid(5)
const NOW = new Date('2026-10-14T10:00:00.000Z')
function site(id = siteA): CustomerSiteRow {
  return { id, company_id: company, customer_id: customer, status: 'active', site_name: id === siteA ? 'Anläggning A' : 'Anläggning B', facility_id: '735999000000000001', grid_owner_id: uuid(7), grid_area_code: 'TEST', price_area_code: 'SE3', move_in_date: '2026-10-01', current_supplier_name: 'Testleverantör', street: 'Testvägen 1', postal_code: '11122', city: 'Teststad' } as CustomerSiteRow
}
function point(id = siteA): MeteringPointRow {
  return { id: uuid(id === siteA ? 8 : 9), company_id: company, customer_id: customer, site_id: id, status: 'active', meter_point_id: '735999000000000001', grid_owner_id: uuid(7), grid_area_code: 'TEST', price_area_code: 'SE3' } as MeteringPointRow
}
function poa(extra: Row = {}): PowerOfAttorneyRow {
  return { id: uuid(10), company_id: company, customer_id: customer, site_id: siteA, customer_site_id: null, scope: 'supplier_switch', scope_summary: {}, status: 'signed', accepted_at: '2026-10-01T10:00:00Z', signed_at: '2026-10-01T10:00:00Z', legal_text_version_id: null, valid_from: '2026-10-01', valid_to: null, valid_until: null, expires_at: null, revoked_at: null, signer_name: 'Testperson', signer_identity_number: '200001010000', method: 'admin_recorded', document_id: uuid(11), document_path: 'synthetic/poa.pdf', fullmakt_snapshot: {}, evidence_payload: {}, source: 'admin_upload', created_at: '2026-10-01T10:00:00Z', reference: null, notes: null, updated_at: '2026-10-01T10:00:00Z', created_by: null, updated_by: null, ...extra } as PowerOfAttorneyRow
}
function context(extra: Partial<SitePoaReadContext> = {}): SitePoaReadContext {
  return { companyId: company, customerId: customer, asOf: NOW.toISOString(), parentCoverage: 'unknown', actor: { id: actor, companyId: company, isPlatformAdmin: false, canOperate: true }, ...extra }
}
function decisions(rows: PowerOfAttorneyRow[], readContext = context()) {
  const input = { site: site(), meteringPoint: point(), powersOfAttorney: rows as unknown as Row[], context: readContext }
  return { facility: buildSitePoaReadiness({ ...input, scope: 'facility_information_lookup' }), supplierSwitch: buildSitePoaReadiness({ ...input, scope: 'supplier_switch' }) }
}
function snapshot(rows: PowerOfAttorneyRow[], readContext = context()) {
  const sites = [site(), site(siteB)], meteringPoints = [point(), point(siteB)]
  return buildCustomerCardSnapshot({ sites, meteringPoints, powersOfAttorney: rows, asOf: readContext.asOf,
    poaReadinessBySiteId: buildCustomerCardSitePoaReadiness({ sites, meteringPoints, powersOfAttorney: rows as unknown as Row[], context: readContext }) })
}
function workflow(rows: PowerOfAttorneyRow[]) {
  const snap = snapshot(rows)
  return { snap, workflow: buildCustomerCardWorkflow({ customerId: customer, snapshot: snap, sites: [site(), site(siteB)], meteringPoints: [point(), point(siteB)], powersOfAttorney: rows, contracts: [], infoRequests: [], switchRequests: [], isPlatformAdmin: false }) }
}
function businessHtml(rows: PowerOfAttorneyRow[]): string {
  return renderToStaticMarkup(React.createElement(BusinessCard, { customerId: customer, companyId: company, sites: [site(), site(siteB)], meteringPoints: [point(), point(siteB)], powersOfAttorney: rows, snapshot: snapshot(rows) }))
}
const oldAggregate = { canStartSupplierSwitch: true, canRequestFacilityData: true, canSendMail: true, hasTerms: true, hasPrivacy: true, hasWithdrawal: true, hasPriceSnapshot: true, hasPowerOfAttorneyAcceptance: true, hasActivePowerOfAttorney: true, hasContractSnapshot: true, hasFacility: true, hasMeteringPoint: true, hasGridOwner: true, hasGridArea: true, hasEdielRoute: true, hasCommunicationLogs: false, blockers: [], siteReadiness: [], nextAction: { label: 'Begär uppgifter', hrefTab: 'data-requests', description: '' } } as CustomerOpsReadiness
function legalHtml(rows: PowerOfAttorneyRow[]): string {
  return renderToStaticMarkup(React.createElement(LegalCard, { customerId: customer, readiness: oldAggregate, acceptances: [], documents: [], timeline: [], powersOfAttorney: rows as unknown as Row[], snapshot: snapshot(rows) }))
}
beforeEach(() => { vi.stubGlobal('React', React); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); actorPort.enabled = false; actorPort.companyStatus = 'active'; actorPort.reads = [] })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('actual customer-card site and lifetime counterexamples', () => {
  it('does not offer an A request from only B power of attorney', () => {
    const rows = [poa({ site_id: siteB })]
    const { snap, workflow: state } = workflow(rows)
    expect(snap.primarySite?.id).toBe(siteA)
    expect(state.primaryAction).toBe('review_blocker')
    const actions = buildCustomerBusinessActionPlan({ workflow: state, snapshot: snap })
    expect(actions.some(action => action.kind === 'customer_data' && action.status === 'available')).toBe(false)
    expect(businessHtml(rows)).not.toContain('data-operation="customer_data"')
  })
  it.each([
    ['expired', { valid_to: '2026-10-01' }],
    ['revoked marker', { revoked_at: '2026-10-13T10:00:00Z' }],
    ['replacement marker', { replaced_by_id: uuid(12) }],
    ['future validity', { valid_from: '2026-11-01' }],
  ])('keeps complete historical evidence without offering current external use: %s', (_name, changes) => {
    const row = poa(changes)
    expect(hasLegalPoaAcceptance(row as unknown as Row)).toBe(true)
    expect(hasExternallySendablePoa(row as unknown as Row)).toBe(true)
    expect(manualPoaIsCurrentlyValid(row as unknown as Row, NOW)).toBe(false)
    expect(businessHtml([row])).not.toContain('data-operation="customer_data"')
    const state = legalHtml([row]).match(/Fullmakt för anläggningsuppgifter<\/p><p[^>]*>(.*?)<\/p>/)
    expect(state).not.toBeNull()
    expect(state![1]).not.toBe('Ja')
  })
  it('does not treat signer/document evidence without legal acceptance as approval', () => {
    const row = poa({ signed_at: null, accepted_at: null, legal_text_version_id: null, evidence_payload: {}, fullmakt_snapshot: {} })
    expect(hasLegalPoaAcceptance(row as unknown as Row)).toBe(false)
    expect(businessHtml([row])).not.toContain('data-operation="customer_data"')
  })
  it.each([
    ['revoked_at', { revoked_at: '2026-10-13T10:00:00Z' }],
    ['replaced_by_id', { replaced_by_id: uuid(12) }],
  ])('the actual switch prerequisite rejects signed rows with %s', (_name, changes) => {
    const result = evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point()], powersOfAttorney: [poa(changes)], now: NOW })
    expect(result.isReady).toBe(false)
    expect(result.issues.map(issue => issue.code)).toContain('power_of_attorney_not_signed')
  })
  it('keeps valid_to usable through the same Swedish last day as the actual manual guard', () => {
    const row = poa({ valid_to: '2026-10-14' })
    expect(manualPoaIsCurrentlyValid(row as unknown as Row, NOW)).toBe(true)
    expect(evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point()], powersOfAttorney: [row], now: NOW }).isReady).toBe(true)
  })
  it('keeps the actual switch prerequisite aligned with a past expires_at send guard', () => {
    const row = poa({ expires_at: '2026-10-13T10:00:00Z' })
    expect(manualPoaIsCurrentlyValid(row as unknown as Row, NOW)).toBe(false)
    expect(evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point()], powersOfAttorney: [row], now: NOW }).isReady).toBe(false)
  })
  it('does not use a B point when evaluating A even if the caller supplied both sites', () => {
    const result = evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point(siteB)], powersOfAttorney: [poa()], now: NOW })
    expect(result.candidateMeteringPointId).toBeNull()
    expect(result.isReady).toBe(false)
  })
  it('keeps the actual exact-site/scope manual policy as a control', () => {
    const row = poa()
    expect(manualPoaIsCurrentlyValid(row as unknown as Row, NOW)).toBe(true)
    expect(poaScopeAllows(row as unknown as Row, 'facility_information_lookup')).toBe(true)
    expect(poaScopeAllows(poa({ scope: 'meter_data', scope_summary: { facility_information_lookup: false } }) as unknown as Row, 'facility_information_lookup')).toBe(false)
  })
})

describe('actual additional site consumers', () => {
  function facilityMarkup(rows: PowerOfAttorneyRow[]): string {
    return renderToStaticMarkup(React.createElement(FacilityCard, { customerId: customer, sites: [site(), site(siteB)], meteringPoints: [point(), point(siteB)], powersOfAttorney: rows, gridOwners: [], infoRequests: [], snapshot: snapshot(rows) }))
  }
  function dataMarkup(rows: PowerOfAttorneyRow[]): string {
    return renderToStaticMarkup(React.createElement(DataRequestsCard, { customerId: customer, sites: [site(), site(siteB)], meteringPoints: [point(), point(siteB)], powersOfAttorney: rows, gridOwners: [], infoRequests: [], documents: [], snapshot: snapshot(rows), isPlatformAdmin: true }))
  }
  it.each([{ extra: [] }, { extra: [poa({ id: uuid(12), site_id: siteB, valid_to: '2026-10-01' })] }])('does not lend an A mandate to the displayed B site: %#', ({ extra }) => {
    const rows = [poa(), ...extra]
    const markup = facilityMarkup(rows)
    const sectionB = markup.slice(markup.indexOf('Anläggning B'))
    expect(sectionB).not.toContain('Starta leverantörsbyte')
    expect(sectionB).toContain('Kontrollera fullmakt')
  })
  it.each([
    { row: poa({ site_id: siteB }) },
    { row: poa({ valid_to: '2026-10-01' }) },
  ])('the platform primary form does not bypass unknown/mismatched current-site POA: %#', ({ row }) => {
    expect(dataMarkup([row])).not.toContain('data-operation="customer_data"')
  })
  it('keeps the platform primary A form for a qualified A mandate', () => {
    const markup = dataMarkup([poa()])
    expect(markup).toContain('data-operation="customer_data"')
    expect(markup).toContain(`data-site="${siteA}"`)
  })
  it('preserves both independently qualified site indicators instead of reusing only the primary result', () => {
    const markup = facilityMarkup([poa(), poa({ id: uuid(12), site_id: siteB })])
    expect(markup.match(/Starta leverantörsbyte/g)).toHaveLength(2)
  })
})

describe('qualified server POA facts and current UI composition', () => {
  it.each(['unknown', 'partial'] as const)('preserves a positive exact-site row with %s parent coverage and keeps the real A action target', parentCoverage => {
    const row = poa()
    const snap = snapshot([row], context({ parentCoverage }))
    expect(snap.poaReadiness?.facility).toMatchObject({ kind: 'ready', usableNow: true, companyId: company, customerId: customer, siteId: siteA, actorId: actor, asOf: NOW.toISOString(), powerOfAttorneyId: uuid(10), parentCoverage })
    const markup = businessHtml([row])
    expect(markup).toContain('data-operation="customer_data"')
    expect(markup).toContain(`data-site="${siteA}"`)
    expect(legalHtml([row])).toMatch(/Fullmakt för anläggningsuppgifter<\/p><p[^>]*>Ja<\/p>/)
  })
  it.each([{ rows: [] }, { rows: [poa({ site_id: siteB })] }, { rows: [poa({ site_id: null, customer_site_id: null })] }])('does not infer absence or all-site authority from a bounded unmatched parent list: %#', ({ rows }) => {
    expect(decisions(rows).facility).toMatchObject({ kind: 'unknown', usableNow: null, powerOfAttorneyId: null })
    expect(businessHtml(rows)).not.toContain('data-operation="customer_data"')
  })
  it('preserves legal acceptance and evidence independently when actor qualification is missing', () => {
    const readContext = context({ actor: { id: '', companyId: company, isPlatformAdmin: false, canOperate: true } })
    expect(decisions([poa()], readContext).facility).toMatchObject({ kind: 'unknown', usableNow: null, legallyAccepted: true, evidenceComplete: true })
  })
  it('does not turn an actor refusal into a claim that fullmakt is absent from a partial parent list', () => {
    const snap = snapshot([], context({ actor: { id: actor, companyId: company, isPlatformAdmin: false, canOperate: false } }))
    const markup = renderToStaticMarkup(React.createElement(LegalCard, { customerId: customer, readiness: oldAggregate, acceptances: [], documents: [], timeline: [], snapshot: snap }))
    expect(markup).toContain('Godkännande av fullmakt: behöver kontrolleras')
    expect(markup).not.toContain('Godkännande av fullmakt: saknas')
  })
  it('holds a foreign actor company and refuses an explicit lack of action permission', () => {
    expect(decisions([poa()], context({ actor: { id: actor, companyId: uuid(20), isPlatformAdmin: false, canOperate: true } })).facility.usableNow).toBeNull()
    expect(decisions([poa()], context({ actor: { id: actor, companyId: company, isPlatformAdmin: false, canOperate: false } })).facility).toMatchObject({ kind: 'blocked', usableNow: false })
    expect(decisions([poa()], context({ actor: { id: actor, companyId: company, isPlatformAdmin: false, canOperate: null } })).facility).toMatchObject({ kind: 'unknown', usableNow: null })
  })
  it('does not borrow an unrelated tenant/customer row or a foreign point', () => {
    for (const changes of [{ company_id: uuid(20) }, { customer_id: uuid(21) }]) expect(decisions([poa(changes)]).facility.usableNow).toBeNull()
    expect(buildSitePoaReadiness({ site: site(), meteringPoint: point(siteB), powersOfAttorney: [poa() as unknown as Row], scope: 'facility_information_lookup', context: context() }).usableNow).toBeNull()
  })
  it.each(['revoked_at', 'expires_at', 'valid_from', 'signed_at', 'accepted_at', 'legal_text_version_id'])('holds an omitted %s fact instead of assuming a null value', field => {
    const row = poa() as unknown as Row; delete row[field]
    expect(decisions([row as unknown as PowerOfAttorneyRow]).facility.usableNow).toBeNull()
  })
  it('holds malformed validity dates instead of treating them as an unbounded mandate', () => {
    expect(decisions([poa({ valid_from: 'not-a-date' })]).facility.usableNow).toBeNull()
  })
  it('holds conflicting explicit site identifiers rather than guessing an alias', () => {
    expect(decisions([poa({ site_id: siteA, customer_site_id: siteB })]).facility.usableNow).toBeNull()
  })
  it('retains the old evidence meaning for a past expiry without rendering a current action', () => {
    const row = poa({ expires_at: '2026-10-13T10:00:00Z' })
    expect(hasExternallySendablePoa(row as unknown as Row)).toBe(true)
    expect(decisions([row]).facility).toMatchObject({ legallyAccepted: true, evidenceComplete: true, usableNow: null, kind: 'unknown' })
    expect(businessHtml([row])).not.toContain('data-operation="customer_data"')
  })
  it('uses accepted/active manual scope only where the real operation allows it', () => {
    for (const status of ['accepted', 'active']) {
      const result = decisions([poa({ status })])
      expect(result.facility.usableNow).toBe(true)
      expect(result.supplierSwitch.usableNow).not.toBe(true)
    }
  })
  it('does not turn the manual all-scope rule into a supplier-switch capability', () => {
    const row = poa({ scope: 'all' })
    expect(poaScopeAllows(row as unknown as Row, 'facility_information_lookup')).toBe(true)
    expect(decisions([row]).facility.usableNow).toBe(true)
    expect(evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point()], powersOfAttorney: [row], now: NOW }).isReady).toBe(false)
    expect(decisions([row]).supplierSwitch.usableNow).not.toBe(true)
  })
  it('follows the actual newest-exact-site switch prerequisite instead of selecting an older mandate', () => {
    const rows = [poa({ id: uuid(12), revoked_at: '2026-10-13T10:00:00Z', created_at: '2026-10-13T10:00:00Z' }), poa()]
    expect(evaluateSiteSwitchReadiness({ site: site(), meteringPoints: [point()], powersOfAttorney: rows, now: NOW }).isReady).toBe(false)
    expect(decisions(rows).supplierSwitch.usableNow).not.toBe(true)
    expect(decisions(rows).facility.usableNow).toBe(true)
  })
  it('keeps legal acceptance when an incomplete website capture is not externally sendable', () => {
    const row = poa({ source: 'website_api', evidence_payload: { capture_type: 'legacy_consent_only' } })
    expect(decisions([row]).facility).toMatchObject({ legallyAccepted: true, evidenceComplete: false })
    expect(decisions([row]).facility.usableNow).not.toBe(true)
  })
  it('rejects a supplied decision from another target or evaluation time in the pure snapshot', () => {
    for (const fact of [decisions([poa()], context({ asOf: '2026-10-13T10:00:00Z' })), {
      ...decisions([poa()]), facility: { ...decisions([poa()]).facility, siteId: siteB },
    }]) {
      const snap = buildCustomerCardSnapshot({ sites: [site()], meteringPoints: [point()], powersOfAttorney: [poa()], asOf: NOW.toISOString(), poaReadiness: fact })
      expect(snap.poaReadiness?.facility.usableNow).toBeNull()
    }
  })
  it('preserves recorded response progress while holding an unqualified actual switch form', () => {
    const infoRequests = [{ id: uuid(30), status: 'z02_received', verified_payload: {} }] as unknown as import('@/lib/onboarding/infoRequests').CustomerInfoRequestRow[]
    for (const allowed of [true, false]) {
      const rows = [poa()]
      const snap = snapshot(rows, context({ actor: { id: actor, companyId: company, isPlatformAdmin: false, canOperate: allowed } }))
      const state = buildCustomerCardWorkflow({ customerId: customer, snapshot: snap, sites: [site()], meteringPoints: [point()], powersOfAttorney: rows, contracts: [], infoRequests, switchRequests: [], isPlatformAdmin: false })
      expect(state.primaryAction).toBe('create_supplier_switch')
      const markup = renderToStaticMarkup(React.createElement(BusinessCard, { customerId: customer, companyId: company, sites: [site()], meteringPoints: [point()], powersOfAttorney: rows, infoRequests, snapshot: snap }))
      expect(markup.includes('data-operation="supplier_switch"')).toBe(allowed)
    }
  })
})

describe('actual SDK actor-company eligibility consumed by the POA caller', () => {
  it.each(['active', 'paused'])('qualifies platform actor for the actual %s company before offering a form', async status => {
    actorPort.enabled = true; actorPort.companyStatus = status
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await readResult(() => assertUserCanOperateCompany(actor, company), {
      definitionVersion: 'customer_card_poa_actor_v1', errorCode: 'POA_ACTOR_UNAVAILABLE',
    })
    const canOperate = result.kind !== 'unavailable' && result.data === company ? true : null
    expect(canOperate).toBe(status === 'active' ? true : null)
    const rows = [poa()]
    const snap = snapshot(rows, context({ actor: { id: actor, companyId: company, isPlatformAdmin: true, canOperate } }))
    const markup = renderToStaticMarkup(React.createElement(BusinessCard, { customerId: customer, companyId: company, sites: [site()], meteringPoints: [point()], powersOfAttorney: rows, snapshot: snap, isPlatformAdmin: true }))
    expect(markup.includes('data-operation="customer_data"')).toBe(status === 'active')
    expect(actorPort.reads.map(read => read.path)).toEqual(['/rest/v1/rpc/gridex_get_user_roles', '/rest/v1/companies'])
    expect(actorPort.reads[0].body).toEqual({ p_user_id: actor })
    expect(new URLSearchParams(actorPort.reads[1].query).get('id')).toBe(`eq.${company}`)
    expect(markup).not.toContain('Bolaget är pausat eller inte operativt')
  })
})
