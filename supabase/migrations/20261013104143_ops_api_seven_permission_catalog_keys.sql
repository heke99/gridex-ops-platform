-- SOURCE-OWNED PORTABLE METADATA FORWARD; reviewed against OPS piidsfebjqjmnepdpnas.
-- Seven existing canonical permission catalog definitions, zero role/user/override
-- assignments. Does not run Ediel/business RPCs or alter published source history.
-- Existing catalog rows/UUIDs/all attributes/disabled flags and table ACL/OID are
-- preserved, including unrelated catalog keys. Unknown shape/source drift refuses;
-- replay does not reactivate existing disabled permissions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $qualified_permission_catalog$
DECLARE before_catalog jsonb;before_role_permissions jsonb;after_role_permissions jsonb;
 actual_table jsonb;before_table jsonb;after_table jsonb;actual_columns jsonb;actual_constraints jsonb;
 spec jsonb;existing_row jsonb;
 expected_table constant jsonb := '{"acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","oid":"17545","rls":true,"owner":"postgres","force_rls":false}'::jsonb;
 expected_columns constant jsonb := '[{"name":"id","type":"uuid","default":"gen_random_uuid()","notnull":true},{"name":"key","type":"text","default":null,"notnull":true},{"name":"name","type":"text","default":null,"notnull":true},{"name":"description","type":"text","default":null,"notnull":false},{"name":"created_at","type":"timestamp with time zone","default":"now()","notnull":true},{"name":"is_active","type":"boolean","default":"true","notnull":false},{"name":"category","type":"text","default":null,"notnull":false}]'::jsonb;
 expected_constraints constant jsonb := '[{"name":"permissions_key_key","type":"u","validated":true,"definition":"UNIQUE (key)"},{"name":"permissions_pkey","type":"p","validated":true,"definition":"PRIMARY KEY (id)"}]'::jsonb;
 source_rows constant jsonb := '[{"key":"communication.write","name":"Förbereda kommunikation","description":"Kan skapa och förbereda källbundna meddelanden; medger inte extern leverans.","category":"Kommunikation","is_active":true},{"key":"ediel.source.review","name":"Review own Ediel source artifacts","category":"ediel","description":"Separate, company-scoped review of actual archived source artifacts; does not establish issuer authority.","is_active":true},{"key":"ediel.ai_purpose.review","name":"Granska AI/BI-ändamålsunderlag","category":"ediel","is_active":true},{"key":"ediel.bilateral_profile.review","name":"Review bilateral PRODAT ground","category":"ediel","description":"Separate own-company review of issuer-authenticated bilateral PRODAT original bytes.","is_active":true},{"key":"ediel.network_registry.review","name":"Granska autentiska nätregisterunderlag","category":"ediel","is_active":true},{"key":"ediel.regulated_supply.review","name":"Review regulated supply ground","category":"ediel","description":"Separate own-company review of issuer-authenticated regulated supply original bytes.","is_active":true},{"key":"ediel.supply_rescission.review","name":"Review archived legal supply rescission source","category":"ediel","description":"Independent review of authenticated national Z08H legal original","is_active":true}]'::jsonb;
BEGIN
 LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.role_permissions IN SHARE MODE;
 SELECT jsonb_build_object('oid',c.oid::text,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) INTO actual_table FROM pg_class c WHERE c.oid='public.permissions'::regclass;
 before_table:=actual_table;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO actual_columns
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.permissions'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 SELECT jsonb_agg(jsonb_build_object('name',conname,'type',contype,'validated',convalidated,
  'definition',pg_get_constraintdef(oid)) ORDER BY conname) INTO actual_constraints
 FROM pg_constraint WHERE conrelid='public.permissions'::regclass;
 IF (actual_table-'oid') IS DISTINCT FROM (expected_table-'oid')
  OR actual_columns IS DISTINCT FROM expected_columns OR actual_constraints IS DISTINCT FROM expected_constraints
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.permissions'::regclass AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'permission_catalog_native_shape_changed_requires_review';
 END IF;
 SELECT coalesce(jsonb_object_agg(p.id::text,to_jsonb(p)),'{}'::jsonb) INTO before_catalog FROM public.permissions p;
 SELECT coalesce(jsonb_object_agg(r.id::text,to_jsonb(r)),'{}'::jsonb) INTO before_role_permissions FROM public.role_permissions r;
 FOR spec IN SELECT s FROM jsonb_array_elements(source_rows) s LOOP
  SELECT to_jsonb(p) INTO existing_row FROM public.permissions p WHERE p.key=spec->>'key';
  IF existing_row IS NOT NULL AND NOT (existing_row @> (spec-'is_active')) THEN
   RAISE EXCEPTION 'permission_catalog_existing_source_attributes_require_review: %',spec->>'key';
  END IF;
 END LOOP;
-- supabase/migrations/20261001103735_ediel_canonical_preparation_permission_catalog.sql
-- Exact INSERT SHA256 1ae3137ed5700b7b0e1a644c341f2c5756ac6011697b8428c1e7b3a1e3955284
INSERT INTO public.permissions(key,name,description,category,is_active)
VALUES ('communication.write','Förbereda kommunikation','Kan skapa och förbereda källbundna meddelanden; medger inte extern leverans.','Kommunikation',true)
ON CONFLICT(key) DO NOTHING;
-- supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql
-- Exact INSERT SHA256 b0c099ccae0d410e03226ec1752e6e30571b5de7b63c65874d99c27f4652f198
INSERT INTO public.permissions(key,name,category,description,is_active)
 SELECT 'ediel.source.review','Review own Ediel source artifacts','ediel','Separate, company-scoped review of actual archived source artifacts; does not establish issuer authority.',true
 WHERE NOT EXISTS(SELECT FROM public.permissions WHERE key='ediel.source.review');
-- supabase/migrations/20261001020550_ediel_ai_purpose_source_owner.sql
-- Exact INSERT SHA256 9260b4ceff88292d7303cdb4086cd5df3190f4068a41d132add3f96d581de315
INSERT INTO public.permissions(key,name,category,is_active) VALUES('ediel.ai_purpose.review','Granska AI/BI-ändamålsunderlag','ediel',true) ON CONFLICT(key) DO NOTHING;
-- supabase/migrations/20261001013034_ediel_bilateral_prodat_archived_profile_review.sql
-- Exact INSERT SHA256 38c47e8dfdb8c4a2d45a1b9c733c7dca290d4b0aa88da9554b6ebacaa2b8f532
INSERT INTO public.permissions(key,name,category,description,is_active)
 VALUES('ediel.bilateral_profile.review','Review bilateral PRODAT ground','ediel','Separate own-company review of issuer-authenticated bilateral PRODAT original bytes.',true) ON CONFLICT(key) DO NOTHING;
-- supabase/migrations/20261001023514_ediel_network_registry_original_source_owner.sql
-- Exact INSERT SHA256 27e46f01bea195ef75d5f45d3452eda49f5ae1eeedd1223868100e010a87256a
INSERT INTO public.permissions(key,name,category,is_active) VALUES('ediel.network_registry.review','Granska autentiska nätregisterunderlag','ediel',true) ON CONFLICT(key) DO NOTHING;
-- supabase/migrations/20261001004331_ediel_regulated_supply_ground_archive_review.sql
-- Exact INSERT SHA256 e8540f40a4f5f5f779bf23833ed01b3fd4d9784decf760c763b2e6a45a5e3f24
INSERT INTO public.permissions(key,name,category,description,is_active)
 VALUES('ediel.regulated_supply.review','Review regulated supply ground','ediel','Separate own-company review of issuer-authenticated regulated supply original bytes.',true) ON CONFLICT(key) DO NOTHING;
-- supabase/migrations/20261001093425_ediel_national_supply_rescission_archived_mandate.sql
-- Exact INSERT SHA256 bb87e1538d5ea920ce72a8d44924a0eef0dd98d7b3497075a7e33d2f3d76c777
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES('ediel.supply_rescission.review','Review archived legal supply rescission source','ediel','Independent review of authenticated national Z08H legal original',true) ON CONFLICT(key) DO NOTHING;
 IF EXISTS(SELECT 1 FROM jsonb_each(before_catalog) original LEFT JOIN public.permissions p ON p.id::text=original.key
  WHERE to_jsonb(p) IS DISTINCT FROM original.value) THEN
  RAISE EXCEPTION 'permission_catalog_existing_rows_must_remain_exact';
 END IF;
 FOR spec IN SELECT s FROM jsonb_array_elements(source_rows) s LOOP
  SELECT to_jsonb(p) INTO existing_row FROM public.permissions p WHERE p.key=spec->>'key';
  IF existing_row IS NULL OR NOT (existing_row @> (spec-'is_active')) THEN
   RAISE EXCEPTION 'permission_catalog_source_registration_required: %',spec->>'key';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_each(before_catalog) original WHERE original.value->>'key'=spec->>'key')
   AND existing_row->'is_active' IS DISTINCT FROM spec->'is_active' THEN
   RAISE EXCEPTION 'permission_catalog_new_source_active_flag_required: %',spec->>'key';
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_object_agg(r.id::text,to_jsonb(r)),'{}'::jsonb) INTO after_role_permissions FROM public.role_permissions r;
 SELECT jsonb_build_object('oid',c.oid::text,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) INTO after_table FROM pg_class c WHERE c.oid='public.permissions'::regclass;
 IF after_role_permissions IS DISTINCT FROM before_role_permissions OR after_table IS DISTINCT FROM before_table THEN
  RAISE EXCEPTION 'permission_catalog_no_assignment_or_privilege_changes_allowed';
 END IF;
END
$qualified_permission_catalog$;
NOTIFY pgrst,'reload schema';
COMMIT;
