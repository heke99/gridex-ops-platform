-- Complete the established Staff permission registry before current active-catalog admission.
-- Data-only forward: preserve every existing key, UUID, attribute and disabled flag.
-- No role, user, company membership or override assignment is added or changed.
-- Twenty-eight missing canonical rows reuse immutable legacy INSERT/VALUES metadata.
-- Eight keys have existing permission literals but no historical registry INSERT; their
-- display name is the exact key and description/category are NULL (new metadata).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $staff_catalog$
DECLARE before_catalog jsonb;before_table jsonb;after_table jsonb;new_rows jsonb;
 expected constant jsonb := '[{"key":"admin.access","name":"admin.access","description":null,"category":null,"is_active":true},{"key":"audit.read","name":"Läsa revisionslogg","description":"Kan se audit och historik.","category":null,"is_active":true},{"key":"billing_underlay.export","name":"billing_underlay.export","description":null,"category":null,"is_active":true},{"key":"billing_underlay.read","name":"Läsa faktureringsunderlag","description":"Kan se faktureringsunderlag och exportstatus.","category":null,"is_active":true},{"key":"cases.read","name":"Läsa kundärenden","description":"Kan se kundärenden och blockerare.","category":null,"is_active":true},{"key":"contracts.read","name":"Läsa avtal","description":"Kan se avtal, kampanjer och prisplaner.","category":null,"is_active":true},{"key":"contracts.write","name":"Ändra avtal","description":"Kan skapa och ändra avtal, kampanjer och prisplaner.","category":null,"is_active":true},{"key":"customers.write","name":"Ändra kunder","description":"Kan skapa, importera och ändra kunddata.","category":null,"is_active":true},{"key":"documents.write","name":"documents.write","description":null,"category":null,"is_active":true},{"key":"masterdata.read","name":"Läsa masterdata","description":"Kan se anläggningar, mätpunkter, nätägare och elområden.","category":null,"is_active":true},{"key":"masterdata.write","name":"Ändra masterdata","description":"Kan skapa och ändra anläggningar, mätpunkter och masterdata.","category":null,"is_active":true},{"key":"metering.read","name":"Läsa mätdata","description":"Kan se mätvärden och mätpunktsdata.","category":null,"is_active":true},{"key":"metering.write","name":"Ändra mätdata","description":"Kan skapa och ändra mätvärdesflöden.","category":null,"is_active":true},{"key":"metering_points.read","name":"Läsa mätpunkter","description":"Kan se mätpunkter.","category":null,"is_active":true},{"key":"metering_points.write","name":"Ändra mätpunkter","description":"Kan skapa eller ändra mätpunkter.","category":null,"is_active":true},{"key":"partner_exports.read","name":"partner_exports.read","description":null,"category":null,"is_active":true},{"key":"partner_exports.write","name":"partner_exports.write","description":null,"category":null,"is_active":true},{"key":"permissions.manage","name":"Hantera behörigheter","description":"Kan hantera behörighetsöverskridningar.","category":null,"is_active":true},{"key":"poa.read","name":"Läsa fullmakter","description":"Kan se fullmakter och behörighetsunderlag.","category":null,"is_active":true},{"key":"poa.write","name":"Ändra fullmakter","description":"Kan skapa och ändra fullmakter.","category":null,"is_active":true},{"key":"pricing.publish","name":"pricing.publish","description":null,"category":null,"is_active":true},{"key":"pricing.read","name":"pricing.read","description":null,"category":null,"is_active":true},{"key":"pricing.write","name":"pricing.write","description":null,"category":null,"is_active":true},{"key":"reports.read","name":"Läsa rapporter","description":"Kan se drift- och kvalitetsrapporter.","category":null,"is_active":true},{"key":"roles.manage","name":"Hantera roller","description":"Kan hantera användarroller.","category":null,"is_active":true},{"key":"sites.read","name":"Läsa anläggningar","description":"Kan se anläggningar.","category":null,"is_active":true},{"key":"sites.write","name":"Ändra anläggningar","description":"Kan skapa eller ändra anläggningar.","category":null,"is_active":true},{"key":"switching.read","name":"Läsa switchärenden","description":"Kan se leverantörsbyten.","category":null,"is_active":true},{"key":"switching.write","name":"Ändra switchärenden","description":"Kan skapa och ändra leverantörsbyten.","category":null,"is_active":true},{"key":"tenants.invite","name":"Bjuda in till företag","description":"Kan bjuda in användare till ett bolag och sätta bolagsroll.","category":null,"is_active":true},{"key":"tenants.read","name":"Läsa företag","description":"Kan se bolagskonton och bolagskopplingar.","category":null,"is_active":true},{"key":"tenants.write","name":"Skapa eller ändra företag","description":"Kan skapa och uppdatera bolagskonton i plattformen.","category":null,"is_active":true},{"key":"users.read","name":"Läsa användare","description":"Kan se användarlistan och användarkort.","category":null,"is_active":true},{"key":"users.write","name":"Ändra användare","description":"Kan bjuda in eller ändra användare.","category":null,"is_active":true},{"key":"whitelabel.read","name":"Läsa white-label-scope","description":"Kan se bolag, användare, aktörstest och produktionsstatus inom egen white-label-plattform.","category":null,"is_active":true},{"key":"whitelabel.write","name":"Ändra white-label-scope","description":"Kan hantera egna white-label-bolag, aktörstester och produktionsförberedelser.","category":null,"is_active":true}]'::jsonb;
BEGIN
 LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.permissions'::regclass AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'staff_permission_catalog_trigger_requires_review';END IF;
 SELECT coalesce(jsonb_object_agg(p.id::text,to_jsonb(p)),'{}'::jsonb) INTO before_catalog FROM public.permissions p;
 SELECT to_jsonb(c) INTO before_table FROM pg_class c WHERE c.oid='public.permissions'::regclass;
 -- supabase/migrations/20260924003724_company_direct_permission_scope_repair.sql:73 SHA256 12f64cbba929a88e2d0b057c2e75c8a945faf4830d13b87844de2a1cf21c8a2e
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('admin.access','admin.access',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:121 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('audit.read','Läsa revisionslogg','Kan se audit och historik.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('billing_underlay.export','billing_underlay.export',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:119 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('billing_underlay.read','Läsa faktureringsunderlag','Kan se faktureringsunderlag och exportstatus.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:113 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('cases.read','Läsa kundärenden','Kan se kundärenden och blockerare.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:109 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('contracts.read','Läsa avtal','Kan se avtal, kampanjer och prisplaner.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:110 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('contracts.write','Ändra avtal','Kan skapa och ändra avtal, kampanjer och prisplaner.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:106 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('customers.write','Ändra kunder','Kan skapa, importera och ändra kunddata.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('documents.write','documents.write',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:107 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('masterdata.read','Läsa masterdata','Kan se anläggningar, mätpunkter, nätägare och elområden.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:108 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('masterdata.write','Ändra masterdata','Kan skapa och ändra anläggningar, mätpunkter och masterdata.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:117 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('metering.read','Läsa mätdata','Kan se mätvärden och mätpunktsdata.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:118 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('metering.write','Ändra mätdata','Kan skapa och ändra mätvärdesflöden.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:113 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('metering_points.read','Läsa mätpunkter','Kan se mätpunkter.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:114 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('metering_points.write','Ändra mätpunkter','Kan skapa eller ändra mätpunkter.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('partner_exports.read','partner_exports.read',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('partner_exports.write','partner_exports.write',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:120 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('permissions.manage','Hantera behörigheter','Kan hantera behörighetsöverskridningar.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:111 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('poa.read','Läsa fullmakter','Kan se fullmakter och behörighetsunderlag.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:112 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('poa.write','Ändra fullmakter','Kan skapa och ändra fullmakter.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('pricing.publish','pricing.publish',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('pricing.read','pricing.read',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20261004083640_staff_user_commands.sql:10 SHA256 0cf1911c72cdb954f27eef54e7604c2008868ec293e33425a57e0e7f0e25147b
 -- new registry display metadata for established permission literal; no historical INSERT claim.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('pricing.write','pricing.write',NULL,NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:120 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('reports.read','Läsa rapporter','Kan se drift- och kvalitetsrapporter.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:119 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('roles.manage','Hantera roller','Kan hantera användarroller.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:111 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('sites.read','Läsa anläggningar','Kan se anläggningar.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:112 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('sites.write','Ändra anläggningar','Kan skapa eller ändra anläggningar.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:115 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('switching.read','Läsa switchärenden','Kan se leverantörsbyten.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260522_customer_flow_access_repair.sql:116 SHA256 7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('switching.write','Ändra switchärenden','Kan skapa och ändra leverantörsbyten.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:102 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('tenants.invite','Bjuda in till företag','Kan bjuda in användare till ett bolag och sätta bolagsroll.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:100 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('tenants.read','Läsa företag','Kan se bolagskonton och bolagskopplingar.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:101 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('tenants.write','Skapa eller ändra företag','Kan skapa och uppdatera bolagskonton i plattformen.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:117 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('users.read','Läsa användare','Kan se användarlistan och användarkort.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260519_bootstrap_div3rsa_superadmin.sql:118 SHA256 bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('users.write','Ändra användare','Kan bjuda in eller ändra användare.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260521_actor_testing_go_live_module.sql:227 SHA256 94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('whitelabel.read','Läsa white-label-scope','Kan se bolag, användare, aktörstest och produktionsstatus inom egen white-label-plattform.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 -- supabase/migrations/20260521_actor_testing_go_live_module.sql:228 SHA256 94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08
 -- historical source registry metadata.
 INSERT INTO public.permissions(key,name,description,category,is_active)
 VALUES ('whitelabel.write','Ändra white-label-scope','Kan hantera egna white-label-bolag, aktörstester och produktionsförberedelser.',NULL,true)
 ON CONFLICT(key) DO NOTHING;
 IF EXISTS(SELECT FROM jsonb_each(before_catalog) original LEFT JOIN public.permissions p ON p.id::text=original.key
   WHERE to_jsonb(p) IS DISTINCT FROM original.value) THEN
  RAISE EXCEPTION 'staff_permission_catalog_existing_rows_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)-'id'-'created_at' ORDER BY p.key COLLATE "C"),'[]'::jsonb)
 INTO new_rows FROM public.permissions p WHERE NOT before_catalog ? p.id::text;
 IF new_rows IS DISTINCT FROM (SELECT coalesce(jsonb_agg(spec ORDER BY spec->>'key' COLLATE "C"),'[]'::jsonb)
   FROM jsonb_array_elements(expected) spec WHERE NOT EXISTS(
    SELECT FROM jsonb_each(before_catalog) previous WHERE previous.value->>'key'=spec->>'key')) THEN
  RAISE EXCEPTION 'staff_permission_catalog_only_declared_new_rows_allowed';END IF;
 SELECT to_jsonb(c) INTO after_table FROM pg_class c WHERE c.oid='public.permissions'::regclass;
 IF after_table IS DISTINCT FROM before_table THEN
  RAISE EXCEPTION 'staff_permission_catalog_relation_metadata_changed';END IF;
END
$staff_catalog$;
NOTIFY pgrst,'reload schema';
COMMIT;
