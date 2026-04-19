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
  CustomerContractEventType,
  CustomerContractRow,
} from '@/lib/customer-contracts/types'
import {
  parseBoolean,
  parseContractType,
  parseGreenFeeMode,
  parseIntOrNull,
  parseNumberOrNull,
  parseStringOrNull,
  parseTerminationReason,
} from './helpers'

async function emitLifecycleEventsForStatus(params: {
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
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signed',
      happenedAt: params.signedAt ?? params.startsAt ?? undefined,
      note: `Signering registrerad före aktivering ${noteSuffix}`,
      actorUserId: params.actorUserId,
    })

    await addCustomerContractEvent({
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
        customerContractId: params.contractId,
        customerId: params.customerId,
        eventType: 'termination_notice_received',
        happenedAt: params.terminationNoticeDate,
        note: `Uppsägning mottagen ${noteSuffix}`,
        actorUserId: params.actorUserId,
      })
    }

    await addCustomerContractEvent({
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
  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  const customerContractId = String(formData.get('customer_contract_id') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? 'note').trim() as CustomerContractEventType
  const note = String(formData.get('note') ?? '').trim() || null
  const happenedAt = String(formData.get('happened_at') ?? '').trim() || null

  if (!customerId || !customerContractId) {
    throw new Error('customer_id och customer_contract_id krävs')
  }

  await addCustomerContractEvent({
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
  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  const contractOfferId = String(formData.get('contract_offer_id') ?? '').trim()

  if (!customerId || !contractOfferId) {
    throw new Error('customer_id och contract_offer_id krävs')
  }

  const offer = await getContractOfferById(contractOfferId)
  if (!offer || !offer.is_active || offer.status !== 'active') {
    throw new Error('Avtalsmallen är inte aktiv eller kunde inte hittas')
  }

  const status = String(formData.get('status') ?? 'pending_signature').trim() as CustomerContractRow['status']
  const siteId = parseStringOrNull(formData.get('site_id'))
  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const signedAt = parseStringOrNull(formData.get('signed_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const overrideReason = parseStringOrNull(formData.get('override_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const contract = await createCustomerContract({
    customerId,
    siteId,
    contractOfferId: offer.id,
    sourceType: 'catalog',
    status,
    contractName: offer.name,
    contractType: offer.contract_type,
    campaignName: offer.campaign_name,
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
    },
    actorUserId: user.id,
  })

  await emitLifecycleEventsForStatus({
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
  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) {
    throw new Error('customer_id krävs')
  }

  const contractName = String(formData.get('contract_name') ?? '').trim()
  if (!contractName) {
    throw new Error('Avtalsnamn krävs')
  }

  const status = String(formData.get('status') ?? 'draft').trim() as CustomerContractRow['status']
  const siteId = parseStringOrNull(formData.get('site_id'))
  const contractType = parseContractType(formData.get('contract_type'))
  const startsAt = parseStringOrNull(formData.get('starts_at'))
  const endsAt = parseStringOrNull(formData.get('ends_at'))
  const signedAt = parseStringOrNull(formData.get('signed_at'))
  const terminationNoticeDate = parseStringOrNull(formData.get('termination_notice_date'))
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const overrideReason = parseStringOrNull(formData.get('override_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const contract = await createCustomerContract({
    customerId,
    siteId,
    contractOfferId: null,
    sourceType: 'manual_override',
    status,
    contractName,
    contractType,
    campaignName: null,
    fixedPriceOrePerKwh: parseNumberOrNull(formData.get('fixed_price_ore_per_kwh')),
    spotMarkupOrePerKwh: parseNumberOrNull(formData.get('spot_markup_ore_per_kwh')),
    variableFeeOrePerKwh: parseNumberOrNull(formData.get('variable_fee_ore_per_kwh')),
    monthlyFeeSek: parseNumberOrNull(formData.get('monthly_fee_sek')),
    greenFeeMode: parseGreenFeeMode(formData.get('green_fee_mode')),
    greenFeeValue: parseNumberOrNull(formData.get('green_fee_value')),
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
    customerContractId: contract.id,
    customerId,
    eventType: 'created',
    note: 'Manuellt kundavtal skapat från kundkortet',
    metadata: {
      sourceType: 'manual_override',
      autoRenewEnabled,
      autoRenewTermMonths,
      terminationReason,
    },
    actorUserId: user.id,
  })

  await emitLifecycleEventsForStatus({
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
  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  const contractId = String(formData.get('customer_contract_id') ?? '').trim()

  if (!customerId || !contractId) {
    throw new Error('customer_id och customer_contract_id krävs')
  }

  const before = await getCustomerContractById(contractId)
  if (!before || before.customer_id !== customerId) {
    throw new Error('Kundavtalet kunde inte hittas')
  }

  const nextStatus = String(formData.get('status') ?? before.status).trim() as CustomerContractRow['status']
  const signedAt = String(formData.get('signed_at') ?? '').trim() || null
  const startsAt = String(formData.get('starts_at') ?? '').trim() || null
  const endsAt = String(formData.get('ends_at') ?? '').trim() || null
  const terminationNoticeDate = String(formData.get('termination_notice_date') ?? '').trim() || null
  const terminationReason = parseTerminationReason(formData.get('termination_reason'))
  const autoRenewEnabled = parseBoolean(formData.get('auto_renew_enabled'))
  const autoRenewTermMonths = parseIntOrNull(formData.get('auto_renew_term_months'))

  const updated = await updateCustomerContract({
    id: contractId,
    customerId,
    siteId: String(formData.get('site_id') ?? '').trim() || null,
    status: nextStatus,
    contractName: String(formData.get('contract_name') ?? '').trim() || before.contract_name,
    contractType: parseContractType(formData.get('contract_type')),
    fixedPriceOrePerKwh: parseNumberOrNull(formData.get('fixed_price_ore_per_kwh')),
    spotMarkupOrePerKwh: parseNumberOrNull(formData.get('spot_markup_ore_per_kwh')),
    variableFeeOrePerKwh: parseNumberOrNull(formData.get('variable_fee_ore_per_kwh')),
    monthlyFeeSek: parseNumberOrNull(formData.get('monthly_fee_sek')),
    bindingMonths: parseIntOrNull(formData.get('binding_months')),
    noticeMonths: parseIntOrNull(formData.get('notice_months')),
    startsAt,
    endsAt,
    signedAt,
    terminationNoticeDate,
    terminationReason,
    autoRenewEnabled,
    autoRenewTermMonths,
    overrideReason: String(formData.get('override_reason') ?? '').trim() || null,
    actorUserId: user.id,
  })

  await addCustomerContractEvent({
    customerContractId: updated.id,
    customerId,
    eventType: 'updated',
    note: 'Kundavtal uppdaterat från kundkortet',
    metadata: {
      previousStatus: before.status,
      nextStatus: updated.status,
      previousSiteId: before.site_id,
      nextSiteId: updated.site_id,
      previousTerminationReason: before.termination_reason ?? null,
      nextTerminationReason: updated.termination_reason ?? null,
      previousAutoRenewEnabled: before.auto_renew_enabled,
      nextAutoRenewEnabled: updated.auto_renew_enabled,
      previousAutoRenewTermMonths: before.auto_renew_term_months ?? null,
      nextAutoRenewTermMonths: updated.auto_renew_term_months ?? null,
    },
    actorUserId: user.id,
  })

  if (before.status !== updated.status) {
    await emitLifecycleEventsForStatus({
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