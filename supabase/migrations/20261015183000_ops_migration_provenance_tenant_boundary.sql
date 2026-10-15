-- Preserve service-only aggregate migration evidence while public views run
-- with invoker privileges. Raw migration SQL stays private; historical migration
-- bytes, readiness criteria, receipt rows and append-only protections are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;

-- Compile the published aggregate queries independently for exact preimage
-- comparison. These temporary views contain no captured catalog/expected output.
CREATE TEMP VIEW ops_boundary_before_gridex_migration_governance_v3 AS
with manifest as (
  select count(*)::bigint manifest_file_count,
         count(distinct version)::bigint manifest_version_count,
         count(*) filter(where verified_at is not null)::bigint verified_file_count,
         count(*) filter(where effect_verified)::bigint effect_verified_file_count,
         count(*) filter(where checksum is null or checksum !~ '^[a-f0-9]{64}$')::bigint invalid_checksum_count,
         count(*) filter(where verification_kind='schema_effect')::bigint schema_effect_file_count,
         max(verified_at) last_verified_at
  from public.canonical_migration_manifest
), ledger as (
  select count(*)::bigint ledger_version_count,max(version) latest_ledger_version
  from supabase_migrations.schema_migrations
), missing as (
  select count(*)::bigint count from public.canonical_migration_manifest m
  where m.verification_kind in ('ledger','ledger_alias') and not exists (
    select 1 from supabase_migrations.schema_migrations l
    where l.version::text=m.applied_ledger_version and l.name=m.applied_ledger_name
  )
), unmapped as (
  select count(*)::bigint count from supabase_migrations.schema_migrations l
  where not exists (
    select 1 from public.canonical_migration_manifest m
    where m.applied_ledger_version=l.version::text and m.applied_ledger_name=l.name
  )
), duplicate_mappings as (
  select count(*)::bigint count from (
    select applied_ledger_version from public.canonical_migration_manifest
    where applied_ledger_version is not null
    group by applied_ledger_version having count(*)>1
  ) d
)
select manifest.manifest_file_count,manifest.manifest_version_count,
       manifest.verified_file_count,manifest.effect_verified_file_count,
       manifest.invalid_checksum_count,manifest.schema_effect_file_count,
       manifest.last_verified_at,ledger.ledger_version_count,ledger.latest_ledger_version,
       missing.count missing_in_ledger,unmapped.count unmapped_ledger_versions,
       duplicate_mappings.count duplicate_ledger_mappings,
       (manifest.manifest_file_count>0
        and manifest.verified_file_count=manifest.manifest_file_count
        and manifest.effect_verified_file_count=manifest.manifest_file_count
        and manifest.invalid_checksum_count=0
        and missing.count=0 and unmapped.count=0 and duplicate_mappings.count=0) is_ready,
       array_remove(array[
         case when manifest.manifest_file_count=0 then 'CANONICAL_MIGRATION_MANIFEST_EMPTY' end,
         case when manifest.verified_file_count<>manifest.manifest_file_count then 'MIGRATIONS_NOT_FULLY_VERIFIED' end,
         case when manifest.effect_verified_file_count<>manifest.manifest_file_count then 'MIGRATION_EFFECTS_NOT_FULLY_VERIFIED' end,
         case when manifest.invalid_checksum_count>0 then 'MIGRATION_CHECKSUM_INVALID' end,
         case when missing.count>0 then 'MIGRATION_LEDGER_MISSING_MAPPING' end,
         case when unmapped.count>0 then 'MIGRATION_LEDGER_UNMAPPED_VERSION' end,
         case when duplicate_mappings.count>0 then 'MIGRATION_LEDGER_DUPLICATE_MAPPING' end
       ],null)::text[] blockers
from manifest cross join ledger cross join missing cross join unmapped cross join duplicate_mappings;

CREATE TEMP VIEW ops_boundary_before_ops_migration_provenance_summary_v1 AS
WITH receipts AS(
 SELECT r.*,
  coalesce(l.name=r.applied_ledger_name
   AND md5(array_to_string(l.statements,E'\n'))=r.recorded_input_md5
   AND encode(extensions.digest(convert_to(array_to_string(l.statements,E'\n'),'UTF8'),'sha256'),'hex')=r.recorded_input_sha256,false) AS recorded_input_still_matches,
  r.effect_verified
  AND jsonb_array_length(coalesce(r.effect_evidence#>'{native_snapshot,functions}','[]'::jsonb))=3
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,functions}','[]'::jsonb)) f
   LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f->>'signature')
   WHERE jsonb_build_object('owner',pg_get_userbyid(p.proowner),
    'arguments',pg_get_function_identity_arguments(p.oid),
    'definition_sha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    'volatility',p.provolatile::text,'security_definer',p.prosecdef,'parallel',p.proparallel::text,
    'config',to_jsonb(p.proconfig),'acl',to_jsonb(p.proacl))
    IS DISTINCT FROM (f-'name'-'signature'-'oid')
  )
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,override_fields}','[]'::jsonb)) f
   LEFT JOIN pg_attribute a ON a.attrelid='public.user_permission_overrides'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname=f->>'name'
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) IS DISTINCT FROM f
  )
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,override_constraints}','[]'::jsonb)) f
   LEFT JOIN pg_constraint c ON c.conrelid='public.user_permission_overrides'::regclass AND c.conname=f->>'name'
   WHERE jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) IS DISTINCT FROM f
  ) AS current_bounded_schema_still_matches
 FROM public.ops_migration_provenance_receipts r
 LEFT JOIN supabase_migrations.schema_migrations l ON l.version=r.applied_ledger_version
), counts AS(
 SELECT count(*) AS receipt_count,
  count(*) FILTER(WHERE receipt_kind='exact_input' AND recorded_input_still_matches) AS exact_input_receipt_count,
  count(*) FILTER(WHERE receipt_kind='historical_source_lineage' AND recorded_input_still_matches) AS lineage_receipt_count,
  count(*) FILTER(WHERE NOT effect_verified) AS effect_not_assessed_receipt_count,
  count(*) FILTER(WHERE recorded_input_still_matches AND current_bounded_schema_still_matches) AS current_bounded_schema_receipt_count,
  count(*) FILTER(WHERE effect_verified AND NOT current_bounded_schema_still_matches) AS changed_bounded_schema_receipt_count
 FROM receipts
), uncovered AS(
 SELECT count(*) AS ledger_versions_without_exact_input_receipt
 FROM supabase_migrations.schema_migrations l
 WHERE NOT EXISTS(SELECT FROM receipts r WHERE r.applied_ledger_version=l.version
  AND r.applied_ledger_name=l.name AND r.receipt_kind='exact_input' AND r.recorded_input_still_matches)
)
SELECT c.*,u.ledger_versions_without_exact_input_receipt,
 g.ledger_version_count,g.latest_ledger_version,g.unmapped_ledger_versions AS canonical_unmapped_ledger_versions,
 g.is_ready AS canonical_governance_is_ready,g.blockers AS canonical_governance_blockers,
 false AS full_history_and_effect_qualification_claimed
FROM counts c CROSS JOIN uncovered u CROSS JOIN public.gridex_migration_governance_v3 g;

DO $ops_boundary_preflight$
DECLARE v text;
BEGIN
 IF current_user<>'postgres' THEN
  RAISE EXCEPTION 'ops_provenance_boundary_owner_required';
 END IF;
 FOREACH v IN ARRAY ARRAY['gridex_migration_governance_v3','ops_migration_provenance_summary_v1'] LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=v AND c.relkind='v'
    AND pg_get_userbyid(c.relowner)='postgres'
    AND c.relacl=acldefault('r',c.relowner)||CASE WHEN v='gridex_migration_governance_v3'
      THEN ARRAY[replace((acldefault('r',c.relowner))[1]::text,'postgres=','service_role=')::aclitem]
      ELSE ARRAY['service_role=r/postgres'::aclitem] END
    AND c.reloptions=CASE WHEN v='gridex_migration_governance_v3'
      THEN ARRAY['security_invoker=false']::text[]
      ELSE ARRAY['security_invoker=false','security_barrier=true']::text[] END
    AND pg_get_viewdef(c.oid,true)=pg_get_viewdef(to_regclass('pg_temp.ops_boundary_before_'||v),true)
  ) THEN RAISE EXCEPTION 'ops_provenance_boundary_view_profile_unknown:%',v; END IF;
 END LOOP;
 IF to_regprocedure('public.ops_migration_governance_projection_v1()') IS NOT NULL
  OR to_regprocedure('public.ops_migration_provenance_projection_v1()') IS NOT NULL THEN
  RAISE EXCEPTION 'ops_provenance_boundary_function_already_exists';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='public.ops_migration_provenance_receipts'::regclass
   AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres'
   AND c.relrowsecurity AND c.relforcerowsecurity
   AND c.relacl=acldefault('r',c.relowner)||ARRAY['service_role=r/postgres'::aclitem])
  OR EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.ops_migration_provenance_receipts'::regclass
   AND attname='company_id' AND attnum>0 AND NOT attisdropped)
  OR EXISTS(SELECT FROM public.platform_table_classification
   WHERE table_name='ops_migration_provenance_receipts' AND kind<>'system') THEN
  RAISE EXCEPTION 'ops_provenance_boundary_receipts_or_classification_unknown';
 END IF;
END
$ops_boundary_preflight$;

INSERT INTO public.platform_table_classification(table_name,kind,rationale,classified_by)
VALUES('ops_migration_provenance_receipts','system',
 'Platform migration input and lineage evidence keyed by project and applied ledger version, not tenant data. Append-only, RLS protected, and readable only by the service role.',
 'migration:ops_migration_provenance_tenant_boundary')
ON CONFLICT(table_name) DO NOTHING;

-- The query below is byte-for-byte the published aggregate projection.
CREATE FUNCTION public.ops_migration_governance_projection_v1()
RETURNS TABLE(manifest_file_count bigint,manifest_version_count bigint,
 verified_file_count bigint,effect_verified_file_count bigint,
 invalid_checksum_count bigint,schema_effect_file_count bigint,
 last_verified_at timestamptz,ledger_version_count bigint,latest_ledger_version text,
 missing_in_ledger bigint,unmapped_ledger_versions bigint,duplicate_ledger_mappings bigint,
 is_ready boolean,blockers text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
AS $ops_projection$
with manifest as (
  select count(*)::bigint manifest_file_count,
         count(distinct version)::bigint manifest_version_count,
         count(*) filter(where verified_at is not null)::bigint verified_file_count,
         count(*) filter(where effect_verified)::bigint effect_verified_file_count,
         count(*) filter(where checksum is null or checksum !~ '^[a-f0-9]{64}$')::bigint invalid_checksum_count,
         count(*) filter(where verification_kind='schema_effect')::bigint schema_effect_file_count,
         max(verified_at) last_verified_at
  from public.canonical_migration_manifest
), ledger as (
  select count(*)::bigint ledger_version_count,max(version) latest_ledger_version
  from supabase_migrations.schema_migrations
), missing as (
  select count(*)::bigint count from public.canonical_migration_manifest m
  where m.verification_kind in ('ledger','ledger_alias') and not exists (
    select 1 from supabase_migrations.schema_migrations l
    where l.version::text=m.applied_ledger_version and l.name=m.applied_ledger_name
  )
), unmapped as (
  select count(*)::bigint count from supabase_migrations.schema_migrations l
  where not exists (
    select 1 from public.canonical_migration_manifest m
    where m.applied_ledger_version=l.version::text and m.applied_ledger_name=l.name
  )
), duplicate_mappings as (
  select count(*)::bigint count from (
    select applied_ledger_version from public.canonical_migration_manifest
    where applied_ledger_version is not null
    group by applied_ledger_version having count(*)>1
  ) d
)
select manifest.manifest_file_count,manifest.manifest_version_count,
       manifest.verified_file_count,manifest.effect_verified_file_count,
       manifest.invalid_checksum_count,manifest.schema_effect_file_count,
       manifest.last_verified_at,ledger.ledger_version_count,ledger.latest_ledger_version,
       missing.count missing_in_ledger,unmapped.count unmapped_ledger_versions,
       duplicate_mappings.count duplicate_ledger_mappings,
       (manifest.manifest_file_count>0
        and manifest.verified_file_count=manifest.manifest_file_count
        and manifest.effect_verified_file_count=manifest.manifest_file_count
        and manifest.invalid_checksum_count=0
        and missing.count=0 and unmapped.count=0 and duplicate_mappings.count=0) is_ready,
       array_remove(array[
         case when manifest.manifest_file_count=0 then 'CANONICAL_MIGRATION_MANIFEST_EMPTY' end,
         case when manifest.verified_file_count<>manifest.manifest_file_count then 'MIGRATIONS_NOT_FULLY_VERIFIED' end,
         case when manifest.effect_verified_file_count<>manifest.manifest_file_count then 'MIGRATION_EFFECTS_NOT_FULLY_VERIFIED' end,
         case when manifest.invalid_checksum_count>0 then 'MIGRATION_CHECKSUM_INVALID' end,
         case when missing.count>0 then 'MIGRATION_LEDGER_MISSING_MAPPING' end,
         case when unmapped.count>0 then 'MIGRATION_LEDGER_UNMAPPED_VERSION' end,
         case when duplicate_mappings.count>0 then 'MIGRATION_LEDGER_DUPLICATE_MAPPING' end
       ],null)::text[] blockers
from manifest cross join ledger cross join missing cross join unmapped cross join duplicate_mappings
$ops_projection$;
REVOKE ALL ON FUNCTION public.ops_migration_governance_projection_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ops_migration_governance_projection_v1() TO service_role;
COMMENT ON FUNCTION public.ops_migration_governance_projection_v1() IS
 'Service-only aggregate migration evidence. No raw ledger grant, row output, dynamic SQL or qualification beyond the existing projection.';

CREATE OR REPLACE VIEW public.gridex_migration_governance_v3 WITH(security_invoker=true) AS
 SELECT * FROM public.ops_migration_governance_projection_v1();
COMMENT ON VIEW public.gridex_migration_governance_v3 IS
 'Invoker view over a service-only fixed aggregate projection. Raw migration inputs remain private; existing readiness and evidence limits are preserved.';

-- The query below is byte-for-byte the published aggregate projection.
CREATE FUNCTION public.ops_migration_provenance_projection_v1()
RETURNS TABLE(receipt_count bigint,exact_input_receipt_count bigint,lineage_receipt_count bigint,
 effect_not_assessed_receipt_count bigint,current_bounded_schema_receipt_count bigint,
 changed_bounded_schema_receipt_count bigint,ledger_versions_without_exact_input_receipt bigint,
 ledger_version_count bigint,latest_ledger_version text,canonical_unmapped_ledger_versions bigint,
 canonical_governance_is_ready boolean,canonical_governance_blockers text[],
 full_history_and_effect_qualification_claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
AS $ops_projection$
WITH receipts AS(
 SELECT r.*,
  coalesce(l.name=r.applied_ledger_name
   AND md5(array_to_string(l.statements,E'\n'))=r.recorded_input_md5
   AND encode(extensions.digest(convert_to(array_to_string(l.statements,E'\n'),'UTF8'),'sha256'),'hex')=r.recorded_input_sha256,false) AS recorded_input_still_matches,
  r.effect_verified
  AND jsonb_array_length(coalesce(r.effect_evidence#>'{native_snapshot,functions}','[]'::jsonb))=3
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,functions}','[]'::jsonb)) f
   LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f->>'signature')
   WHERE jsonb_build_object('owner',pg_get_userbyid(p.proowner),
    'arguments',pg_get_function_identity_arguments(p.oid),
    'definition_sha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    'volatility',p.provolatile::text,'security_definer',p.prosecdef,'parallel',p.proparallel::text,
    'config',to_jsonb(p.proconfig),'acl',to_jsonb(p.proacl))
    IS DISTINCT FROM (f-'name'-'signature'-'oid')
  )
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,override_fields}','[]'::jsonb)) f
   LEFT JOIN pg_attribute a ON a.attrelid='public.user_permission_overrides'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname=f->>'name'
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) IS DISTINCT FROM f
  )
  AND NOT EXISTS(
   SELECT FROM jsonb_array_elements(coalesce(r.effect_evidence#>'{native_snapshot,override_constraints}','[]'::jsonb)) f
   LEFT JOIN pg_constraint c ON c.conrelid='public.user_permission_overrides'::regclass AND c.conname=f->>'name'
   WHERE jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) IS DISTINCT FROM f
  ) AS current_bounded_schema_still_matches
 FROM public.ops_migration_provenance_receipts r
 LEFT JOIN supabase_migrations.schema_migrations l ON l.version=r.applied_ledger_version
), counts AS(
 SELECT count(*) AS receipt_count,
  count(*) FILTER(WHERE receipt_kind='exact_input' AND recorded_input_still_matches) AS exact_input_receipt_count,
  count(*) FILTER(WHERE receipt_kind='historical_source_lineage' AND recorded_input_still_matches) AS lineage_receipt_count,
  count(*) FILTER(WHERE NOT effect_verified) AS effect_not_assessed_receipt_count,
  count(*) FILTER(WHERE recorded_input_still_matches AND current_bounded_schema_still_matches) AS current_bounded_schema_receipt_count,
  count(*) FILTER(WHERE effect_verified AND NOT current_bounded_schema_still_matches) AS changed_bounded_schema_receipt_count
 FROM receipts
), uncovered AS(
 SELECT count(*) AS ledger_versions_without_exact_input_receipt
 FROM supabase_migrations.schema_migrations l
 WHERE NOT EXISTS(SELECT FROM receipts r WHERE r.applied_ledger_version=l.version
  AND r.applied_ledger_name=l.name AND r.receipt_kind='exact_input' AND r.recorded_input_still_matches)
)
SELECT c.*,u.ledger_versions_without_exact_input_receipt,
 g.ledger_version_count,g.latest_ledger_version,g.unmapped_ledger_versions AS canonical_unmapped_ledger_versions,
 g.is_ready AS canonical_governance_is_ready,g.blockers AS canonical_governance_blockers,
 false AS full_history_and_effect_qualification_claimed
FROM counts c CROSS JOIN uncovered u CROSS JOIN public.gridex_migration_governance_v3 g
$ops_projection$;
REVOKE ALL ON FUNCTION public.ops_migration_provenance_projection_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ops_migration_provenance_projection_v1() TO service_role;
COMMENT ON FUNCTION public.ops_migration_provenance_projection_v1() IS
 'Service-only aggregate migration evidence. No raw ledger grant, row output, dynamic SQL or qualification beyond the existing projection.';

CREATE OR REPLACE VIEW public.ops_migration_provenance_summary_v1 WITH(security_invoker=true,security_barrier=true) AS
 SELECT * FROM public.ops_migration_provenance_projection_v1();
COMMENT ON VIEW public.ops_migration_provenance_summary_v1 IS
 'Invoker view over a service-only fixed aggregate projection. Raw migration inputs remain private; existing readiness and evidence limits are preserved.';

DROP VIEW pg_temp.ops_boundary_before_ops_migration_provenance_summary_v1;
DROP VIEW pg_temp.ops_boundary_before_gridex_migration_governance_v3;
COMMIT;
