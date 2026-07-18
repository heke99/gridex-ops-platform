import { supabaseService } from '@/lib/supabase/service'
import {
  findCustomerSiteById,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  findOpenSupplierSwitchRequestForSite,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import { findActiveSwitchLifecycleBlock } from '@/lib/operations/switchLifecycleBlocks'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'
import type { SwitchReadinessResult } from '@/lib/operations/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'

/**
 * Unified supplier switch readiness.
 *
 * This is the single readiness gate that aggregates the previously separate
 * systems:
 *  1. Site readiness (POA, metering point, grid owner/area, price area, current
 *     supplier, move-in date) — lib/operations/readiness.ts
 *  2. EDIEL route readiness (PRODAT Z03 route/certificate/production approval)
 *     — lib/customer-operations/customerProcessRouteReadiness.ts
 *  3. Grid owner verification (gridex_verified_grid_owners_v) —
 *     lib/grid-owners/verification.ts
 *  4. Lifecycle blocks (withdrawal, rejection, blocking cases/tasks) —
 *     lib/operations/switchLifecycleBlocks.ts
 *  5. Scheduler guards (send window, duplicate active switch, unresolved
 *     negative ACK) — lib/operations/supplierSwitchScheduler.ts
 *
 * Both the automated customer-process engine and the manual/admin dispatch path
 * must call this before creating or dispatching a supplier switch.
 */

export type SupplierSwitchReadinessBlocker = {
  code: string
  message: string
  source:
    | 'site_readiness'
    | 'contract'
    | 'legal'
    | 'grid_owner_verification'
    | 'route_readiness'
    | 'lifecycle'
    | 'scheduler'
    | 'input'
}

export type SupplierSwitchReadinessInput = {
  companyId: string
  customerId: string
  siteId: string
  contractId?: string | null
  /** Existing switch request when re-validating before dispatch. */
  switchRequestId?: string | null
  requestedStartDate?: string | null
  /**
   * When true (default) low-priority site issues (missing current supplier,
   * missing move-in date) block the switch, matching the historical behavior
   * of the automated engine. Set false to treat them as warnings only.
   */
  treatNormalIssuesAsBlockers?: boolean
  /** Skip the async route/scheduler checks (used by pure unit tests). */
  now?: Date
}

export type SupplierSwitchReadinessResult = {
  ready: boolean
  blockers: SupplierSwitchReadinessBlocker[]
  warnings: SupplierSwitchReadinessBlocker[]
  nextRequiredAction: string
  readinessSnapshot: Record<string, unknown>
  siteReadiness: SwitchReadinessResult | null
  site: CustomerSiteRow | null
  candidateMeteringPoint: MeteringPointRow | null
  openSwitchRequestId: string | null
}

const NEXT_ACTION_BY_CODE: Record<string, string> = {
  site_not_found: 'Kontrollera att anläggningen finns och tillhör rätt kund/tenant.',
  power_of_attorney_missing: 'Registrera och signera fullmakt för leverantörsbyte.',
  power_of_attorney_not_signed: 'Signera eller förnya fullmakten.',
  metering_point_missing: 'Komplettera mätpunkt via anläggningsuppslag.',
  meter_point_id_missing: 'Komplettera mätpunkts-ID via anläggningsuppslag.',
  grid_owner_missing: 'Fastställ nätägare för anläggningen.',
  grid_area_missing: 'Fastställ nätområde för anläggningen.',
  price_area_missing: 'Fastställ elområde (SE1–SE4) för anläggningen.',
  current_supplier_missing: 'Registrera nuvarande elleverantör.',
  move_in_date_missing: 'Registrera inflyttnings-/startdatum.',
  contract_cancelled: 'Avtalet är avslutat/annullerat – skapa nytt avtal innan byte.',
  contract_start_date_missing: 'Komplettera avtalets startdatum.',
  contract_missing: 'Koppla ett signerat canonical-avtal till anläggningen.',
  agreement_not_signed_with_exact_evidence: 'Slutför signering och samtliga exakta juridikaccepter.',
  signed_pdf_not_archived_or_hash_mismatch: 'Arkivera och verifiera den signerade PDF-filen.',
  valid_power_of_attorney_missing: 'Registrera en giltig signerad fullmakt för avtalet och anläggningen.',
  contract_readiness_unavailable: 'Installera senaste readiness-migration innan leverantörsbyte.',
  grid_owner_not_verified: 'Verifiera nätägaren (rutt/certifikat/Ediel-ID) innan byte.',
  duplicate_open_supplier_switch: 'Invänta eller hantera det befintliga leverantörsbytet.',
  supplier_switch_send_window_not_open: 'Invänta att sändfönstret öppnar.',
  unresolved_negative_ack: 'Hantera den negativa kvittensen innan nytt utskick.',
  lifecycle_blocked: 'Hantera kundens ånger/blockering innan byte.',
  route_not_ready: 'Färdigställ Ediel-rutten (PRODAT Z03) för nätägaren.',
}

function nextActionForBlockers(blockers: SupplierSwitchReadinessBlocker[]): string {
  const first = blockers[0]
  if (!first) return 'Redo för leverantörsbyte.'
  return NEXT_ACTION_BY_CODE[first.code] ?? first.message
}

export async function checkSupplierSwitchReadiness(
  input: SupplierSwitchReadinessInput
): Promise<SupplierSwitchReadinessResult> {
  const blockers: SupplierSwitchReadinessBlocker[] = []
  const warnings: SupplierSwitchReadinessBlocker[] = []
  const treatNormalAsBlockers = input.treatNormalIssuesAsBlockers !== false
  const evaluatedAt = new Date().toISOString()

  // 1. Site + tenant validation ------------------------------------------------
  const site = await findCustomerSiteById(supabaseService, input.siteId)
  if (!site || site.company_id !== input.companyId || site.customer_id !== input.customerId) {
    const blocker: SupplierSwitchReadinessBlocker = {
      code: 'site_not_found',
      message: 'Anläggningen kunde inte hittas i rätt tenant/kund.',
      source: 'input',
    }
    return {
      ready: false,
      blockers: [blocker],
      warnings: [],
      nextRequiredAction: nextActionForBlockers([blocker]),
      readinessSnapshot: {
        evaluated_at: evaluatedAt,
        company_id: input.companyId,
        customer_id: input.customerId,
        site_id: input.siteId,
        blockers: [blocker],
        warnings: [],
      },
      siteReadiness: null,
      site: null,
      candidateMeteringPoint: null,
      openSwitchRequestId: null,
    }
  }

  const meteringPoints = await listMeteringPointsForSite(supabaseService, site.id)
  const powersOfAttorney = await listPowersOfAttorneyByCustomerId(supabaseService, input.customerId, {
    companyId: input.companyId,
  })

  const siteReadiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
    now: input.now,
  })

  for (const issue of siteReadiness.issues) {
    const entry: SupplierSwitchReadinessBlocker = {
      code: issue.code,
      message: issue.description,
      source: 'site_readiness',
    }
    if (issue.priority === 'normal' && !treatNormalAsBlockers) warnings.push(entry)
    else blockers.push(entry)
  }

  const candidateMeteringPoint =
    meteringPoints.find((point) => point.id === siteReadiness.candidateMeteringPointId) ??
    meteringPoints[0] ??
    null

  // 2. Exact agreement chain. Missing schema is fail-closed: neither service
  // role nor a direct Ediel call may turn an unverifiable contract into a send.
  let contractSnapshot: Record<string, unknown> | null = null
  let effectiveContractId = input.contractId ?? null
  if (!effectiveContractId) {
    let contractQuery = supabaseService
      .from('customer_contracts')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false })
      .limit(1)
    contractQuery = contractQuery.or(`customer_site_id.eq.${input.siteId},site_id.eq.${input.siteId}`)
    const candidate = await contractQuery.maybeSingle()
    if (!candidate.error && candidate.data?.id) effectiveContractId = String(candidate.data.id)
  }

  let legalAcceptanceCount = 0
  if (!effectiveContractId) {
    blockers.push({
      code: 'contract_missing',
      message: 'Inget signerat canonical-avtal är kopplat till kunden och anläggningen.',
      source: 'contract',
    })
  } else {
    const exact = await supabaseService
      .from('customer_contract_lifecycle_readiness_v')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('customer_site_id', input.siteId)
      .eq('customer_contract_id', effectiveContractId)
      .maybeSingle()
    if (exact.error) {
      blockers.push({
        code: 'contract_readiness_unavailable',
        message: 'Den canonicala avtals-/switch-readinessen kunde inte verifieras.',
        source: 'contract',
      })
      contractSnapshot = { id: effectiveContractId, error: exact.error.message }
    } else if (!exact.data) {
      blockers.push({
        code: 'contract_missing',
        message: 'Avtalet saknar readiness för rätt tenant, kund eller anläggning.',
        source: 'contract',
      })
    } else {
      const row = exact.data as Record<string, unknown>
      contractSnapshot = row
      legalAcceptanceCount = Number(row.accepted_document_count ?? 0)
      const exactBlockers = Array.isArray(row.blockers) ? row.blockers : []
      for (const codeValue of exactBlockers) {
        const code = String(codeValue)
        blockers.push({
          code,
          message: `Avtalets switch-gate blockerades: ${code}.`,
          source: code.includes('legal') ? 'legal' : 'contract',
        })
      }
      if (row.switch_ready !== true && exactBlockers.length === 0) {
        blockers.push({
          code: 'contract_not_switch_ready',
          message: 'Avtalet är inte markerat som switch-ready i den canonicala livscykeln.',
          source: 'contract',
        })
      }
    }
  }

  // 4. Lifecycle blocks ---------------------------------------------------------
  const lifecycleBlock = await findActiveSwitchLifecycleBlock(supabaseService, {
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    meteringPointId: candidateMeteringPoint?.id ?? null,
  })
  if (lifecycleBlock) {
    blockers.push({
      code: 'lifecycle_blocked',
      message: `${lifecycleBlock.title}: ${lifecycleBlock.reason}`,
      source: 'lifecycle',
    })
  }

  // 5. Grid owner verification ---------------------------------------------------
  const gridOwnerId = candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null
  let gridOwnerVerification: Record<string, unknown> | null = null
  if (gridOwnerId) {
    try {
      const verification = await getGridOwnerVerification(gridOwnerId)
      if (verification) {
        gridOwnerVerification = {
          grid_owner_id: verification.gridOwnerId,
          verification_status: verification.verificationStatus,
          can_start_supplier_switch: verification.canStartSupplierSwitch,
          can_use_for_prodat: verification.canUseForProdat,
        }
        const allowed =
          verification.canStartSupplierSwitch ||
          (verification.verifiedForCustomerFlow && verification.verificationStatus === 'verified')
        if (!allowed) {
          blockers.push({
            code: 'grid_owner_not_verified',
            message: `Nätägaren är inte verifierad för leverantörsbyte (${verification.verificationStatus}). ${verification.nextAction ?? ''}`.trim(),
            source: 'grid_owner_verification',
          })
        }
      }
    } catch {
      warnings.push({
        code: 'grid_owner_verification_unavailable',
        message: 'Nätägarverifieringen kunde inte läsas – kontrollera manuellt.',
        source: 'grid_owner_verification',
      })
    }
  }

  // 6. EDIEL route readiness ------------------------------------------------------
  let routeReadinessSnapshot: Record<string, unknown> | null = null
  if (gridOwnerId) {
    const routeReadiness = await evaluateCustomerProcessRouteReadiness({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      gridOwnerId,
      process: 'supplier_switch',
      emitEvents: false,
    })
    routeReadinessSnapshot = {
      ready: routeReadiness.ready,
      route_profile_id: routeReadiness.routeProfileId,
      communication_route_id: routeReadiness.communicationRouteId,
      family: routeReadiness.family,
      code: routeReadiness.code,
      blockers: routeReadiness.blockers,
      warnings: routeReadiness.warnings,
    }
    if (!routeReadiness.ready) {
      if (routeReadiness.blockers.length === 0) {
        blockers.push({
          code: 'route_not_ready',
          message: 'Ediel-rutten för leverantörsbyte (PRODAT Z03) är inte klar.',
          source: 'route_readiness',
        })
      }
      for (const blocker of routeReadiness.blockers) {
        blockers.push({
          code: blocker.code || 'route_not_ready',
          message: blocker.message,
          source: 'route_readiness',
        })
      }
    }
    for (const warning of routeReadiness.warnings) {
      warnings.push({ code: warning.code, message: warning.message, source: 'route_readiness' })
    }
  }

  // 7. Duplicate open switch + scheduler guards -----------------------------------
  let openSwitchRequestId: string | null = null
  const openSwitch = await findOpenSupplierSwitchRequestForSite(supabaseService, {
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
  })
  if (openSwitch && openSwitch.id !== input.switchRequestId) {
    openSwitchRequestId = openSwitch.id
    blockers.push({
      code: 'duplicate_open_supplier_switch',
      message: `Det finns redan ett öppet leverantörsbyte (${openSwitch.status}) för anläggningen.`,
      source: 'scheduler',
    })
  } else if (openSwitch) {
    openSwitchRequestId = openSwitch.id
  }

  let scheduleSnapshot: Record<string, unknown> | null = null
  if (input.switchRequestId) {
    const schedule = await evaluateSupplierSwitchSchedule({
      switchRequestId: input.switchRequestId,
      companyId: input.companyId,
      requestedStartDate: input.requestedStartDate ?? null,
      siteId: input.siteId,
      meteringPointId: candidateMeteringPoint?.id ?? null,
      now: input.now,
    })
    scheduleSnapshot = {
      ok: schedule.ok,
      window: schedule.window,
      blockers: schedule.blockers,
    }
    for (const blocker of schedule.blockers) {
      blockers.push({ code: blocker.code, message: blocker.message, source: 'scheduler' })
    }
  }

  const ready = blockers.length === 0

  const readinessSnapshot: Record<string, unknown> = {
    version: 'supplier_switch_readiness_v1',
    evaluated_at: evaluatedAt,
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId,
    contract_id: effectiveContractId,
    switch_request_id: input.switchRequestId ?? null,
    ready,
    blockers,
    warnings,
    site_readiness: {
      is_ready: siteReadiness.isReady,
      issues: siteReadiness.issues,
      candidate_metering_point_id: siteReadiness.candidateMeteringPointId,
      latest_power_of_attorney_id: siteReadiness.latestPowerOfAttorneyId,
    },
    contract: contractSnapshot,
    legal_acceptance_count: legalAcceptanceCount,
    lifecycle_block: lifecycleBlock
      ? { source: lifecycleBlock.source, id: lifecycleBlock.id, decision_type: lifecycleBlock.decisionType }
      : null,
    grid_owner_verification: gridOwnerVerification,
    route_readiness: routeReadinessSnapshot,
    schedule: scheduleSnapshot,
    open_switch_request_id: openSwitchRequestId,
  }

  return {
    ready,
    blockers,
    warnings,
    nextRequiredAction: nextActionForBlockers(blockers),
    readinessSnapshot,
    siteReadiness,
    site,
    candidateMeteringPoint,
    openSwitchRequestId,
  }
}

/**
 * Persist a readiness snapshot on the supplier switch request. Tolerates
 * databases where the snapshot column has not been migrated yet.
 */
export async function persistSwitchReadinessSnapshot(input: {
  switchRequestId: string
  companyId: string
  snapshot: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabaseService
    .from('supplier_switch_requests')
    .update({
      readiness_snapshot: input.snapshot,
      readiness_checked_at: new Date().toISOString(),
    })
    .eq('id', input.switchRequestId)
    .eq('company_id', input.companyId)

  if (error) {
    const code = (error as { code?: string }).code ?? ''
    if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)) return
    throw error
  }
}
