-- FINDINGS H-B6 (reality H11, batch 6). D11 (20261025120000, owner decision 28) made an approved break fee its own
-- billing underlay (0 kWh, payload.charge_kind = 'break_fee') that is "qualified exactly when its own approved charge is
-- bound to it", but applied that rule only in public.gridex_read_billing_underlay_source_basis_v1. The invoice
-- preparation creates the draft through public.gridex_create_billing_export_run, which calls
-- gridex_billing_source.require_underlay_v1 for every ready item; a break-fee underlay has no metering source binding,
-- so every break-fee invoice was refused with billing_finalized_source_basis_required ("Draftfakturan kunde inte
-- skapas."), after its pricing run had been locked.
--
-- Rule (D11's, verbatim): a ready item whose underlay is a break-fee underlay of the same company is accepted exactly when
-- its own approved charge (same company, billing_underlay_id = the underlay, id = payload.break_fee_charge_id) is
-- 'underlaid' or 'invoiced'. Every other item keeps require_underlay_v1 unchanged, and the downstream checks of
-- gridex_create_billing_export_run_before_source_v2 (exact contract, price snapshot, locked pricing run) still apply to
-- every ready item. The trigger break_fee_charge_invoiced still refuses a second invoice of the same underlay.
--
-- Exact-needle rewrite of the installed body (20260930175405); the needle must occur exactly once and the marker must be
-- absent. Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $hb6$
declare
  needle constant text := $n$  IF item->>'status'='ready' THEN PERFORM gridex_billing_source.require_underlay_v1(company,(item->>'billing_underlay_id')::uuid); END IF;$n$;
  replacement constant text := $r$  -- H-B6 (20261027160000): a break-fee underlay is backed by its own approved charge, not by metering values (D11).
  IF item->>'status'='ready' THEN
   IF NOT EXISTS(SELECT FROM public.billing_underlays u JOIN public.break_fee_charges ch ON ch.company_id=u.company_id
      AND ch.billing_underlay_id=u.id AND ch.id::text=u.payload->>'break_fee_charge_id' AND ch.status IN ('underlaid','invoiced')
     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee') THEN
    PERFORM gridex_billing_source.require_underlay_v1(company,(item->>'billing_underlay_id')::uuid);
   END IF;
  END IF;$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('H-B6 (20261027160000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'break_fee_export_run_h_b6_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position(needle in body) <> 0 then
    raise exception 'break_fee_export_run_h_b6_metadata_changed' using errcode = 'P0U01';
  end if;
end
$hb6$;

commit;
