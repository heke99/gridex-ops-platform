-- TR-10/ST-T02: worker identity also needs a current internal lease.
-- The bound matches the public claim owner's default00:10:00. This is an
-- internal worker limit, not a normative counterparty timer/retry permission.
-- Acquire the existing identity row lock FIRST, then separately recheck its
-- database clock. A lock wait crossing expiry cannot authorize provider entry.
-- Historical observation/reconciliation is deliberately unchanged.
BEGIN;
DO $lease$
DECLARE patch record;f record;body text;actual jsonb;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)','and o.locked_by=owner->>''workerId'' for update;','and o.locked_by=owner->>''workerId'' for update;
   IF FOUND AND NOT EXISTS(SELECT FROM public.ediel_outbox lease WHERE lease.id=(owner->>''outboxId'')::uuid AND lease.company_id=c AND lease.ediel_message_id=mid AND lease.environment=env AND lease.locked_at IS NOT NULL AND lease.locked_at<=clock_timestamp() AND lease.locked_at>clock_timestamp()-interval ''10 minutes'') THEN RAISE EXCEPTION ''ediel_transport_worker_fence_lost'';END IF;'),
  ('gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)','and o.locked_by=a.owner->>''workerId'' for update;','and o.locked_by=a.owner->>''workerId'' for update;
   IF FOUND AND NOT EXISTS(SELECT FROM public.ediel_outbox lease WHERE lease.id=(a.owner->>''outboxId'')::uuid AND lease.company_id=c AND lease.ediel_message_id=mid AND lease.environment=env AND lease.locked_at IS NOT NULL AND lease.locked_at<=clock_timestamp() AND lease.locked_at>clock_timestamp()-interval ''10 minutes'') THEN RAISE EXCEPTION ''ediel_transport_worker_fence_lost'';END IF;'),
  ('gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)','AND o.locked_by=p_input#>>''{owner,workerId}'' FOR UPDATE;','AND o.locked_by=p_input#>>''{owner,workerId}'' FOR UPDATE;
   IF FOUND AND NOT EXISTS(SELECT FROM public.ediel_outbox lease WHERE lease.id=(p_input#>>''{owner,outboxId}'')::uuid AND lease.company_id=c AND lease.ediel_message_id=mid AND lease.environment=m.environment AND lease.locked_at IS NOT NULL AND lease.locked_at<=clock_timestamp() AND lease.locked_at>clock_timestamp()-interval ''10 minutes'') THEN RAISE EXCEPTION ''ediel_transport_worker_fence_lost'';END IF;'),
  ('gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb)','AND locked_by=owner->>''workerId'' FOR UPDATE;','AND locked_by=owner->>''workerId'' FOR UPDATE;
   IF FOUND AND NOT EXISTS(SELECT FROM public.ediel_outbox lease WHERE lease.id=(owner->>''outboxId'')::uuid AND lease.company_id=c AND lease.ediel_message_id=mid AND lease.environment=env AND lease.locked_at IS NOT NULL AND lease.locked_at<=clock_timestamp() AND lease.locked_at>clock_timestamp()-interval ''10 minutes'') THEN RAISE EXCEPTION ''outbound_dispatch_worker_fence_lost'' USING ERRCODE=''42501'';END IF;'),
  ('gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb)','AND locked_by=a.owner->>''workerId'' FOR UPDATE;','AND locked_by=a.owner->>''workerId'' FOR UPDATE;
   IF FOUND AND NOT EXISTS(SELECT FROM public.ediel_outbox lease WHERE lease.id=(a.owner->>''outboxId'')::uuid AND lease.company_id=c AND lease.ediel_message_id=mid AND lease.environment=env AND lease.locked_at IS NOT NULL AND lease.locked_at<=clock_timestamp() AND lease.locked_at>clock_timestamp()-interval ''10 minutes'') THEN RAISE EXCEPTION ''outbound_dispatch_worker_fence_lost'' USING ERRCODE=''42501'';END IF;')
 ) AS patches(signature,old_fragment,new_fragment)
 LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=patch.signature::regprocedure;
  IF f.prosecdef IS NOT TRUE OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR (length(f.prosrc)-length(replace(f.prosrc,patch.old_fragment,'')))<>length(patch.old_fragment)
   OR strpos(f.prosrc,patch.new_fragment)>0
  THEN RAISE EXCEPTION 'ediel_worker_lease_installed_owner_review_required: %',patch.signature;END IF;
  body:=replace(f.prosrc,patch.old_fragment,patch.new_fragment);
  EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
  IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc'
  THEN RAISE EXCEPTION 'ediel_worker_lease_existing_authority_changed: %',patch.signature;END IF;
 END LOOP;
END$lease$;
COMMIT;
