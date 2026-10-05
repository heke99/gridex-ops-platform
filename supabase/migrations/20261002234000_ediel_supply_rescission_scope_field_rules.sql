-- gridex_supply_rescission.scope_v1 (national Z08/H rescission, 20261001093425)
-- snapshots its Z08/H + Z05/L grammar with
-- ediel_field_rules.message_profile_id, a column that does not exist; every
-- rescission scope failed at runtime (column f.message_profile_id does not
-- exist). PRODAT 26.A field rules are per message code, subtype optional: read
-- the rules of each selected profile's code (no subtype, or the profile's
-- subtype). Nothing else in the scope changes. Its signed issuer receipt
-- embeds that scope, so receipt_current_v1's 64 KiB cap on the decoded payload
-- is raised to 1 MiB; signature and hash checks are unchanged.
--
-- PRODAT 26.A requires NAD+Z02 (balance responsible, field 262) on Z08; the
-- rescission scope carried no balance responsible, so the rendered Z08/H was
-- refused by the field matrix. The scope now carries the BRP bound to the
-- original Z03 that started this supply
-- (gridex_received_sources.switch_brp_source_bindings) and is held without one.
BEGIN;
DO $scope$DECLARE f record;
 needle CONSTANT text:=$n$FROM public.ediel_field_rules f WHERE f.message_profile_id IN(SELECT(profile->>'id')::uuid FROM jsonb_array_elements(profiles) profile)$n$;
 replacement CONSTANT text:=$n$FROM public.ediel_field_rules f WHERE f.message_family='PRODAT' AND coalesce(f.is_active,true) AND coalesce(f.enabled,true)
   AND EXISTS(SELECT FROM jsonb_array_elements(profiles) profile WHERE profile->>'message_code'=f.message_code AND (nullif(f.subtype,'') IS NULL OR f.subtype=profile->>'transaction_subtype'))$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_supply_rescission.scope_v1(uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'supply_rescission_scope_field_rules_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_rescission_scope_field_rules_metadata_changed';END IF;
END$scope$;
DO $receipt$DECLARE f record;
 needle CONSTANT text:=$n$IF octet_length(bytes) NOT BETWEEN 1 AND 65536$n$;
 replacement CONSTANT text:=$n$IF octet_length(bytes) NOT BETWEEN 1 AND 1048576$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'supply_rescission_receipt_size_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_rescission_receipt_size_metadata_changed';END IF;
END$receipt$;
DO $brp$DECLARE f record;
 needle CONSTANT text:=$n$'effectiveAt',effective,'rulePackId',pack.id,'sourceGrammar',grammar,$n$;
 replacement CONSTANT text:=$n$'effectiveAt',effective,'balanceResponsibleId',(SELECT b.brp_ediel_id FROM gridex_received_sources.switch_brp_source_bindings b WHERE b.message_id=(basis->>'originalMessageId')::uuid AND b.company_id=c),'rulePackId',pack.id,'sourceGrammar',grammar,$n$;
 guard CONSTANT text:=$n$ RETURN jsonb_build_object('purpose','national_prodat_z08h_legal_rescission',$n$;
 guarded CONSTANT text:=$n$ IF NOT EXISTS(SELECT FROM gridex_received_sources.switch_brp_source_bindings b WHERE b.message_id=(basis->>'originalMessageId')::uuid AND b.company_id=c AND nullif(b.brp_ediel_id,'') IS NOT NULL) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('purpose','national_prodat_z08h_legal_rescission',$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_supply_rescission.scope_v1(uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR (length(f.prosrc)-length(replace(f.prosrc,guard,'')))/length(guard)<>1 THEN RAISE EXCEPTION 'supply_rescission_brp_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(replace(f.prosrc,needle,replacement),guard,guarded));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_rescission_brp_metadata_changed';END IF;
END$brp$;
COMMIT;
