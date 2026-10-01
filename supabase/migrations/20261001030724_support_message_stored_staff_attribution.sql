-- Add saved staff attribution only to the current customer-visible read.
-- No writer, historical relabelling, caller identity inference or ACL change.
DO $migration$
DECLARE
  target regprocedure := pg_catalog.to_regprocedure('public.gridex_support_case_read_v1(jsonb,jsonb)');
  definition text;
  before_owner oid; before_acl aclitem[]; before_config text[];
  after_owner oid; after_acl aclitem[]; after_config text[];
  old_projection constant text := 'select m.id,m.body,m.author_kind,m.channel,m.revision,m.created_at from public.customer_support_messages m';
  new_projection constant text := 'select m.id,m.body,m.author_kind,case when m.author_kind=''staff'' then m.actor_user_id else null::uuid end as actor_user_id,m.channel,m.revision,m.created_at from public.customer_support_messages m';
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'support_staff_attribution_read_owner_missing' USING ERRCODE='42883';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig
    INTO definition,before_owner,before_acl,before_config FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF (length(definition)-length(replace(definition,old_projection,'')))/length(old_projection) <> 1 THEN
    RAISE EXCEPTION 'support_staff_attribution_read_projection_changed' USING ERRCODE='23514';
  END IF;
  -- pg_get_functiondef retains the existing signature, language, invoker,
  -- configuration and every current actor/visibility/publication/clock gate.
  EXECUTE replace(definition,old_projection,new_projection);
  SELECT p.proowner,p.proacl,p.proconfig INTO after_owner,after_acl,after_config
    FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF pg_catalog.to_regprocedure('public.gridex_support_case_read_v1(jsonb,jsonb)') IS DISTINCT FROM target
    OR after_owner IS DISTINCT FROM before_owner OR after_acl IS DISTINCT FROM before_acl
    OR after_config IS DISTINCT FROM before_config THEN
    RAISE EXCEPTION 'support_staff_attribution_read_identity_changed' USING ERRCODE='23514';
  END IF;
END
$migration$;
