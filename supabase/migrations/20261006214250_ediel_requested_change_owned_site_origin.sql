-- Fresh generic requested-change intents must retain the actual owned point's
-- site before the immutable origin snapshot is created. Historical origins
-- return first and keep their original bindings; caller site IDs are ignored.
DO $forward$
DECLARE
 target regprocedure := 'public.ediel_originate_requested_change_before_scope_fence_v1(uuid,uuid,uuid,jsonb)'::regprocedure;
 definition_before text;
 body_before text;
 body_after text;
 metadata_before jsonb;
 wrapper_before jsonb;
 anchors text[] := ARRAY[
  'route public.ediel_route_profiles%rowtype;ref text;',
  ' SELECT * INTO route FROM public.ediel_route_profiles',
  'communication_route_id,customer_id,operation_id,metering_point_id',
  '(p_route->>''communicationRouteId'')::uuid,e.customer_id,e.id,e.point_id'
 ];
 replacements text[] := ARRAY[
  'route public.ediel_route_profiles%rowtype;ref text;owned_site uuid;',
  $site$
 SELECT site_id INTO owned_site FROM public.metering_points
  WHERE id=e.metering_point_id AND company_id=e.company_id AND customer_id=e.customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'requested_change_owned_point_site_required';END IF;
 IF owned_site IS NOT NULL THEN
  PERFORM id FROM public.customer_sites WHERE id=owned_site AND company_id=e.company_id AND customer_id=e.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'requested_change_owned_point_site_required';END IF;
 END IF;
 SELECT * INTO route FROM public.ediel_route_profiles$site$,
  'communication_route_id,customer_id,customer_site_id,operation_id,metering_point_id',
  '(p_route->>''communicationRouteId'')::uuid,e.customer_id,owned_site,e.id,e.point_id'
 ];
 position integer;
BEGIN
 SELECT pg_get_functiondef(target),p.prosrc,to_jsonb(p)-'prosrc'
  INTO definition_before,body_before,metadata_before FROM pg_proc p WHERE p.oid=target;
 SELECT to_jsonb(p) INTO wrapper_before FROM pg_proc p
  WHERE p.oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure;
 body_after:=body_before;
 FOR position IN 1..array_length(anchors,1) LOOP
  IF (length(body_before)-length(replace(body_before,anchors[position],'')))/length(anchors[position]) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'requested_change_owned_site_single_predecessor_anchor_required';
  END IF;
  body_after:=replace(body_after,anchors[position],replacements[position]);
 END LOOP;
 EXECUTE replace(definition_before,body_before,body_after);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM wrapper_before THEN
  RAISE EXCEPTION 'requested_change_owned_site_metadata_preservation_required';
 END IF;
END $forward$;
