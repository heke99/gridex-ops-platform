-- Commit a fresh, bound multisource raw projection before evaluating reply readiness.
-- Replays still run the existing owner and readiness proof within their own worker attempt.
DO $raw_yield$
DECLARE
  target regprocedure:='public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)';
  saved record;
  changed text;
  previous constant text:=$previous$    IF (gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,(
      SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
      FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source
    ))).id IS NULL THEN
      PERFORM gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(p_company,p_source,p_actor);
    END IF;
$previous$;
  replacement constant text:=$replacement$    SELECT p.primary_underlay_id INTO prior_projection
    FROM gridex_e66_intake.mixed_e73_billing_projections p
    JOIN gridex_e66_intake.mixed_e73_request_basis b
     ON (b.company_id,b.environment,b.request_id)=(p.company_id,p.environment,p.request_id)
    WHERE (b.company_id,b.environment,b.source_id,b.transaction_id,b.actor_id)
     =(p_company,p_environment,p_source,p_ide,p_actor);

    consumed_underlay:=gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,(
      SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
      FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source
    ));
    IF consumed_underlay.id IS NULL THEN
      PERFORM gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(p_company,p_source,p_actor);
    ELSIF consumed_underlay.payload#>>'{e73BillingScope,basisVersion}'='mixed-e73-ide-finance-v2'
      AND prior_projection IS DISTINCT FROM consumed_underlay.id THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
      RETURN jsonb_build_object('kind','progress');
    END IF;
$replacement$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT saved FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(saved.prosrc,'UTF8')),'hex') <> '6b6161d69b85cd9979c382db599b27b477c72ce8cfc57a484f65ed16b6258cf1'
    OR strpos(saved.prosrc,previous)=0
  THEN RAISE EXCEPTION 'mixed_e66_raw_yield_preimage_changed'; END IF;
  changed:=replace(replace(saved.prosrc,previous,replacement),'  stored jsonb;',
    '  stored jsonb;
  prior_projection uuid;
  consumed_underlay public.billing_underlays;');
  EXECUTE replace(saved.definition,saved.prosrc,changed);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM saved.metadata
  THEN RAISE EXCEPTION 'mixed_e66_raw_yield_metadata_changed'; END IF;
END
$raw_yield$;
