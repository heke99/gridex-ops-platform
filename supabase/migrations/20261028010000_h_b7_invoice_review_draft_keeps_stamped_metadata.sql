-- FINDINGS H-B7 (reality H11, batch 11). A break-fee credit invoice is created through
-- public.gridex_create_invoice_review_draft_v1: it builds the graph (gridex_create_invoice_export_graph_v1, whose insert
-- fires the D11g1 trigger break_fee_credit_invoice_guard that stamps metadata.credit_of_invoice_id,
-- credit_of_billing_underlay_id, break_fee_charge_id, break_fee_credit_id, credited_fee_lines, credit_reason and
-- adjustment_case_id), and then enriches the invoice with metadata = coalesce(p_enrichment->'metadata', metadata). That
-- replaced the whole object, so the credit invoice lost its traceable link to the original invoice and credit
-- (owner decision 28: "credited traceably").
--
-- Rule: the enrichment adds its metadata keys to what the invoice already carries; keys stamped at insert are kept.
-- On a conflicting key the enrichment still wins, as before; a null enrichment keeps the stored metadata, as before.
--
-- Exact-needle rewrite of the installed body; the needle must occur exactly once and the marker must be absent. Owner,
-- ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $hb7$
declare
  needle constant text := $n$      metadata = coalesce(p_enrichment->'metadata', metadata),$n$;
  replacement constant text := $r$      -- H-B7 (20261028010000): keep what the insert stamped (e.g. a break-fee credit's link, D11g1).
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_enrichment->'metadata', '{}'::jsonb),$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.proname = 'gridex_create_invoice_review_draft_v1' and p.pronamespace = 'public'::regnamespace;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('H-B7 (20261028010000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'invoice_review_draft_h_b7_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'invoice_review_draft_h_b7_metadata_changed' using errcode = 'P0U01';
  end if;
end
$hb7$;

commit;
