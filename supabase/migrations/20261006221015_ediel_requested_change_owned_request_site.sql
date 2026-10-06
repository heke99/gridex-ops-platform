-- Fresh requests must share the intent's already qualified point site before
-- freezing request_binding. Historical origins return first and are unchanged.
-- Preserve the existing projector's ownership checks and all function metadata.
DO $forward$
DECLARE
 target regprocedure := 'public.ediel_originate_requested_change_before_scope_fence_v1(uuid,uuid,uuid,jsonb)'::regprocedure;
 definition_before text;
 body_before text;
 body_after text;
 metadata_before jsonb;
 wrapper_before jsonb;
 anchors text[] := ARRAY[
  'INSERT INTO public.outbound_requests(company_id,customer_id,metering_point_id,communication_route_id',
  'VALUES(p_company_id,e.customer_id,e.metering_point_id,i.communication_route_id'
 ];
 replacements text[] := ARRAY[
  'INSERT INTO public.outbound_requests(company_id,customer_id,site_id,metering_point_id,communication_route_id',
  'VALUES(p_company_id,e.customer_id,owned_site,e.metering_point_id,i.communication_route_id'
 ];
 position integer;
BEGIN
 SELECT pg_get_functiondef(target),p.prosrc,to_jsonb(p)-'prosrc'
  INTO definition_before,body_before,metadata_before FROM pg_proc p WHERE p.oid=target;
 SELECT to_jsonb(p) INTO wrapper_before FROM pg_proc p
  WHERE p.oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure;
 -- Require the preceding qualified-site forward, including the replay-first
 -- order. No caller site selector or new authority is introduced here.
 IF (length(body_before)-length(replace(body_before,'owned_site uuid;','')))/length('owned_site uuid;') IS DISTINCT FROM 1
  OR strpos(body_before,'SELECT site_id INTO owned_site FROM public.metering_points')<=strpos(body_before,'IF FOUND THEN RETURN')
  OR strpos(body_before,'SELECT site_id INTO owned_site FROM public.metering_points')>=strpos(body_before,anchors[1])
  OR strpos(body_before,'e.customer_id,owned_site,e.id,e.point_id')=0
  OR strpos(body_before,'INSERT INTO gridex_requested_changes.origins')<=strpos(body_before,anchors[1]) THEN
  RAISE EXCEPTION 'requested_change_owned_request_site_predecessor_required';
 END IF;
 body_after:=body_before;
 FOR position IN 1..array_length(anchors,1) LOOP
  IF (length(body_before)-length(replace(body_before,anchors[position],'')))/length(anchors[position]) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'requested_change_owned_request_site_single_anchor_required';
  END IF;
  body_after:=replace(body_after,anchors[position],replacements[position]);
 END LOOP;
 EXECUTE replace(definition_before,body_before,body_after);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM wrapper_before THEN
  RAISE EXCEPTION 'requested_change_owned_request_site_metadata_preservation_required';
 END IF;
END $forward$;
