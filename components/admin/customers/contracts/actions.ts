'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import {
  addCustomerContractEvent,
  createCustomerContract,
  getContractOfferById,
  getCustomerContractById,
  updateCustomerContract,
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

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function buildPriceSnapshot(input: {
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
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

export async function logContractEventAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = getString(formData, 'customer_id')
  const customerContractId = getString(formData, 'customer_contract_id')
  const eventType = (getString(formData, 'event_type') || 'note') as CustomerContractEventType
  const note = getString(formData, 'note') || null
  const happenedAt = getString(formData, 'happened_at') || null

  if (!customerId || !customerContractId) {
    throw new Error('customer_id och customer_contract_id krävs')
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
    throw new Error('Unauthorized')
  }

  const customerId = getString(formData, 'customer_id')
  const contractOfferId = getString(formData, 'contract_offer_id')

  if (!customerId || !contractOfferId) {
    throw new Error('customer_id och contract_offer_id krävs')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)
  const offer = await getContractOfferById(contractOfferId, companyId)
  if (!offer || !offer.is_active || offer.status !== 'active') {
    throw new Error('Avtalsmallen är inte aktiv eller tillhör inte valt bolag.')
  }

  const status = (getString(formData, 'status') || 'pending_signature') as CustomerContractRow['status']
  const siteId = parseStringOrNull(formData.get('site_id'))
  const meteringPointId = parseStringOrNull(formData.get('metering_point_id'))
  await assertCustomerSiteTenant({ companyId, customerId, siteId })
  await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId })

  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const signedAt = parseStringOrNull(formData.get('signed_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const overrideReason = parseStringOrNull(formData.get('override_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const priceSnapshot = buildPriceSnapshot({
    fixedPriceOrePerKwh: offer.fixed_price_ore_per_kwh,
    spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
    variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
    monthlyFeeSek: offer.monthly_fee_sek,
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

  const contract = await createCustomerContract({
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
    fixedPriceOrePerKwh: offer.fixed_price_ore_per_kwh,
    spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
    variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
    monthlyFeeSek: offer.monthly_fee_sek,
    greenFeeMode: offer.green_fee_mode,
    greenFeeValue: offer.green_fee_value,
    bindingMonths: offer.default_binding_months,
    noticeMonths: offer.default_notice_months,
    optionalFeeLines: offer.optional_fee_lines ?? [],
    startsAt,
    endsAt,
    signedAt: status === 'signed' || status === 'active' ? signedAt ?? startsAt : null,
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

  await emitLifecycleEventsForStatus({
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
}

export async function createContractAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = getString(formData, 'customer_id')
  if (!customerId) {
    throw new Error('customer_id krävs')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)

  const contractName = getString(formData, 'contract_name')
  if (!contractName) {
    throw new Error('Avtalsnamn krävs')
  }

  const status = (getString(formData, 'status') || 'draft') as CustomerContractRow['status']
  const siteId = parseStringOrNull(formData.get('site_id'))
  const meteringPointId = parseStringOrNull(formData.get('metering_point_id'))
  await assertCustomerSiteTenant({ companyId, customerId, siteId })
  await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId })

  const contractType = parseContractType(formData.get('contract_type'))
  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const signedAt = parseStringOrNull(formData.get('signed_at'))
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
  const greenFeeMode = parseGreenFeeMode(formData.get('green_fee_mode'))
  const greenFeeValue = parseNumberOrNull(formData.get('green_fee_value'))
  const discountValue = parseNumberOrNull(formData.get('discount_value'))
  const discountUnit = parseStringOrNull(formData.get('discount_unit'))
  const startFeeSek = parseNumberOrNull(formData.get('start_fee_sek'))
  const adminFeeSek = parseNumberOrNull(formData.get('admin_fee_sek'))
  const breakFeeSek = parseNumberOrNull(formData.get('break_fee_sek'))
  const vatRate = parseNumberOrNull(formData.get('vat_rate'))

  const contract = await createCustomerContract({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    contractOfferId: null,
    sourceType: 'manual_override',
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
    greenFeeMode,
    greenFeeValue,
    bindingMonths: parseIntOrNull(formData.get('binding_months')),
    noticeMonths: parseIntOrNull(formData.get('notice_months')),
    optionalFeeLines: [],
    startsAt,
    endsAt,
    signedAt: status === 'signed' || status === 'active' ? signedAt ?? startsAt : null,
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

  await emitLifecycleEventsForStatus({
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
}

export async function updateContractAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['contracts.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = getString(formData, 'customer_id')
  const contractId = getString(formData, 'customer_contract_id')

  if (!customerId || !contractId) {
    throw new Error('customer_id och customer_contract_id krävs')
  }

  const { companyId } = await loadCustomerTenantContext(customerId, guard)
  await assertContractTenant({ companyId, customerId, contractId })

  const before = await getCustomerContractById(contractId)
  if (!before || before.customer_id !== customerId || before.company_id !== companyId) {
    throw new Error('Kundavtalet kunde inte hittas')
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
  const greenFeeMode = parseGreenFeeMode(formData.get('green_fee_mode'))
  const greenFeeValue = parseNumberOrNull(formData.get('green_fee_value'))
  const discountValue = parseNumberOrNull(formData.get('discount_value'))
  const discountUnit = parseStringOrNull(formData.get('discount_unit'))
  const startFeeSek = parseNumberOrNull(formData.get('start_fee_sek'))
  const adminFeeSek = parseNumberOrNull(formData.get('admin_fee_sek'))
  const breakFeeSek = parseNumberOrNull(formData.get('break_fee_sek'))
  const vatRate = parseNumberOrNull(formData.get('vat_rate'))

  const updated = await updateCustomerContract({
    id: contractId,
    customerId,
    siteId,
    meteringPointId,
    companyId,
    status: nextStatus,
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
    priceSnapshot: buildPriceSnapshot({
      fixedPriceOrePerKwh,
      spotMarkupOrePerKwh,
      variableFeeOrePerKwh,
      monthlyFeeSek,
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
