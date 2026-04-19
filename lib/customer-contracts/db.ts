import { supabaseService } from '@/lib/supabase/service'
import type {
  ContractOfferRow,
  ContractType,
  CustomerContractEventRow,
  CustomerContractEventType,
  CustomerContractRow,
  GreenFeeMode,
  CustomerContractTerminationReason,
} from './types'
import { deriveContractEndsAt } from './lifecycle'

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

export type LatestCustomerContractSummary = {
  contract_name: string
  status: CustomerContractRow['status']
  contract_type: CustomerContractRow['contract_type']
  monthly_fee_sek: number | null
  starts_at: string | null
  ends_at: string | null
  auto_renew_enabled: boolean
  auto_renew_term_months: number | null
  termination_notice_date: string | null
  termination_reason: CustomerContractTerminationReason | null
} | null

export type LatestContractBucketFilter =
  | 'all'
  | 'none'
  | 'pending_signature'
  | 'signed'
  | 'active'
  | 'closed'

export type LatestContractBucketCounts = {
  all: number
  none: number
  pending_signature: number
  signed: number
  active: number
  closed: number
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

export async function listLatestCustomerContractsByCustomerIds(
  customerIds: string[]
): Promise<Map<string, LatestCustomerContractSummary>> {
  const result = new Map<string, LatestCustomerContractSummary>()

  if (customerIds.length === 0) {
    return result
  }

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('*')
    .in('customer_id', customerIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as CustomerContractRow[]

  for (const row of rows) {
    if (!result.has(row.customer_id)) {
      result.set(row.customer_id, {
        contract_name: row.contract_name,
        status: row.status,
        contract_type: row.contract_type,
        monthly_fee_sek: row.monthly_fee_sek,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        auto_renew_enabled: row.auto_renew_enabled,
        auto_renew_term_months: row.auto_renew_term_months,
        termination_notice_date: row.termination_notice_date,
        termination_reason: row.termination_reason,
      })
    }
  }

  return result
}

export async function getLatestContractBucketCounts(options: {
  query?: string | null
  customerStatus?: string | null
} = {}): Promise<LatestContractBucketCounts> {
  const { data, error } = await supabaseService.rpc(
    'admin_customer_latest_contract_counts',
    {
      search_text: options.query?.trim() || null,
      customer_status: options.customerStatus?.trim() || null,
    }
  )

  if (error) throw error

  const rows = (data ?? []) as Array<{
    bucket: string
    total: number | string
  }>

  const counts: LatestContractBucketCounts = {
    all: 0,
    none: 0,
    pending_signature: 0,
    signed: 0,
    active: 0,
    closed: 0,
  }

  for (const row of rows) {
    const total = Number(row.total ?? 0)

    if (row.bucket === 'none') counts.none += total
    if (row.bucket === 'pending_signature') counts.pending_signature += total
    if (row.bucket === 'signed') counts.signed += total
    if (row.bucket === 'active') counts.active += total
    if (row.bucket === 'closed') counts.closed += total

    counts.all += total
  }

  return counts
}

export async function listCustomerIdsByLatestContractBucket(options: {
  query?: string | null
  customerStatus?: string | null
  bucket: LatestContractBucketFilter
  page: number
  pageSize: number
}): Promise<{
  customerIds: string[]
  total: number
}> {
  const { data, error } = await supabaseService.rpc(
    'admin_customer_ids_by_latest_contract',
    {
      search_text: options.query?.trim() || null,
      customer_status: options.customerStatus?.trim() || null,
      contract_bucket: options.bucket,
      page_num: options.page,
      page_size: options.pageSize,
    }
  )

  if (error) throw error

  const rows = (data ?? []) as Array<{
    customer_id: string
    total_count: number | string
  }>

  return {
    customerIds: rows.map((row) => row.customer_id),
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
  }
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
  terminationReason?: CustomerContractTerminationReason | null
  autoRenewEnabled?: boolean | null
  autoRenewTermMonths?: number | null
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
      ends_at: deriveContractEndsAt({
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        bindingMonths: input.bindingMonths ?? null,
        noticeMonths: input.noticeMonths ?? null,
        terminationNoticeDate: input.terminationNoticeDate ?? null,
        terminationReason: input.terminationReason ?? null,
        autoRenewEnabled: input.autoRenewEnabled ?? null,
        autoRenewTermMonths: input.autoRenewTermMonths ?? null,
        status: input.status ?? 'draft',
      }),
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      termination_reason: input.terminationReason ?? null,
      auto_renew_enabled: input.autoRenewEnabled ?? ((input.bindingMonths ?? 0) > 0),
      auto_renew_term_months: input.autoRenewTermMonths ?? input.bindingMonths ?? null,
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
  terminationReason?: CustomerContractTerminationReason | null
  autoRenewEnabled?: boolean | null
  autoRenewTermMonths?: number | null
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
      ends_at: deriveContractEndsAt({
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        bindingMonths: input.bindingMonths ?? null,
        noticeMonths: input.noticeMonths ?? null,
        terminationNoticeDate: input.terminationNoticeDate ?? null,
        terminationReason: input.terminationReason ?? null,
        autoRenewEnabled: input.autoRenewEnabled ?? null,
        autoRenewTermMonths: input.autoRenewTermMonths ?? null,
        status: input.status ?? 'draft',
      }),
      signed_at: input.signedAt ?? null,
      termination_notice_date: input.terminationNoticeDate ?? null,
      termination_reason: input.terminationReason ?? null,
      auto_renew_enabled: input.autoRenewEnabled ?? ((input.bindingMonths ?? 0) > 0),
      auto_renew_term_months: input.autoRenewTermMonths ?? input.bindingMonths ?? null,
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
    const { data: current, error: currentError } = await supabaseService
      .from('customer_contracts')
      .select(
        'starts_at, ends_at, binding_months, notice_months, status, auto_renew_enabled, auto_renew_term_months, termination_reason'
      )
      .eq('id', input.customerContractId)
      .maybeSingle()

    if (currentError) throw currentError

    const { error: updateError } = await supabaseService
      .from('customer_contracts')
      .update({
        termination_notice_date: eventPayload.happened_at,
        ends_at: deriveContractEndsAt({
          startsAt: current?.starts_at ?? null,
          endsAt: current?.ends_at ?? null,
          bindingMonths: current?.binding_months ?? null,
          noticeMonths: current?.notice_months ?? null,
          terminationNoticeDate: eventPayload.happened_at,
          terminationReason: current?.termination_reason ?? null,
          autoRenewEnabled: current?.auto_renew_enabled ?? null,
          autoRenewTermMonths: current?.auto_renew_term_months ?? null,
          status: current?.status ?? null,
        }),
        updated_by: input.actorUserId ?? null,
      })
      .eq('id', input.customerContractId)

    if (updateError) throw updateError
  }

  return data as CustomerContractEventRow
}