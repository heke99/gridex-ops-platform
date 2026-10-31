-- PORT to main (simulation T1, finding 20261029-3f1a8ab1/claude-track1/010 and 007) of finance
-- c400f6959d8c279fb518b7199fe6e77da30409c4 (commit 392e99ae8):
-- supabase/migrations/20261024130000_g6_billing_source_bases_once_per_source.sql. Applies after the adopted g1/g2
-- tokenizer and decimal-scan migrations 20261030120000/20261030120100 (#956); it does not depend on them (no guard references their bodies).
-- Version 20261030120200 is provisional; GEN assigns the final version.
--
-- Deviations from the finance file, all caused by main's 20261023201053_ediel_s01_area_aggregate_identity.sql (not in
-- finance), which changed stored_contract_v1 (S01 area identity branch; four tokenizer calls instead of two):
--   * stored_contract_v1: pre-image 0e74bd2f… -> 63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c;
--     fragments re-cut against main's body: the declaration line now ends with "area_identity jsonb;", v_tokens is
--     assigned once before the S01 CASE and replaces all four wire_tokens_v1(v_source.raw_payload) calls (S01 area
--     identity, S01 item match, supported point, decimal source). Every later path tokenized the same raw anyway and
--     wire_tokens_v1 is IMMUTABLE and never raises, so behaviour is unchanged.
--     post-image 9a580dde… -> 741c06ad69d76bf639390bbeb4f78507cccbf39c3f0869d54e4db2032c5154d1.
--   * gridex_store_billing_underlay: pre-image bd80a4d3… (finance body with f108/final-month/move-out/h3d parts) ->
--     c775d57fec0c980ddc31fff632b3595971250071d54fe2be76ff65b6eb3217a3 (main). Only G-6's three fragments (declare,
--     bases_v1 before the item loop, basis per item) are applied to main's body; nothing else from finance is carried.
--     post-image 014b52df… -> ba59faf05e9c807608147eca6b6c36cbac8ec84ab18974e19dd3477c3c15e7f5.
--   * basis_before_precision_v1 (d1965eb8…), basis_v1 (cf5325a4…) and gridex_read_billing_source_values_v1 (3d1a829f…):
--     main's pre-images equal finance's; fragments, post-images and the bases_v1/basis_entry_v1 bodies
--     (fe9b0b98…, 7f60d560…) are verbatim. Comments inside rewritten bodies keep the finance tag "G-6 (20261024130000)"
--     so that those post-images stay byte-identical with finance.
--
-- FINDINGS G-6 / G-2 (quality/audits/live-chain-20261015/FINDINGS.md): gridex_read_billing_source_values_v1 hit the
-- 8 s statement timeout (57014) on every quarter-hour month. Per value it called basis_v1 -> basis_before_precision_v1
-- -> stored_contract_v1, which re-validated the whole source message (raw hash, membership, contract, decimal source)
-- and tokenized it twice; basis_before_precision_v1 and basis_v1 tokenized it twice more. Measured in the world DB
-- (rolled back): ~167 ms per value, ~167 s per 1000-id chunk. gridex_store_billing_underlay loops basis_v1 over every
-- item of the month in one statement and had the same cost.
--
-- Change (exact pre-images, refused otherwise with g6_billing_source_basis_rule_source_changed; owner, ACL, security,
-- volatility and configuration preserved and checked, g6_billing_source_basis_metadata_changed):
--   * gridex_billing_source.bases_v1(company, values[], precision, capture): the unchanged logic of
--     basis_before_precision_v1 (and of basis_v1's precision step) for each value in order, with a per-call memo:
--     tokens per raw sha256 and decimal rules per (raw sha256, transaction) (IMMUTABLE functions), and the
--     stored_contract_v1 outcome per (source, transaction). With more than one value every source message is first
--     locked FOR UPDATE for the rest of the transaction; every writer of the rows stored_contract_v1 reads takes that
--     lock (persist_series_v2/legacy_v1, persist_consumption_before_precision_v1) or the rows are immutable
--     (receipts, contracts, meter_reading_series), so one validation per (source, transaction) equals the repeated one.
--   * basis_before_precision_v1 / basis_v1 become one-value calls of bases_v1 (single source of truth; no memo reuse,
--     no extra lock, errors raised unchanged).
--   * gridex_read_billing_source_values_v1 evaluates its values with one bases_v1 call in the same id order.
--   * gridex_store_billing_underlay evaluates its items with one bases_v1 call in loop order; a captured error is
--     raised (same SQLSTATE/message/detail/hint) when the loop reaches that item, so error precedence is unchanged.
--   * stored_contract_v1 tokenizes the source once instead of twice (G-2 open item).
-- No validation, qualification rule, result shape, error path or permission changes.
begin;

create function pg_temp.g6_rewrite(p_target regprocedure, p_pre text, p_post text, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from p_pre
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'g6_billing_source_basis_rule_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'g6_billing_source_basis_rule_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  if encode(sha256(convert_to(body, 'UTF8')), 'hex') is distinct from p_post then
    raise exception 'g6_billing_source_basis_rule_source_changed:%:post', p_target using errcode = 'P0U01';
  end if;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'g6_billing_source_basis_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

CREATE FUNCTION gridex_billing_source.bases_v1(p_company uuid, p_values uuid[], p_precision boolean, p_capture boolean) RETURNS jsonb
 LANGUAGE plpgsql SET search_path TO pg_catalog, public, extensions
 AS $g6bases$
-- G-6 (20261024130000): one evaluation of basis_before_precision_v1 (and, with p_precision, basis_v1) per value, in
-- p_values order, with a per-call memo: wire tokens per raw-payload sha256 (wire_tokens_v1 is IMMUTABLE), the
-- stored_contract_v1 outcome per (source, transaction) and the decimal rules per (raw-payload sha256, transaction)
-- (decimal_rules_v1 is IMMUTABLE). With more than one value every source message is locked FOR UPDATE first (the lock
-- lock_values_v1 takes per value) for the rest of the transaction, so every row stored_contract_v1 reads for that
-- source is either immutable or written only under that lock: one validation per (source, transaction) is the same
-- validation repeated. Element i of the result is {"b":basis} ({} for a NULL basis); with p_capture an error of value
-- i is returned as {"e":{state,message,detail,hint}} for basis_entry_v1 to raise at the caller's own position.
DECLARE n public.normalized_metering_values%rowtype;m public.metering_values%rowtype;s public.ediel_messages%rowtype;
 c jsonb;o jsonb;physical jsonb;basis jsonb;rule_basis jsonb;ordinal integer;source_ordinal integer;qualified boolean;why text;
 rules jsonb;p_value uuid;result jsonb[]:='{}';token_keys text[]:='{}';token_values jsonb[]:='{}';contract_keys text[]:='{}';contract_values jsonb[]:='{}';rule_keys text[]:='{}';rule_values jsonb[]:='{}';at integer;locked boolean:=false;contract_hash text;
 payload_hash text;memo_key text;hit jsonb;tokens jsonb;e_state text;e_message text;e_detail text;e_hint text;
BEGIN
 IF cardinality(p_values)>1 THEN
  PERFORM em.id FROM public.ediel_messages em WHERE em.company_id=p_company AND em.id IN(SELECT nv.source_message_id FROM public.normalized_metering_values nv WHERE nv.company_id=p_company AND nv.id=ANY(p_values)) ORDER BY em.id FOR UPDATE;
  -- The locks lock_values_v1 takes per value, taken once for every existing value. Afterwards the per-value call can
  -- only refuse a value that does not exist (P0002 billing_source_value_missing), which the existence check below
  -- raises identically. If this one call fails, nothing is kept and every value takes its own lock_values_v1 call.
  BEGIN
   PERFORM gridex_billing_source.lock_values_v1(p_company,ARRAY(SELECT nv.id FROM public.normalized_metering_values nv WHERE nv.company_id=p_company AND nv.id=ANY(p_values)));
   locked:=true;
  EXCEPTION WHEN OTHERS THEN locked:=false;
  END;
 END IF;
 FOREACH p_value IN ARRAY p_values LOOP
  BEGIN
   n:=NULL;m:=NULL;s:=NULL;c:=NULL;o:=NULL;physical:=NULL;basis:=NULL;rule_basis:=NULL;ordinal:=NULL;source_ordinal:=NULL;qualified:=false;why:='billing_source_binding_unavailable';rules:=NULL;
   <<before_precision>>
   BEGIN
    IF NOT locked THEN PERFORM gridex_billing_source.lock_values_v1(p_company,ARRAY[p_value]);
    ELSIF NOT EXISTS(SELECT FROM public.normalized_metering_values nv WHERE nv.company_id=p_company AND nv.id=p_value) THEN RAISE EXCEPTION 'billing_source_value_missing' USING ERRCODE='P0002';
    END IF;
    SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company AND id=p_value;
    IF n.id IS NULL THEN RAISE EXCEPTION 'billing_source_value_missing' USING ERRCODE='P0002'; END IF;
    basis:=jsonb_build_object('version',1,'qualified',false,'reason',why,'normalizedValueId',n.id,'sourceMessageId',n.source_message_id,
    'quantityKwh',gridex_utilts_binding.canonical_decimal_v2(n.quantity_kwh::text),'quantityType',null,'quality',null,'qualityEstablished',false,'productCode',n.product_code,'contractHash',null,'sourcePayloadHash',null,'observationOrdinal',null);
    SELECT * INTO m FROM public.metering_values WHERE id=n.source_metering_value_id AND company_id=p_company FOR SHARE;
    SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company FOR SHARE;
    IF m.id IS NULL OR s.id IS NULL OR s.direction IS DISTINCT FROM 'inbound' OR s.message_family IS DISTINCT FROM 'UTILTS' OR NOT coalesce(s.message_code IN ('E30','E66'),false)
     OR n.source_transaction_reference IS NULL OR n.revision_status IS DISTINCT FROM 'current' OR m.is_current IS DISTINCT FROM true OR m.revision_status IS DISTINCT FROM 'current'
     OR n.quantity_kwh IS DISTINCT FROM m.value_kwh OR n.period_start IS DISTINCT FROM m.period_start OR n.period_end IS DISTINCT FROM m.period_end
     OR n.unit IS DISTINCT FROM 'kWh' OR n.direction IS DISTINCT FROM m.direction OR n.quality_status IS DISTINCT FROM m.quality_code
     OR n.source_message_id IS DISTINCT FROM m.source_ediel_message_id OR n.source_transaction_reference IS DISTINCT FROM m.source_transaction_reference
     OR n.metering_point_id IS DISTINCT FROM m.metering_point_id OR n.customer_id IS DISTINCT FROM m.customer_id
     OR n.raw_payload IS DISTINCT FROM m.raw_payload THEN EXIT before_precision; END IF;
    memo_key:=s.id::text||'/'||n.source_transaction_reference;
    at:=array_position(contract_keys,memo_key);hit:=contract_values[at];
    IF hit IS NULL THEN
     BEGIN
      c:=gridex_utilts_binding.stored_contract_v1(p_company,s.id,n.source_transaction_reference);
      contract_keys:=contract_keys||memo_key;contract_hash:=encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex');contract_values:=contract_values||jsonb_build_object('contract',c,'hash',contract_hash);
     EXCEPTION WHEN SQLSTATE 'P0U01' OR no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range THEN
      contract_keys:=contract_keys||memo_key;contract_values:=contract_values||jsonb_build_object('state',SQLSTATE,'message',SQLERRM);
      RAISE;
     END;
    ELSIF hit ? 'state' THEN RAISE EXCEPTION USING ERRCODE=hit->>'state',MESSAGE=hit->>'message';
    ELSE c:=hit->'contract';contract_hash:=hit->>'hash';
    END IF;
    BEGIN rule_basis:=gridex_ediel_source_rules.require_v1(p_company,s.id);
    EXCEPTION WHEN raise_exception THEN
     IF SQLERRM IN ('ediel_historical_rule_pack_basis_unavailable','ediel_source_rule_pack_basis_required') THEN basis:=basis||jsonb_build_object('reason',SQLERRM); EXIT before_precision; END IF;
     RAISE;
    END;
    IF n.raw_payload->'consumptionContract' IS DISTINCT FROM c OR n.raw_payload->>'edielMessageId' IS DISTINCT FROM s.id::text
     OR c#>>'{metering,capability}' IS DISTINCT FROM 'write' OR c#>>'{metering,meteringPointId}' IS DISTINCT FROM n.metering_point_id::text
     OR c#>>'{metering,customerId}' IS DISTINCT FROM n.customer_id::text THEN EXIT before_precision; END IF;
    source_ordinal:=(n.raw_payload->>'sourceOrdinal')::integer;
    SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
    payload_hash:=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex');
    at:=array_position(token_keys,payload_hash);tokens:=token_values[at];
    IF tokens IS NULL THEN
     tokens:=gridex_utilts_binding.wire_tokens_v1(s.raw_payload);
     IF payload_hash IS NOT NULL AND tokens IS NOT NULL THEN token_keys:=token_keys||payload_hash;token_values:=token_values||tokens; END IF;
    END IF;
    physical:=gridex_billing_source.observation_v1(tokens,n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
    IF physical IS NULL THEN EXIT before_precision; END IF;
    -- This is a new billing projection, not a rewrite of the immutable consumer
    -- contract or its historical ACK. The authentic raw/hash/own ordinal and
    -- original rule basis independently establish previously lossy diagnostics.
    basis:=basis||jsonb_build_object('projectionVersion','ediel-billing-source-v1','quantityType',physical->'quantityType','quality',physical->'quality','qualityEstablished',true,'productCode',physical->'productCode','registerCode',physical->'registerCode','sourceRulePackBasis',rule_basis,
     'retainedProjection',jsonb_build_object('quality',n.quality_status,'productCode',n.product_code,'registerCode',n.register_code),
     'contractHash',contract_hash,'sourcePayloadHash',encode(digest(convert_to(s.raw_payload,'UTF8'),'sha256'),'hex'),'observationOrdinal',ordinal);
    IF o->>'unit' IS DISTINCT FROM 'kWh' OR (o->>'quantity')::numeric IS DISTINCT FROM n.quantity_kwh
     OR (o->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (o->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
     OR o->>'direction' IS DISTINCT FROM n.direction OR o->>'quality' IS DISTINCT FROM n.quality_status
     OR o->>'productCode' IS DISTINCT FROM n.product_code OR o->>'registerCode' IS DISTINCT FROM n.register_code
     OR (physical->>'quantityKwh')::numeric IS DISTINCT FROM n.quantity_kwh OR (physical->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (physical->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
     OR physical->>'messageCode' IS DISTINCT FROM s.message_code OR physical->>'quantityType' IS DISTINCT FROM '136'
     OR NOT coalesce(physical->>'applicationReference' IN ('23-DDQ-E66-S','23-DDQ-E66-T'),false) THEN why:='billing_source_semantics_mismatch';
    ELSIF s.message_code='E66' AND physical->>'productCode' IS DISTINCT FROM '8716867000030' THEN why:='billing_product_not_individual_active_energy';
    ELSE qualified:=true;why:=NULL; END IF;
    basis:=basis||jsonb_build_object('qualified',qualified,'reason',why);
   EXCEPTION WHEN SQLSTATE 'P0U01' OR no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range THEN NULL;
   END;
   -- basis_v1: the standard decimal/unit precision step over a qualified basis.
   IF p_precision AND basis->'qualified' IS NOT DISTINCT FROM 'true'::jsonb THEN
    SELECT * INTO n FROM public.normalized_metering_values WHERE id=p_value AND company_id=p_company;
    SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company;
    payload_hash:=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex');
    memo_key:=payload_hash||'/'||n.source_transaction_reference;
    at:=array_position(rule_keys,memo_key);hit:=rule_values[at];
    IF hit IS NOT NULL THEN rules:=hit->'r';
    ELSE
     at:=array_position(token_keys,payload_hash);tokens:=token_values[at];
     IF tokens IS NULL THEN
      tokens:=gridex_utilts_binding.wire_tokens_v1(s.raw_payload);
      IF payload_hash IS NOT NULL AND tokens IS NOT NULL THEN token_keys:=token_keys||payload_hash;token_values:=token_values||tokens; END IF;
     END IF;
     rules:=gridex_utilts_binding.decimal_rules_v1(tokens,n.source_transaction_reference,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
     IF memo_key IS NOT NULL THEN rule_keys:=rule_keys||memo_key;rule_values:=rule_values||CASE WHEN rules IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('r',rules) END; END IF;
    END IF;
    IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN basis:=basis||jsonb_build_object('qualified',false,'reason','billing_source_standard_decimal_or_unit_basis_required'); END IF;
   END IF;
   result:=result||CASE WHEN basis IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('b',basis) END;
  EXCEPTION WHEN OTHERS THEN
   IF NOT p_capture THEN RAISE; END IF;
   GET STACKED DIAGNOSTICS e_state=RETURNED_SQLSTATE,e_message=MESSAGE_TEXT,e_detail=PG_EXCEPTION_DETAIL,e_hint=PG_EXCEPTION_HINT;
   result:=result||jsonb_build_object('e',jsonb_build_object('state',e_state,'message',e_message,'detail',nullif(e_detail,''),'hint',nullif(e_hint,'')));
  END;
 END LOOP;
 RETURN to_jsonb(result);
END$g6bases$;
CREATE FUNCTION gridex_billing_source.basis_entry_v1(p_entry jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog'
 AS $g6entry$
-- G-6 (20261024130000): the basis of one bases_v1 element, or that value's captured error raised again with its
-- SQLSTATE, message, detail and hint.
DECLARE e jsonb:=p_entry->'e';
BEGIN
 IF e IS NULL THEN RETURN p_entry->'b'; END IF;
 IF e->>'detail' IS NOT NULL AND e->>'hint' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE=e->>'state',MESSAGE=e->>'message',DETAIL=e->>'detail',HINT=e->>'hint';
 ELSIF e->>'detail' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE=e->>'state',MESSAGE=e->>'message',DETAIL=e->>'detail';
 ELSIF e->>'hint' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE=e->>'state',MESSAGE=e->>'message',HINT=e->>'hint';
 ELSE RAISE EXCEPTION USING ERRCODE=e->>'state',MESSAGE=e->>'message';
 END IF;
END$g6entry$;
REVOKE ALL ON FUNCTION gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION gridex_billing_source.basis_entry_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;

do $g6check$
begin
  if encode(sha256(convert_to((select prosrc from pg_proc where oid = 'gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)'::regprocedure), 'UTF8')), 'hex') is distinct from 'fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2'
    or encode(sha256(convert_to((select prosrc from pg_proc where oid = 'gridex_billing_source.basis_entry_v1(jsonb)'::regprocedure), 'UTF8')), 'hex') is distinct from '7f60d5609b5f2c9ce8b726d7c0b5f4831be234f36306bcf833598622ed0c5c3b'
    or exists (select from pg_proc p, pg_proc b where b.oid = 'gridex_billing_source.basis_before_precision_v1(uuid,uuid)'::regprocedure
      and p.oid in ('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)'::regprocedure, 'gridex_billing_source.basis_entry_v1(jsonb)'::regprocedure)
      and (p.proowner, p.proacl::text, p.prosecdef) is distinct from (b.proowner, b.proacl::text, b.prosecdef)) then
    raise exception 'g6_billing_source_basis_metadata_changed:helpers' using errcode = 'P0U01';
  end if;
end
$g6check$;

select pg_temp.g6_rewrite(
  'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'::regprocedure,
  '63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c',
  '741c06ad69d76bf639390bbeb4f78507cccbf39c3f0869d54e4db2032c5154d1',
  array[
    $g6old$ v_contract gridex_utilts_binding.contracts%rowtype; v_point text; area_identity jsonb;
$g6old$,
    $g6old$ area_identity:=CASE WHEN v_source.message_code='S01' THEN gridex_utilts_binding.s01_l359_area_identity_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction) END;$g6old$,
    $g6old$gridex_utilts_binding.s01_l359_item_matches_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),$g6old$,
    $g6old$ v_point:=gridex_utilts_binding.supported_point_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction);$g6old$,
    $g6old$gridex_utilts_binding.validate_decimal_source_v2(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),v_series.raw_transaction,$g6old$
  ],
  array[
    $g6new$ v_contract gridex_utilts_binding.contracts%rowtype; v_point text; area_identity jsonb;
 -- G-6 (20261024130000): the source is tokenized once (wire_tokens_v1 is IMMUTABLE and never raises).
 v_tokens jsonb;
$g6new$,
    $g6new$ v_tokens:=gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload);
 area_identity:=CASE WHEN v_source.message_code='S01' THEN gridex_utilts_binding.s01_l359_area_identity_v1(v_tokens,p_transaction) END;$g6new$,
    $g6new$gridex_utilts_binding.s01_l359_item_matches_v1(v_tokens,$g6new$,
    $g6new$ v_point:=gridex_utilts_binding.supported_point_v1(v_tokens,p_transaction);$g6new$,
    $g6new$gridex_utilts_binding.validate_decimal_source_v2(v_tokens,v_series.raw_transaction,$g6new$
  ]
);

select pg_temp.g6_rewrite(
  'gridex_billing_source.basis_before_precision_v1(uuid,uuid)'::regprocedure,
  'd1965eb86c40723593accc3c1249ec382091bde14a4f6a3b84adc3daf4db2644',
  '70f24d94162cd04b82a886230edb5abea551b4e9715a3b3d83037159c4ce2e25',
  array[
    $g6old$
DECLARE n public.normalized_metering_values%rowtype;m public.metering_values%rowtype;s public.ediel_messages%rowtype;
 c jsonb;o jsonb;physical jsonb;basis jsonb;rule_basis jsonb;ordinal integer;source_ordinal integer;qualified boolean:=false;why text:='billing_source_binding_unavailable';
BEGIN
 PERFORM gridex_billing_source.lock_values_v1(p_company,ARRAY[p_value]);
 SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company AND id=p_value;
 IF n.id IS NULL THEN RAISE EXCEPTION 'billing_source_value_missing' USING ERRCODE='P0002'; END IF;
 basis:=jsonb_build_object('version',1,'qualified',false,'reason',why,'normalizedValueId',n.id,'sourceMessageId',n.source_message_id,
 'quantityKwh',gridex_utilts_binding.canonical_decimal_v2(n.quantity_kwh::text),'quantityType',null,'quality',null,'qualityEstablished',false,'productCode',n.product_code,'contractHash',null,'sourcePayloadHash',null,'observationOrdinal',null);
 SELECT * INTO m FROM public.metering_values WHERE id=n.source_metering_value_id AND company_id=p_company FOR SHARE;
 SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company FOR SHARE;
 IF m.id IS NULL OR s.id IS NULL OR s.direction IS DISTINCT FROM 'inbound' OR s.message_family IS DISTINCT FROM 'UTILTS' OR NOT coalesce(s.message_code IN ('E30','E66'),false)
  OR n.source_transaction_reference IS NULL OR n.revision_status IS DISTINCT FROM 'current' OR m.is_current IS DISTINCT FROM true OR m.revision_status IS DISTINCT FROM 'current'
  OR n.quantity_kwh IS DISTINCT FROM m.value_kwh OR n.period_start IS DISTINCT FROM m.period_start OR n.period_end IS DISTINCT FROM m.period_end
  OR n.unit IS DISTINCT FROM 'kWh' OR n.direction IS DISTINCT FROM m.direction OR n.quality_status IS DISTINCT FROM m.quality_code
  OR n.source_message_id IS DISTINCT FROM m.source_ediel_message_id OR n.source_transaction_reference IS DISTINCT FROM m.source_transaction_reference
  OR n.metering_point_id IS DISTINCT FROM m.metering_point_id OR n.customer_id IS DISTINCT FROM m.customer_id
  OR n.raw_payload IS DISTINCT FROM m.raw_payload THEN RETURN basis; END IF;
 c:=gridex_utilts_binding.stored_contract_v1(p_company,s.id,n.source_transaction_reference);
 BEGIN rule_basis:=gridex_ediel_source_rules.require_v1(p_company,s.id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IN ('ediel_historical_rule_pack_basis_unavailable','ediel_source_rule_pack_basis_required') THEN RETURN basis||jsonb_build_object('reason',SQLERRM); END IF;
  RAISE;
 END;
 IF n.raw_payload->'consumptionContract' IS DISTINCT FROM c OR n.raw_payload->>'edielMessageId' IS DISTINCT FROM s.id::text
  OR c#>>'{metering,capability}' IS DISTINCT FROM 'write' OR c#>>'{metering,meteringPointId}' IS DISTINCT FROM n.metering_point_id::text
  OR c#>>'{metering,customerId}' IS DISTINCT FROM n.customer_id::text THEN RETURN basis; END IF;
 source_ordinal:=(n.raw_payload->>'sourceOrdinal')::integer;
 SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
 physical:=gridex_billing_source.observation_v1(gridex_utilts_binding.wire_tokens_v1(s.raw_payload),n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
 IF physical IS NULL THEN RETURN basis; END IF;
 -- This is a new billing projection, not a rewrite of the immutable consumer
 -- contract or its historical ACK. The authentic raw/hash/own ordinal and
 -- original rule basis independently establish previously lossy diagnostics.
 basis:=basis||jsonb_build_object('projectionVersion','ediel-billing-source-v1','quantityType',physical->'quantityType','quality',physical->'quality','qualityEstablished',true,'productCode',physical->'productCode','registerCode',physical->'registerCode','sourceRulePackBasis',rule_basis,
  'retainedProjection',jsonb_build_object('quality',n.quality_status,'productCode',n.product_code,'registerCode',n.register_code),
  'contractHash',encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex'),'sourcePayloadHash',encode(digest(convert_to(s.raw_payload,'UTF8'),'sha256'),'hex'),'observationOrdinal',ordinal);
 IF o->>'unit' IS DISTINCT FROM 'kWh' OR (o->>'quantity')::numeric IS DISTINCT FROM n.quantity_kwh
  OR (o->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (o->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
  OR o->>'direction' IS DISTINCT FROM n.direction OR o->>'quality' IS DISTINCT FROM n.quality_status
  OR o->>'productCode' IS DISTINCT FROM n.product_code OR o->>'registerCode' IS DISTINCT FROM n.register_code
  OR (physical->>'quantityKwh')::numeric IS DISTINCT FROM n.quantity_kwh OR (physical->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (physical->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
  OR physical->>'messageCode' IS DISTINCT FROM s.message_code OR physical->>'quantityType' IS DISTINCT FROM '136'
  OR NOT coalesce(physical->>'applicationReference' IN ('23-DDQ-E66-S','23-DDQ-E66-T'),false) THEN why:='billing_source_semantics_mismatch';
 ELSIF s.message_code='E66' AND physical->>'productCode' IS DISTINCT FROM '8716867000030' THEN why:='billing_product_not_individual_active_energy';
 ELSE qualified:=true;why:=NULL; END IF;
 RETURN basis||jsonb_build_object('qualified',qualified,'reason',why);
EXCEPTION WHEN SQLSTATE 'P0U01' OR no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN basis;
END $g6old$
  ],
  array[
    $g6new$
-- G-6 (20261024130000): one value of gridex_billing_source.bases_v1, which holds this logic for one or many values.
BEGIN
 RETURN gridex_billing_source.basis_entry_v1(gridex_billing_source.bases_v1(p_company,ARRAY[p_value],false,false)->0);
END $g6new$
  ]
);

select pg_temp.g6_rewrite(
  'gridex_billing_source.basis_v1(uuid,uuid)'::regprocedure,
  'cf5325a4fa00b070ca0be113354497f818d308c2c482371a91d2668f724f69de',
  'd2a211ec8b87ca1e403e49de57046cf8b171c7d89d5f900e638ef6f9526d7d50',
  array[
    $g6old$
DECLARE b jsonb;n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;rules jsonb;
BEGIN
 b:=gridex_billing_source.basis_before_precision_v1(p_company,p_value);
 IF b->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RETURN b; END IF;
 SELECT * INTO n FROM public.normalized_metering_values WHERE id=p_value AND company_id=p_company;
 SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company;
 rules:=gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1(s.raw_payload),n.source_transaction_reference,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
 IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN RETURN b||jsonb_build_object('qualified',false,'reason','billing_source_standard_decimal_or_unit_basis_required'); END IF;
 RETURN b;
END $g6old$
  ],
  array[
    $g6new$
-- G-6 (20261024130000): one value of gridex_billing_source.bases_v1 with the decimal/unit precision step.
BEGIN
 RETURN gridex_billing_source.basis_entry_v1(gridex_billing_source.bases_v1(p_company,ARRAY[p_value],true,false)->0);
END $g6new$
  ]
);

select pg_temp.g6_rewrite(
  'public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure,
  '3d1a829f6b04f93ae332a3ee35168e8c15efdbb0861ef65266b5fb6bc5634b50',
  'f7cdbd917f7c956e7acd168576e98671afc91456d29e02f0c550b1fc84df5be5',
  array[
    $g6old$DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;result jsonb:='[]';
$g6old$,
    $g6old$  result:=result||jsonb_build_array(to_jsonb(n)||$g6old$,
    $g6old$ RETURN result;
$g6old$,
    $g6old$ FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
$g6old$
  ],
  array[
    $g6new$DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;result jsonb[]:='{}';bases jsonb;i integer:=0;
$g6new$,
    $g6new$  result:=result||(to_jsonb(n)||$g6new$,
    $g6new$ -- G-6: rows are accumulated in an array and serialized once (was an O(n^2) jsonb concatenation of ~43 kB rows).
 RETURN to_jsonb(result);
$g6new$,
    $g6new$ -- G-6 (20261024130000): every basis of this call in one bases_v1 evaluation (same values, same id order).
 bases:=gridex_billing_source.bases_v1(p_company_id,ARRAY(SELECT id FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id),true,false);
 FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_entry_v1(bases->i);i:=i+1;
$g6new$
  ]
);

select pg_temp.g6_rewrite(
  'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
  'c775d57fec0c980ddc31fff632b3595971250071d54fe2be76ff65b6eb3217a3',
  'ba59faf05e9c807608147eca6b6c36cbac8ec84ab18974e19dd3477c3c15e7f5',
  array[
    $g6old$ prior gridex_billing_source.underlay_bindings%rowtype;stored_id uuid;start_at timestamptz;end_at timestamptz;ready boolean;
$g6old$,
    $g6old$ FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'source_normalized_metering_value_id' LOOP
$g6old$,
    $g6old$  basis:=gridex_billing_source.basis_v1(p_company_id,n.id);
$g6old$
  ],
  array[
    $g6new$ prior gridex_billing_source.underlay_bindings%rowtype;stored_id uuid;start_at timestamptz;end_at timestamptz;ready boolean;bases jsonb;ids uuid[];i integer:=0;
$g6new$,
    $g6new$ -- G-6 (20261024130000): the bases of the items in loop order in one bases_v1 evaluation; an error of one item is
 -- raised when the loop reaches that item, and an item whose id does not resolve exactly as below is evaluated alone.
 ids:=ARRAY(SELECT nv.id FROM jsonb_array_elements(p_items) e LEFT JOIN public.normalized_metering_values nv ON nv.company_id=p_company_id AND nv.id::text=e.value->>'source_normalized_metering_value_id' ORDER BY e.value->>'source_normalized_metering_value_id');
 bases:=gridex_billing_source.bases_v1(p_company_id,ids,true,true);
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'source_normalized_metering_value_id' LOOP
$g6new$,
    $g6new$  i:=i+1;basis:=CASE WHEN ids[i] IS NOT DISTINCT FROM n.id THEN gridex_billing_source.basis_entry_v1(bases->(i-1)) ELSE gridex_billing_source.basis_v1(p_company_id,n.id) END;
$g6new$
  ]
);

commit;
