import { supabaseService } from '@/lib/supabase/service'
import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformation'
import {
  resolveCustomerSiteProcessContext,
  type ProcessBlocker,
} from '@/lib/customer-operations/customerSiteProcessContext'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'

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
    contractId: string | null
    meteringPointId: string | null
    gridOwnerInformationRequestId: string | null
    supplierSwitchRequestId: string | null
    communicationRouteId: string | null
    edielRouteProfileId: string | null
  }
}

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function decision(
  input: Omit<CustomerIntakeDecision, 'warnings'> & { warnings?: CustomerIntakeDecision['warnings'] },
): CustomerIntakeDecision {
  return { ...input, warnings: input.warnings ?? [] }
}

function intakeBlockers(blockers: ProcessBlocker[]): CustomerIntakeDecision['blockers'] {
  return blockers.map((item) => ({ code: item.code, message: item.message, source: item.source }))
}

async function exactSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function latestGridOwnerInformationRequest(input: {
  companyId: string
  customerId: string
  siteId: string
}) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('customer_site_id', input.siteId)
    .in('request_type', ['facility_lookup', 'facility_identifier_lookup'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function openSupplierSwitch(input: {
  companyId: string
  customerId: string
  siteId: string
}) {
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('id,status,communication_route_id,ediel_route_profile_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .or(`site_id.eq.${input.siteId},customer_site_id.eq.${input.siteId}`)
    .in('status', ['draft', 'queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response', 'manual_followup_required'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

async function persistDecision(input: {
  companyId: string
  customerId: string
  siteId: string
  decision: CustomerIntakeDecision
}) {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('customer_sites')
    .update({
      onboarding_status: input.decision.state,
      next_action: input.decision.nextAction,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
  if (error && !missingSchema(error)) throw error

  // Customer-level state is a derived summary only. It must never overwrite
  // the truth for another site just because this site progressed last.
  const rpcClient = supabaseService as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
      data: unknown
      error: { code?: string; message?: string } | null
    }>
  }
  const summary = await rpcClient.rpc('gridex_refresh_customer_process_summary', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_latest_action: `${input.siteId}:${input.decision.state}:${input.decision.nextAction}`,
  })
  if (summary.error && !missingSchema(summary.error)) {
    throw new Error(`customer_process_summary_failed:${summary.error.code ?? 'unknown'}:${summary.error.message ?? 'unknown'}`)
  }
}

export type SiteFacilityIdentity = {
  siteId: string | null
  siteExists: boolean
  facilityReady: boolean
  facilityId: string | null
  meteringPointIdentity: string | null
}

/**
 * Strict facility identity gate. The caller must identify the site. We never
 * choose the newest site or newest metering point from the customer as a
 * fallback because customer identity is not installation identity.
 */
export async function evaluateSiteFacilityIdentity(input: {
  companyId: string
  customerId: string
  siteId?: string | null
}): Promise<SiteFacilityIdentity> {
  const siteId = clean(input.siteId)
  if (!siteId) {
    return {
      siteId: null,
      siteExists: false,
      facilityReady: false,
      facilityId: null,
      meteringPointIdentity: null,
    }
  }

  const site = await exactSite({ companyId: input.companyId, customerId: input.customerId, siteId })
  if (!site) {
    return {
      siteId,
      siteExists: false,
      facilityReady: false,
      facilityId: null,
      meteringPointIdentity: null,
    }
  }

  const meter = await supabaseService
    .from('metering_points')
    .select('id,metering_point_id,ediel_metering_point_id,meter_point_id,ediel_reference')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    .order('created_at', { ascending: false })
    .limit(20)
  if (meter.error && !missingSchema(meter.error)) throw meter.error
  const rows = (meter.data ?? []) as JsonRecord[]
  const candidate = rows.find((row) => clean(row.ediel_reference) || clean(row.ediel_metering_point_id) || clean(row.metering_point_id) || clean(row.meter_point_id)) ?? null
  const facilityId = clean(site.normalized_facility_id) ?? clean(site.facility_id)
  const meteringPointIdentity =
    clean(candidate?.ediel_reference) ??
    clean(candidate?.ediel_metering_point_id) ??
    clean(candidate?.metering_point_id) ??
    clean(candidate?.meter_point_id)

  return {
    siteId,
    siteExists: true,
    facilityReady: Boolean(facilityId || meteringPointIdentity),
    facilityId,
    meteringPointIdentity,
  }
}

export async function evaluateCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  contractId?: string | null
  actorUserId?: string | null
  apply?: boolean
  autoEnsureFacilityLookup?: boolean
}): Promise<CustomerIntakeDecision> {
  const siteId = clean(input.siteId)
  const emptyReferences: CustomerIntakeDecision['references'] = {
    customerId: input.customerId,
    siteId,
    contractId: clean(input.contractId),
    meteringPointId: null,
    gridOwnerInformationRequestId: null,
    supplierSwitchRequestId: null,
    communicationRouteId: null,
    edielRouteProfileId: null,
  }

  if (!siteId) {
    return decision({
      state: 'needs_admin_review',
      nextAction: 'review_blocker',
      customerMessage: 'Vi behöver identifiera exakt anläggning innan ärendet kan fortsätta.',
      adminMessage: 'SiteId saknas. Kundnivå får inte användas som fallback för en anläggningsprocess.',
      blockers: [{ code: 'customer_site_required', message: 'Exakt customer_site_id krävs.', source: 'customer_intake_orchestrator' }],
      references: emptyReferences,
    })
  }

  let context: Awaited<ReturnType<typeof resolveCustomerSiteProcessContext>>
  try {
    context = await resolveCustomerSiteProcessContext({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId,
      contractId: input.contractId ?? null,
    })
  } catch (error) {
    const result = decision({
      state: 'needs_admin_review',
      nextAction: 'review_blocker',
      customerMessage: 'Vi behöver kontrollera kopplingen till anläggningen innan ärendet kan fortsätta.',
      adminMessage: error instanceof Error ? error.message : 'Anläggningen kunde inte verifieras.',
      blockers: [{ code: 'customer_site_context_failed', message: error instanceof Error ? error.message : 'Canonical site context kunde inte lösas.', source: 'customer_intake_orchestrator' }],
      references: emptyReferences,
    })
    return result
  }

  const [gridOwnerInformationRequest, supplierSwitch] = await Promise.all([
    latestGridOwnerInformationRequest({ companyId: input.companyId, customerId: input.customerId, siteId }),
    openSupplierSwitch({ companyId: input.companyId, customerId: input.customerId, siteId }),
  ])

  const referencesBase: CustomerIntakeDecision['references'] = {
    customerId: input.customerId,
    siteId,
    contractId: context.contractId,
    meteringPointId: context.meteringPointId,
    gridOwnerInformationRequestId: clean(gridOwnerInformationRequest?.id),
    supplierSwitchRequestId: clean(supplierSwitch?.id),
    communicationRouteId: clean(supplierSwitch?.communication_route_id),
    edielRouteProfileId: clean(supplierSwitch?.ediel_route_profile_id),
  }

  if (!context.contractReady) {
    const blockers = context.blockers.filter((item) => item.source === 'contract')
    const result = decision({
      state: 'needs_contract_or_poa',
      nextAction: 'review_blocker',
      customerMessage: 'Avtalet behöver vara signerat och kopplat till rätt anläggning innan processen kan fortsätta.',
      adminMessage: 'Canonical site-specifikt avtal är inte operationellt redo.',
      blockers: intakeBlockers(blockers.length ? blockers : context.blockers),
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (!context.authorizationReady) {
    const blockers = context.blockers.filter((item) => item.source === 'authorization')
    const result = decision({
      state: 'needs_contract_or_poa',
      nextAction: 'review_blocker',
      customerMessage: 'En giltig fullmakt för just den här anläggningen behöver vara klar innan processen kan fortsätta.',
      adminMessage: 'Site-specifik authorization med rätt scope saknas eller kan inte verifieras.',
      blockers: intakeBlockers(blockers.length ? blockers : context.blockers),
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (!context.gridOwnerId) {
    const result = decision({
      state: 'needs_grid_owner_resolution',
      nextAction: 'resolve_grid_owner',
      customerMessage: 'Vi verifierar nätägare och nätområde för anläggningen.',
      adminMessage: 'Verifierad nätägare saknas på exakt customer_site_id.',
      blockers: [{ code: 'grid_owner_missing', message: 'Nätägare saknas för anläggningen.', source: 'grid_owner' }],
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (!context.gridOwnerReady) {
    const blockers = context.blockers.filter((item) => item.source === 'grid_owner')
    const result = decision({
      state: 'needs_admin_review',
      nextAction: 'review_blocker',
      customerMessage: 'Nätägaren behöver verifieras innan vi kan fortsätta automatiskt.',
      adminMessage: 'Nätägaren är mappad men inte verifierad för kundflöde.',
      blockers: intakeBlockers(blockers.length ? blockers : context.blockers),
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (!context.facilityReady) {
    if (input.autoEnsureFacilityLookup) {
      const manual = await requestMissingFacilityInformation({
        companyId: input.companyId,
        customerId: input.customerId,
        siteId,
        actorUserId: input.actorUserId ?? null,
        source: 'customer_intake_orchestrator',
      })
      referencesBase.gridOwnerInformationRequestId = manual.requestId
      const waiting = ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'waiting_response', 'sent'].includes(manual.status)
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
        warnings: intakeBlockers(context.warnings),
        references: referencesBase,
      })
      if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
      return result
    }

    const requestStatus = clean(gridOwnerInformationRequest?.status)
    const result = decision({
      state: ['waiting_response', 'sent', 'manual_email_sent', 'waiting_manual_response'].includes(requestStatus ?? '')
        ? 'facility_lookup_waiting_response'
        : ['ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued'].includes(requestStatus ?? '')
          ? 'facility_lookup_ready_to_send'
          : 'needs_facility_lookup',
      nextAction: ['waiting_response', 'sent', 'manual_email_sent', 'waiting_manual_response'].includes(requestStatus ?? '')
        ? 'wait_for_grid_owner'
        : ['ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued'].includes(requestStatus ?? '')
          ? 'send_facility_lookup'
          : 'request_facility_data',
      customerMessage: 'Vi behöver hämta anläggningsuppgifter från nätägaren.',
      adminMessage: requestStatus ? 'Nätägarbegäran finns för exakt site. Fortsätt eller invänta svar.' : 'Skapa nätägarbegäran för exakt customer_site_id.',
      blockers: [],
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  if (supplierSwitch?.id) {
    const result = decision({
      state: 'supplier_switch_waiting_response',
      nextAction: 'wait_for_switch_ack',
      customerMessage: 'Leverantörsbytet för anläggningen är startat och vi inväntar nästa svar.',
      adminMessage: 'Det finns redan ett öppet leverantörsbyte för exakt site.',
      blockers: [],
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const processBlockers = context.blockers.filter((item) => item.source === 'process_type')
  if (processBlockers.length > 0) {
    const result = decision({
      state: 'needs_admin_review',
      nextAction: 'review_blocker',
      customerMessage: 'Vi behöver bekräfta vilken marknadsprocess som gäller för anläggningen.',
      adminMessage: 'Process-typen måste vara entydig innan Z01/Z02/Z03-variant kan väljas.',
      blockers: intakeBlockers(processBlockers),
      warnings: intakeBlockers(context.warnings),
      references: referencesBase,
    })
    if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
    return result
  }

  const readiness = await checkSupplierSwitchReadiness({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId,
    contractId: context.contractId,
    requestedStartDate: context.requestedStartDate,
    treatNormalIssuesAsBlockers: context.processType !== 'move_in',
  })
  referencesBase.communicationRouteId = clean((readiness.readinessSnapshot as JsonRecord).communication_route_id) ?? referencesBase.communicationRouteId
  referencesBase.edielRouteProfileId = clean((readiness.readinessSnapshot as JsonRecord).ediel_route_profile_id) ?? referencesBase.edielRouteProfileId

  const result = decision({
    state: readiness.ready ? 'ready_for_supplier_switch' : 'needs_admin_review',
    nextAction: readiness.ready ? 'start_supplier_switch' : 'review_blocker',
    customerMessage: readiness.ready
      ? 'Anläggningsuppgifter, avtal och fullmakt är verifierade. Nästa steg är leverantörsbyte.'
      : 'Ärendet behöver granskas innan leverantörsbytet kan startas.',
    adminMessage: readiness.ready
      ? `Site är redo för ${context.processType}.`
      : readiness.nextRequiredAction,
    blockers: readiness.blockers,
    warnings: [...readiness.warnings, ...intakeBlockers(context.warnings)],
    references: referencesBase,
  })
  if (input.apply) await persistDecision({ companyId: input.companyId, customerId: input.customerId, siteId, decision: result })
  return result
}

export async function processWebsiteApplicationIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  contractId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function processManualCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  contractId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function processPdfCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  contractId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}

export async function resumeCustomerIntake(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  contractId?: string | null
  actorUserId?: string | null
}): Promise<CustomerIntakeDecision> {
  return evaluateCustomerIntake({ ...input, apply: true, autoEnsureFacilityLookup: true })
}