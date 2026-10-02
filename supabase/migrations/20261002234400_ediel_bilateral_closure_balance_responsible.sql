-- PRODAT 26.A requires NAD+Z02 (balance responsible, field 262) on Z08. The
-- bilateral LK closure basis carried no balance responsible, so every
-- rendered bilateral Z08/LK was refused by the field matrix
-- (FIELD_MATRIX_REQUIRED_FIELD_MISSING NAD+Z02/C082/3039).
--
-- The basis now carries the balance responsible confirmed by the received
-- source that started this supply (supplyBasis.initialSourceMessageId, the
-- grid owner's Z04): exactly one distinct NAD+Z02 party identifier. Without
-- one the operation is held, as before when the scope was not current.
BEGIN;
DO $brp$DECLARE f record;
 needle CONSTANT text:=$n$ RETURN scope||jsonb_build_object('status','authorized','version',1,'owner','immutable-bilateral-prodat-closure-operation-v1',$n$;
 replacement CONSTANT text:=$n$ SELECT count(DISTINCT t#>>'{elements,2,0}'),min(t#>>'{elements,2,0}') INTO brp_count,brp
  FROM public.ediel_messages src CROSS JOIN LATERAL jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(src.raw_payload,10000)) t
  WHERE src.id=(scope#>>'{supplyBasis,initialSourceMessageId}')::uuid AND src.company_id=c AND src.direction='inbound'
   AND t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02' AND nullif(t#>>'{elements,2,0}','') IS NOT NULL;
 IF brp_count IS DISTINCT FROM 1 OR brp IS NULL THEN RETURN NULL;END IF;
 RETURN scope||jsonb_build_object('balanceResponsibleId',brp,'status','authorized','version',1,'owner','immutable-bilateral-prodat-closure-operation-v1',$n$;
 decl_needle CONSTANT text:=$n$scope jsonb;BEGIN$n$;
 decl_replacement CONSTANT text:=$n$scope jsonb;brp text;brp_count integer;BEGIN$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_bilateral_prodat.closure_operation_current_v1(uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR (length(f.prosrc)-length(replace(f.prosrc,decl_needle,'')))/length(decl_needle)<>1 THEN RAISE EXCEPTION 'bilateral_closure_brp_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(replace(f.prosrc,needle,replacement),decl_needle,decl_replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'bilateral_closure_brp_metadata_changed';END IF;
END$brp$;
COMMIT;
