import { supabaseService } from '@/lib/supabase/service'
import { evaluateGridOwnerBusinessApproval } from '@/lib/ediel/gridOwnerBusinessApproval'
import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformation'

export type CustomerIntakeState =
  | 'application_received'
  | 'needs_contract_or_poa'
  | 'needs_grid_owner_resolution'
  | 'needs_facility_lookup'
  | 'facility_lookup_ready_to_send'
  | 'facility_lookup_waiting_response'
  | 'ready_for_supplier_switch'
  | 'supplier_switch_waiting_response'
  | 'active_supply'
  | 'needs_admin_review'

export type CustomerIntakeNextAction =
  | 'none'
  | 'resolve_grid_owner'
  | 'request_facility_data'
  | 'send_facility_lookup'
  | 'wait_for_grid_owner'
  | 'complete_facility_data'
  | 'start_supplier_switch'
  | 'wait_for_switch_ack'
  | 'review_blocker'

export type CustomerIntakeDecision = {
  state: CustomerIntakeState
  nextAction: CustomerIntakeNextAction
  customerMessage: string
  adminMessage: string
  blockers: Array<{ code: string; message: string; source?: string }>
  warnings: Array<{ code: string; message: string; source?: string }>
  references: {
    customerId: string
    siteId: string | null
    meteringPointId: string | null
    gridOwnerInformationRequestId: string | null
    supplierSwitchRequestId: string | null
    communicationRouteId: string | null
    edielRouteProfileId: string | null
  }
}

type JsonRecord = Record<string, unknown>
type SupabaseQueryBuilder = ReturnType<typeof supabaseService.from>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function hasText(...values: unknown[]): boolean {
  return values.some((value) => Boolean(clean(value)))
}

type SupabaseQueryResult = { data?: unknown; error?: unknown }

async function maybeOne(table: string, query: (builder: SupabaseQueryBuilder) => unknown) {
  const result = (await query(supabaseService.from(table))) as SupabaseQueryResult
  if (result.error) {
    if (missingSchema(result.error)) return null
    throw result.error
  }
  return (result.data as JsonRecord | null) ?? null
}

async function latestSite(input: { companyId: string; customerId: string; siteId?: string | null }) {
  let query = supabaseService
    .from('customer_sites')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.siteId) query = query.eq('id', input.siteId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function latestMeteringPoint(input: { companyId: string; customerId: string; siteId?: string | null }) {
  let query = supabaseService
    .from('metering_points')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.siteId) query = query.or(`site_id.eq.${input.siteId},customer_site_id.eq.${input.siteId}`)
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function hasContract(input: { companyId: string; customerId: string }) {
  const row = await maybeOne('customer_contracts', (builder) => builder
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle())
  return Boolean(row?.id)
}

async function hasPowerOfAttorney(input: { companyId: string; customerId: string; siteId?: string | null }) {
  const query = supabaseService
    .from('powers_of_attorney')
    .select('id,status,site_id,customer_site_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['signed', 'active', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(10)
  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
  const siteId = clean(input.siteId)
  return ((data ?? []) as JsonRecord[]).some((row) => {
    const rowSite = clean(row.site_id) ?? clean(row.customer_site_id)
    return !siteId || !rowSite || rowSite === siteId
  })
}

async function latestGridOwnerInformationRequest(input: { companyId: string; customerId: string; siteId?: string | null }) {
  let query = supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    // Both lookup channels count: Ediel ('facility_lookup') and the default
    // manual e-mail pipeline ('facility_identifier_lookup').
    .in('request_type', ['facility_lookup', 'facility_identifier_lookup'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.siteId) query = query.eq('customer_site_id', input.siteId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function openSupplierSwitch(input: { companyId: string; customerId: string; siteId?: string | null }) {
  let query = supabaseService
    .from('supplier_switch_requests')
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.siteId) query = query.eq('customer_site_id', input.siteId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function persistDecision(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  decision: CustomerIntakeDecision
}) {
  const now = new Date().toISOString()
  const customer = await supabaseService
    .from('customers')
    .update({
      intake_status: input.decision.state,
      next_action: input.decision.nextAction,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
  if (customer.error && !missingSchema(customer.error)) throw customer.error

  if (input.siteId) {
    const site = await supabaseService
      .from('customer_sites')
      .update({
        onboarding_status: input.decision.state,
        next_action: input.decision.nextAction,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('id', input.siteId)
    if (site.error && !missingSchema(site.error)) throw site.error
  }
}

function decision(input: Omit<CustomerIntakeDecision, 'warnings'> & { warnings?: CustomerIntakeDecision['warnings'] }): CustomerIntakeDecision {
  return { ...input, warnings: input.warnings ?? [] }
}

export type SiteFacilityIdentity = {
  siteId: string | null
  siteExists: boolean
  facilityReady: boolean
  facilityId: string | null
  meteringPointIdentity: string | null
}

/**
 * Canonical facility-identity gate shared by every entry point that may lead
 * to PRODAT Z01 / customer_masterdata. A site is facility-ready only when it
 * carries an external facility id or the metering point carries an external
 * metering identity. Missing identity must route to the manual grid-owner
 * information request path — never to a queued Z01/outbound.
 */
export async function evaluateSiteFacilityIdentity(input: {
  companyId: string
  customerId: string
  siteId?: string | null
}): Promise<SiteFacilityIdentity> {
  const site = await latestSite(input)
  const siteId = clean(site?.id)
  const meteringPoint = siteId ? await latestMeteringPoint({ ...input, siteId }) : null
  const facilityId = clean(site?.facility_id) ?? clean(site?.normalized_facility_id)
  const meteringPointIdentity =
    clean(meteringPoint?.metering_point_id) ??
    clean(meteringPoint?.ediel_metering_point_id) ??
    clean(meteringPoint?.meter_point_id)
  return {
    siteId,
    siteExists: Boolean(site && siteId),
    facilityReady: hasText(facilityId, meteringPointIdentity),
    facilityId,
    meteringPointIdentity,
  }
}

export async function evaluateCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
  apply?: boolean
  autoEnsureFacilityLookup?: boolean
}): Promise<CustomerIntakeDecision> {
  const site = await latestSite(input)
  const siteId = clean(site?.id)
  const meteringPoint = siteId ? await latestMeteringPoint({ ...input, siteId }) : null
  const gridOwnerInformationRequest = siteId ? await latestGridOwnerInformationRequest({ ...input, siteId }) : null
  const supplierSwitch = await openSupplierSwitch({ ...input, siteId })
  const contractReady = await hasContract(input)
  const poaReady = await hasPowerOfAttorney({ ...input, siteId })

  const referencesBase = {
    customerId: input.customerId,
    siteId,
    meteringPointId: clean(meteringPoint?.id),
    gridOwnerInformationRequestId: clean(gridOwnerInformationRequest?.id),
    supplierSwitchRequestId: clean(supplierSwitch?.id),
    communicationRouteId: null as string | null,
    edielRouteProfileId: null as string | null,
  }

  if (!site || !siteId) {
    const result = decision({
      state: 'needs_admin_review',
      nextAction: 'review_blocker',
      customerMessage: 'Vi behöver komplettera anläggningsuppgifter innan ärendet kan fortsätta.',
      adminMessage: 'Anläggning saknas på kunden.',
      blockers: [{ code: 'customer_site_missing', message: 'Anläggning saknas.', source: 'customer_intake_orchestrator' }],
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const activeSite = site

  if (!contractReady || !poaReady) {
    const result = decision({
      state: 'needs_contract_or_poa',
      nextAction: 'review_blocker',
      customerMessage: 'Avtal och fullmakt behöver vara klara innan vi kan kontakta nätägaren.',
      adminMessage: !contractReady ? 'Kundavtal saknas.' : 'Signerad fullmakt saknas.',
      blockers: [{ code: !contractReady ? 'contract_missing' : 'missing_power_of_attorney', message: !contractReady ? 'Kundavtal saknas.' : 'Signerad fullmakt saknas.', source: 'customer_intake_orchestrator' }],
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const gridOwnerId = clean(activeSite.grid_owner_id) ?? clean(activeSite.selected_grid_owner_id)
  if (!gridOwnerId) {
    const result = decision({
      state: 'needs_grid_owner_resolution',
      nextAction: 'resolve_grid_owner',
      customerMessage: 'Vi verifierar nätägare och elområde.',
      adminMessage: 'Nätägare saknas på anläggningen.',
      blockers: [{ code: 'grid_owner_missing', message: 'Nätägare saknas.', source: 'customer_intake_orchestrator' }],
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const facilityReady = hasText(activeSite.facility_id, activeSite.normalized_facility_id, meteringPoint?.metering_point_id, meteringPoint?.ediel_metering_point_id, meteringPoint?.meter_point_id)

  if (!facilityReady) {
    if (input.autoEnsureFacilityLookup) {
      const manual = await requestMissingFacilityInformation({
        companyId: input.companyId,
        customerId: input.customerId,
        siteId,
        actorUserId: input.actorUserId ?? null,
        source: 'customer_intake_orchestrator',
      })
      referencesBase.gridOwnerInformationRequestId = manual.requestId
      const waiting = ['manual_email_queued', 'waiting_response', 'sent'].includes(manual.status)
      const blocked = manual.blockers.length > 0 || manual.status.startsWith('blocked') || manual.status === 'needs_review'
      const result = decision({
        state: waiting
          ? 'facility_lookup_waiting_response'
          : blocked
            ? 'needs_admin_review'
            : manual.status === 'not_needed'
              ? 'ready_for_supplier_switch'
              : 'needs_facility_lookup',
        nextAction: waiting
          ? 'wait_for_grid_owner'
          : blocked
            ? 'review_blocker'
            : manual.status === 'not_needed'
              ? 'start_supplier_switch'
              : 'request_facility_data',
        customerMessage: waiting
          ? 'Vi väntar på anläggningsuppgifter från nätägaren.'
          : manual.nextAction.message,
        adminMessage: manual.nextAction.message,
        blockers: manual.blockers.map((item) => ({ ...item, source: 'manual_facility_information_request' })),
        warnings: [],
        references: referencesBase,
      })
      if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
      return result
    }

    const requestStatus = clean(gridOwnerInformationRequest?.status)
    const result = decision({
      state: requestStatus === 'waiting_response' || requestStatus === 'sent'
        ? 'facility_lookup_waiting_response'
        : requestStatus === 'ready_to_send'
          ? 'facility_lookup_ready_to_send'
          : 'needs_facility_lookup',
      nextAction: requestStatus === 'waiting_response' || requestStatus === 'sent'
        ? 'wait_for_grid_owner'
        : requestStatus === 'ready_to_send'
          ? 'send_facility_lookup'
          : 'request_facility_data',
      customerMessage: 'Vi behöver hämta anläggningsuppgifter från nätägaren.',
      adminMessage: requestStatus ? 'Nätägarbegäran finns. Fortsätt eller invänta svar.' : 'Skapa nätägarbegäran för anläggnings-ID och mätpunkts-ID.',
      blockers: [],
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (supplierSwitch?.id) {
    const result = decision({
      state: 'supplier_switch_waiting_response',
      nextAction: 'wait_for_switch_ack',
      customerMessage: 'Leverantörsbytet är startat och vi inväntar nästa svar.',
      adminMessage: 'Det finns redan ett öppet leverantörsbyte.',
      blockers: [],
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const approval = await evaluateGridOwnerBusinessApproval({
    companyId: input.companyId,
    gridOwnerId,
    process: 'facility_lookup',
    environment: 'production',
  })
  referencesBase.communicationRouteId = approval.communicationRouteId
  referencesBase.edielRouteProfileId = approval.edielRouteProfileId

  const result = decision({
    state: approval.businessProductionApproved ? 'ready_for_supplier_switch' : 'needs_admin_review',
    nextAction: approval.businessProductionApproved ? 'start_supplier_switch' : 'review_blocker',
    customerMessage: approval.businessProductionApproved
      ? 'Anläggningsuppgifter är klara. Nästa steg är leverantörsbyte.'
      : 'Ärendet behöver granskas innan leverantörsbyte kan startas.',
    adminMessage: approval.businessProductionApproved
      ? 'Kunden är redo för leverantörsbyte.'
      : 'Nätägaren är inte godkänd för produktionsflödet.',
    blockers: approval.blockers,
    warnings: approval.warnings,
    references: referencesBase,
  })
  if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
  return result
}


export async function processWebsiteApplicationIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function processManualCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function processPdfCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function resumeCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}
