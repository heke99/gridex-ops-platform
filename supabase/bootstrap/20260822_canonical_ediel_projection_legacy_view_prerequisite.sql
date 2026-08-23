-- Replay-only compatibility prerequisites for the canonical Ediel production projection convergence.
-- These zero-row views exist only when the historical Batch 2B/2C relations are absent from the
-- reconstructed canonical replay. Existing live relations are never replaced or modified.

do $bootstrap$
begin
  if to_regclass('public.billing_import_rows') is null then
    execute $sql$
      create view public.billing_import_rows as
      select
        null::uuid as company_id,
        null::text as status
      where false
    $sql$;
  end if;

  if to_regclass('public.operations_automation_runs') is null then
    execute $sql$
      create view public.operations_automation_runs as
      select
        null::uuid as company_id,
        null::timestamptz as created_at
      where false
    $sql$;
  end if;

  if to_regclass('public.metering_period_gaps') is null then
    execute $sql$
      create view public.metering_period_gaps as
      select
        null::uuid as company_id,
        null::text as status
      where false
    $sql$;
  end if;

  if to_regclass('public.gridex_batch_2c_drift_queue_v') is null then
    execute $sql$
      create view public.gridex_batch_2c_drift_queue_v as
      select
        null::uuid as company_id,
        null::text as severity
      where false
    $sql$;
  end if;
end
$bootstrap$;
