-- Synthetic staff account eligibility, executed against actual full replay SQL.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(a,'Synthetic staff account A','active'),(b,'Synthetic staff account B','active');
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
  VALUES(actor,'authenticated','authenticated',actor::text || '@example.invalid','{}','{}',now(),now(),false);
  INSERT INTO public.user_profiles(id,email,user_status) VALUES(actor,actor::text || '@example.invalid','active')
    ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
  VALUES(a,actor,'customer_service_agent','support','active',true,now());
  IF (SELECT count(*) FROM public.gridex_staff_active_membership_v1(a,actor))<>1 THEN RAISE EXCEPTION 'eligible staff denied'; END IF;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(b,actor)) THEN RAISE EXCEPTION 'cross-company account accepted'; END IF;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,gen_random_uuid())) THEN RAISE EXCEPTION 'missing user accepted'; END IF;
  UPDATE public.company_memberships SET accepted_at=null WHERE company_id=a AND user_id=actor;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,actor)) THEN RAISE EXCEPTION 'unaccepted membership accepted'; END IF;
  UPDATE public.company_memberships SET accepted_at=now(),status='disabled',is_active=false WHERE company_id=a AND user_id=actor;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,actor)) THEN RAISE EXCEPTION 'disabled membership accepted'; END IF;
  UPDATE public.company_memberships SET status='active',is_active=true WHERE company_id=a AND user_id=actor;
  UPDATE public.user_profiles SET user_status='suspended' WHERE id=actor;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,actor)) THEN RAISE EXCEPTION 'suspended profile accepted'; END IF;
  UPDATE public.user_profiles SET user_status='active' WHERE id=actor;
  UPDATE auth.users SET deleted_at=now() WHERE id=actor;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,actor)) THEN RAISE EXCEPTION 'deleted Auth account accepted'; END IF;
  UPDATE auth.users SET deleted_at=null,banned_until=now()+interval '1 hour' WHERE id=actor;
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(a,actor)) THEN RAISE EXCEPTION 'banned Auth account accepted'; END IF;
  UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id=actor;
  IF (SELECT count(*) FROM public.gridex_staff_active_membership_v1(a,actor))<>1 THEN RAISE EXCEPTION 'expired ban remained blocked'; END IF;
  IF has_function_privilege('anon','public.gridex_staff_active_membership_v1(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.gridex_staff_active_membership_v1(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.gridex_staff_active_membership_v1(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'staff account RPC grants are incorrect';
  END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(gen_random_uuid(),gen_random_uuid())) THEN RAISE EXCEPTION 'service-only missing account accepted'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.gridex_staff_active_membership_v1(gen_random_uuid(),gen_random_uuid());
    RAISE EXCEPTION 'anon invoked staff account RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.gridex_staff_active_membership_v1(gen_random_uuid(),gen_random_uuid());
    RAISE EXCEPTION 'authenticated invoked staff account RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
