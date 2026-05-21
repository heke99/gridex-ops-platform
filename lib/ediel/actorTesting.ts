import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'
import type { EdielTestRunStatus, EdielTestSuite } from '@/lib/ediel/types'

export type ActorTestStatus = 'not_started' | 'running' | 'passed' | 'failed' | 'blocked' | 'manual_verified'
export type ActorTestPackageKey = 'PRODAT_SUPPLIER' | 'UTILTS_METERING'
export type ActorTestDirection = 'actor_to_portal' | 'portal_to_actor'
export type ActorTestingScope = 'platform' | 'whitelabel' | 'company'

export type ActorTestCaseDefinition = {
  key: string
  packageKey: ActorTestPackageKey
  packageLabel: string
  label: string
  testId: string | null
  suite: EdielTestSuite
  messageFamily: 'PRODAT' | 'UTILTS'
  messageCode: string
  direction: ActorTestDirection
  required: boolean
  description: string
}

export type ActorTestResultRow = {
  id: string
  company_id: string
  test_key: string
  test_name: string | null
  test_id: string | null
  package_key: ActorTestPackageKey | string | null
  message_family: string | null
  message_code: string | null
  direction: ActorTestDirection | string | null
  status: ActorTestStatus | string | null
  latest_run_at: string | null
  passed_at: string | null
  failure_reason: string | null
  portal_status: string | null
  raw_payload: string | null
  evidence: Record<string, unknown> | null
  ediel_test_run_id: string | null
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  updated_by: string | null
}

export type ActorTestingCompanyRow = {
  id: string
  name: string
  slug: string | null
  org_number: string | null
  status: string | null
  primary_contact_email: string | null
  primary_contact_name: string | null
  support_email: string | null
  billing_contact_email: string | null
  ediel_id: string | null
  actor_role: string | null
  sender_sub_address: string | null
  ediel_mailbox: string | null
  operating_environment: string | null
  white_label_platform_id: string | null
  market_role: string | null
  brp_name: string | null
  brp_ediel_id: string | null
  brp_status: string | null
  esett_status: string | null
  technical_contact_name: string | null
  technical_contact_email: string | null
  production_status: string | null
  live_ediel_enabled: boolean | null
  live_approved_at: string | null
  live_blocked_reason: string | null
  test_ediel_id: string | null
  production_ediel_id: string | null
  test_sender_sub_address: string | null
  production_sender_sub_address: string | null
  test_mailbox: string | null
  production_mailbox: string | null
  test_application_reference: string | null
  production_application_reference: string | null
  test_counterparty_ediel_id: string | null
  production_counterparty_ediel_id: string | null
  created_at: string | null
  updated_at: string | null
}

export type ActorTestingSummary = {
  company: ActorTestingCompanyRow
  results: ActorTestResultRow[]
  prodatPassed: number
  prodatTotal: number
  utiltsPassed: number
  utiltsTotal: number
  totalPassed: number
  totalRequired: number
  blockedTests: number
  latestRunAt: string | null
  hasActiveActorProfile: boolean
  hasTestRoute: boolean
  hasProductionRoute: boolean
  hasVerifiedMailbox: boolean
  missingSetup: string[]
  goLiveBlockers: string[]
  actorTestStatus: 'not_ready' | 'ready_for_tests' | 'in_progress' | 'approved' | 'blocked'
  productionReadiness: 'not_ready' | 'ready' | 'live' | 'blocked'
}

export const ACTOR_TEST_CASES: ActorTestCaseDefinition[] = [
  {
    key: 'L1',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L1 PRODAT Z03',
    testId: '388756',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    direction: 'actor_to_portal',
    required: true,
    description: 'Skapar och skickar leverantörsbyte där aktören är avsändare.',
  },
  {
    key: 'L2',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L2 PRODAT Z04',
    testId: '388764',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z04',
    direction: 'portal_to_actor',
    required: true,
    description: 'Tar emot Z04 från portalen och svarar med korrekt CONTRL/APERAK-kedja.',
  },
  {
    key: 'L3',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L3 PRODAT Z05',
    testId: '388765',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z05',
    direction: 'portal_to_actor',
    required: true,
    description: 'Tar emot Z05 och kopplar svar/kvittenser till tenantens testfall.',
  },
  {
    key: 'L4',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L4 PRODAT Z06',
    testId: '388766',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z06',
    direction: 'portal_to_actor',
    required: true,
    description: 'Tar emot Z06 och sparar beviskedjan per bolag.',
  },
  {
    key: 'L5',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L5 PRODAT Z10',
    testId: '388767',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z10',
    direction: 'portal_to_actor',
    required: true,
    description: 'Tar emot Z10 och validerar negativ/positiv kvittens enligt regelmotor.',
  },
  {
    key: 'L7',
    packageKey: 'PRODAT_SUPPLIER',
    packageLabel: 'Leverantör PRODAT',
    label: 'L7 PRODAT Z09',
    testId: '388809',
    suite: 'PRODAT',
    messageFamily: 'PRODAT',
    messageCode: 'Z09',
    direction: 'actor_to_portal',
    required: true,
    description: 'Skapar och skickar Z09 från aktören med tenantens route och BRP.',
  },
  {
    key: 'UL1',
    packageKey: 'UTILTS_METERING',
    packageLabel: 'UTILTS / mätvärden',
    label: 'UL1 UTILTS S03',
    testId: '388810',
    suite: 'UTILTS',
    messageFamily: 'UTILTS',
    messageCode: 'S03',
    direction: 'portal_to_actor',
    required: true,
    description: 'Hanterar S03-testet och kopplar svar/kvittenser korrekt.',
  },
  {
    key: 'UL2',
    packageKey: 'UTILTS_METERING',
    packageLabel: 'UTILTS / mätvärden',
    label: 'UL2 UTILTS E66-KVART',
    testId: '388811',
    suite: 'UTILTS',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    direction: 'portal_to_actor',
    required: true,
    description: 'Hanterar kvartsvärden med kontroll av period, upplösning, mätpunkt och dedupe.',
  },
  {
    key: 'UL3',
    packageKey: 'UTILTS_METERING',
    packageLabel: 'UTILTS / mätvärden',
    label: 'UL3 UTILTS E66-SCH',
    testId: '388812',
    suite: 'UTILTS',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    direction: 'portal_to_actor',
    required: true,
    description: 'Hanterar SCH-värden separat från kvartsvärden.',
  },
  {
    key: 'UL4',
    packageKey: 'UTILTS_METERING',
    packageLabel: 'UTILTS / mätvärden',
    label: 'UL4 UTILTS S02',
    testId: '388813',
    suite: 'UTILTS',
    messageFamily: 'UTILTS',
    messageCode: 'S02',
    direction: 'portal_to_actor',
    required: true,
    description: 'Hanterar S02 enligt aktörstestpaketet.',
  },
  {
    key: 'UL6',
    packageKey: 'UTILTS_METERING',
    packageLabel: 'UTILTS / mätvärden',
    label: 'UL6 UTILTS E31-SCH',
    testId: null,
    suite: 'UTILTS',
    messageFamily: 'UTILTS',
    messageCode: 'E31',
    direction: 'portal_to_actor',
    required: true,
    description: 'Hanterar E31-SCH med tidigare godkända regler: positivt flöde, negativ APERAK vid anvisningsfel och UTILTS_ERR vid funktionsfel.',
  },
]

const REQUIRED_TEST_CASES = ACTOR_TEST_CASES.filter((testCase) => testCase.required)
const PRODAT_TESTS = ACTOR_TEST_CASES.filter((testCase) => testCase.packageKey === 'PRODAT_SUPPLIER')
const UTILTS_TESTS = ACTOR_TEST_CASES.filter((testCase) => testCase.packageKey === 'UTILTS_METERING')

const COMPANY_SELECT_COLUMNS = [
  'id',
  'name',
  'slug',
  'org_number',
  'status',
  'primary_contact_email',
  'primary_contact_name',
  'support_email',
  'billing_contact_email',
  'ediel_id',
  'actor_role',
  'sender_sub_address',
  'ediel_mailbox',
  'operating_environment',
  'white_label_platform_id',
  'market_role',
  'brp_name',
  'brp_ediel_id',
  'brp_status',
  'esett_status',
  'technical_contact_name',
  'technical_contact_email',
  'production_status',
  'live_ediel_enabled',
  'live_approved_at',
  'live_blocked_reason',
  'test_ediel_id',
  'production_ediel_id',
  'test_sender_sub_address',
  'production_sender_sub_address',
  'test_mailbox',
  'production_mailbox',
  'test_application_reference',
  'production_application_reference',
  'test_counterparty_ediel_id',
  'production_counterparty_ediel_id',
  'created_at',
  'updated_at',
].join(',')

function normalizeStatus(status: string | null | undefined): ActorTestStatus {
  if (
    status === 'running' ||
    status === 'passed' ||
    status === 'failed' ||
    status === 'blocked' ||
    status === 'manual_verified'
  ) {
    return status
  }
  return 'not_started'
}

function isApprovedStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status)
  return normalized === 'passed' || normalized === 'manual_verified'
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const dates = values
    .filter((value): value is string => nonEmpty(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time)

  return dates[0]?.value ?? null
}

async function safeCount(table: string, filters: Array<{ column: string; value: string | boolean | string[]; op?: 'eq' | 'in' }> = []): Promise<number> {
  try {
    let query: unknown = supabaseService.from(table).select('id', { count: 'exact', head: true })
    for (const filter of filters) {
      const builder = query as { eq: (column: string, value: string | boolean) => unknown; in: (column: string, value: string[]) => unknown }
      if (filter.op === 'in') query = builder.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
      else query = builder.eq(filter.column, Array.isArray(filter.value) ? filter.value.join(',') : filter.value)
    }
    const { count, error } = (await query) as { count: number | null; error: unknown }
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function listResultsForCompanies(companyIds: string[]): Promise<ActorTestResultRow[]> {
  if (companyIds.length === 0) return []

  try {
    const { data, error } = await supabaseService
      .from('actor_test_results')
      .select('*')
      .in('company_id', companyIds)
      .order('updated_at', { ascending: false })

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as unknown as ActorTestResultRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

async function countActiveActorProfiles(companyId: string): Promise<number> {
  return safeCount('ediel_actor_settings', [
    { column: 'company_id', value: companyId },
    { column: 'is_active', value: true },
  ])
}

async function countEnabledRoutes(companyId: string, environment: 'test' | 'production'): Promise<number> {
  const routeProfiles = await safeCount('ediel_route_profiles', [
    { column: 'company_id', value: companyId },
    { column: 'environment', value: environment },
    { column: 'is_enabled', value: true },
  ])

  if (routeProfiles > 0) return routeProfiles

  return safeCount('communication_routes', [
    { column: 'company_id', value: companyId },
    { column: 'is_active', value: true },
  ])
}

function missingSetupForCompany(company: ActorTestingCompanyRow, hasActiveActorProfile: boolean, hasTestRoute: boolean): string[] {
  const missing: string[] = []
  if (!nonEmpty(company.org_number)) missing.push('Orgnummer saknas')
  if (!nonEmpty(company.market_role ?? company.actor_role)) missing.push('Marknadsroll saknas')
  if (!nonEmpty(company.test_ediel_id ?? company.ediel_id)) missing.push('Test Ediel-id saknas')
  if (!nonEmpty(company.technical_contact_email ?? company.primary_contact_email)) missing.push('Teknisk kontakt saknas')
  if (!nonEmpty(company.brp_ediel_id) && !nonEmpty(company.brp_name)) missing.push('BRP saknas')
  if (!nonEmpty(company.test_mailbox ?? company.ediel_mailbox)) missing.push('Test mailbox/SMTP saknas')
  if (!hasActiveActorProfile) missing.push('Aktiv Ediel-aktörsprofil saknas')
  if (!hasTestRoute) missing.push('Test-route saknas')
  if (['paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'].includes(String(company.status ?? ''))) missing.push('Bolaget är pausat eller blockerat')
  return missing
}

function goLiveBlockersForCompany(params: {
  company: ActorTestingCompanyRow
  hasActiveActorProfile: boolean
  hasProductionRoute: boolean
  hasVerifiedMailbox: boolean
  prodatPassed: number
  prodatTotal: number
  utiltsPassed: number
  utiltsTotal: number
}): string[] {
  const { company } = params
  const blockers: string[] = []

  if (!nonEmpty(company.org_number)) blockers.push('Orgnummer saknas')
  if (!nonEmpty(company.production_ediel_id ?? company.ediel_id)) blockers.push('Produktions Ediel-id saknas')
  if (!nonEmpty(company.market_role ?? company.actor_role)) blockers.push('Marknadsroll saknas')
  if (!nonEmpty(company.brp_ediel_id) && !nonEmpty(company.brp_name)) blockers.push('BRP saknas')
  if (String(company.brp_status ?? '').toLowerCase() !== 'active') blockers.push('BRP är inte markerad som aktiv')
  if (String(company.esett_status ?? '').toLowerCase() !== 'ready') blockers.push('eSett-status är inte klar')
  if (!params.hasActiveActorProfile) blockers.push('Aktiv Ediel-aktörsprofil saknas')
  if (!params.hasProductionRoute) blockers.push('Produktionsroute saknas')
  if (!params.hasVerifiedMailbox) blockers.push('Produktionsmailbox/SMTP saknas')
  if (params.prodatPassed < params.prodatTotal) blockers.push(`PRODAT-tester ej kompletta (${params.prodatPassed}/${params.prodatTotal})`)
  if (params.utiltsPassed < params.utiltsTotal) blockers.push(`UTILTS-tester ej kompletta (${params.utiltsPassed}/${params.utiltsTotal})`)
  if (['paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'].includes(String(company.status ?? ''))) blockers.push('Bolaget är pausat eller blockerat')
  if (!nonEmpty(company.production_mailbox ?? company.ediel_mailbox)) blockers.push('Produktionsmailbox saknas')
  if (!nonEmpty(company.production_application_reference)) blockers.push('Produktions Application Reference saknas')
  if (!nonEmpty(company.production_counterparty_ediel_id)) blockers.push('Produktionsmotpart saknas')

  const testEdiel = company.test_ediel_id ?? company.ediel_id
  const productionEdiel = company.production_ediel_id ?? company.ediel_id
  if (nonEmpty(testEdiel) && nonEmpty(productionEdiel) && testEdiel === productionEdiel && company.operating_environment === 'production') {
    blockers.push('Test- och produktionsidentitet måste vara explicit granskad innan live')
  }

  return blockers
}

async function buildSummary(company: ActorTestingCompanyRow, results: ActorTestResultRow[]): Promise<ActorTestingSummary> {
  const resultsByKey = new Map(results.map((row) => [row.test_key, row]))
  const prodatPassed = PRODAT_TESTS.filter((testCase) => isApprovedStatus(resultsByKey.get(testCase.key)?.status)).length
  const utiltsPassed = UTILTS_TESTS.filter((testCase) => isApprovedStatus(resultsByKey.get(testCase.key)?.status)).length
  const totalPassed = REQUIRED_TEST_CASES.filter((testCase) => isApprovedStatus(resultsByKey.get(testCase.key)?.status)).length
  const blockedTests = REQUIRED_TEST_CASES.filter((testCase) => normalizeStatus(resultsByKey.get(testCase.key)?.status) === 'blocked' || normalizeStatus(resultsByKey.get(testCase.key)?.status) === 'failed').length
  const hasRunning = REQUIRED_TEST_CASES.some((testCase) => normalizeStatus(resultsByKey.get(testCase.key)?.status) === 'running')
  const latestRunAt = latestDate(results.map((result) => result.latest_run_at ?? result.updated_at ?? result.created_at))

  const [actorProfiles, testRoutes, productionRoutes] = await Promise.all([
    countActiveActorProfiles(company.id),
    countEnabledRoutes(company.id, 'test'),
    countEnabledRoutes(company.id, 'production'),
  ])

  const hasActiveActorProfile = actorProfiles > 0 || nonEmpty(company.ediel_id)
  const hasTestRoute = testRoutes > 0
  const hasProductionRoute = productionRoutes > 0
  const hasVerifiedMailbox = nonEmpty(company.production_mailbox ?? company.ediel_mailbox)
  const missingSetup = missingSetupForCompany(company, hasActiveActorProfile, hasTestRoute)
  const goLiveBlockers = goLiveBlockersForCompany({
    company,
    hasActiveActorProfile,
    hasProductionRoute,
    hasVerifiedMailbox,
    prodatPassed,
    prodatTotal: PRODAT_TESTS.length,
    utiltsPassed,
    utiltsTotal: UTILTS_TESTS.length,
  })

  const actorTestStatus: ActorTestingSummary['actorTestStatus'] =
    missingSetup.length > 0
      ? 'not_ready'
      : blockedTests > 0
        ? 'blocked'
        : totalPassed === REQUIRED_TEST_CASES.length
          ? 'approved'
          : hasRunning || totalPassed > 0
            ? 'in_progress'
            : 'ready_for_tests'

  const productionReadiness: ActorTestingSummary['productionReadiness'] =
    company.live_ediel_enabled
      ? 'live'
      : goLiveBlockers.length === 0
        ? 'ready'
        : ['paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'].includes(String(company.status ?? ''))
          ? 'blocked'
          : 'not_ready'

  return {
    company,
    results,
    prodatPassed,
    prodatTotal: PRODAT_TESTS.length,
    utiltsPassed,
    utiltsTotal: UTILTS_TESTS.length,
    totalPassed,
    totalRequired: REQUIRED_TEST_CASES.length,
    blockedTests,
    latestRunAt,
    hasActiveActorProfile,
    hasTestRoute,
    hasProductionRoute,
    hasVerifiedMailbox,
    missingSetup,
    goLiveBlockers,
    actorTestStatus,
    productionReadiness,
  }
}

export function getActorTestCase(testKey: string): ActorTestCaseDefinition | null {
  const normalized = testKey.trim().toUpperCase()
  return ACTOR_TEST_CASES.find((testCase) => testCase.key === normalized) ?? null
}

export function getActorTestStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeStatus(status)
  const labels: Record<ActorTestStatus, string> = {
    not_started: 'Ej startad',
    running: 'Pågår',
    passed: 'Godkänd',
    failed: 'Nekad',
    blocked: 'Blockerad',
    manual_verified: 'Manuellt verifierad',
  }
  return labels[normalized]
}

export function getActorTestStatusTone(status: string | null | undefined): string {
  const normalized = normalizeStatus(status)
  if (normalized === 'passed' || normalized === 'manual_verified') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (normalized === 'running') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (normalized === 'failed' || normalized === 'blocked') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function getActorTestingStatusLabel(status: ActorTestingSummary['actorTestStatus']): string {
  const labels: Record<ActorTestingSummary['actorTestStatus'], string> = {
    not_ready: 'Ej konfigurerad',
    ready_for_tests: 'Redo för aktörstest',
    in_progress: 'Aktörstest pågår',
    approved: 'Aktörstest godkänt',
    blocked: 'Blockerad',
  }
  return labels[status]
}

export function getProductionReadinessLabel(status: ActorTestingSummary['productionReadiness']): string {
  const labels: Record<ActorTestingSummary['productionReadiness'], string> = {
    not_ready: 'Ej redo',
    ready: 'Redo för live-kontroll',
    live: 'Live',
    blocked: 'Blockerad',
  }
  return labels[status]
}

export function groupActorTestsByPackage() {
  return [
    {
      key: 'PRODAT_SUPPLIER' as const,
      label: 'Leverantör PRODAT',
      tests: PRODAT_TESTS,
    },
    {
      key: 'UTILTS_METERING' as const,
      label: 'UTILTS / mätvärden',
      tests: UTILTS_TESTS,
    },
  ]
}

export async function listActorTestingSummaries(options: {
  scope: ActorTestingScope
  companyIds?: string[]
  whiteLabelPlatformId?: string | null
}): Promise<ActorTestingSummary[]> {
  let query = supabaseService
    .from('companies')
    .select(COMPANY_SELECT_COLUMNS)
    .neq('status', 'deleted_test_only')
    .order('created_at', { ascending: false })

  if (options.companyIds && options.companyIds.length > 0) {
    query = query.in('id', options.companyIds)
  }

  if (options.scope === 'whitelabel' && options.whiteLabelPlatformId) {
    query = query.eq('white_label_platform_id', options.whiteLabelPlatformId)
  }

  const { data, error } = await query
  if (error) throw error

  const companies = (data ?? []) as unknown as ActorTestingCompanyRow[]
  const results = await listResultsForCompanies(companies.map((company) => company.id))
  const resultsByCompany = new Map<string, ActorTestResultRow[]>()
  for (const result of results) {
    const list = resultsByCompany.get(result.company_id) ?? []
    list.push(result)
    resultsByCompany.set(result.company_id, list)
  }

  return Promise.all(companies.map((company) => buildSummary(company, resultsByCompany.get(company.id) ?? [])))
}

export async function getActorTestingSummary(companyId: string): Promise<ActorTestingSummary | null> {
  const { data, error } = await supabaseService
    .from('companies')
    .select(COMPANY_SELECT_COLUMNS)
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const results = await listResultsForCompanies([companyId])
  return buildSummary(data as unknown as ActorTestingCompanyRow, results)
}

export async function listWhiteLabelPlatformIdsForUser(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseService
      .from('white_label_platform_memberships')
      .select('white_label_platform_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .in('membership_role', ['owner', 'admin'])

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return ((data ?? []) as Array<{ white_label_platform_id?: string | null }>)
      .map((row) => row.white_label_platform_id)
      .filter((value): value is string => nonEmpty(value))
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function userCanManageActorTestingForCompany(userId: string, companyId: string, isPlatformAdmin: boolean): Promise<boolean> {
  if (isPlatformAdmin) return true
  const platformIds = await listWhiteLabelPlatformIdsForUser(userId)
  if (platformIds.length === 0) return false

  const { data, error } = await supabaseService
    .from('companies')
    .select('id, white_label_platform_id')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  const platformId = (data as { white_label_platform_id?: string | null } | null)?.white_label_platform_id
  return nonEmpty(platformId) && platformIds.includes(platformId)
}

export function buildActorTestResultEvidence(params: {
  testCase: ActorTestCaseDefinition
  status: ActorTestStatus
  portalStatus?: string | null
  rawPayload?: string | null
  failureReason?: string | null
  actorUserId: string
}) {
  return {
    testKey: params.testCase.key,
    testName: params.testCase.label,
    testId: params.testCase.testId,
    messageFamily: params.testCase.messageFamily,
    messageCode: params.testCase.messageCode,
    direction: params.testCase.direction,
    portalStatus: params.portalStatus ?? null,
    failureReason: params.failureReason ?? null,
    rawPayloadSaved: nonEmpty(params.rawPayload),
    updatedBy: params.actorUserId,
    updatedAt: new Date().toISOString(),
  }
}

export function mapTestStatusToRunStatus(status: ActorTestStatus): EdielTestRunStatus {
  if (status === 'passed' || status === 'manual_verified') return 'passed'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'running') return 'running'
  return 'draft'
}
