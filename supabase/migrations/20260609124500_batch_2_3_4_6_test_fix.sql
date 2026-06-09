-- Gridex Batch 2/3/4/6 verification fix
-- Backfills invoice readiness after pricing and preserves monthly fees as one charge per billing period.

alter table if exists public.billing_underlays
  add column if not exists invoice_readiness_status text,
  add column if not exists invoice_readiness_issues jsonb not null default '[]'::jsonb;

update public.billing_underlays
set invoice_readiness_status = case
    when status = 'validated'
      and readiness_status = 'ready'
      and coalesce(total_kwh, 0) > 0
      and contract_id is not null
      and pricing_snapshot_id is not null
      then 'ready_for_invoice'
    else 'blocked'
  end,
  invoice_readiness_issues = case
    when status = 'validated'
      and readiness_status = 'ready'
      and coalesce(total_kwh, 0) > 0
      and contract_id is not null
      and pricing_snapshot_id is not null
      then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'code', 'readiness_backfill_requires_review',
      'message', 'Faktureringsunderlaget behöver kontrolleras innan fakturaexport.',
      'severity', 'blocked'
    ))
  end,
  updated_at = now()
where invoice_readiness_status is null;

-- Keep old preview rows untouched for audit, but make later reporting clearer by tagging
-- already-created zero-amount monthly fee rows as superseded by the verification fix.
update public.pricing_preview_lines
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'superseded_by_fix', '20260609124500_batch_2_3_4_6_test_fix',
    'superseded_reason', 'fixed_monthly_fee was generated with quantity 0 before the kr/månad verification fix'
  )
where line_type = 'fixed_monthly_fee'
  and coalesce(amount_ex_vat, 0) = 0
  and coalesce(quantity, 0) = 0
  and coalesce(metadata->>'normalized_pricing_unit', '') = 'sek_month';
