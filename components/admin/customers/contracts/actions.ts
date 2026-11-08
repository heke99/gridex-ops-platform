'use server'

import { catalogPricesOverridden, firstContractPricingError, validateContractPricing } from '@/lib/customer-contracts/pricingValidation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { redirect } from 'next/navigation'
import { autoSendSigningLinkAfterCreate } from '@/lib/customer-contracts/autoSendSigningLink'
import { importSignedAgreementForContract } from '@/lib/customer-contracts/importSignedAgreement'
import {
  SIGNED_AGREEMENT_IMPORTED_MESSAGE,
  SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE,
  resolveContractSigningChoice,
  type ResolvedSigningChoice,
} from '@/lib/customer-contracts/signingMethod'
import {
  addCustomerContractEvent,
  createCustomerContract,
  getContractOfferById,
  getCustomerContractById,
  SEALED_CONTRACT_LIFECYCLE_TRANSITIONS,
  SEALED_CONTRACT_TRANSITION_REFUSED_MESSAGE,
  updateCustomerContract,
  updateSealedCustomerContractLifecycle,
} from '@/lib/customer-contracts/db'
import type {
  ContractOfferRow,
  CustomerContractEventType,
  CustomerContractRow,
} from '@/lib/customer-contracts/types'
import {
  assertContractTenant,
  assertCustomerSiteTenant,
  assertMeteringPointTenant,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'
import {
  parseBoolean,
  parseContractType,
  parseGreenFeeMode,
  parseIntOrNull,
  parseNumberOrNull,
  parseStringOrNull,
  parseTerminationReason,
} from './helpers'
import {
  commercialModelFromSnapshot,
  mergeFrozenPriceComponentsWithCommercialSelection,
  resolveCommercialSelection,
  type InvoiceDeliveryMethod,
} from '@/lib/pricing/commercialModel'
import { isPriceArea, type PriceArea } from '@/lib/pricing/types'
import { standardConsumptionVatPercent } from '@/lib/pricing/vat'

function manualContractVatRate(formData: FormData, contract?: CustomerContractRow): number | null {
  // Bound or frozen commercial terms keep their authoritative historic rate.
  if (contract && (contract.status !== 'draft' || contract.locked_at || contract.signed_at ||
    contract.contract_offer_id || contract.public_contract_offer_id ||
    contract.contract_publication_version_id)) {
    return contract.vat_rate ?? null
  }
  if (contract?.energy_direction === 'production') {
    const percent = parseNumberOrNull(formData.get('vat_rate'))
    if (percent === null) return contract.vat_rate ?? null
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('Moms måste ligga mellan 0 och 100 procent.')
    }
    return percent / 100
  }
  return standardConsumptionVatPercent(formData.get('vat_rate')) / 100
}

function manualProductionConfiguration(contract: CustomerContractRow): Record<string, unknown> {
  if (contract.energy_direction !== 'production' || contract.status !== 'draft' ||
    contract.locked_at || contract.signed_at || contract.contract_offer_id ||
    contract.public_contract_offer_id || contract.contract_publication_version_id) return {}
  const production = contract.price_snapshot?.production
  if (!production || typeof production !== 'object' || Array.isArray(production)) return {}
  // Only canonical settlement configuration crosses into new authoring. Old
  // receipt hashes, binding IDs and customer/publication metadata never do.
  const source = production as Record<string, unknown>
  const keys = [
    'enabled', 'compensation_model', 'resolution', 'deduction_ore_per_kwh',
    'premium_ore_per_kwh', 'fixed_compensation_ore_per_kwh', 'compensation_ore_per_kwh',
    'compensation_sek_per_kwh', 'vat_rate', 'vat_rate_decimal', 'vat_rate_percent',
    'vat_treatment', 'settlement_mode', 'billing_direction', 'metering_point_role',
  ]
  return {
    energy_direction: contract.energy_direction,
    production: Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]])),
  }
}

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function buildPriceSnapshot(input: {
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  invoiceFeeSek?: number | null
  greenFeeMode?: string | null
  greenFeeValue?: number | null
  discountValue?: number | null
  discountUnit?: string | null
  startFeeSek?: number | null
  adminFeeSek?: number | null
  breakFeeSek?: number | null
  vatRate?: number | null
}) {
  return {
    fixedPriceOrePerKwh: input.fixedPriceOrePerKwh ?? null,
    spotMarkupOrePerKwh: input.spotMarkupOrePerKwh ?? null,
    variableFeeOrePerKwh: input.variableFeeOrePerKwh ?? null,
    monthlyFeeSek: input.monthlyFeeSek ?? null,
    invoiceFeeSek: input.invoiceFeeSek ?? null,
    greenFeeMode: input.greenFeeMode ?? null,
    greenFeeValue: input.greenFeeValue ?? null,
    discountValue: input.discountValue ?? null,
    discountUnit: input.discountUnit ?? null,
    startFeeSek: input.startFeeSek ?? null,
    adminFeeSek: input.adminFeeSek ?? null,
    breakFeeSek: input.breakFeeSek ?? null,
    vatRate: input.vatRate ?? null,
  }
}

function buildCampaignSnapshot(input: {
  campaignName?: string | null
  campaignCode?: string | null
  campaignVersion?: string | null
  priceVersion?: string | null
  termsVersion?: string | null
  meteringPointId?: string | null
  offer?: ContractOfferRow | null
}) {
  return {
    campaignName: input.campaignName ?? null,
    campaignCode: input.campaignCode ?? null,
    campaignVersion: input.campaignVersion ?? null,
    priceVersion: input.priceVersion ?? null,
    termsVersion: input.termsVersion ?? null,
    meteringPointId: input.meteringPointId ?? null,
    offerId: input.offer?.id ?? null,
    offerName: input.offer?.name ?? null,
    offerVersion: input.offer?.offer_version ?? null,
  }
}

async function emitLifecycleEventsForStatus(params: {
  companyId: string
  customerId: string
  contractId: string
  status: CustomerContractRow['status']
  startsAt: string | null
  signedAt: string | null
  terminationNoticeDate: string | null
  endsAt: string | null
  actorUserId: string
  context: 'create' | 'update'
}) {
  const noteSuffix =
    params.context === 'create'
      ? 'registrerat från kundkortet'
      : 'status ändrad från kundkortet'

  if (params.status === 'pending_signature') {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signature_requested',
      happenedAt: params.startsAt ?? undefined,
      note: `Signering skickad / väntar signering ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.status === 'signed') {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signed',
      happenedAt: params.signedAt ?? params.startsAt ?? undefined,
      note: `Avtal signerat ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.status === 'active') {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signed',
      happenedAt: params.signedAt ?? params.startsAt ?? undefined,
      note: `Signering registrerad före aktivering ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })

    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'activated',
      happenedAt: params.startsAt ?? undefined,
      note: `Avtal aktiverat ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.status === 'terminated') {
    if (params.terminationNoticeDate) {
      await addCustomerContractEvent({
        companyId: params.companyId,
        customerContractId: params.contractId,
        customerId: params.customerId,
        eventType: 'termination_notice_received',
        happenedAt: params.terminationNoticeDate,
        note: `Uppsägning mottagen ${noteSuffix}`,
        actorUserId: params.actorUserId,
      })
    }

    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'terminated',
      happenedAt: params.endsAt ?? params.terminationNoticeDate ?? undefined,
      note: `Avtal avslutat ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.status === 'cancelled') {
    await addCustomerContractEvent({
      companyId: params.companyId,
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'cancelled',
      happenedAt: params.endsAt ?? undefined,
      note: `Avtal avbrutet ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })
  }
}

// Staff must choose how a new contract is signed. New rows only start as
// draft or pending_signature; "already signed" goes through the canonical
// signed-agreement import after the row exists, never a raw signed insert.
function parseCreateSigningChoice(
  formData: FormData,
  uploadedCreateStatus: 'draft' | 'pending_signature',
) {
  const raw = formData.get('signed_agreement_file')
  const file = raw instanceof File && raw.size > 0 ? raw : null
  const choice = resolveContractSigningChoice({
    method: getString(formData, 'signing_method'),
    file,
    signedDate: getString(formData, 'signed_date'),
    uploadedCreateStatus,
  })
  return { choice, file }
}

type ResolvedCreateSigningChoice = Extract<ResolvedSigningChoice, { ok: true }>

// Runs after the contract (and its events) are committed: imports the signed
// agreement or sends the signing link, then shows the outcome on the
// signature page. Never throws for an import/send failure.
async function completeContractSigningChoice(input: {
  companyId: string
  customerId: string
  contractId: string
  siteId: string | null
  meteringPointId: string | null
  actorUserId: string
  choice: ResolvedCreateSigningChoice
  file: File | null
}) {
  const signaturePath = `/admin/customers/${input.customerId}/contracts/${input.contractId}/signature`
  if (input.choice.importSignedAgreement && input.file) {
    let param: 'notice' | 'warning' = 'notice'
    let message = SIGNED_AGREEMENT_IMPORTED_MESSAGE
    try {
      await importSignedAgreementForContract({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contractId,
        siteId: input.siteId,
        meteringPointId: input.meteringPointId,
        file: input.file,
        declaredSignedDate: input.choice.signedDate,
      })
    } catch (error) {
      console.error('[contracts] signed agreement import failed', {
        companyId: input.companyId,
        contractId: input.contractId,
        error: error instanceof Error ? error.message : String(error),
      })
      param = 'warning'
      message = SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE
    }
    revalidatePath(`/admin/customers/${input.customerId}`)
    revalidatePath(signaturePath)
    redirect(`${signaturePath}?${param}=${encodeURIComponent(message)}`)
  }
  if (input.choice.sendSigningLink) {
    await autoSendSigningLinkAndRedirect({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      actorUserId: input.actorUserId,
      status: input.choice.createStatus,
    })
  }
}

// Runs after the contract (and its events) are committed. Never throws for a
// send failure: the result is shown as a notice on the signature page.
async function autoSendSigningLinkAndRedirect(input: {
  companyId: string
  customerId: string
  contractId: string
  actorUserId: string
  status: string
}) {
  if (input.status !== 'pending_signature') return
  const result = await autoSendSigningLinkAfterCreate({
    companyId: input.companyId,
    customerId: input.customerId,
    contractId: input.contractId,
    actorUserId: input.actorUserId,
    // Both create actions already require contracts.write via the guard.
    actorCanWriteContracts: true,
  })
  if (!result.message) return
  const signaturePath = `/admin/customers/${input.customerId}/contracts/${input.contractId}/signature`
  revalidatePath(signaturePath)
  const param = result.status === 'sent' ? 'notice' : 'warning'
  redirect(`${signaturePath}?${param}=${encodeURIComponent(result.message)}`)
}

export async function logContractEventAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Du saknar behörighet.')
  }

  const customerId = getString(formData, 'customer_id')
  const customerContractId = getString(formData, 'customer_contract_id')
  const eventType = (getString(formData, 'event_type') || 'note') as CustomerContractEventType
  const note = getString(formData, 'note') || null
  const happenedAt = getString(formData, 'happened_at') || null

  if (!customerId || !customerContractId) {
    throw new Error('Kund eller avtal saknas. Ladda om sidan och försök igen.')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)
  await assertContractTenant({ companyId, customerId, contractId: customerContractId })

  await addCustomerContractEvent({
    companyId,
    customerContractId,
    customerId,
    eventType,
    note,
    happenedAt,
    actorUserId: user.id,
  })

  revalidatePath(`/admin/customers/${customerId}`)
}

export async function createContractFromOfferAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Du saknar behörighet.')
  }

  const customerId = getString(formData, 'customer_id')
  const contractOfferId = getString(formData, 'contract_offer_id')

  if (!customerId || !contractOfferId) {
    throw new Error('Välj kund och avtalsmall.')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)
  const offer = await getContractOfferById(contractOfferId, companyId)
  if (!offer || !offer.is_active || offer.status !== 'active') {
    throw new Error('Avtalsmallen är inte aktiv eller tillhör inte valt bolag.')
  }

  const { choice: signingChoice, file: signedAgreementFile } = parseCreateSigningChoice(formData, 'pending_signature')
  if (!signingChoice.ok) {
    const fields = {signingMethod:'signing_method', signedAgreementFile:'signed_agreement_file', signedDate:'signed_date'}
    const entry = Object.entries(signingChoice.errors).find(([,message]) => message)
    return {status:'invalid' as const, message: entry?.[1] ?? 'Välj hur avtalet ska signeras.',
      field: entry ? fields[entry[0] as keyof typeof fields] : 'signing_method'}
  }
  const status: CustomerContractRow['status'] = signingChoice.createStatus
  const siteId = parseStringOrNull(formData.get('site_id'))
  const meteringPointId = parseStringOrNull(formData.get('metering_point_id'))
  await assertCustomerSiteTenant({ companyId, customerId, siteId })
  await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId })

  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const signedAt: string | null = null
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const overrideReason = parseStringOrNull(formData.get('override_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))
  const offerDateError = firstContractPricingError(validateContractPricing({
    contractType: offer.contract_type,
    customPricing: false,
    catalogOverridden: false,
    startsAt,
    endsAt,
  }))
  if (offerDateError) throw new Error(offerDateError)

  const commercialModel = commercialModelFromSnapshot(
    offer.commercial_snapshot,
  )
  let resolvedSelection: ReturnType<
    typeof resolveCommercialSelection
  > | null = null
  let canonicalPriceArea: PriceArea | null = null
  const invoiceDeliveryMethod = (
    getString(formData, 'invoice_delivery_method') || 'email'
  ) as InvoiceDeliveryMethod
  if (commercialModel) {
    const { data: priceAreaSource, error: priceAreaError } =
      meteringPointId
        ? await supabaseService
            .from('metering_points')
            .select('price_area_code')
            .eq('company_id', companyId)
            .eq('id', meteringPointId)
            .maybeSingle()
        : siteId
          ? await supabaseService
              .from('customer_sites')
              .select('price_area_code')
              .eq('company_id', companyId)
              .eq('id', siteId)
              .maybeSingle()
          : { data: null, error: null }
    if (priceAreaError) throw priceAreaError
    const area = String(priceAreaSource?.price_area_code ?? '')
      .trim()
      .toUpperCase()
    if (!isPriceArea(area)) {
      throw new Error(
        'Vald anläggning eller mätpunkt måste ha verifierat prisområde SE1–SE4.',
      )
    }
    canonicalPriceArea = area
    const { data: customerRow, error: customerError } = await supabaseService
      .from('customers')
      .select('customer_type')
      .eq('company_id', companyId)
      .eq('id', customerId)
      .maybeSingle()
    if (customerError) throw customerError
    const customerType =
      customerRow?.customer_type === 'business' ? 'business' : 'private'
    const { data: consumptionRow, error: consumptionError } = siteId
      ? await supabaseService
          .from('customer_sites')
          .select('annual_consumption_kwh')
          .eq('company_id', companyId)
          .eq('id', siteId)
          .maybeSingle()
      : { data: null, error: null }
    if (consumptionError) throw consumptionError
    const requiresAnnualConsumption = commercialModel.components.some(
      (component) =>
        component.conditions.minimum_annual_consumption_kwh !== null ||
        component.conditions.maximum_annual_consumption_kwh !== null,
    )
    const rawAnnualConsumptionKwh =
      consumptionRow?.annual_consumption_kwh ?? null
    const annualConsumptionKwh = Number(rawAnnualConsumptionKwh)
    const hasAnnualConsumption =
      rawAnnualConsumptionKwh !== null &&
      Number.isFinite(annualConsumptionKwh) &&
      annualConsumptionKwh >= 0
    if (requiresAnnualConsumption && !hasAnnualConsumption) {
      throw new Error(
        'Vald anläggning måste ha verifierad årsförbrukning när avtalet har förbrukningsvillkor.',
      )
    }
    resolvedSelection = resolveCommercialSelection({
      model: commercialModel,
      contractType: offer.contract_type,
      priceOptionReference:
        getString(formData, 'price_option_reference') || null,
      priceArea: canonicalPriceArea,
      customerType,
      invoiceDeliveryMethod,
      selectedComponentReferences: formData
        .getAll('selected_component_references')
        .map(String),
      adminSelectedComponentReferences: formData
        .getAll('admin_selected_component_references')
        .map(String),
      annualConsumptionKwh: hasAnnualConsumption
        ? annualConsumptionKwh
        : 0,
      siteCount: 1,
      startDate: startsAt ?? new Date().toISOString().slice(0, 10),
      salesChannel: 'internal',
    })
  }
  const selectedFixedOre =
    resolvedSelection?.areaPrice?.unit === 'sek_per_kwh'
      ? resolvedSelection.areaPrice.amount * 100
      : resolvedSelection?.areaPrice?.amount ?? offer.fixed_price_ore_per_kwh
  const catalogBaseComponents = Array.isArray(
    offer.commercial_snapshot?.base_components,
  )
    ? offer.commercial_snapshot.base_components
    : Array.isArray(
          offer.commercial_snapshot?.base_price_components_snapshot,
        )
      ? offer.commercial_snapshot.base_price_components_snapshot
      : []
  const frozenBaseComponents =
    resolvedSelection?.areaPrice && canonicalPriceArea
      ? catalogBaseComponents.map((value) => {
          const component = value as Record<string, unknown>
          return (component.source_type ?? component.sourceType) === 'fixed'
            ? {
                ...component,
                fixed_price_sek_per_kwh: selectedFixedOre! / 100,
                fixedPriceSekPerKwh: selectedFixedOre! / 100,
                price_area: canonicalPriceArea,
                priceArea: canonicalPriceArea,
                price_option_reference:
                  resolvedSelection!.priceOption.price_option_reference,
                price_row_reference:
                  resolvedSelection!.areaPrice!.price_row_reference,
              }
            : component
        })
      : catalogBaseComponents
  const frozenCatalogPriceComponents = Array.isArray(
    offer.commercial_snapshot?.price_components,
  )
    ? offer.commercial_snapshot.price_components
    : Array.isArray(offer.commercial_snapshot?.price_components_snapshot)
      ? offer.commercial_snapshot.price_components_snapshot
      : []
  const selectedPriceComponents =
    resolvedSelection && commercialModel
      ? mergeFrozenPriceComponentsWithCommercialSelection({
          frozenComponents: frozenCatalogPriceComponents,
          model: commercialModel,
          selectedComponents: resolvedSelection.components,
        })
      : frozenCatalogPriceComponents
  const hasFrozenOfferSnapshot =
    frozenBaseComponents.length > 0 || selectedPriceComponents.length > 0
  const priceSnapshot = resolvedSelection
    ? {
        ...offer.commercial_snapshot,
        snapshot_schema: 'gridex_contract_pricing_v6_selection',
        source: 'internal_customer_contract_selection',
        contract_type: offer.contract_type,
        price_area: canonicalPriceArea,
        price_option_reference:
          resolvedSelection.priceOption.price_option_reference,
        area_price_reference:
          resolvedSelection.areaPrice?.price_row_reference ?? null,
        invoice_delivery_method: invoiceDeliveryMethod,
        selected_component_references:
          resolvedSelection.selectedComponentReferences,
        mandatory_component_references:
          resolvedSelection.mandatoryComponentReferences,
        conditional_component_references:
          resolvedSelection.conditionalComponentReferences,
        base_price_components_snapshot: frozenBaseComponents,
        price_components_snapshot: selectedPriceComponents,
      }
    : hasFrozenOfferSnapshot
      ? {
          ...offer.commercial_snapshot,
          source: 'internal_customer_contract_catalog_snapshot',
          contract_type: offer.contract_type,
          base_price_components_snapshot: frozenBaseComponents,
          price_components_snapshot: selectedPriceComponents,
        }
      : buildPriceSnapshot({
          fixedPriceOrePerKwh: offer.fixed_price_ore_per_kwh,
          spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
          variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
          monthlyFeeSek: offer.monthly_fee_sek,
          invoiceFeeSek: offer.invoice_fee_sek,
          greenFeeMode: offer.green_fee_mode,
          greenFeeValue: offer.green_fee_value,
          discountValue: offer.discount_value,
          discountUnit: offer.discount_unit,
          startFeeSek: offer.start_fee_sek,
          adminFeeSek: offer.admin_fee_sek,
          breakFeeSek: offer.break_fee_sek,
          vatRate: offer.vat_rate,
        })
  const campaignSnapshot = buildCampaignSnapshot({
    campaignName: offer.campaign_name,
    campaignCode: offer.campaign_code ?? null,
    campaignVersion: offer.campaign_version ?? null,
    priceVersion: offer.price_version ?? null,
    termsVersion: offer.terms_version ?? null,
    meteringPointId,
    offer,
  })

  const canonicalCommand = resolvedSelection
    ? await supabaseService.rpc('gridex_create_internal_customer_contract_v1', {
        p_company_id: companyId,
        p_customer_id: customerId,
        p_contract_offer_id: offer.id,
        p_site_id: siteId,
        p_metering_point_id: meteringPointId,
        p_selection: priceSnapshot,
        p_contract: {
          status,
          contract_name: offer.name,
          starts_at: startsAt,
          ends_at: endsAt,
          signed_at: null,
          termination_notice_date: terminationNoticeDate,
          termination_reason: terminationReason,
          auto_renew_enabled: autoRenewEnabled,
          auto_renew_term_months: autoRenewTermMonths,
          override_reason: overrideReason,
        },
        p_actor_user_id: user.id,
      })
    : null
  if (canonicalCommand?.error) throw canonicalCommand.error
  const canonicalContract = canonicalCommand?.data
    ? ((canonicalCommand.data as Record<string, unknown>)
        .contract as CustomerContractRow | undefined)
    : undefined
  const contract = canonicalContract ?? await createCustomerContract({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    contractOfferId: offer.id,
    sourceType: 'catalog',
    status,
    contractName: offer.name,
    contractType: offer.contract_type,
    campaignName: offer.campaign_name,
    campaignCode: offer.campaign_code ?? null,
    campaignVersion: offer.campaign_version ?? null,
    priceVersion: offer.price_version ?? null,
    termsVersion: offer.terms_version ?? null,
    discountValue: offer.discount_value ?? null,
    discountUnit: offer.discount_unit ?? null,
    startFeeSek: offer.start_fee_sek ?? null,
    adminFeeSek: offer.admin_fee_sek ?? null,
    breakFeeSek: offer.break_fee_sek ?? null,
    vatRate: offer.vat_rate ?? null,
    priceSnapshot,
    campaignSnapshot,
    fixedPriceOrePerKwh: selectedFixedOre,
    spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
    variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
    monthlyFeeSek: offer.monthly_fee_sek,
    invoiceFeeSek: offer.invoice_fee_sek,
    greenFeeMode: offer.green_fee_mode,
    greenFeeValue: offer.green_fee_value,
    bindingMonths:
      resolvedSelection?.priceOption.binding_months ??
      offer.default_binding_months,
    noticeMonths:
      resolvedSelection?.priceOption.notice_months ??
      offer.default_notice_months,
    optionalFeeLines:
      resolvedSelection?.components.map((component) => ({
        ...component,
        component_reference: component.componentReference,
        component_code: component.componentCode,
      })) ?? offer.optional_fee_lines ?? [],
    startsAt,
    endsAt,
    // Never signed at insert; see parseCreateSigningChoice.
    signedAt: null,
    terminationNoticeDate,
    terminationReason,
    autoRenewEnabled,
    autoRenewTermMonths,
    overrideReason,
    actorUserId: user.id,
  })

  await addCustomerContractEvent({
    companyId,
    customerContractId: contract.id,
    customerId,
    eventType: 'created',
    note: 'Kundavtal skapat från aktiv avtalsmall på kundkortet',
    metadata: {
      sourceType: 'catalog',
      contractOfferId: offer.id,
      offerName: offer.name,
      autoRenewEnabled,
      autoRenewTermMonths,
      terminationReason,
      campaignCode: offer.campaign_code ?? null,
      campaignVersion: offer.campaign_version ?? null,
      priceVersion: offer.price_version ?? null,
      termsVersion: offer.terms_version ?? null,
      meteringPointId,
    },
    actorUserId: user.id,
  })

  // An imported signed agreement records its own 'signed' event in the DB.
  if (!signingChoice.importSignedAgreement) await emitLifecycleEventsForStatus({
    companyId,
    customerId,
    contractId: contract.id,
    status,
    startsAt,
    signedAt,
    terminationNoticeDate,
    endsAt,
    actorUserId: user.id,
    context: 'create',
  })

  revalidatePath(`/admin/customers/${customerId}`)
  await completeContractSigningChoice({
    companyId,
    customerId,
    contractId: contract.id,
    siteId,
    meteringPointId,
    actorUserId: user.id,
    choice: signingChoice,
    file: signedAgreementFile,
  })
  redirect(`/admin/customers/${customerId}/contracts/${contract.id}/signature`)
}

export async function createContractAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Du saknar behörighet.')
  }

  const customerId = getString(formData, 'customer_id')
  if (!customerId) {
    throw new Error('Kund saknas. Ladda om sidan och försök igen.')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)

  const contractName = getString(formData, 'contract_name')
  if (!contractName) {
    throw new Error('Avtalsnamn krävs')
  }

  const { choice: signingChoice, file: signedAgreementFile } = parseCreateSigningChoice(formData, 'draft')
  if (!signingChoice.ok) {
    const fields = {signingMethod:'signing_method', signedAgreementFile:'signed_agreement_file', signedDate:'signed_date'}
    const entry = Object.entries(signingChoice.errors).find(([,message]) => message)
    return {status:'invalid' as const, message: entry?.[1] ?? 'Välj hur avtalet ska signeras.',
      field: entry ? fields[entry[0] as keyof typeof fields] : 'signing_method'}
  }
  const status: CustomerContractRow['status'] = signingChoice.createStatus
  const siteId = parseStringOrNull(formData.get('site_id'))
  const meteringPointId = parseStringOrNull(formData.get('metering_point_id'))
  await assertCustomerSiteTenant({ companyId, customerId, siteId })
  await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId })

  const contractType = parseContractType(formData.get('contract_type'))
  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const signedAt: string | null = null
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const overrideReason = parseStringOrNull(formData.get('override_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const campaignName = parseStringOrNull(formData.get('campaign_name'))
  const campaignCode = parseStringOrNull(formData.get('campaign_code'))
  const campaignVersion = parseStringOrNull(formData.get('campaign_version'))
  const priceVersion = parseStringOrNull(formData.get('price_version'))
  const termsVersion = parseStringOrNull(formData.get('terms_version'))
  const fixedPriceOrePerKwh = parseNumberOrNull(formData.get('fixed_price_ore_per_kwh'))
  const spotMarkupOrePerKwh = parseNumberOrNull(formData.get('spot_markup_ore_per_kwh'))
  const variableFeeOrePerKwh = parseNumberOrNull(formData.get('variable_fee_ore_per_kwh'))
  const monthlyFeeSek = parseNumberOrNull(formData.get('monthly_fee_sek'))
  const invoiceFeeSek = parseNumberOrNull(formData.get('invoice_fee_sek'))
  const greenFeeMode = parseGreenFeeMode(formData.get('green_fee_mode'))
  const greenFeeValue = parseNumberOrNull(formData.get('green_fee_value'))
  const discountValue = parseNumberOrNull(formData.get('discount_value'))
  const discountUnit = parseStringOrNull(formData.get('discount_unit'))
  const startFeeSek = parseNumberOrNull(formData.get('start_fee_sek'))
  const adminFeeSek = parseNumberOrNull(formData.get('admin_fee_sek'))
  const breakFeeSek = parseNumberOrNull(formData.get('break_fee_sek'))
  const vatRate = manualContractVatRate(formData)

  // Manual contracts carry custom pricing: the price that matches the
  // contract type is mandatory and the period must be ordered.
  const manualPricingError = firstContractPricingError(validateContractPricing({
    contractType,
    customPricing: true,
    catalogOverridden: false,
    fixedPriceOrePerKwh,
    spotMarkupOrePerKwh,
    overrideReason,
    startsAt,
    endsAt,
  }))
  if (manualPricingError) throw new Error(manualPricingError)

  const contract = await createCustomerContract({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    contractOfferId: null,
    sourceType: 'manual_override',
    energyDirection: 'consumption',
    status,
    contractName,
    contractType,
    campaignName,
    campaignCode,
    campaignVersion,
    priceVersion,
    termsVersion,
    discountValue,
    discountUnit,
    startFeeSek,
    adminFeeSek,
    breakFeeSek,
    vatRate,
    priceSnapshot: buildPriceSnapshot({
      fixedPriceOrePerKwh,
      spotMarkupOrePerKwh,
      variableFeeOrePerKwh,
      monthlyFeeSek,
      invoiceFeeSek,
      greenFeeMode,
      greenFeeValue,
      discountValue,
      discountUnit,
      startFeeSek,
      adminFeeSek,
      breakFeeSek,
      vatRate,
    }),
    campaignSnapshot: buildCampaignSnapshot({
      campaignName,
      campaignCode,
      campaignVersion,
      priceVersion,
      termsVersion,
      meteringPointId,
    }),
    fixedPriceOrePerKwh,
    spotMarkupOrePerKwh,
    variableFeeOrePerKwh,
    monthlyFeeSek,
    invoiceFeeSek,
    greenFeeMode,
    greenFeeValue,
    bindingMonths: parseIntOrNull(formData.get('binding_months')),
    noticeMonths: parseIntOrNull(formData.get('notice_months')),
    optionalFeeLines: [],
    startsAt,
    endsAt,
    // Never signed at insert; see parseCreateSigningChoice.
    signedAt: null,
    terminationNoticeDate,
    terminationReason,
    autoRenewEnabled,
    autoRenewTermMonths,
    overrideReason,
    actorUserId: user.id,
  })

  await addCustomerContractEvent({
    companyId,
    customerContractId: contract.id,
    customerId,
    eventType: 'created',
    note: 'Manuellt kundavtal skapat från kundkortet',
    metadata: {
      sourceType: 'manual_override',
      autoRenewEnabled,
      autoRenewTermMonths,
      terminationReason,
      campaignCode,
      campaignVersion,
      priceVersion,
      termsVersion,
    },
    actorUserId: user.id,
  })

  // An imported signed agreement records its own 'signed' event in the DB.
  if (!signingChoice.importSignedAgreement) await emitLifecycleEventsForStatus({
    companyId,
    customerId,
    contractId: contract.id,
    status,
    startsAt,
    signedAt,
    terminationNoticeDate,
    endsAt,
    actorUserId: user.id,
    context: 'create',
  })

  revalidatePath(`/admin/customers/${customerId}`)
  await completeContractSigningChoice({
    companyId,
    customerId,
    contractId: contract.id,
    siteId,
    meteringPointId,
    actorUserId: user.id,
    choice: signingChoice,
    file: signedAgreementFile,
  })
  redirect(`/admin/customers/${customerId}/contracts/${contract.id}/signature`)
}

const SEALED_CONTRACT_STATUSES = new Set<string>(['signed', 'active', 'terminated', 'cancelled', 'expired'])
const SIGNED_CONTRACT_EDIT_REFUSED_MESSAGE = 'Signerat avtal kan inte ändras – använd avtalsåtgärder.'

/** Map known database refusals from the customer-card writer to controlled
 * Swedish validation errors; unknown errors are returned unchanged. */
function controlledContractUpdateError(error: unknown): unknown {
  const problem = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null
  const message = typeof problem?.message === 'string' ? problem.message : ''
  if (problem?.code === '55000' && message.startsWith('signed_customer_contract_immutable')) {
    return new Error(SIGNED_CONTRACT_EDIT_REFUSED_MESSAGE)
  }
  if (message.includes('termination_notice_already_recorded')) {
    return new Error('Uppsägningsdatum är redan registrerat och kan inte ändras här – använd avtalsåtgärder.')
  }
  if (message.includes('termination_notice_before_contract_start')) {
    return new Error('Uppsägningsdatum kan inte vara före avtalets startdatum.')
  }
  if (message === 'customer_contract_activation_requires_supply_graph') {
    return new Error('Avtalet kan bara aktiveras när leveransstarten är registrerad – använd avtalsåtgärder.')
  }
  if (message === 'customer_contract_terminal_evidence_required') {
    return new Error('Avslut kräver slutdatum och orsakskod – använd avtalsåtgärder.')
  }
  if (message.startsWith('customer_contract_transition_not_allowed:')) {
    return new Error(SEALED_CONTRACT_TRANSITION_REFUSED_MESSAGE)
  }
  return error
}

const SEALED_TEXT_FIELDS = ['site_id', 'metering_point_id', 'contract_name', 'contract_type', 'green_fee_mode', 'discount_unit', 'terms_version'] as const
const SEALED_NUMBER_FIELDS = ['fixed_price_ore_per_kwh', 'spot_markup_ore_per_kwh', 'variable_fee_ore_per_kwh', 'monthly_fee_sek', 'invoice_fee_sek', 'green_fee_value', 'discount_value', 'start_fee_sek', 'admin_fee_sek', 'break_fee_sek', 'binding_months', 'notice_months', 'auto_renew_term_months'] as const
const SEALED_DATE_FIELDS = ['starts_at', 'ends_at', 'signed_at'] as const

/** True when a submitted value differs from a column the database seals once
 * a contract is signed or locked. Absent form fields are not changes. */
function sealedFieldChanged(formData: FormData, before: CustomerContractRow): string | null {
  const row = before as unknown as Record<string, unknown>
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim())
  for (const field of SEALED_TEXT_FIELDS) {
    if (!formData.has(field)) continue
    const fallback = field === 'green_fee_mode' ? 'none' : ''
    if ((text(formData.get(field)) || fallback) !== (text(row[field]) || fallback)) return field
  }
  for (const field of [...SEALED_NUMBER_FIELDS, 'vat_rate'] as const) {
    if (!formData.has(field)) continue
    const raw = text(formData.get(field)).replace(',', '.')
    const parsed = raw === '' ? null : Number(raw)
    if (parsed !== null && !Number.isFinite(parsed)) return field
    const next = field === 'vat_rate' && parsed !== null ? parsed / 100 : parsed
    const current = row[field] === null || row[field] === undefined ? null : Number(row[field])
    if (next === null || current === null ? next !== current : Math.abs(next - current) > 1e-9) return field
  }
  for (const field of SEALED_DATE_FIELDS) {
    if (!formData.has(field)) continue
    if (text(formData.get(field)).slice(0, 10) !== text(row[field]).slice(0, 10)) return field
  }
  if (formData.has('auto_renew_present') || formData.has('auto_renew_enabled')) {
    if (parseBoolean(formData.get('auto_renew_enabled')) !== Boolean(before.auto_renew_enabled)) return 'auto_renew_enabled'
  }
  return null
}

async function updateSealedContractFromCustomerCard(params: {
  formData: FormData
  before: CustomerContractRow
  companyId: string
  customerId: string
  contractId: string
  actorUserId: string
}) {
  const { formData, before, companyId, customerId, contractId, actorUserId } = params
  if (sealedFieldChanged(formData, before)) throw new Error(SIGNED_CONTRACT_EDIT_REFUSED_MESSAGE)

  const nextStatus = (getString(formData, 'status') || before.status) as CustomerContractRow['status']
  const terminationReason = formData.has('termination_reason')
    ? parseTerminationReason(formData.get('termination_reason'))
    : before.termination_reason ?? null
  const submittedNotice = formData.has('termination_notice_date')
    ? parseStringOrNull(formData.get('termination_notice_date'))
    : before.termination_notice_date ?? null
  const previousNotice = before.termination_notice_date ? before.termination_notice_date.slice(0, 10) : null
  const nextNotice = submittedNotice ? submittedNotice.slice(0, 10) : null
  if (previousNotice && nextNotice !== previousNotice) {
    // Clearing or replacing a recorded notice is not a customer-card edit (#938).
    throw new Error('Uppsägningsdatum är redan registrerat och kan inte ändras här – använd avtalsåtgärder.')
  }
  const statusChanged = nextStatus !== before.status
  const reasonChanged = terminationReason !== (before.termination_reason ?? null)
  // Validate every transition before any write, so a refused status change
  // never leaves a termination notice behind.
  if (statusChanged && !(SEALED_CONTRACT_LIFECYCLE_TRANSITIONS[before.status] ?? []).includes(nextStatus)) {
    throw new Error(SEALED_CONTRACT_TRANSITION_REFUSED_MESSAGE)
  }
  const terminalEvent = statusChanged && (nextStatus === 'terminated' || nextStatus === 'cancelled') ? nextStatus : null

  let lifecycleWriteSucceeded = false
  try {
    if (nextNotice && !previousNotice) {
      // The canonical event command applies the notice and its database rules.
      await addCustomerContractEvent({
        companyId,
        customerContractId: contractId,
        customerId,
        eventType: 'termination_notice_received',
        happenedAt: nextNotice,
        note: 'Uppsägning registrerad från kundkortet',
        metadata: { terminationReason },
        actorUserId,
      })
      lifecycleWriteSucceeded = true
    }
    if (terminalEvent) {
      // The event RPC sets status, ended_at and status_reason_code atomically
      // (20260727165000:200-243), satisfying the terminal state invariant.
      await addCustomerContractEvent({
        companyId,
        customerContractId: contractId,
        customerId,
        eventType: terminalEvent,
        note: terminalEvent === 'terminated' ? 'Avtal avslutat från kundkortet' : 'Avtal avbrutet från kundkortet',
        metadata: {
          previousStatus: before.status,
          ...(terminationReason ? { termination_reason: terminationReason, reason_code: terminationReason } : {}),
        },
        actorUserId,
      })
      lifecycleWriteSucceeded = true
    } else if (statusChanged || reasonChanged) {
      const updated = await updateSealedCustomerContractLifecycle({
        id: contractId,
        customerId,
        companyId,
        currentStatus: before.status,
        ...(statusChanged ? { status: nextStatus } : {}),
        ...(reasonChanged ? { terminationReason } : {}),
        actorUserId,
      })
      lifecycleWriteSucceeded = true
      await addCustomerContractEvent({
        companyId,
        customerContractId: contractId,
        customerId,
        eventType: 'updated',
        note: 'Signerat avtals livscykel uppdaterad från kundkortet',
        metadata: {
          previousStatus: before.status,
          nextStatus: updated.status,
          previousTerminationReason: before.termination_reason ?? null,
          nextTerminationReason: updated.termination_reason ?? null,
        },
        actorUserId,
      })
      lifecycleWriteSucceeded = true
    }
  } catch (error) {
    // Earlier commands have committed independently. Ordinary validation would
    // invite a retry even though part of this change may already be saved.
    if (lifecycleWriteSucceeded) {
      throw new Error('Avtalsändringens utfall kunde inte bekräftas. Ladda om kundkortet och kontrollera de sparade uppgifterna innan du försöker igen.', { cause: error })
    }
    throw controlledContractUpdateError(error)
  }
  revalidatePath(`/admin/customers/${customerId}`)
}

export async function updateContractAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Du saknar behörighet.')
  }

  const customerId = getString(formData, 'customer_id')
  const contractId = getString(formData, 'customer_contract_id')

  if (!customerId || !contractId) {
    throw new Error('Kund eller avtal saknas. Ladda om sidan och försök igen.')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)
  await assertContractTenant({ companyId, customerId, contractId })

  const before = await getCustomerContractById(contractId, { companyId })
  if (!before || before.customer_id !== customerId || before.company_id !== companyId) {
    throw new Error('Kundavtalet kunde inte hittas')
  }

  // Signed/locked agreements are sealed by the database. Only lifecycle
  // fields may change; never send the full row or a rebuilt price snapshot.
  if (before.signed_at || before.locked_at || SEALED_CONTRACT_STATUSES.has(before.status)) {
    await updateSealedContractFromCustomerCard({ formData, before, companyId, customerId, contractId, actorUserId: user.id })
    return
  }

  const nextStatus = (getString(formData, 'status') || before.status) as CustomerContractRow['status']
  const siteId = parseStringOrNull(formData.get('site_id'))
  const meteringPointId = parseStringOrNull(formData.get('metering_point_id'))
  await assertCustomerSiteTenant({ companyId, customerId, siteId })
  await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId })

  const signedAt = parseStringOrNull(formData.get('signed_at'))
  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const campaignName = parseStringOrNull(formData.get('campaign_name'))
  const campaignCode = parseStringOrNull(formData.get('campaign_code'))
  const campaignVersion = parseStringOrNull(formData.get('campaign_version'))
  const priceVersion = parseStringOrNull(formData.get('price_version'))
  const termsVersion = parseStringOrNull(formData.get('terms_version'))
  const fixedPriceOrePerKwh = parseNumberOrNull(formData.get('fixed_price_ore_per_kwh'))
  const spotMarkupOrePerKwh = parseNumberOrNull(formData.get('spot_markup_ore_per_kwh'))
  const variableFeeOrePerKwh = parseNumberOrNull(formData.get('variable_fee_ore_per_kwh'))
  const monthlyFeeSek = parseNumberOrNull(formData.get('monthly_fee_sek'))
  const invoiceFeeSek = parseNumberOrNull(formData.get('invoice_fee_sek'))
  const greenFeeMode = parseGreenFeeMode(formData.get('green_fee_mode'))
  const greenFeeValue = parseNumberOrNull(formData.get('green_fee_value'))
  const discountValue = parseNumberOrNull(formData.get('discount_value'))
  const discountUnit = parseStringOrNull(formData.get('discount_unit'))
  const startFeeSek = parseNumberOrNull(formData.get('start_fee_sek'))
  const adminFeeSek = parseNumberOrNull(formData.get('admin_fee_sek'))
  const breakFeeSek = parseNumberOrNull(formData.get('break_fee_sek'))
  const vatRate = manualContractVatRate(formData, before)

  // Catalog-backed contracts need a documented reason when prices are changed.
  const updatePricingError = firstContractPricingError(validateContractPricing({
    contractType: parseContractType(formData.get('contract_type')),
    customPricing: false,
    catalogOverridden: before.contract_offer_id
      ? catalogPricesOverridden(before, { fixedPriceOrePerKwh, spotMarkupOrePerKwh, variableFeeOrePerKwh, monthlyFeeSek, invoiceFeeSek })
      : false,
    overrideReason: getString(formData, 'override_reason') || null,
    startsAt,
    endsAt,
  }))
  if (updatePricingError) throw new Error(updatePricingError)

  let updated: Awaited<ReturnType<typeof updateCustomerContract>>
  try {
    updated = await updateCustomerContract({
      id: contractId,
      customerId,
      siteId,
      meteringPointId,
      companyId,
      status: nextStatus,
      energyDirection: before.energy_direction,
      contractName: getString(formData, 'contract_name') || before.contract_name,
      contractType: parseContractType(formData.get('contract_type')),
      campaignName,
      campaignCode,
      campaignVersion,
      priceVersion,
      termsVersion,
      discountValue,
      discountUnit,
      startFeeSek,
      adminFeeSek,
      breakFeeSek,
      vatRate,
      priceSnapshot: {
        ...manualProductionConfiguration(before),
        ...buildPriceSnapshot({
          fixedPriceOrePerKwh,
          spotMarkupOrePerKwh,
          variableFeeOrePerKwh,
          monthlyFeeSek,
          invoiceFeeSek,
          greenFeeMode,
          greenFeeValue,
          discountValue,
          discountUnit,
          startFeeSek,
          adminFeeSek,
          breakFeeSek,
          vatRate,
        }),
      },
      campaignSnapshot: buildCampaignSnapshot({
        campaignName,
        campaignCode,
        campaignVersion,
        priceVersion,
        termsVersion,
        meteringPointId,
      }),
      fixedPriceOrePerKwh,
      spotMarkupOrePerKwh,
      variableFeeOrePerKwh,
      monthlyFeeSek,
      invoiceFeeSek,
      greenFeeMode,
      greenFeeValue,
      bindingMonths: parseIntOrNull(formData.get('binding_months')),
      noticeMonths: parseIntOrNull(formData.get('notice_months')),
      startsAt,
      endsAt,
      signedAt,
      terminationNoticeDate,
      terminationReason,
      autoRenewEnabled,
      autoRenewTermMonths,
      overrideReason: getString(formData, 'override_reason') || null,
      actorUserId: user.id,
    })
  } catch (error) {
    throw controlledContractUpdateError(error)
  }

  await addCustomerContractEvent({
    companyId,
    customerContractId: updated.id,
    customerId,
    eventType: 'updated',
    note: 'Kundavtal uppdaterat från kundkortet',
    metadata: {
      previousStatus: before.status,
      nextStatus: updated.status,
      previousSiteId: before.site_id,
      nextSiteId: updated.site_id,
      previousMeteringPointId: before.metering_point_id ?? null,
      nextMeteringPointId: updated.metering_point_id ?? null,
      previousTerminationReason: before.termination_reason ?? null,
      nextTerminationReason: updated.termination_reason ?? null,
      previousAutoRenewEnabled: before.auto_renew_enabled,
      nextAutoRenewEnabled: updated.auto_renew_enabled,
      previousAutoRenewTermMonths: before.auto_renew_term_months ?? null,
      nextAutoRenewTermMonths: updated.auto_renew_term_months ?? null,
      previousCampaignCode: before.campaign_code ?? null,
      nextCampaignCode: updated.campaign_code ?? null,
      previousPriceVersion: before.price_version ?? null,
      nextPriceVersion: updated.price_version ?? null,
    },
    actorUserId: user.id,
  })

  if (before.status !== updated.status) {
    await emitLifecycleEventsForStatus({
      companyId,
      customerId,
      contractId: updated.id,
      status: updated.status,
      startsAt,
      signedAt,
      terminationNoticeDate,
      endsAt,
      actorUserId: user.id,
      context: 'update',
    })
  }

  if (
    terminationNoticeDate &&
    (!before.termination_notice_date || before.termination_notice_date !== terminationNoticeDate)
  ) {
    await addCustomerContractEvent({
      companyId,
      customerContractId: updated.id,
      customerId,
      eventType: 'termination_notice_received',
      happenedAt: terminationNoticeDate,
      note: 'Uppsägning registrerad eller uppdaterad från kundkortet',
      metadata: {
        terminationReason: updated.termination_reason ?? null,
      },
      actorUserId: user.id,
    })
  }

  revalidatePath(`/admin/customers/${customerId}`)
}
