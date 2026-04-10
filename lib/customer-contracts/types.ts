export type ContractType =
  | 'fixed'
  | 'variable_monthly'
  | 'variable_hourly'
  | 'portfolio'

export type GreenFeeMode = 'none' | 'sek_month' | 'ore_per_kwh'

export type ContractOfferStatus = 'draft' | 'active' | 'inactive'

export type CustomerContractStatus =
  | 'draft'
  | 'pending_signature'
  | 'signed'
  | 'active'
  | 'terminated'
  | 'cancelled'
  | 'expired'

export type ContractOfferRow = {
  id: string
  name: string
  slug: string
  status: ContractOfferStatus
  contract_type: ContractType
  campaign_name: string | null
  description: string | null
  fixed_price_ore_per_kwh: number | null
  spot_markup_ore_per_kwh: number | null
  variable_fee_ore_per_kwh: number | null
  monthly_fee_sek: number | null
  green_fee_mode: GreenFeeMode
  green_fee_value: number | null
  default_binding_months: number | null
  default_notice_months: number | null
  optional_fee_lines: Array<Record<string, unknown>> | null
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type CustomerContractRow = {
  id: string
  customer_id: string
  site_id: string | null
  contract_offer_id: string | null
  source_type: 'catalog' | 'manual_override'
  status: CustomerContractStatus
  contract_name: string
  contract_type: ContractType
  campaign_name: string | null
  fixed_price_ore_per_kwh: number | null
  spot_markup_ore_per_kwh: number | null
  variable_fee_ore_per_kwh: number | null
  monthly_fee_sek: number | null
  green_fee_mode: GreenFeeMode
  green_fee_value: number | null
  binding_months: number | null
  notice_months: number | null
  optional_fee_lines: Array<Record<string, unknown>> | null
  starts_at: string | null
  ends_at: string | null
  signed_at: string | null
  termination_notice_date: string | null
  override_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type CustomerContractEventType =
  | 'created'
  | 'signature_requested'
  | 'signed'
  | 'activated'
  | 'updated'
  | 'termination_notice_received'
  | 'terminated'
  | 'cancelled'
  | 'note'

export type CustomerContractEventRow = {
  id: string
  customer_contract_id: string
  customer_id: string
  event_type: CustomerContractEventType
  happened_at: string
  note: string | null
  metadata: Record<string, unknown> | null
  actor_user_id: string | null
  created_at: string
}