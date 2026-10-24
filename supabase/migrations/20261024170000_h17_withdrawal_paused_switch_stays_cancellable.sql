-- FINDINGS H-17 (quality/audits/live-chain-20261015/FINDINGS.md, reality H run 5): a customer withdraws after the Z03
-- is sent. The withdrawal case pauses the switch for cancellation (lib/operations/switchLifecycleBlocks.ts: status
-- 'cancellation_requested', lifecycle_blocked = true, lifecycle_block_source 'customer_case' or
-- 'customer_lifecycle_decision'). gridex_switch_cancellations.context_v1, the authority for every Z03C, refused any
-- lifecycle_blocked switch (same_current_owned_switch_customer_contract_physical_scope), so the very cancellation the
-- withdrawal asked for could never be built: the switch continued at the grid owner.
--
-- Change (exact pre-image, refused otherwise with h17_switch_cancellation_context_pre_image_changed; owner, ACL,
-- security definer, volatility and configuration preserved and checked, h17_switch_cancellation_context_metadata_changed):
-- a lifecycle block no longer refuses the cancellation when it is the block that requested it: status
-- 'cancellation_requested' set by a customer case or lifecycle decision. Every other block (manual follow-up, any
-- other source or status) still refuses. All other scope, contract, physical and wire checks are unchanged.
begin;

do $h17$
declare
  fn constant regprocedure := 'gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)'::regprocedure;
  pre_image constant text := '600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e';
  old_text constant text := $old$  OR s.lifecycle_blocked IS TRUE OR (s.status IN($old$;
  new_text constant text := $new$  -- H-17 (20261024170000): the block that requested this cancellation does not refuse it.
  OR (s.lifecycle_blocked IS TRUE AND (s.status='cancellation_requested' AND s.lifecycle_block_source IN('customer_case','customer_lifecycle_decision')) IS NOT TRUE)
  OR (s.status IN($new$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_text, ''))) / length(old_text) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h17_switch_cancellation_context_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_text, new_text);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h17_switch_cancellation_context_metadata_changed' using errcode = 'P0U01';
  end if;
end
$h17$;

commit;
