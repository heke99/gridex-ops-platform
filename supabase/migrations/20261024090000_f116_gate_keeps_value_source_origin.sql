-- FINDINGS F116 (reality run 29): a corrected E66 day re-sends all 96 quarters. gridex_consume_utilts_metering_v1 /
-- gridex_ingest_metering_value_atomic store a new revision only for a changed quarter; for an unchanged quarter they
-- keep the stored value, whose own origin (metering_values.source_ediel_message_id) stays the ORIGINAL message, and add
-- the correction as an extra metering_value_sources link. The ingestion then gated that unchanged value with the
-- correction as its source (lib/billing/meterValueBillingMatcher.ts, fixed in the same change). The gate write
-- gridex_set_metering_billing_gate_before_source_v2 set normalized_metering_values.source_message_id to whatever the
-- gate carried, so the value was rebound to the correction: its source basis (basis_before_precision_v1 requires
-- normalized.source_message_id = metering_values.source_ediel_message_id) became unqualified for good, and the value
-- was blocked with source_message_missing + source_basis_unqualified (72 of 96 quarters of the corrected day).
--
-- Change (one exact-text replacement in gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2):
--   a gate decision never rebinds the value's source; it only fills a missing one. The outer gate
--   (public.gridex_set_metering_billing_gate) still requires the gate's source to equal the value's own source for an
--   eligible decision, unchanged.
-- Repair: a current normalized value whose source_message_id was rebound by that write to a message that is only an
--   extra source link of the same stored value gets its own origin back (metering_values.source_ediel_message_id),
--   when the raw payload and the transaction reference still name that origin and the origin link exists. The gate
--   decision of a repaired value is not changed here; it is evaluated again by the product gate.
--
-- Exact-needle rewrite of the installed body; refuses (f116_gate_source_origin_rule_source_changed) unless the needle is
-- present exactly once and the replacement is absent. Owner, ACL, security definer, volatility and configuration
-- (proconfig) are preserved and checked.
begin;

do $f116$
declare
  old_bind constant text := $c$    source_message_id=coalesce(nullif(p_gate->>'source_message_id','')::uuid,source_message_id),$c$;
  new_bind constant text := $c$    -- F116 (20261024090000): a gate decision never rebinds the value's source; it only fills a missing one.
    source_message_id=coalesce(source_message_id,nullif(p_gate->>'source_message_id','')::uuid),$c$;
  f record;
  body text;
  repaired integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p
  where p.oid = 'gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(uuid,uuid,uuid,jsonb)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, old_bind, ''))) / length(old_bind) <> 1
    or position('F116 (20261024090000)' in f.prosrc) <> 0
    or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'f116_gate_source_origin_rule_source_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_bind, new_bind);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'f116_gate_source_origin_metadata_changed' using errcode = 'P0U01';
  end if;

  update public.normalized_metering_values n
     set source_message_id = m.source_ediel_message_id, updated_at = now()
    from public.metering_values m
   where m.company_id = n.company_id and m.id = n.source_metering_value_id
     and n.revision_status = 'current' and m.is_current is true and m.revision_status = 'current'
     and m.source_ediel_message_id is not null and n.source_message_id is not null
     and n.source_message_id is distinct from m.source_ediel_message_id
     and n.source_transaction_reference is not distinct from m.source_transaction_reference
     and n.raw_payload->>'edielMessageId' = m.source_ediel_message_id::text
     and exists (select 1 from public.metering_value_sources origin
                  where origin.company_id = n.company_id and origin.metering_value_id = m.id
                    and origin.normalized_metering_value_id = n.id and origin.source_ediel_message_id = m.source_ediel_message_id)
     and exists (select 1 from public.metering_value_sources resent
                  where resent.company_id = n.company_id and resent.metering_value_id = m.id
                    and resent.normalized_metering_value_id = n.id and resent.source_ediel_message_id = n.source_message_id);
  get diagnostics repaired = row_count;
  raise notice 'f116_gate_source_origin_repaired_values=%', repaired;
end
$f116$;

commit;
