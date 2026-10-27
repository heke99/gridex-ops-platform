-- FINDINGS H-B6b (reality H11, batch 8; variant of H-B6). D11g1 (20261026120000) made a break-fee credit its own
-- credit underlay (payload.charge_kind = 'break_fee_credit') that is "qualified exactly when its own credit row binds it
-- and is underlaid or invoiced", but, like D11, only in gridex_read_billing_underlay_source_basis_v1. The credit invoice is
-- created through public.gridex_create_billing_export_run, whose H-B6 rule (20261027160000) covers the break fee only, so
-- every credit was refused with billing_finalized_source_basis_required.
--
-- Rule (D11g1's, verbatim): a ready item whose underlay is a credit underlay of the same company is accepted exactly when
-- its own credit row (same company, credit_underlay_id = the underlay, id = payload.break_fee_credit_id) is 'underlaid' or
-- 'invoiced'. Everything else is unchanged (H-B6's break-fee rule, require_underlay_v1 for every other item, and the
-- downstream exact contract / price snapshot / locked pricing run checks).
--
-- Exact-needle rewrite of the body installed by 20261027160000; the needle must occur exactly once and the marker must be
-- absent. Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $hb6b$
declare
  needle constant text := $n$     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee') THEN$n$;
  replacement constant text := $r$     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee')
    -- H-B6b (20261027170000): a break-fee credit underlay is backed by its own credit row (D11g1).
    AND NOT EXISTS(SELECT FROM public.billing_underlays u JOIN public.break_fee_credits cr ON cr.company_id=u.company_id
      AND cr.credit_underlay_id=u.id AND cr.id::text=u.payload->>'break_fee_credit_id' AND cr.status IN ('underlaid','invoiced')
     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee_credit') THEN$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('H-B6 (20261027160000)' in f.prosrc) = 0
    or position('H-B6b (20261027170000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'break_fee_credit_export_run_h_b6b_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'break_fee_credit_export_run_h_b6b_metadata_changed' using errcode = 'P0U01';
  end if;
end
$hb6b$;

commit;
