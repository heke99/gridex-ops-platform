//lib/masterdata/types.ts
export type PriceAreaCode = "SE1" | "SE2" | "SE3" | "SE4";

export type SiteType = "consumption" | "production" | "mixed";

export type SiteStatus =
  | "draft"
  | "active"
  | "pending_move"
  | "inactive"
  | "closed";

export type MeteringPointStatus =
  | "draft"
  | "active"
  | "pending_validation"
  | "inactive"
  | "closed";

export type MeasurementType = "consumption" | "production" | "mixed";

export type ReadingFrequency = "hourly" | "daily" | "monthly" | "manual";

export type GridOwnerRow = {
  id: string;
  name: string;
  owner_code: string;
  ediel_id: string | null;
  org_number: string | null;
  environment?: string | null;
  lifecycle_status?: string | null;
  default_prodat_subaddress?: string | null;
  default_utilts_subaddress?: string | null;
  transport_channel?: string | null;
  communication_email?: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  company_id?: string | null;
  platform_market_actor_id?: string | null;
  platform_grid_owner_id?: string | null;
  verification_status?: 'verified' | 'needs_route' | 'needs_certificate' | 'needs_ediel_id' | 'needs_subaddress' | 'needs_contact' | 'unresolved_duplicate' | 'ambiguous_subaddress' | string | null;
  verification_reasons?: string[] | null;
  verified_for_customer_flow?: boolean | null;
  actor_registry_status?: string | null;
  certificate_status?: 'finns' | 'saknas' | 'utgånget' | 'fel_miljö' | 'fel_mottagare' | string | null;
  certificate_environment?: string | null;
  certificate_fingerprint_sha256?: string | null;
  route_status?: string | null;
  route_count?: number | null;
  prodat_route_count?: number | null;
  utilts_route_count?: number | null;
  duplicate_count?: number | null;
  duplicate_group_key?: string | null;
  verification_checked_at?: string | null;
  verified_at?: string | null;
  verification_metadata?: Record<string, unknown> | null;
  prodat_subaddress_status?: string | null;
  utilts_subaddress_status?: string | null;
  prodat_subaddress_source?: string | null;
  utilts_subaddress_source?: string | null;
  has_verified_prodat_route?: boolean | null;
  has_verified_utilts_route?: boolean | null;
  possible_prodat_subaddresses?: string[] | null;
  possible_utilts_subaddresses?: string[] | null;
  can_use_for_prodat?: boolean | null;
  can_use_for_utilts?: boolean | null;
  can_start_supplier_switch?: boolean | null;
  certificate_source?: string | null;
  electricity_scope_status?: string | null;
  excluded_from_electricity_scope?: boolean | null;
  manual_review_required?: boolean | null;
  manual_review_reason?: string | null;
  supplier_switch_readiness_status?: string | null;
  primary_role_group?: string | null;
  is_electricity_grid_owner_scope?: boolean | null;
  role_aware_blocking_reasons?: string[] | null;
};

export type ElectricitySupplierRow = {
  id: string;
  name: string;
  org_number: string | null;
  environment?: string | null;
  lifecycle_status?: string | null;
  default_prodat_subaddress?: string | null;
  default_utilts_subaddress?: string | null;
  transport_channel?: string | null;
  communication_email?: string | null;
  market_actor_code: string | null;
  ediel_id: string | null;
  contact_name: string | null;
  email: string | null;
  customer_service_email?: string | null;
  switching_email?: string | null;
  contract_email?: string | null;
  website?: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  is_own_supplier: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PriceAreaRow = {
  code: PriceAreaCode;
  name: string;
  sort_order: number;
  created_at: string;
};

export type PriceAreaLocalityRow = {
  id: string;
  price_area_code: PriceAreaCode;
  locality_name: string;
  municipality: string | null;
  postal_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type CustomerSiteRow = {
  id: string;
  customer_id: string;
  site_name: string;
  facility_id: string | null;
  site_type: SiteType;
  status: SiteStatus;
  grid_owner_id: string | null;
  price_area_code: PriceAreaCode | null;
  grid_area_code?: string | null;
  move_in_date: string | null;
  annual_consumption_kwh: number | null;
  current_supplier_id?: string | null;
  current_supplier_name: string | null;
  current_supplier_org_number: string | null;
  current_supplier_unknown?: boolean | null;
  current_supplier_contract_status?: string | null;
  current_supplier_contract_end_date?: string | null;
  current_supplier_notice_period?: string | null;
  current_supplier_termination_fee?: number | null;
  current_supplier_response_status?: string | null;
  street: string | null;
  care_of: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  moved_from_street: string | null;
  moved_from_postal_code: string | null;
  moved_from_city: string | null;
  moved_from_supplier_name: string | null;
  move_out_date?: string | null;
  closed_at?: string | null;
  closed_reason?: string | null;
  internal_notes: string | null;
  data_quality_status?: string | null;
  missing_data_status?: string | null;
  company_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type MeteringPointRow = {
  id: string;
  company_id?: string | null;
  customer_id?: string | null;
  site_id: string;
  meter_point_id: string | null;
  site_facility_id: string | null;
  ediel_reference: string | null;
  status: MeteringPointStatus;
  measurement_type: MeasurementType;
  reading_frequency: ReadingFrequency;
  grid_owner_id: string | null;
  price_area_code: PriceAreaCode | null;
  grid_area_code?: string | null;
  facility_data_verified_at?: string | null;
  start_date: string | null;
  end_date: string | null;
  closed_at?: string | null;
  closed_reason?: string | null;
  is_settlement_relevant: boolean;
  data_quality_status?: string | null;
  verification_status?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type CustomerInternalNoteRow = {
  id: string;
  company_id?: string | null;
  customer_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CustomerListRow = {
  id: string;
  customer_type: string | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  site_count: number;
  metering_point_count: number;
  active_site_count: number;
  active_metering_point_count: number;
};

export type MasterdataAuditEntry = {
  id: string;
  actor_user_id: string | null;
  entity_type: "customer_site" | "metering_point";
  entity_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
