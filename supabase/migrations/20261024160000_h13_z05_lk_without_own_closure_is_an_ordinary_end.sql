-- FINDINGS H-13 (quality/audits/live-chain-20261015/FINDINGS.md, reality H run 2): a grid owner's Z05 LK (reason Z23,
-- the customer moved out and a new customer and supplier moved in) ends our supply without any message of ours. It is
-- received, applied and ends the period, but gridex_bilateral_prodat.recorded_supply_current_v1 sent EVERY Z05 with a
-- Z23 object to recorded_closure_end_current_v1, the check for a Z05 that answers OUR bilateral closure (Z08 LK). That
-- check requires a closure receipt and our original and returned false, so supply_period_source_basis_v1 and
-- billing_supply_basis_v1 returned NULL and every value of the ended period, also before the move-out, was blocked as
-- supply_source_unqualified: the final month is never billed.
--
-- Change (exact pre-image, refused otherwise with h13_recorded_supply_pre_image_changed; owner, ACL, security definer,
-- volatility and configuration preserved and checked, h13_recorded_supply_metadata_changed): a Z05 with Z23 objects
-- takes the closure check only when it is a closure end of ours by the existing predicate
-- gridex_bilateral_prodat.z05_closure_owned_v1 (a recorded closure receipt, a related own closure or a matched closure
-- operation), or when that cannot be decided (no parsable wire). Otherwise it takes the same checks as every other
-- received end (gridex_supply_rescission.recorded_end_current_v1 and the supply-effect receipts), as
-- gridex_bilateral_prodat.ordinary_z05_end_v1 already treats it. A closure answer of ours is checked exactly as before.
begin;

do $h13$
declare
  fn constant regprocedure := 'gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure;
  pre_image constant text := '04b9de6b17709a1da8206a96265690f9ed9e182b2ba30178ca5dbecfa8900c2e';
  old_text constant text := $old$ IF m.message_code='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) o WHERE o->>'reason'='Z23') THEN RETURN gridex_bilateral_prodat.recorded_closure_end_current_v1(c,s);END IF;$old$;
  new_text constant text := $new$ -- H-13 (20261024160000): only a Z05 that ends a closure of ours is checked as a closure end.
 IF m.message_code='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) o WHERE o->>'reason'='Z23')
  AND gridex_bilateral_prodat.z05_closure_owned_v1(m,gridex_received_sources.normal_switch_wire_v1(m.raw_payload)) IS NOT FALSE THEN RETURN gridex_bilateral_prodat.recorded_closure_end_current_v1(c,s);END IF;$new$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_text, ''))) / length(old_text) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h13_recorded_supply_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_text, new_text);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h13_recorded_supply_metadata_changed' using errcode = 'P0U01';
  end if;
end
$h13$;

commit;
