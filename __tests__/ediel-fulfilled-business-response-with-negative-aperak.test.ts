import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import ProcessWatchesPage from '@/app/admin/ediel/process-watches/page'
import { readEdielProcessNextActions, type EdielProcessActionVisibility } from '@/lib/ediel/operations/processNextAction'
import type { EdielBusinessExpectation } from '@/lib/ediel/businessExpectations'

const ports = vi.hoisted(() => ({ rpc: vi.fn(), tenantDb: vi.fn(), readSources: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: ports.tenantDb }))

const sourceId = '11111111-1111-4111-8111-111111111111'
const companyId = 'scoped-company'
const base = {
  companyId,
  environment: 'test',
  actorUserId: 'authorized-current-actor',
  messageIds: [sourceId],
  evaluatedAt: '2026-11-10T23:01:00Z',
  access: { canRead: true, canReview: true, canPrepare: true },
} as const

vi.mock('@/lib/admin/guards', () => ({ requireAdminPageAccess: async () => ({
  userId: base.actorUserId, companyId, email: 'operator@example.invalid', permissions: ['communication.read', 'cases.write'],
}) }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({
  companyId, memberships: [{ companyId, status: 'active', companyStatus: 'active' }],
}) }))
vi.mock('@/components/admin/AdminHeader', () => ({
  default: ({ title }: { title: string }) => React.createElement('header', null, title),
}))

beforeEach(() => {
  vi.resetAllMocks()
  ports.tenantDb.mockReturnValue({ from: () => ({ select: () => ({ in: ports.readSources }) }) })
})

const witnesses = [
  { messageCode: 'Z13', expectedCode: 'Z14', owner: 'gridex_ediel_business_expectations_v1', metadata: {
    anchorType: 'actual_accepted_smtp_observed_at', anchorAt: '2026-10-01T12:00:00Z', remoteReceiptKnown: false,
    timerKind: 'internal_sender_watch',
  } },
  { messageCode: 'Z09', expectedCode: 'Z06', owner: 'gridex_ediel_metering_method_expectations_v1', metadata: {
    timerRuleId: 'TM-METHOD40', timerKind: 'source_validity_day_watch', anchorType: 'z09_validity_day',
    validityDay: '2026-10-01', dueDay: '2026-11-10', actualAcceptedAt: '2026-10-01T12:00:00Z',
    remoteReceiptKnown: false, automaticResendAllowed: false, authorizesMarketEffects: false,
    observationCriterion: 'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day',
  } },
] as const

type Case = typeof witnesses[number]

function fixture(current: Case, status: EdielBusinessExpectation['status'], application: string,
  technical = 'received', company = companyId) {
  const row = {
    id: 'actual-own-observation', source_message_id: sourceId, expected_code: current.expectedCode, status,
    due_at: '2026-11-10T23:00:00Z', metadata: current.metadata,
  }
  ports.rpc.mockImplementation(async (name: string) => ({ error: null, data: current.owner === name ? [row] : [] }))
  ports.readSources.mockResolvedValue({ error: null, data: [{
    id: sourceId, company_id: company, environment: 'test', direction: 'outbound', message_family: 'PRODAT',
    message_code: current.messageCode, status: 'sent', requires_contrl: true, contrl_status: technical,
    contrl_due_at: '2026-11-10T23:00:00Z', requires_aperak: true, aperak_status: application,
  }] })
}

async function decision(access: EdielProcessActionVisibility = base.access, evaluatedAt: string = base.evaluatedAt) {
  return (await readEdielProcessNextActions({ ...base, access, evaluatedAt })).get(sourceId)
}

it.each(witnesses)('$expectedCode remains received when a late negative APERAK arrives', async current => {
  fixture(current, 'fulfilled', 'received')
  expect(await decision()).toMatchObject({ cause: 'business_response_received', waitingFor: [], blockers: [] })
  fixture(current, 'fulfilled', 'failed')
  expect(await decision()).toMatchObject({
    cause: 'business_response_received', responsibility: 'tenant_operator', waitingFor: [],
    blockers: ['application_response_rejected'], allowedActions: ['read_source', 'review_case'],
    authorizesProviderEntry: false, automaticResendAllowed: false,
  })
})

it.each(witnesses)('$expectedCode closes the business wait although negative APERAK arrived first', async current => {
  fixture(current, 'pending', 'failed')
  expect(await decision()).toMatchObject({
    cause: 'technical_rejection', waitingFor: [current.expectedCode], blockers: ['application_response_rejected'],
  })
  fixture(current, 'fulfilled', 'failed', 'pending')
  expect(await decision()).toMatchObject({
    cause: 'business_response_received', waitingFor: ['CONTRL'],
    blockers: ['application_response_rejected', 'technical_sender_watch_overdue'],
  })
})

it.each(witnesses)('$expectedCode real negative business response and no provider authority remain', async current => {
  fixture(current, 'rejected', 'received')
  expect(await decision()).toMatchObject({
    cause: 'business_response_rejected', waitingFor: [], blockers: ['business_response_rejected'],
    allowedActions: ['read_source', 'review_case'], authorizesProviderEntry: false, automaticResendAllowed: false,
  })
})

it('keeps the selected source bound to its actual tenant', async () => {
  fixture(witnesses[0], 'fulfilled', 'failed', 'received', 'foreign')
  await expect(decision()).rejects.toThrow('ediel_process_projection_exact_source_required')
})

it.each(witnesses)('$expectedCode stays received across its watch deadline and after a current ACK is accepted', async current => {
  fixture(current, 'fulfilled', 'failed')
  const status = await Promise.all(['22:59:59.999', '23:00:00.000', '23:00:00.001'].map(time =>
    decision({ ...base.access, canReview: false }, `2026-11-10T${time}Z`),
  ))
  expect(status.map(result => ({ cause: result?.cause, waitingFor: result?.waitingFor, allowedActions: result?.allowedActions }))).toEqual(
    Array.from({ length: 3 }, () => ({ cause: 'business_response_received', waitingFor: [], allowedActions: ['read_source'] })),
  )
  fixture(current, 'fulfilled', 'received')
  expect(await decision()).toMatchObject({
    cause: 'business_response_received', waitingFor: [], blockers: [], allowedActions: ['read_source'],
  })
})

it.each(witnesses)('$expectedCode process-watch page shows the received response and separate operator follow-up', async current => {
  fixture(current, 'fulfilled', 'failed')
  const html = renderToStaticMarkup(await ProcessWatchesPage({
    searchParams: Promise.resolve({ environment: 'test', sourceId }),
  }))
  expect(html).toContain(`${current.expectedCode}-svaret`)
  expect(html).toContain('Granska den separata negativa APERAK-kvittensen')
  expect(html).toContain('Granska ärendet')
  expect(html).toContain('Inget automatiskt externt steg')
  expect(html).not.toContain(`<dd>${current.expectedCode}</dd>`)
})
