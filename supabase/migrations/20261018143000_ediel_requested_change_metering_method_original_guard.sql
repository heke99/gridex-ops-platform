-- The retained requested-change transport consumer claims every outbound Z09
-- carrying CAV E34/E64/E32. A Z09F/G (E64/E32) originated by the customer-
-- agreed metering-method owner has no requested-change origin, so it was
-- refused at send/prepare/enter. When that owner's origin exactly binds the
-- message, leave it to that owner: this guard has no sender identity, and the
-- owner's current-source check runs with the actual sender in the same send
-- (TS assertMeteringMethodChangeSendSource; SQL transport/dispatch prepare and
-- enter). Never on E34 and never in place of a requested-change origin.
DO $forward$
DECLARE
 target regprocedure := 'public.ediel_require_requested_change_source_current_before_scope_fence_v1(uuid,uuid)'::regprocedure;
 original_definition text;
 anchor text := E'  IF m.environment=''test'' AND m.message_standard=''edifact''';
 bridge text := $body$  IF EXISTS(SELECT FROM gridex_metering_method_changes.origins method_origin
    WHERE method_origin.company_id=p_company_id AND method_origin.message_id=m.id
     AND gridex_metering_method_changes.message_binding_v1(m,method_origin))
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}' IN('E64','E32'))
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='E34') THEN
   RETURN;
  END IF;
$body$ || E'  IF m.environment=''test'' AND m.message_standard=''edifact''';
 metadata_before jsonb;
 wrapper_before jsonb;
BEGIN
 SELECT pg_get_functiondef(target),to_jsonb(p)-'prosrc' INTO original_definition,metadata_before FROM pg_proc p WHERE p.oid=target;
 SELECT to_jsonb(p) INTO wrapper_before FROM pg_proc p WHERE p.oid='public.ediel_require_requested_change_source_current_v1(uuid,uuid)'::regprocedure;
 IF (length(original_definition)-length(replace(original_definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'requested_change_method_bridge_single_anchor_required';
 END IF;
 EXECUTE replace(original_definition,anchor,bridge);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.ediel_require_requested_change_source_current_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM wrapper_before THEN
  RAISE EXCEPTION 'requested_change_method_bridge_metadata_preservation_required';
 END IF;
END $forward$;
