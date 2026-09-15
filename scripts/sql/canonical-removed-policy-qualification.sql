-- Fixed metadata witness for 59 removed-policy source dispositions.
-- No application rows or business DML; parent owns actor and ledger receipts.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,auth,extensions,pg_catalog;
WITH targets(name) AS (VALUES
  ('audit_logs'),
  ('auth_email_events'),
  ('communication_routes'),
  ('company_customer_number_sequences'),
  ('company_invitations'),
  ('customer_addresses'),
  ('customer_authorization_documents'),
  ('customer_contacts'),
  ('customer_contract_events'),
  ('customer_documents'),
  ('customer_info_request_events'),
  ('customer_internal_notes'),
  ('customer_operation_tasks'),
  ('ediel_actor_settings'),
  ('ediel_route_profiles'),
  ('ediel_send_locks'),
  ('grid_owner_data_requests'),
  ('inbound_processing_jobs'),
  ('metering_permissions'),
  ('outbound_dispatch_events'),
  ('outbound_requests'),
  ('partner_exports'),
  ('user_roles')), functions(signature) AS (VALUES
  ('gridex_can_read_company(uuid)'),
  ('gridex_can_write_company(uuid)'),
  ('gridex_user_company_ids()'),
  ('gridex_user_is_platform_admin()'),
  ('gridex_is_current_session_allowed()'),
  ('gridex_normalize_platform_role(text)'),
  ('canonical_restore_pre_engine_live_ediel_approval(uuid,uuid,text)'),
  ('canonical_transition_ediel_production(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text)'),
  ('canonical_create_tenant_invitation(jsonb)'),
  ('canonical_accept_tenant_invitation(jsonb)'),
  ('canonical_change_tenant_user_access(jsonb)'),
  ('canonical_manage_platform_user_access(jsonb)')), rels AS (
  SELECT t.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relowner
  FROM targets t LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||quote_ident(t.name))
), policies AS (
  SELECT n.nspname,c.relname,p.polname,p.polcmd::text AS command,p.polpermissive AS permissive,
    coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') AS using_expression,
    coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') AS check_expression,
    ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
      FROM unnest(p.polroles) role_oid ORDER BY 1) AS roles
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (SELECT name FROM targets)
), principals AS (
  SELECT r.oid,r.rolname,r.rolsuper,r.rolbypassrls,r.rolcanlogin,
    pg_has_role('authenticated',r.oid,'MEMBER') AS authenticated_member,
    pg_has_role('authenticated',r.oid,'USAGE') AS authenticated_usage,
    pg_has_role(r.oid,'anon','MEMBER') AS anon_descendant,
    pg_has_role('anon',r.oid,'MEMBER') AS anon_member,
    pg_has_role(r.oid,'service_role','USAGE') AS service_usage,
    EXISTS(SELECT 1 FROM pg_roles entry
      WHERE entry.rolcanlogin AND NOT entry.rolsuper AND NOT entry.rolbypassrls
        AND entry.rolname NOT IN ('authenticated','anon','service_role','authenticator')
        AND pg_has_role(entry.oid,r.oid,'MEMBER')) AS unreviewed_login_member,
    (r.rolcanlogin OR EXISTS(SELECT 1 FROM pg_roles entry
      WHERE entry.rolcanlogin AND NOT entry.rolsuper AND NOT entry.rolbypassrls
        AND pg_has_role(entry.oid,r.oid,'MEMBER'))
      OR CASE WHEN to_regrole('authenticator') IS NULL THEN false
      ELSE pg_has_role(to_regrole('authenticator'),r.oid,'MEMBER') END) AS client_entry
  FROM pg_roles r
), authority AS (
  SELECT t.name,r.rolname,r.rolsuper,r.rolbypassrls,
    pg_has_role(r.oid,t.relowner,'MEMBER') AS owner_member,
    ARRAY(SELECT privilege FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege
      WHERE has_table_privilege(r.oid,t.oid,privilege) ORDER BY privilege) AS table_privileges,
    ARRAY(SELECT privilege FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege
      WHERE has_any_column_privilege(r.oid,t.oid,privilege) ORDER BY privilege) AS column_privileges
  FROM rels t CROSS JOIN principals r WHERE t.oid IS NOT NULL
), routines AS (
  SELECT f.signature,p.prosrc,p.prosecdef,p.provolatile::text,p.prokind::text,p.proconfig,
    l.lanname,pg_get_userbyid(p.proowner) AS owner,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END),'[]')
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS acl,
    ARRAY(SELECT r.rolname FROM principals r WHERE has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY r.rolname) AS executable_by
  FROM functions f LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||f.signature)
  LEFT JOIN pg_language l ON l.oid=p.prolang
)
SELECT jsonb_build_object(
 'scope','REMOVED_POLICY_READ_ONLY_METADATA',
 'postgres17',current_user='postgres' AND current_setting('server_version_num')::int/10000=17,
 'readOnly',current_setting('transaction_read_only')='on',
 'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY relname,polname),'[]') FROM policies p),
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'kind',relkind,'rls',relrowsecurity,
   'force',relforcerowsecurity,'owner',pg_get_userbyid(relowner)) ORDER BY name),'[]') FROM rels),
 'principals',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY rolname),'[]') FROM principals r),
 'authority',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY name,rolname),'[]') FROM authority a),
 'routines',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY signature),'[]') FROM routines p)
);
ROLLBACK;
