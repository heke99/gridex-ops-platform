export type ContractType =
  | "fixed"
  | "variable_monthly"
  | "variable_hourly"
  | "variable_quarterly"
  | "portfolio"
  | "mixed";

export type GreenFeeMode = "none" | "sek_month" | "ore_per_kwh";

export type CustomerContractTerminationReason =
  "switch_supplier" | "stop_supply" | "move_out" | "manual_override" | "other";

export type ContractOfferStatus = "draft" | "active" | "inactive";

export type CustomerContractStatus =
  | "draft"
  | "pending_signature"
  | "signed"
  | "active"
  | "terminated"
  | "cancelled"
  | "expired";

export type ContractOfferRow = {
  id: string;
  company_id?: string | null;
  name: string;
  slug: string;
  status: ContractOfferStatus;
  contract_type: ContractType;
  campaign_name: string | null;
  campaign_code?: string | null;
  campaign_version?: string | null;
  price_version?: string | null;
  terms_version?: string | null;
  offer_version?: string | null;
  terms_document_url?: string | null;
  version_snapshot?: Record<string, unknown> | null;
  max_customers?: number | null;
  discount_value?: number | null;
  discount_unit?: string | null;
  start_fee_sek?: number | null;
  admin_fee_sek?: number | null;
  break_fee_sek?: number | null;
  vat_rate?: number | null;
  description: string | null;
  fixed_price_ore_per_kwh: number | null;
  spot_markup_ore_per_kwh: number | null;
  variable_fee_ore_per_kwh: number | null;
  monthly_fee_sek: number | null;
  green_fee_mode: GreenFeeMode;
  green_fee_value: number | null;
  default_binding_months: number | null;
  default_notice_months: number | null;
  optional_fee_lines: Array<Record<string, unknown>> | null;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type CustomerContractRow = {
  id: string;
  company_id?: string | null;
  customer_id: string;
  site_id: string | null;
  customer_site_id?: string | null;
  metering_point_id?: string | null;
  contract_offer_id: string | null;
  public_contract_offer_id?: string | null;
  offer_reference?: string | null;
  legal_versions_snapshot?: Array<Record<string, unknown>> | null;
  signature_snapshot?: Record<string, unknown> | null;
  signature_snapshot_sha256?: string | null;
  signed_ip_hash?: string | null;
  signed_user_agent?: string | null;
  withdrawal_deadline_at?: string | null;
  source_type:
    | "catalog"
    | "manual_override"
    | "manual"
    | "admin"
    | "api"
    | "external_website"
    | "website_application"
    | "website_application_review"
    | "customer_portal"
    | "import"
    | "migration"
    | "system"
    | null;
  status: CustomerContractStatus;
  contract_name: string;
  contract_type: ContractType;
  campaign_name: string | null;
  campaign_code?: string | null;
  campaign_version?: string | null;
  price_version?: string | null;
  terms_version?: string | null;
  contract_version?: string | null;
  signed_version?: string | null;
  terms_signed_version?: string | null;
  version_snapshot?: Record<string, unknown> | null;
  start_status?: string | null;
  old_supplier_start_at?: string | null;
  grid_owner_confirmed_start_at?: string | null;
  ediel_confirmed_start_at?: string | null;
  export_blocked?: boolean | null;
  export_block_reason?: string | null;
  price_snapshot?: Record<string, unknown> | null;
  campaign_snapshot?: Record<string, unknown> | null;
  billing_ready_status?: string | null;
  billing_blocker_reasons?: Array<Record<string, unknown>> | null;
  withdrawal_requested_at?: string | null;
  rejected_reason?: string | null;
  discount_value?: number | null;
  discount_unit?: string | null;
  start_fee_sek?: number | null;
  admin_fee_sek?: number | null;
  break_fee_sek?: number | null;
  vat_rate?: number | null;
  fixed_price_ore_per_kwh: number | null;
  spot_markup_ore_per_kwh: number | null;
  variable_fee_ore_per_kwh: number | null;
  monthly_fee_sek: number | null;
  green_fee_mode: GreenFeeMode;
  green_fee_value: number | null;
  binding_months: number | null;
  notice_months: number | null;
  optional_fee_lines: Array<Record<string, unknown>> | null;
  starts_at: string | null;
  expected_start_at?: string | null;
  confirmed_start_at?: string | null;
  actual_start_at?: string | null;
  start_date_source?: string | null;
  invoice_recipient?: string | null;
  invoice_email?: string | null;
  invoice_reference?: string | null;
  billing_street?: string | null;
  billing_postal_code?: string | null;
  billing_city?: string | null;
  billing_country?: string | null;
  billing_address_same_as_site?: boolean | null;
  billing_level?: string | null;
  consolidated_invoice?: boolean | null;
  ends_at: string | null;
  signed_at: string | null;
  termination_notice_date: string | null;
  termination_reason: CustomerContractTerminationReason | null;
  auto_renew_enabled: boolean;
  auto_renew_term_months: number | null;
  override_reason: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type CustomerContractEventType =
  | "created"
  | "signature_requested"
  | "signed"
  | "activated"
  | "updated"
  | "termination_notice_received"
  | "terminated"
  | "cancelled"
  | "note";

export type CustomerContractEventRow = {
  id: string;
  company_id?: string | null;
  customer_contract_id: string;
  customer_id: string;
  event_type: CustomerContractEventType;
  happened_at: string;
  note: string | null;
  metadata: Record<string, unknown> | null;
  actor_user_id: string | null;
  created_at: string;
};
