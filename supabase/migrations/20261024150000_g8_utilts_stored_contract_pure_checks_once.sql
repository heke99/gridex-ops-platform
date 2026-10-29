-- FINDINGS G-8 (quality/audits/live-chain-20261015/FINDINGS.md): storing one inbound UTILTS file took 2-3 minutes.
-- gridex_utilts_binding.stored_contract_v1 runs for every stored value several times (consume 2x plus once per
-- same-cohort hop, the billing read and the gate once each, the underlay once per source) and every call
-- re-tokenized the whole source (wire_tokens_v1) and re-ran validate_contract_v1, supported_point_v1 and
-- validate_decimal_source_v2. Those four are IMMUTABLE functions of content that stored_contract_v1 already binds by
-- hash on every call: the raw payload (receipt raw_hash = sha256(raw_payload)), the series raw transaction
-- (immutable_hash), the contract (contract_hash) and the transaction id.
--
-- Change (exact pre-image, refused otherwise with g8_stored_contract_pre_image_changed; owner, ACL, security,
-- volatility and configuration preserved and checked, g8_stored_contract_metadata_changed):
--   * gridex_utilts_binding.stored_contract_pure_checks: one row per passed combination of
--     (raw_hash, transaction, series immutable_hash, contract_hash, rules_hash), holding the supported point.
--     rules_hash is the sha256 of every IMMUTABLE function in gridex_utilts_binding (signature, configuration and
--     source), so any later rule change misses the memo and validates afresh. No grants; RLS on; only the owner's
--     functions write it.
--   * stored_contract_v1 keeps every row, lock, binding and hash check unchanged on every call. Only when the memo
--     holds the exact key does it reuse the point and skip the three pure checks; otherwise it runs them unchanged
--     and records the key after all of them passed. Same result, same errors, same
--     error precedence: a memo row exists only for inputs on which all three checks passed.
begin;

create function pg_temp.g8_rewrite(p_target regprocedure, p_pre text, p_old text[], p_new text[]) returns void
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
    raise exception 'g8_stored_contract_pre_image_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'g8_stored_contract_pre_image_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'g8_stored_contract_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

create table gridex_utilts_binding.stored_contract_pure_checks (
  check_key text primary key check (check_key ~ '^[0-9a-f]{64}$'),
  supported_point text not null,
  created_at timestamptz not null default now()
);
alter table gridex_utilts_binding.stored_contract_pure_checks enable row level security;
revoke all on table gridex_utilts_binding.stored_contract_pure_checks from public, anon, authenticated, service_role;

select pg_temp.g8_rewrite(
  'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'::regprocedure,
  -- Pre-image: the G-6 body over main's S01 stored_contract_v1 (20261024130000).
  '1ea52c365e001d5d9a99fd86210242791a3b9feb5094a430de06b2a2c2b9944f',
  array[
    E' v_tokens jsonb;\n',
    E' SELECT c.* INTO v_contract FROM gridex_utilts_binding.contracts c WHERE c.series_id=v_series.id AND c.company_id=p_company;\n',
    E' OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(v_contract.contract),false) THEN\n',
    E' v_tokens:=gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload);\n v_point:=gridex_utilts_binding.supported_point_v1(v_tokens,p_transaction);\n',
    E' IF v_contract.contract_version=2 AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(',
    E' RETURN v_contract.contract;\n'
  ],
  array[
    E' v_tokens jsonb;\n -- G-8 (20261024150000): the pure checks run once per hash-bound content and rule set.\n v_check_key text; v_memo_point text;\n',
    E' SELECT c.* INTO v_contract FROM gridex_utilts_binding.contracts c WHERE c.series_id=v_series.id AND c.company_id=p_company;\n'
    || E' IF FOUND THEN\n'
    || E'  -- Assignments, not SELECT INTO: FOUND must still describe the contract row for the check below.\n'
    || E'  v_check_key:=encode(sha256(convert_to(concat_ws(''|'',v_receipt.raw_hash,p_transaction,v_series.immutable_hash,v_contract.contract_hash,\n'
    || E'   (SELECT encode(sha256(convert_to(string_agg(r.oid::regprocedure::text||'':''||coalesce(array_to_string(r.proconfig,'',''),'''')||'':''||r.prosrc,''|'' ORDER BY r.oid::regprocedure::text),''UTF8'')),''hex'')\n'
    || E'    FROM pg_catalog.pg_proc r WHERE r.pronamespace=''gridex_utilts_binding''::regnamespace AND r.provolatile=''i'')),''UTF8'')),''hex'');\n'
    || E'  v_memo_point:=(SELECT m.supported_point FROM gridex_utilts_binding.stored_contract_pure_checks m WHERE m.check_key=v_check_key);\n'
    || E' END IF;\n',
    E' OR (v_memo_point IS NULL AND NOT coalesce(gridex_utilts_binding.validate_contract_v1(v_contract.contract),false)) THEN\n',
    E' IF v_memo_point IS NOT NULL THEN v_point:=v_memo_point; ELSE\n'
    || E' v_tokens:=gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload);\n v_point:=gridex_utilts_binding.supported_point_v1(v_tokens,p_transaction);\n END IF;\n',
    E' IF v_memo_point IS NULL AND v_contract.contract_version=2 AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(',
    E' -- An S01 area source has no supported point and is never remembered (main 20261023201053).\n'
    || E' IF v_memo_point IS NULL AND v_check_key IS NOT NULL AND v_point IS NOT NULL THEN\n'
    || E'  INSERT INTO gridex_utilts_binding.stored_contract_pure_checks(check_key,supported_point) VALUES (v_check_key,v_point) ON CONFLICT (check_key) DO NOTHING;\n'
    || E' END IF;\n RETURN v_contract.contract;\n'
  ]
);

commit;
