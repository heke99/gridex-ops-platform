-- Immediate forward boundary for the complete 20260528 diagnostics source.
-- Offline replay only: G-only state is never an application admission boundary.
-- Temporary reference objects parse the reviewed definitions with PostgreSQL;
-- they neither replace the source nor survive this transaction.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, extensions;

DO $preflight$
DECLARE
  t oid := to_regclass('public.auth_provisioning_events');
  v oid := to_regclass('public.gridex_user_auth_integrity_v');
  owner_id oid := (select oid from pg_roles where rolname = current_user);
BEGIN
  IF t IS NULL OR v IS NULL OR
     NOT EXISTS (SELECT FROM pg_class WHERE oid=t AND relkind='r') OR
     NOT EXISTS (SELECT FROM pg_class WHERE oid=v AND relkind='v') THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: source relations';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
        ('anon','authenticated','authenticator','service_role')) <> 4 OR
     NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) OR
     EXISTS (SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator')
             AND (rolsuper OR rolbypassrls)) OR
     EXISTS (SELECT FROM pg_class WHERE oid IN (t,v) AND relowner<>owner_id) OR
     EXISTS (SELECT FROM pg_roles WHERE oid=owner_id AND rolname IN
        ('anon','authenticated','authenticator','service_role')) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH: roles or ownership';
  END IF;
END
$preflight$;

-- Hold both target definitions stable through validation and security mutation.
-- PostgreSQL also locks view dependencies; timeout is deliberately finite.
LOCK TABLE public.auth_provisioning_events IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.gridex_user_auth_integrity_v IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE canonical_auth_provisioning_expected (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'info',
  email text,
  user_id uuid,
  company_id uuid,
  actor_user_id uuid,
  supabase_project_ref text,
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;
CREATE INDEX canonical_auth_provisioning_expected_company_idx
  ON canonical_auth_provisioning_expected(company_id,created_at DESC);
CREATE INDEX canonical_auth_provisioning_expected_email_idx
  ON canonical_auth_provisioning_expected(lower(email),created_at DESC)
  WHERE email IS NOT NULL;
CREATE TEMP VIEW canonical_auth_provisioning_expected_v AS
SELECT
  coalesce(cm.company_id, ur.company_id) AS company_id,
  coalesce(cm.user_id, ur.user_id, up.id) AS user_id,
  lower(coalesce(au.email, up.email, cm.invited_email)) AS email,
  CASE WHEN au.id IS NULL THEN false ELSE true END AS has_auth_user,
  CASE WHEN up.id IS NULL THEN false ELSE true END AS has_user_profile,
  CASE WHEN cm.id IS NULL THEN false ELSE true END AS has_company_membership,
  CASE WHEN ur.id IS NULL THEN false ELSE true END AS has_user_role,
  cm.status AS membership_status,
  ur.status AS user_role_status,
  ur.is_active AS user_role_is_active,
  coalesce(cm.updated_at, ur.updated_at, up.updated_at, au.updated_at, au.created_at) AS latest_seen_at
FROM public.company_memberships cm
FULL JOIN public.user_roles ur
  ON ur.company_id = cm.company_id AND ur.user_id = cm.user_id
FULL JOIN public.user_profiles up ON up.id = coalesce(cm.user_id, ur.user_id)
LEFT JOIN auth.users au ON au.id = coalesce(cm.user_id, ur.user_id, up.id)
WHERE coalesce(cm.user_id, ur.user_id, up.id) IS NOT NULL;

DO $catalog$
DECLARE
  t oid := 'public.auth_provisioning_events'::regclass;
  v oid := 'public.gridex_user_auth_integrity_v'::regclass;
  e oid := 'pg_temp.canonical_auth_provisioning_expected'::regclass;
  ev oid := 'pg_temp.canonical_auth_provisioning_expected_v'::regclass;
  pair record;
  actual oid;
  expected oid;
BEGIN
  -- Ownership may have changed while waiting for the locks above.
  IF EXISTS (SELECT FROM pg_class WHERE oid IN (t,v) AND
       relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH: locked ownership';
  END IF;
  FOR pair IN SELECT * FROM (VALUES (t,e),(v,ev)) AS pairs(actual,expected) LOOP
    IF EXISTS (
      WITH cols AS (
        SELECT attrelid,attnum,attname,atttypid,atttypmod,attnotnull,attcollation,
               attidentity,attgenerated,attisdropped,pg_get_expr(d.adbin,d.adrelid) AS def
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attnum>0 AND a.attrelid IN (pair.actual,pair.expected)
      )
      SELECT FROM (
        (SELECT attnum,attname,atttypid,atttypmod,attnotnull,attcollation,attidentity,attgenerated,attisdropped,def
         FROM cols WHERE attrelid=pair.actual EXCEPT ALL
         SELECT attnum,attname,atttypid,atttypmod,attnotnull,attcollation,attidentity,attgenerated,attisdropped,def
         FROM cols WHERE attrelid=pair.expected)
        UNION ALL
        (SELECT attnum,attname,atttypid,atttypmod,attnotnull,attcollation,attidentity,attgenerated,attisdropped,def
         FROM cols WHERE attrelid=pair.expected EXCEPT ALL
         SELECT attnum,attname,atttypid,atttypmod,attnotnull,attcollation,attidentity,attgenerated,attisdropped,def
         FROM cols WHERE attrelid=pair.actual)
      ) delta
    ) THEN
      RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: columns';
    END IF;
  END LOOP;
  IF EXISTS (SELECT FROM pg_constraint WHERE conrelid=t AND
       (contype<>'p' OR conkey<>ARRAY[1]::smallint[] OR NOT convalidated OR condeferrable)) OR
     (SELECT count(*) FROM pg_constraint WHERE conrelid=t AND contype='p')<>1 OR
     EXISTS (SELECT FROM pg_constraint WHERE conrelid=v) OR
     EXISTS (SELECT FROM pg_inherits WHERE inhrelid=t OR inhparent=t) OR
     EXISTS (SELECT FROM pg_trigger WHERE tgrelid IN (t,v) AND NOT tgisinternal) OR
     EXISTS (SELECT FROM pg_rewrite WHERE ev_class IN (t,v) AND
       NOT (ev_class=v AND rulename='_RETURN' AND ev_type='1' AND is_instead)) OR
     EXISTS (SELECT FROM pg_class WHERE oid=t AND
       (relispartition OR relpersistence<>'p' OR reloptions IS NOT NULL OR relforcerowsecurity)) OR
     EXISTS (SELECT FROM pg_class WHERE oid=v AND
       (relpersistence<>'p' OR EXISTS (SELECT FROM unnest(reloptions) opt
         WHERE opt NOT IN ('security_invoker=true','security_invoker=false')))) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: constraints triggers or options';
  END IF;
  IF (SELECT count(*) FROM pg_index WHERE indrelid=t)<>3 THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: index set';
  END IF;
  FOR pair IN SELECT * FROM (VALUES
    ('auth_provisioning_events_pkey','canonical_auth_provisioning_expected_pkey'),
    ('auth_provisioning_events_company_created_idx','canonical_auth_provisioning_expected_company_idx'),
    ('auth_provisioning_events_email_created_idx','canonical_auth_provisioning_expected_email_idx')
  ) AS pairs(actual,expected) LOOP
    actual := to_regclass(format('public.%I',pair.actual));
    expected := to_regclass(format('pg_temp.%I',pair.expected));
    IF actual IS NULL OR NOT EXISTS (
      SELECT FROM pg_index a JOIN pg_class ac ON ac.oid=a.indexrelid
      JOIN pg_index b ON b.indexrelid=expected JOIN pg_class bc ON bc.oid=b.indexrelid
      WHERE a.indexrelid=actual AND a.indrelid=t AND ac.relowner=(SELECT relowner FROM pg_class WHERE oid=t)
        AND ac.relam=bc.relam AND ac.reloptions IS NULL AND ac.relkind='i'
        AND a.indisvalid AND a.indisready AND a.indislive
        AND ROW(a.indisunique,a.indisprimary,a.indisexclusion,a.indimmediate,a.indnullsnotdistinct,
                a.indnatts,a.indnkeyatts,a.indkey,a.indclass,a.indcollation,a.indoption)
          = ROW(b.indisunique,b.indisprimary,b.indisexclusion,b.indimmediate,b.indnullsnotdistinct,
                b.indnatts,b.indnkeyatts,b.indkey,b.indclass,b.indcollation,b.indoption)
        AND pg_get_expr(a.indexprs,a.indrelid) IS NOT DISTINCT FROM pg_get_expr(b.indexprs,b.indrelid)
        AND pg_get_expr(a.indpred,a.indrelid) IS NOT DISTINCT FROM pg_get_expr(b.indpred,b.indrelid)
        AND ARRAY(SELECT pg_get_indexdef(a.indexrelid,k,true) FROM generate_series(1,a.indnatts) k)
          = ARRAY(SELECT pg_get_indexdef(b.indexrelid,k,true) FROM generate_series(1,b.indnatts) k)
    ) THEN
      RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: index %',pair.actual;
    END IF;
  END LOOP;
  IF pg_get_viewdef(v,false) IS DISTINCT FROM pg_get_viewdef(ev,false) OR
     obj_description(v,'pg_class') IS DISTINCT FROM
       'Shows app users/tenant access rows that do or do not have a real Supabase Auth user. Missing auth users cannot log in.' OR
     EXISTS (
       WITH deps AS (
         SELECT r.ev_class,d.refclassid,d.refobjid,d.refobjsubid,d.deptype
         FROM pg_rewrite r JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid
         WHERE r.ev_class IN (v,ev) AND d.refobjid<>r.ev_class
       ) SELECT FROM (
         (SELECT refclassid,refobjid,refobjsubid,deptype FROM deps WHERE ev_class=v EXCEPT
          SELECT refclassid,refobjid,refobjsubid,deptype FROM deps WHERE ev_class=ev)
         UNION ALL
         (SELECT refclassid,refobjid,refobjsubid,deptype FROM deps WHERE ev_class=ev EXCEPT
          SELECT refclassid,refobjid,refobjsubid,deptype FROM deps WHERE ev_class=v)
       ) delta
     ) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: view projection dependencies or comment';
  END IF;
  -- Only reviewed owner/service and the explicitly revoked public/client ACLs
  -- are admissible. Inherited effective access is independently checked below.
  IF EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid IN (t,v) AND a.grantee<>c.relowner AND a.grantee<>0 AND
      a.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN
        ('anon','authenticated','authenticator','service_role'))
  ) OR EXISTS (
    SELECT FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
    CROSS JOIN LATERAL aclexplode(col.attacl) a
    WHERE c.oid IN (t,v) AND a.grantee<>c.relowner AND a.grantee<>0 AND
      a.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN
        ('anon','authenticated','authenticator','service_role'))
  ) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_TARGET_SHAPE_MISMATCH: unclassified grants';
  END IF;
  IF EXISTS (
    SELECT FROM pg_policy WHERE polrelid=t AND polname='canonical_auth_provisioning_service_boundary'
      AND (polcmd<>'*' OR polpermissive OR
           ARRAY(SELECT unnest(polroles) ORDER BY 1) <>
           ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY oid) OR
           pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'false' OR
           pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM 'false')
  ) THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_POLICY_DEFINITION_MISMATCH';
  END IF;
END
$catalog$;
DROP VIEW pg_temp.canonical_auth_provisioning_expected_v;

ALTER TABLE public.auth_provisioning_events ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.gridex_user_auth_integrity_v SET (security_invoker = true);
REVOKE ALL ON TABLE public.auth_provisioning_events FROM public, anon, authenticated, authenticator;
REVOKE ALL ON TABLE public.gridex_user_auth_integrity_v FROM public, anon, authenticated, authenticator;
GRANT SELECT ON TABLE public.auth_provisioning_events TO service_role;

DO $security$
DECLARE
  c record;
  privilege text;
  role_name text;
  relation oid;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='public.auth_provisioning_events'::regclass
                 AND polname='canonical_auth_provisioning_service_boundary') THEN
    CREATE POLICY canonical_auth_provisioning_service_boundary
      ON public.auth_provisioning_events AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
  FOR c IN SELECT n.nspname,t.relname,a.attname FROM pg_attribute a
    JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE a.attrelid IN ('public.auth_provisioning_events'::regclass,'public.gridex_user_auth_integrity_v'::regclass)
      AND a.attnum>0 AND NOT a.attisdropped
  LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      EXECUTE format('REVOKE %s (%I) ON TABLE %I.%I FROM public, anon, authenticated, authenticator',
                     privilege,c.attname,c.nspname,c.relname);
    END LOOP;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator'] LOOP
    FOREACH relation IN ARRAY ARRAY['public.auth_provisioning_events'::regclass::oid,
                                    'public.gridex_user_auth_integrity_v'::regclass::oid] LOOP
      IF has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
         has_any_column_privilege(role_name,relation,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH: residual effective access';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role','public.auth_provisioning_events','SELECT') THEN
    RAISE EXCEPTION 'AUTH_PROVISIONING_ROLE_BOUNDARY_MISMATCH: service count';
  END IF;
END
$security$;
COMMIT;
