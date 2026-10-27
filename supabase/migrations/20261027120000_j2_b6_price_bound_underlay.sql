-- FINDINGS J2-B6 (reality J2-9, batch 5e). Every ready billing underlay is bound to its exact source basis when it is
-- stored (gridex_store_billing_underlay -> gridex_billing_source.underlay_bindings), and the finance guard
-- (billing_source_finalized_immutable on billing_underlays) then refuses any change to its frozen columns, among them
-- pricing_snapshot. gridex_persist_pricing_run wrote its run bookkeeping (latest_pricing_run_id, warnings, errors) into
-- that same pricing_snapshot, in the success and in the failed branch. So no bound underlay could ever be priced
-- (billing_source_finalized_underlay_immutable, 55000), and a failed run was rolled back without a trace: the monthly
-- billing cron ended with "Prisberäkning misslyckades." for every metered underlay and created no invoice draft.
--
-- Rule: a bound underlay keeps its frozen pricing_snapshot. The caller passes that same snapshot
-- (lib/pricing/engine.ts p_pricing_snapshot = the underlay's own pricing_snapshot), and the run itself, its status,
-- lines, warnings and errors are in pricing_runs/pricing_preview_lines; nothing reads the bookkeeping keys back.
-- Status, readiness and the calculated totals are not frozen and are still written. An unbound underlay is unchanged.
--
-- Exact-needle rewrite of the installed body (last changed by 20261023203000); each needle must occur exactly once and
-- the marker must be absent. Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $j2b6$
declare
  needle_success constant text := $n$      pricing_snapshot=coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ),updated_at=now()$n$;
  replacement_success constant text := $r$      -- J2-B6 (20261027120000): a bound underlay keeps its frozen pricing_snapshot; the run is in pricing_runs.
      pricing_snapshot=CASE WHEN EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=p_billing_underlay_id)
        THEN pricing_snapshot ELSE coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END,updated_at=now()$r$;
  needle_failed constant text := $n$      pricing_snapshot=coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ),updated_at=now()$n$;
  replacement_failed constant text := $r$      pricing_snapshot=CASE WHEN EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=p_billing_underlay_id)
        THEN pricing_snapshot ELSE coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END,updated_at=now()$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle_success, ''))) / length(needle_success) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, needle_failed, ''))) / length(needle_failed) <> 1
    or position('J2-B6 (20261027120000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'price_bound_underlay_j2b6_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(replace(f.prosrc, needle_success, replacement_success), needle_failed, replacement_failed);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position(needle_success in body) <> 0 or position(needle_failed in body) <> 0 then
    raise exception 'price_bound_underlay_j2b6_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j2b6$;

commit;
