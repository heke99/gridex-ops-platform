-- Gridex Batch 2/3 verification fix v2
-- Fixed monthly fees are full-month charges by default and existing onboarding rows get a visible state.

alter table if exists public.price_components
  add column if not exists unit text,
  add column if not exists calculation_type text,
  add column if not exists periodization_mode text not null default 'none',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz;

-- Existing Gridex rows can represent a fixed monthly fee as plain SEK with
-- periodization_mode = prorated_by_days. That made quantity become 0 in May 2026.
-- A monthly fee is full-month by default unless the component explicitly asks for proration.
update public.price_components
set unit = 'sek_month',
    calculation_type = coalesce(nullif(calculation_type, ''), 'fixed_monthly'),
    periodization_mode = 'full_month',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'monthly_fee_policy', 'full_month',
      'verification_fix', '20260609133000_batch_2_3_verification_fix_v2'
    ),
    updated_at = now()
where component_type = 'fixed_monthly_fee'
  and coalesce(metadata->>'billing_policy', '') <> 'prorated_by_days'
  and coalesce(metadata->>'proration_policy', '') <> 'prorated_by_days'
  and coalesce(metadata->>'monthly_fee_policy', '') <> 'prorated_by_days';

-- Legacy pricing rules use calculation_unit/value_amount. Keep them aligned too.
update public.pricing_component_rules
set calculation_unit = 'sek_month',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'monthly_fee_policy', 'full_month',
      'verification_fix', '20260609133000_batch_2_3_verification_fix_v2'
    ),
    updated_at = now()
where component_type = 'fixed_monthly_fee'
  and coalesce(metadata->>'billing_policy', '') <> 'prorated_by_days'
  and coalesce(metadata->>'proration_policy', '') <> 'prorated_by_days'
  and coalesce(metadata->>'monthly_fee_policy', '') <> 'prorated_by_days';

-- Keep audit history but mark old wrong 0 kr monthly fee preview lines as superseded.
update public.pricing_preview_lines
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'superseded_by_fix', '20260609133000_batch_2_3_verification_fix_v2',
    'superseded_reason', 'fixed_monthly_fee must be charged once per billing period by default'
  )
where line_type = 'fixed_monthly_fee'
  and coalesce(amount_ex_vat, 0) = 0
  and coalesce(quantity, 0) = 0
  and coalesce(metadata->>'normalized_pricing_unit', '') = 'sek_month';

alter table if exists public.customer_sites
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb,
  add column if not exists next_action text;

alter table if exists public.metering_points
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb,
  add column if not exists next_action text;

-- Backfill existing active/verified records so customer cards do not show null workflow state.
update public.customer_sites
set onboarding_status = 'active',
    onboarding_issues = coalesce(onboarding_issues, '[]'::jsonb),
    next_action = coalesce(next_action, 'ready_for_billing'),
    updated_at = now()
where status = 'active'
  and onboarding_status is null;

update public.metering_points
set onboarding_status = 'active',
    onboarding_issues = coalesce(onboarding_issues, '[]'::jsonb),
    next_action = coalesce(next_action, 'ready_for_billing'),
    updated_at = now()
where status = 'active'
  and coalesce(verification_status, 'verified') in ('verified', 'complete')
  and onboarding_status is null;

-- Re-assert invoice readiness for already validated underlays after pricing/readiness fixes.
update public.billing_underlays
set invoice_readiness_status = 'ready_for_invoice',
    invoice_readiness_issues = '[]'::jsonb,
    updated_at = now()
where status = 'validated'
  and readiness_status = 'ready'
  and coalesce(total_kwh, 0) > 0
  and contract_id is not null
  and pricing_snapshot_id is not null
  and coalesce(missing_values_count, 0) = 0;
