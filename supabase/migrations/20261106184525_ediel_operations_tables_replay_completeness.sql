-- Local047 forward repair for the enum-only canonical replay omission.
-- Base tables/indexes: immutable 20260602143000; additions/FKs/RLS: 20260602152000.
-- One atomic statement: refuse unknown partial shapes before changing any relation.
-- No historical migration, business row, readiness/approval or lock lease is rewritten.
DO $repair$
DECLARE
  expected record;
  actual record;
  rel text;
  obj record;
  known_seed boolean;
BEGIN
  IF to_regtype('public.ediel_environment_type') IS NULL
     OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'ediel_operations_reconstruction_prerequisite_missing';
  END IF;
  -- Canonical downstream dependencies must already exist on f23 and clean replay.
  -- Do not synthesize or replace a shared retention function to accept unknown state.
  IF to_regclass('public.platform_table_classification') IS NULL OR NOT EXISTS (
    SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public.gridex_guard_history_truncate_v1()')
      AND p.prorettype='trigger'::regtype AND p.prokind='f' AND l.lanname='plpgsql'
      AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict AND NOT p.proleakproof
      AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
          '332134e44d786ed24ae616494aabd79ec8f4e4f34dababb07d060f5a67bbc3bb'
      AND NOT EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
                      WHERE acl.grantee<>p.proowner)
  ) THEN RAISE EXCEPTION 'ediel_operations_downstream_prerequisite_missing_or_unknown'; END IF;
  FOREACH rel IN ARRAY ARRAY['ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages'] LOOP
    -- Only the literal September seed is an additional supported predecessor.
    SELECT EXISTS (SELECT FROM public.platform_table_classification
      WHERE table_name=rel AND kind='tenant' AND null_company_meaning IS NULL
        AND rationale='Seeded from observed schema shape during the 2026-09-02 tenant isolation remediation.'
        AND classified_by='migration:platform_table_classification') INTO known_seed;
    -- Fixed table names and booleans only; capture the pre-REVOKE profile safely.
    RAISE NOTICE 'ediel_operations_classification_preprofile: table=% knownCanonicalSeed=% anonCRUDpresent=% authenticatedCRUDpresent=%',
      rel,known_seed,
      coalesce(has_table_privilege('anon',to_regclass('public.'||rel),'SELECT, INSERT, UPDATE, DELETE'),false),
      coalesce(has_table_privilege('authenticated',to_regclass('public.'||rel),'SELECT, INSERT, UPDATE, DELETE'),false);
    IF EXISTS (SELECT FROM public.platform_table_classification WHERE table_name=rel
      AND (null_company_meaning IS NOT NULL OR (kind IS DISTINCT FROM 'system' AND NOT known_seed))
    ) THEN RAISE EXCEPTION 'ediel_operations_unknown_classification'; END IF;
  END LOOP;

  FOR expected IN SELECT * FROM (VALUES
      ('ediel_test_run_locks', 'id', 'uuid', false, 'gen_random_uuid()', true),
      ('ediel_test_run_locks', 'company_id', 'uuid', false, NULL, true),
      ('ediel_test_run_locks', 'actor_role', 'text', false, NULL, true),
      ('ediel_test_run_locks', 'message_family', 'text', false, NULL, true),
      ('ediel_test_run_locks', 'environment_type', 'public.ediel_environment_type', false, NULL, true),
      ('ediel_test_run_locks', 'active_test_run_id', 'uuid', true, NULL, true),
      ('ediel_test_run_locks', 'locked_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_test_run_locks', 'expires_at', 'timestamp with time zone', false, NULL, true),
      ('ediel_test_run_locks', 'released_at', 'timestamp with time zone', true, NULL, true),
      ('ediel_test_run_locks', 'metadata', 'jsonb', false, '''{}''::jsonb', true),
      ('ediel_test_run_locks', 'created_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_test_run_locks', 'updated_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_agt_readiness', 'id', 'uuid', false, 'gen_random_uuid()', true),
      ('ediel_agt_readiness', 'company_id', 'uuid', false, NULL, true),
      ('ediel_agt_readiness', 'actor_role', 'text', false, NULL, true),
      ('ediel_agt_readiness', 'message_family', 'text', false, NULL, true),
      ('ediel_agt_readiness', 'test_resource_name', 'text', true, NULL, true),
      ('ediel_agt_readiness', 'test_resource_email', 'text', true, NULL, true),
      ('ediel_agt_readiness', 'test_resource_confirmed', 'boolean', false, 'false', true),
      ('ediel_agt_readiness', 'ediel_portal_login_confirmed', 'boolean', false, 'false', true),
      ('ediel_agt_readiness', 'application_system_selected', 'boolean', false, 'false', true),
      ('ediel_agt_readiness', 'edi_system_selected', 'boolean', false, 'false', true),
      ('ediel_agt_readiness', 'current_approval_version', 'text', true, NULL, true),
      ('ediel_agt_readiness', 'readiness_status', 'text', false, '''not_ready''::text', true),
      ('ediel_agt_readiness', 'needs_retest', 'boolean', false, 'false', true),
      ('ediel_agt_readiness', 'retest_reason', 'text', true, NULL, true),
      ('ediel_agt_readiness', 'created_by', 'uuid', true, NULL, true),
      ('ediel_agt_readiness', 'updated_by', 'uuid', true, NULL, true),
      ('ediel_agt_readiness', 'created_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_agt_readiness', 'updated_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_unlinked_test_messages', 'id', 'uuid', false, 'gen_random_uuid()', true),
      ('ediel_unlinked_test_messages', 'company_id', 'uuid', true, NULL, true),
      ('ediel_unlinked_test_messages', 'environment_type', 'public.ediel_environment_type', false, '''agt_test''::ediel_environment_type', true),
      ('ediel_unlinked_test_messages', 'message_family', 'text', true, NULL, true),
      ('ediel_unlinked_test_messages', 'business_code', 'text', true, NULL, true),
      ('ediel_unlinked_test_messages', 'sender_ediel_id', 'text', true, NULL, true),
      ('ediel_unlinked_test_messages', 'receiver_ediel_id', 'text', true, NULL, true),
      ('ediel_unlinked_test_messages', 'raw_payload_ref', 'text', true, NULL, true),
      ('ediel_unlinked_test_messages', 'parsed_payload', 'jsonb', false, '''{}''::jsonb', true),
      ('ediel_unlinked_test_messages', 'candidate_test_run_ids', 'uuid[]', false, 'ARRAY[]::uuid[]', true),
      ('ediel_unlinked_test_messages', 'status', 'text', false, '''unlinked''::text', true),
      ('ediel_unlinked_test_messages', 'linked_test_run_id', 'uuid', true, NULL, true),
      ('ediel_unlinked_test_messages', 'linked_by', 'uuid', true, NULL, true),
      ('ediel_unlinked_test_messages', 'linked_at', 'timestamp with time zone', true, NULL, true),
      ('ediel_unlinked_test_messages', 'created_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_unlinked_test_messages', 'updated_at', 'timestamp with time zone', false, 'now()', true),
      ('ediel_agt_readiness', 'invalidated_at', 'timestamp with time zone', true, NULL, false),
      ('ediel_agt_readiness', 'invalidated_by', 'uuid', true, NULL, false),
      ('ediel_agt_readiness', 'invalidation_source', 'text', true, NULL, false),
      ('ediel_agt_readiness', 'last_checked_at', 'timestamp with time zone', true, NULL, false),
      ('ediel_agt_readiness', 'last_checked_by', 'uuid', true, NULL, false),
      ('ediel_agt_readiness', 'blocking_issues', 'jsonb', false, '''[]''::jsonb', false),
      ('ediel_agt_readiness', 'readiness_snapshot', 'jsonb', false, '''{}''::jsonb', false),
      ('ediel_unlinked_test_messages', 'ediel_message_id', 'uuid', true, NULL, false),
      ('ediel_unlinked_test_messages', 'inbound_mail_item_id', 'uuid', true, NULL, false),
      ('ediel_unlinked_test_messages', 'resolution_notes', 'text', true, NULL, false)
    ) AS expected_columns(table_name, column_name, type_name, nullable, default_expr, base_column)
  LOOP
    IF to_regclass('public.' || expected.table_name) IS NULL THEN CONTINUE; END IF;
    SELECT a.atttypid, a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
      INTO actual
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=to_regclass('public.' || expected.table_name)
       AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN
      IF expected.base_column THEN
        RAISE EXCEPTION 'ediel_operations_unknown_partial_shape: %.%', expected.table_name, expected.column_name;
      END IF;
    ELSIF actual.atttypid IS DISTINCT FROM to_regtype(expected.type_name)
       OR actual.attnotnull IS DISTINCT FROM (NOT expected.nullable)
       OR replace(replace(replace(actual.default_expr, 'public.', ''), 'pg_catalog.', ''), 'extensions.', '')
          IS DISTINCT FROM expected.default_expr THEN
      RAISE EXCEPTION 'ediel_operations_unknown_partial_column: %.%', expected.table_name, expected.column_name;
    END IF;
  END LOOP;

  FOREACH rel IN ARRAY ARRAY['ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages'] LOOP
    IF to_regclass('public.' || rel) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT FROM pg_class WHERE oid=to_regclass('public.' || rel) AND relkind='r') THEN
      RAISE EXCEPTION 'ediel_operations_unknown_relation_kind: %', rel;
    END IF;
    IF NOT EXISTS (
      SELECT FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
      WHERE c.conrelid=to_regclass('public.' || rel) AND c.contype='p' AND c.conkey=ARRAY[a.attnum]
    ) THEN RAISE EXCEPTION 'ediel_operations_unknown_primary_key: %', rel; END IF;
    IF EXISTS (SELECT FROM pg_attribute WHERE attrelid=to_regclass('public.' || rel)
               AND attnum>0 AND NOT attisdropped AND attname<>ALL(CASE rel
                 WHEN 'ediel_test_run_locks' THEN ARRAY['id','company_id','actor_role','message_family','environment_type','active_test_run_id','locked_at','expires_at','released_at','metadata','created_at','updated_at']
                 WHEN 'ediel_agt_readiness' THEN ARRAY['id','company_id','actor_role','message_family','test_resource_name','test_resource_email','test_resource_confirmed','ediel_portal_login_confirmed','application_system_selected','edi_system_selected','current_approval_version','readiness_status','needs_retest','retest_reason','created_by','updated_by','created_at','updated_at','invalidated_at','invalidated_by','invalidation_source','last_checked_at','last_checked_by','blocking_issues','readiness_snapshot']
                 WHEN 'ediel_unlinked_test_messages' THEN ARRAY['id','company_id','environment_type','message_family','business_code','sender_ediel_id','receiver_ediel_id','raw_payload_ref','parsed_payload','candidate_test_run_ids','status','linked_test_run_id','linked_by','linked_at','created_at','updated_at','ediel_message_id','inbound_mail_item_id','resolution_notes']
               END)) THEN RAISE EXCEPTION 'ediel_operations_unknown_extra_column: %', rel; END IF;
    FOR obj IN SELECT c.contype, pg_get_constraintdef(c.oid) AS definition
                 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.' || rel) LOOP
      IF obj.contype='p' AND obj.definition='PRIMARY KEY (id)' THEN CONTINUE; END IF;
      IF rel='ediel_agt_readiness' AND obj.contype='u'
         AND obj.definition='UNIQUE (company_id, actor_role, message_family)' THEN CONTINUE; END IF;
      IF rel IN ('ediel_agt_readiness','ediel_test_run_locks') AND obj.contype='f'
         AND obj.definition IN ('FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE',
                                'FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE') THEN CONTINUE; END IF;
      RAISE EXCEPTION 'ediel_operations_unknown_constraint: %', rel;
    END LOOP;
    IF rel='ediel_agt_readiness' AND NOT EXISTS (
      SELECT FROM pg_constraint c WHERE c.conrelid=to_regclass('public.' || rel)
      AND c.contype='u' AND pg_get_constraintdef(c.oid)='UNIQUE (company_id, actor_role, message_family)'
    ) THEN RAISE EXCEPTION 'ediel_operations_readiness_unique_missing'; END IF;
    FOR obj IN SELECT * FROM pg_trigger
      WHERE tgrelid=to_regclass('public.' || rel) AND NOT tgisinternal LOOP
      IF rel IN ('ediel_test_run_locks','ediel_agt_readiness')
         AND obj.tgname='gridex_history_truncate_guard' AND obj.tgenabled='O' AND obj.tgtype=34
         AND obj.tgfoid=to_regprocedure('public.gridex_guard_history_truncate_v1()')
         AND obj.tgnargs=0 AND octet_length(obj.tgargs)=0 AND obj.tgattr=''::int2vector
         AND obj.tgqual IS NULL AND obj.tgconstraint=0 AND obj.tgconstrrelid=0
         AND obj.tgconstrindid=0 AND obj.tgparentid=0
         AND NOT obj.tgdeferrable AND NOT obj.tginitdeferred THEN CONTINUE; END IF;
      RAISE EXCEPTION 'ediel_operations_unknown_trigger: %', rel;
    END LOOP;
    -- Accept only original/June12 service profiles and exact August intermediate guards.
    -- September's grant-aware cleanup below removes obsolete role-specific policies.
    FOR obj IN SELECT * FROM pg_policies WHERE schemaname='public' AND tablename=rel LOOP
      IF obj.policyname=rel || '_service_role_all' AND obj.cmd='ALL'
         AND obj.permissive='PERMISSIVE' AND obj.roles=ARRAY['public']::name[]
         AND ((regexp_replace(obj.qual, '[[:space:]()]', '', 'g')='auth.role=''service_role''::text'
           AND regexp_replace(obj.with_check, '[[:space:]()]', '', 'g')='auth.role=''service_role''::text')
           -- June12's actual optimizer wraps both predicates in one scalar SELECT.
           OR (regexp_replace(obj.qual, '[[:space:]]', '', 'g')='((SELECTauth.role()ASrole)=''service_role''::text)'
           AND regexp_replace(obj.with_check, '[[:space:]]', '', 'g')='((SELECTauth.role()ASrole)=''service_role''::text)')) THEN CONTINUE; END IF;
      -- August26 rewrites only this exact restrictive SELECT guard. September's
      -- grant-aware cleanup below removes it after the target client REVOKE.
      IF obj.policyname='tenant_lifecycle_select_guard' AND obj.cmd='SELECT'
         AND obj.permissive='RESTRICTIVE' AND obj.roles=ARRAY['authenticated']::name[]
         AND obj.with_check IS NULL
         AND regexp_replace(replace(obj.qual,'public.',''), '[[:space:]]', '', 'g')=
           '((SELECTgridex_is_current_session_allowed()ASgridex_is_current_session_allowed)AND((SELECTgridex_user_is_platform_admin()ASgridex_user_is_platform_admin)OR(company_idIN(SELECTgridex_user_company_ids()ASgridex_user_company_ids))))'
      THEN CONTINUE; END IF;
      IF obj.permissive='RESTRICTIVE' AND EXISTS (
        SELECT FROM (VALUES
          ('tenant_lifecycle_select_guard','SELECT',ARRAY['authenticated']::name[],'gridex_can_read_companycompany_id',NULL),
          ('tenant_lifecycle_insert_guard','INSERT',ARRAY['authenticated']::name[],NULL,'gridex_can_write_companycompany_id'),
          ('tenant_lifecycle_update_guard','UPDATE',ARRAY['authenticated']::name[],'gridex_can_write_companycompany_id','gridex_can_write_companycompany_id'),
          ('tenant_lifecycle_delete_guard','DELETE',ARRAY['authenticated']::name[],'gridex_can_write_companycompany_id',NULL),
          ('tenant_lifecycle_anon_deny_guard','ALL',ARRAY['anon']::name[],'false','false')
        ) AS known(policy_name,command,roles,using_expr,check_expr)
        WHERE obj.policyname=known.policy_name AND obj.cmd=known.command AND obj.roles=known.roles
          AND regexp_replace(replace(obj.qual,'public.',''), '[[:space:]()]', '', 'g') IS NOT DISTINCT FROM known.using_expr
          AND regexp_replace(replace(obj.with_check,'public.',''), '[[:space:]()]', '', 'g') IS NOT DISTINCT FROM known.check_expr
      ) THEN CONTINUE; END IF;
      RAISE EXCEPTION 'ediel_operations_unknown_policy: %', rel;
    END LOOP;
  END LOOP;

  FOR obj IN SELECT c.relname, c.relkind, i.indisunique, i.indisvalid, i.indisready,
                       pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid=c.oid
    WHERE c.relnamespace='public'::regnamespace AND c.relname IN (
      'ediel_test_run_locks_one_active_agt_uidx','ediel_unlinked_test_messages_open_idx',
      'idx_fk_ediel_test_run_locks_a4a5ed47195f49b5')
  LOOP
    IF obj.relkind<>'i' OR obj.indisvalid IS DISTINCT FROM true OR (obj.relname='ediel_test_run_locks_one_active_agt_uidx' AND
       (NOT obj.indisunique OR obj.definition NOT IN (
        'CREATE UNIQUE INDEX ediel_test_run_locks_one_active_agt_uidx ON public.ediel_test_run_locks USING btree (company_id, actor_role, message_family, environment_type) WHERE (released_at IS NULL)'))) OR
       (obj.relname='ediel_unlinked_test_messages_open_idx' AND
       (obj.indisunique OR obj.definition NOT IN (
        'CREATE INDEX ediel_unlinked_test_messages_open_idx ON public.ediel_unlinked_test_messages USING btree (environment_type, message_family, status) WHERE (status = ''unlinked''::text)'))) OR
       (obj.relname='idx_fk_ediel_test_run_locks_a4a5ed47195f49b5' AND
        (obj.indisunique OR obj.indisready IS DISTINCT FROM true OR obj.definition<>
         'CREATE INDEX idx_fk_ediel_test_run_locks_a4a5ed47195f49b5 ON public.ediel_test_run_locks USING btree (company_id)')) THEN
      RAISE EXCEPTION 'ediel_operations_unknown_index: %', obj.relname;
    END IF;
  END LOOP;

create table if not exists public.ediel_test_run_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_role text not null,
  message_family text not null,
  environment_type public.ediel_environment_type not null,
  active_test_run_id uuid null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_agt_readiness (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_role text not null,
  message_family text not null,
  test_resource_name text,
  test_resource_email text,
  test_resource_confirmed boolean not null default false,
  ediel_portal_login_confirmed boolean not null default false,
  application_system_selected boolean not null default false,
  edi_system_selected boolean not null default false,
  current_approval_version text,
  readiness_status text not null default 'not_ready',
  needs_retest boolean not null default false,
  retest_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, actor_role, message_family)
);

create table if not exists public.ediel_unlinked_test_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type not null default 'agt_test',
  message_family text,
  business_code text,
  sender_ediel_id text,
  receiver_ediel_id text,
  raw_payload_ref text,
  parsed_payload jsonb not null default '{}'::jsonb,
  candidate_test_run_ids uuid[] not null default array[]::uuid[],
  status text not null default 'unlinked',
  linked_test_run_id uuid null,
  linked_by uuid null,
  linked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_locks_one_active_agt_uidx
  on public.ediel_test_run_locks(company_id, actor_role, message_family, environment_type)
  where released_at is null;

create index if not exists ediel_unlinked_test_messages_open_idx
  on public.ediel_unlinked_test_messages(environment_type, message_family, status)
  where status = 'unlinked';

  ALTER TABLE public.ediel_agt_readiness
    ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
    ADD COLUMN IF NOT EXISTS invalidated_by uuid,
    ADD COLUMN IF NOT EXISTS invalidation_source text,
    ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_checked_by uuid,
    ADD COLUMN IF NOT EXISTS blocking_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

  ALTER TABLE public.ediel_unlinked_test_messages
    ADD COLUMN IF NOT EXISTS ediel_message_id uuid,
    ADD COLUMN IF NOT EXISTS inbound_mail_item_id uuid,
    ADD COLUMN IF NOT EXISTS resolution_notes text;

  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.ediel_agt_readiness'::regclass
                 AND conname='ediel_agt_readiness_company_fkey') THEN
    ALTER TABLE public.ediel_agt_readiness ADD CONSTRAINT ediel_agt_readiness_company_fkey
      FOREIGN KEY(company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.ediel_test_run_locks'::regclass
                 AND conname='ediel_test_run_locks_company_fkey') THEN
    ALTER TABLE public.ediel_test_run_locks ADD CONSTRAINT ediel_test_run_locks_company_fkey
      FOREIGN KEY(company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  -- August13's full FK-index sweep rejects partial coverage. Readiness already
  -- has the leading company_id unique constraint; unlinked has no company FK.
  CREATE INDEX IF NOT EXISTS idx_fk_ediel_test_run_locks_a4a5ed47195f49b5
    ON public.ediel_test_run_locks USING btree (company_id);

  FOREACH rel IN ARRAY ARRAY['ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=rel AND policyname=rel || '_service_role_all') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')', rel || '_service_role_all', rel);
    END IF;
    -- Converge late-created and existing original predicates to June12's form;
    -- ALTER preserves policy identity, command, roles and permissive mode.
    EXECUTE format('ALTER POLICY %I ON public.%I USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')', rel || '_service_role_all', rel);
    -- RLS is not a GRANT. Keep server CRUD usable even without BYPASSRLS, and
    -- remove inherited public/client table privileges; never broaden policies.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', rel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', rel);
    -- Original September reclassification, after this target's client REVOKE.
    -- Preserve classified_at and every compatible custom system/unrelated row.
    UPDATE public.platform_table_classification t
    SET kind='system',
        rationale='Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
        null_company_meaning=NULL,
        classified_by='migration:platform_table_classification'
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    WHERE t.table_name=rel AND c.relname=t.table_name AND c.relkind='r'
      AND t.kind='tenant' AND t.null_company_meaning IS NULL
      AND t.rationale='Seeded from observed schema shape during the 2026-09-02 tenant isolation remediation.'
      AND t.classified_by='migration:platform_table_classification'
      AND NOT EXISTS (SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
        AND has_table_privilege(r.rolname,c.oid,'SELECT, INSERT, UPDATE, DELETE'));
    -- Source: 20260902094000. Scope the same grant-aware cleanup to these3 only;
    -- do not reinstall inert August policies or touch unrelated policy metadata.
    FOR obj IN SELECT pol.polname FROM pg_policy pol
      WHERE pol.polrelid=to_regclass('public.' || rel) AND pol.polroles<>'{0}'::oid[]
        AND NOT EXISTS (
          SELECT FROM unnest(pol.polroles) AS role_oid JOIN pg_roles r ON r.oid=role_oid
          WHERE has_table_privilege(r.rolname,pol.polrelid,'SELECT, INSERT, UPDATE, DELETE')
        ) LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',obj.polname,rel);
    END LOOP;
    INSERT INTO public.platform_table_classification(table_name,kind,rationale,classified_by)
    VALUES(rel,'system',
      'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
      'migration:platform_table_classification')
    ON CONFLICT(table_name) DO NOTHING;
    -- Source: 20261005130000's company-FK sweep. Unlinked has no such FK.
    IF rel IN ('ediel_test_run_locks','ediel_agt_readiness') AND NOT EXISTS (
      SELECT FROM pg_trigger WHERE tgrelid=to_regclass('public.' || rel)
        AND tgname='gridex_history_truncate_guard'
    ) THEN
      EXECUTE format('CREATE TRIGGER gridex_history_truncate_guard BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_guard_history_truncate_v1()',rel);
    END IF;
  END LOOP;
END
$repair$;
