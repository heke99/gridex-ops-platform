import { supabaseService } from '@/lib/supabase/service'
import type {
  ContractOfferRow,
  ContractType,
  CustomerContractEventRow,
  CustomerContractEventType,
  CustomerContractRow,
  GreenFeeMode,
} from './types'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9åäö\s-]/gi, '')
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function listContractOffers(options: {
  activeOnly?: boolean
} = {}): Promise<ContractOfferRow[]> {
  let query = supabaseService
    .from('contract_offers')
    .select('*')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })

  if (options.activeOnly) {
    query = query.eq('is_active', true).eq('status', 'active')
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []) as ContractOfferRow[]
}

export async function getContractOfferById(id: string): Promise<ContractOfferRow | null> {
  const { data, error } = await supabaseService
    .from('contract_offers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as ContractOfferRow | null) ?? null
}

export async function saveContractOffer(input: {
  id?: string
  name: string
  slug?: string | null
  status: 'draft' | 'active' | 'inactive'
  contractType: ContractType
  campaignName?: string | null
  description?: string | null
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  greenFeeMode: GreenFeeMode
  greenFeeValue?: number | null
  defaultBindingMonths?: number | null
  defaultNoticeMonths?: number | null
  optionalFeeLines?: Array<Record<string, unknown>> | null
  isActive: boolean
  validFrom?: string | null
  validTo?: string | null
  actorUserId?: string | null
}): Promise<ContractOfferRow> {
  const payload = {
    name: input.name.trim(),
    slug: (input.slug?.trim() || slugify(input.name)).slice(0, 120),
    status: input.status,
    contract_type: input.contractType,
    campaign_name: input.campaignName ?? null,
    description: input.description ?? null,
    fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
    spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
    variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
    monthly_fee_sek: input.monthlyFeeSek ?? null,
    green_fee_mode: input.greenFeeMode,
    green_fee_value: input.greenFeeValue ?? null,
    default_binding_months: input.defaultBindingMonths ?? null,
    default_notice_months: input.defaultNoticeMonths ?? null,
    optional_fee_lines: input.optionalFeeLines ?? [],
    is_active: input.isActive,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    updated_by: input.actorUserId ?? null,
  }

  const query = input.id
    ? supabaseService.from('contract_offers').update(payload).eq('id', input.id)
    : supabaseService.from('contract_offers').insert({
        ...payload,
        created_by: input.actorUserId ?? null,
      })

  const { data, error } = await query.select('*').single()
  if (error) throw error

  return data as ContractOfferRow
}

export async function listCustomerContractsByCustomerId(
  customerId: string
): Promise<CustomerContractRow[]> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerContractRow[]
}

export async function getCustomerContractById(
  id: string
): Promise<CustomerContractRow | null> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerContractRow | null) ?? null
}

export async function listCustomerContractEventsByCustomerId(
  customerId: string
): Promise<CustomerContractEventRow[]> {
  const { data, error } = await supabaseService
    .from('customer_contract_events')
    .select('*')
    .eq('customer_id', customerId)
    .order('happened_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerContractEventRow[]
}

export async function createCustomerContract(input: {
  customerId: string
  siteId?: string | null
  contractOfferId?: string | null
  sourceType: 'catalog' | 'manual_override'
  status?: CustomerContractRow['status']
  contractName: string
  contractType: ContractType
  campaignName?: string | null
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  greenFeeMode: GreenFeeMode
  greenFeeValue?: number | null
  bindingMonths?: number | null
  noticeMonths?: number | null
  optionalFeeLines?: Array<Record<string, unknown>> | null
  startsAt?: string | null
  endsAt?: string | null
  signedAt?: string | null
  terminationNoticeDate?: string | null
  overrideReason?: string | null
  actorUserId?: string | null
}): Promise<CustomerContractRow> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      contract_offer_id: input.contractOfferId ?? null,
      source_type: input.sourceType,
      status: input.status ?? 'draft',
      contract_name: input.contractName,
      contract_type: input.contractType,
      campaign_name: input.campaignName ?? null,
      fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
      spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
      variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
      monthly_fee_sek: input.monthlyFeeSek ?? null,
      green_fee_mode: input.greenFeeMode,
      green_fee_value: input.greenFeeValue ?? null,
      binding_months: input.bindingMonths ?? null,
      notice_months: input.noticeMonths ?? null,
      optional_fee_lines: input.optionalFeeLines ?? [],
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      override_reason: input.overrideReason ?? null,
      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerContractRow
}

export async function updateCustomerContract(input: {
  id: string
  customerId: string
  siteId?: string | null
  status: CustomerContractRow['status']
  contractName: string
  contractType: ContractType
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  bindingMonths?: number | null
  noticeMonths?: number | null
  startsAt?: string | null
  endsAt?: string | null
  signedAt?: string | null
  terminationNoticeDate?: string | null
  overrideReason?: string | null
  actorUserId?: string | null
}): Promise<CustomerContractRow> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .update({
      site_id: input.siteId ?? null,
      status: input.status,
      contract_name: input.contractName,
      contract_type: input.contractType,
      fixed_price_ore_per_kwh: input.fixedPriceOrePerKwh ?? null,
      spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh ?? null,
      variable_fee_ore_per_kwh: input.variableFeeOrePerKwh ?? null,
      monthly_fee_sek: input.monthlyFeeSek ?? null,
      binding_months: input.bindingMonths ?? null,
      notice_months: input.noticeMonths ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      override_reason: input.overrideReason ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .eq('id', input.id)
    .eq('customer_id', input.customerId)
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerContractRow
}

export async function addCustomerContractEvent(input: {
  customerContractId: string
  customerId: string
  eventType: CustomerContractEventType
  happenedAt?: string | null
  note?: string | null
  metadata?: Record<string, unknown> | null
  actorUserId?: string | null
}): Promise<CustomerContractEventRow> {
  const eventPayload = {
    customer_contract_id: input.customerContractId,
    customer_id: input.customerId,
    event_type: input.eventType,
    happened_at: input.happenedAt ?? new Date().toISOString(),
    note: input.note ?? null,
    metadata: input.metadata ?? null,
    actor_user_id: input.actorUserId ?? null,
  }

  const { data, error } = await supabaseService
    .from('customer_contract_events')
    .insert(eventPayload)
    .select('*')
    .single()

  if (error) throw error

  if (input.eventType === 'signed' || input.eventType === 'activated') {
    const patch =
      input.eventType === 'activated'
        ? {
            status: 'active',
            updated_by: input.actorUserId ?? null,
          }
        : {
            status: 'signed',
            signed_at: eventPayload.happened_at,
            updated_by: input.actorUserId ?? null,
          }

    const { error: updateError } = await supabaseService
      .from('customer_contracts')
      .update(patch)
      .eq('id', input.customerContractId)

    if (updateError) throw updateError
  }

  if (input.eventType === 'terminated' || input.eventType === 'cancelled') {
    const { error: updateError } = await supabaseService
      .from('customer_contracts')
      .update({
        status: input.eventType === 'terminated' ? 'terminated' : 'cancelled',
        updated_by: input.actorUserId ?? null,
      })
      .eq('id', input.customerContractId)

    if (updateError) throw updateError
  }

  if (input.eventType === 'termination_notice_received') {
    const { error: updateError } = await supabaseService
      .from('customer_contracts')
      .update({
        termination_notice_date: eventPayload.happened_at,
        updated_by: input.actorUserId ?? null,
      })
      .eq('id', input.customerContractId)

    if (updateError) throw updateError
  }

  return data as CustomerContractEventRow
}