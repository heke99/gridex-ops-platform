-- Portable OPS forward: current Staff deny precedence and empty provenance registry.
-- No business RPCs, historic replay or project-specific input receipt population.

-- Prospective forward migration; NOT APPLIED by the Staff reviewer.
-- Native predecessors were observed read-only on OPS piidsfebjqjmnepdpnas
-- at 2026-10-13 00:09:57 UTC, with body hashes rechecked afterwards.
-- Keep company membership/binding authority and company-only allow grants.
-- Global rows may deny; they never confer Staff authority. The existing
-- overrides RPC result shape remains unchanged for Staff HTTP admission.

DO $predecessors$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid='public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean)'::regprocedure)
     IS DISTINCT FROM '6fada9ac078080a31d85422deb038281'
     OR (SELECT md5(prosrc) FROM pg_proc
         WHERE oid='public.gridex_staff_permission_overrides_v1(uuid,uuid)'::regprocedure)
        IS DISTINCT FROM '62ab8745b55d0b2b22086b30a04510b2' THEN
    RAISE EXCEPTION 'staff_permission_predecessor_changed';
  END IF;
END;
$predecessors$;

CREATE OR REPLACE FUNCTION public.gridex_staff_actor_permissions_v1(
  p_company_id uuid, p_actor_user_id uuid, p_allow_platform boolean DEFAULT false
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_role_key text;
  v_permissions text[];
BEGIN
  IF p_allow_platform AND public.canonical_actor_is_platform_admin(p_actor_user_id) THEN
    v_permissions := public.gridex_staff_role_profile_v1('super_admin');
  ELSE
    SELECT public.gridex_staff_normalize_role_v1(cm.role_key) INTO v_role_key
    FROM public.company_memberships cm
    JOIN public.user_profiles profile ON profile.id=cm.user_id AND profile.user_status='active'
    JOIN auth.users auth_user ON auth_user.id=cm.user_id
    WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
      AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
      AND auth_user.deleted_at IS NULL
      AND (auth_user.banned_until IS NULL OR auth_user.banned_until<=now());
    IF v_role_key IS NULL OR v_role_key IN ('super_admin','platform_admin','white_label_platform_admin','customer') THEN
      RETURN ARRAY[]::text[];
    END IF;
    v_permissions := public.gridex_staff_role_profile_v1(v_role_key);
    IF cardinality(v_permissions)=0 THEN RETURN ARRAY[]::text[]; END IF;
  END IF;

  SELECT coalesce(array_agg(DISTINCT granted.permission ORDER BY granted.permission),ARRAY[]::text[])
  INTO v_permissions
  FROM (
    SELECT unnest(v_permissions) AS permission
    UNION
    SELECT coalesce(nullif(up.permission_key,''),catalog.key,catalog.name)
    FROM public.user_permissions up
    LEFT JOIN public.permissions catalog ON catalog.id=up.permission_id AND catalog.is_active
    WHERE up.company_id=p_company_id AND up.user_id=p_actor_user_id
      AND up.status='active' AND up.is_active AND up.effect='allow'
  ) granted
  WHERE EXISTS (
    SELECT FROM public.permissions active_catalog
    WHERE active_catalog.key=granted.permission AND active_catalog.is_active
  )
    AND NOT EXISTS (
      SELECT FROM public.user_permissions denied
      LEFT JOIN public.permissions catalog ON catalog.id=denied.permission_id
      WHERE denied.user_id=p_actor_user_id
        AND (denied.company_id IS NULL OR denied.company_id=p_company_id)
        AND denied.status='active' AND denied.is_active AND denied.effect='deny'
        AND coalesce(nullif(denied.permission_key,''),catalog.key,catalog.name)=granted.permission
    )
    AND NOT EXISTS (
      SELECT FROM public.user_permission_overrides denied
      WHERE denied.user_id=p_actor_user_id
        AND (denied.company_id IS NULL OR denied.company_id=p_company_id)
        AND denied.is_active AND denied.effect='deny'
        AND denied.permission_key=granted.permission
        AND (denied.valid_from IS NULL OR denied.valid_from<=clock_timestamp())
        AND (denied.valid_to IS NULL OR clock_timestamp()<denied.valid_to)
    );
  RETURN v_permissions;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gridex_staff_permission_overrides_v1(
  p_company_id uuid,p_user_id uuid
)
RETURNS TABLE(permission_key text,effect text,status text,is_active boolean)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path TO ''
AS $function$
  -- Existing direct grants remain company-only. Inactive catalog entries
  -- cannot extend the HTTP role profile through an explicit allow.
  SELECT coalesce(nullif(up.permission_key,''),catalog.key,catalog.name),up.effect,up.status,up.is_active
  FROM public.user_permissions up
  LEFT JOIN public.permissions catalog ON catalog.id=up.permission_id
  WHERE up.company_id=p_company_id AND up.user_id=p_user_id
    AND up.status='active' AND up.is_active
    AND coalesce(nullif(up.permission_key,''),catalog.key,catalog.name) IS NOT NULL
    AND (up.effect='deny' OR EXISTS (
      SELECT FROM public.permissions active_catalog
      WHERE active_catalog.key=coalesce(nullif(up.permission_key,''),catalog.key,catalog.name)
        AND active_catalog.is_active
    ))
  UNION
  SELECT coalesce(nullif(up.permission_key,''),catalog.key,catalog.name),'deny'::text,'active'::text,true
  FROM public.user_permissions up
  LEFT JOIN public.permissions catalog ON catalog.id=up.permission_id
  WHERE up.company_id IS NULL AND up.user_id=p_user_id
    AND up.status='active' AND up.is_active AND up.effect='deny'
    AND coalesce(nullif(up.permission_key,''),catalog.key,catalog.name) IS NOT NULL
  UNION
  SELECT denied.permission_key,'deny'::text,'active'::text,true
  FROM public.user_permission_overrides denied
  WHERE denied.user_id=p_user_id
    AND (denied.company_id IS NULL OR denied.company_id=p_company_id)
    AND denied.is_active AND denied.effect='deny'
    AND (denied.valid_from IS NULL OR denied.valid_from<=clock_timestamp())
    AND (denied.valid_to IS NULL OR clock_timestamp()<denied.valid_to)
  UNION
  -- Staff HTTP reconstructs the same static role profile in TypeScript.
  -- Return removals for inactive/missing permissions so admission and locked
  -- native writes agree without changing the existing RPC or public API shape.
  SELECT role_permission.permission,'deny'::text,'active'::text,true
  FROM public.company_memberships membership
  CROSS JOIN LATERAL unnest(public.gridex_staff_role_profile_v1(
    public.gridex_staff_normalize_role_v1(membership.role_key)
  )) AS role_permission(permission)
  WHERE membership.company_id=p_company_id AND membership.user_id=p_user_id
    AND membership.status='active' AND membership.is_active
    AND membership.accepted_at IS NOT NULL
    AND NOT EXISTS (
      SELECT FROM public.permissions active_catalog
      WHERE active_catalog.key=role_permission.permission AND active_catalog.is_active
    )
$function$;

REVOKE ALL ON FUNCTION public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.gridex_staff_permission_overrides_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_permission_overrides_v1(uuid,uuid)
  TO service_role;


-- Portable OPS provenance schema. Created cleanly with zero native receipts.
-- Actual project-specific source/ledger/effect evidence is registered only by
-- the separately reviewed explicit ops-provenance-population.sql action.
-- No generated IDs, historical inputs or effect claims are manufactured on replay.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public;
DO $ops_provenance_schema_preflight$
BEGIN
 IF to_regclass('public.ops_migration_provenance_receipts') IS NOT NULL THEN
  RAISE EXCEPTION 'ops_provenance_registry_already_exists_requires_new_review';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_class c
  WHERE c.oid='public.gridex_migration_governance_v3'::regclass
   AND pg_get_userbyid(c.relowner)='postgres'
   AND encode(extensions.digest(convert_to(pg_get_viewdef(c.oid,true),'UTF8'),'sha256'),'hex')='1e7b126901e36d658f2db97ca8c67d4852f2d8a9e00348c613fb13d92a0464b6'
   AND has_table_privilege('service_role',c.oid,'SELECT')
   AND NOT has_table_privilege('anon',c.oid,'SELECT')
   AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
 ) THEN RAISE EXCEPTION 'ops_provenance_governance_projection_or_acl_drift'; END IF;
END
$ops_provenance_schema_preflight$;

CREATE TABLE public.ops_migration_provenance_receipts(
 receipt_id text PRIMARY KEY,
 project_ref text NOT NULL CHECK(project_ref='piidsfebjqjmnepdpnas'),
 applied_ledger_version text NOT NULL,
 applied_ledger_name text NOT NULL,
 canonical_filename text NOT NULL,
 source_file_sha256 text NOT NULL CHECK(source_file_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_input_md5 text NOT NULL CHECK(recorded_input_md5 ~ '^[a-f0-9]{32}$'),
 recorded_input_sha256 text NOT NULL CHECK(recorded_input_sha256 ~ '^[a-f0-9]{64}$'),
 receipt_kind text NOT NULL CHECK(receipt_kind IN ('exact_input','historical_source_lineage')),
 source_file_git_commit text CHECK(source_file_git_commit IS NULL OR source_file_git_commit ~ '^[a-f0-9]{40}$'),
 source_observation_head text NOT NULL CHECK(source_observation_head ~ '^[a-f0-9]{40}$'),
 current_source_sha256 text CHECK(current_source_sha256 IS NULL OR current_source_sha256 ~ '^[a-f0-9]{64}$'),
 current_source_git_commit text CHECK(current_source_git_commit IS NULL OR current_source_git_commit ~ '^[a-f0-9]{40}$'),
 observed_at timestamptz NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 effect_scope text NOT NULL CHECK(effect_scope IN ('input_only','historical_lineage_only','current_native_schema')),
 effect_verified boolean NOT NULL DEFAULT false,
 effect_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(effect_evidence)='object'),
 FOREIGN KEY(applied_ledger_version) REFERENCES supabase_migrations.schema_migrations(version) ON DELETE RESTRICT,
 CHECK((receipt_kind='exact_input' AND source_file_sha256=recorded_input_sha256 AND current_source_sha256 IS NULL)
    OR (receipt_kind='historical_source_lineage' AND source_file_git_commit IS NOT NULL
      AND current_source_sha256 IS NOT NULL AND current_source_git_commit IS NOT NULL
      AND effect_scope='historical_lineage_only')),
 CHECK(effect_verified=(effect_scope='current_native_schema')),
 CHECK(effect_scope<>'current_native_schema'
    OR (receipt_kind='exact_input' AND jsonb_typeof(effect_evidence->'native_snapshot')='object')),
 UNIQUE(applied_ledger_version,applied_ledger_name,canonical_filename,receipt_kind,source_file_sha256,observed_at)
);
COMMENT ON TABLE public.ops_migration_provenance_receipts IS
 'Append-only reviewed input/lineage receipts. Source SHA256 and recorded SQL SHA256 are separate facts. Effect scope never implies a full tenant/API lifecycle.';
CREATE INDEX ops_migration_provenance_ledger_idx
 ON public.ops_migration_provenance_receipts(applied_ledger_version,applied_ledger_name);
ALTER TABLE public.ops_migration_provenance_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_migration_provenance_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_migration_provenance_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ops_migration_provenance_receipts TO service_role;
CREATE POLICY ops_migration_provenance_service_read
 ON public.ops_migration_provenance_receipts FOR SELECT TO service_role USING(true);

CREATE FUNCTION public.ops_reject_migration_provenance_mutation_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $ops_immutable$
BEGIN
 RAISE EXCEPTION 'ops_migration_provenance_receipt_is_append_only' USING ERRCODE='55000';
END
$ops_immutable$;
REVOKE ALL ON FUNCTION public.ops_reject_migration_provenance_mutation_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ops_migration_provenance_no_update_delete
 BEFORE UPDATE OR DELETE ON public.ops_migration_provenance_receipts
 FOR EACH ROW EXECUTE FUNCTION public.ops_reject_migration_provenance_mutation_v1();
CREATE TRIGGER ops_migration_provenance_no_truncate
 BEFORE TRUNCATE ON public.ops_migration_provenance_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.ops_reject_migration_provenance_mutation_v1();

-- The existing view contains only the guarded aggregate counts/status projection.
-- Owner execution fixes service_role permission errors without granting access
-- to the raw supabase_migrations schema/table. Count/blocker SQL and rows remain unchanged.
ALTER VIEW public.gridex_migration_governance_v3 SET(security_invoker=false);
COMMENT ON VIEW public.gridex_migration_governance_v3 IS
 'Service-only aggregate migration governance under owner execution. No raw ledger grant. Existing strict readiness conditions and historical manifest rows remain unchanged; input/lineage receipts are separate.';

-- The companion view makes current versus historical evidence explicit.
-- It is also aggregate-only, owner-executed, and readable only by service_role.
CREATE VIEW public.ops_migration_provenance_summary_v1
 WITH(security_invoker=false,security_barrier=true) AS
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
REVOKE ALL ON public.ops_migration_provenance_summary_v1 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ops_migration_provenance_summary_v1 TO service_role;
COMMENT ON VIEW public.ops_migration_provenance_summary_v1 IS
 'Bounded source-input and lineage coverage. Receipts are populated separately only from reviewed actual inputs. Bounded evidence this is not full governance or live lifecycle readiness.';


NOTIFY pgrst, 'reload schema';
