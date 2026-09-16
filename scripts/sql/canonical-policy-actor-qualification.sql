-- Fixed rollback-only qualification of 52 changed authenticated policy identities.
-- Full policy composition on typed synthetic rows; real retained Auth/lifecycle
-- helpers. This is NOT business-table DML, trigger, app-graph or schema acceptance.
BEGIN;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, auth, extensions, pg_catalog;
CREATE TEMP TABLE policy_actor_targets(table_name text, cmd text, policy_name text, mode text,
  PRIMARY KEY(table_name,cmd)) ON COMMIT DROP;
INSERT INTO policy_actor_targets VALUES
  ('billing_export_run_items','d','gridex_mp_36e1514ae5982ac8511e','platform'),
  ('billing_export_run_items','a','gridex_mp_39c7692b64cbd58c10c0','tenant'),
  ('billing_export_run_items','w','gridex_mp_d59c429ea016cd6099a4','tenant'),
  ('billing_export_runs','w','gridex_mp_ba9a6e281d0113b32dfa','tenant'),
  ('billing_export_runs','a','gridex_mp_bb18366953887925861a','tenant'),
  ('billing_underlays','w','gridex_mp_98c416bf579663dbb6c6','tenant'),
  ('billing_underlays','a','gridex_mp_c3aee7598effd59bb69f','tenant'),
  ('companies','w','gridex_mp_dfed88a79cae9d173446','acl_denied'),
  ('companies','a','gridex_mp_fc55b7175c3951acf0a3','acl_denied'),
  ('company_memberships','w','gridex_mp_58a0211400ea417d71c4','acl_denied'),
  ('company_memberships','a','gridex_mp_5ad5cf7dfbb2e22fd1d8','acl_denied'),
  ('customer_contracts','a','gridex_mp_3b2ae6804c3c1f2360ec','tenant'),
  ('customer_contracts','w','gridex_mp_c489f3d162d8e49f4d42','tenant'),
  ('customer_info_requests','a','gridex_mp_036d7e0c25ac778506a7','tenant'),
  ('customer_info_requests','w','gridex_mp_aa351e5f51666345295c','tenant'),
  ('customer_sites','w','gridex_mp_94b28a477b4f3605ac8f','tenant'),
  ('customer_sites','a','gridex_mp_e41450d799fc948805ab','tenant'),
  ('customers','w','gridex_mp_9f70fde0c862614112d2','tenant'),
  ('customers','a','gridex_mp_fafefb8b50aeeb8b1d53','tenant'),
  ('domain_events','a','gridex_mp_0bcec9548195f9f05c7f','service'),
  ('domain_events','w','gridex_mp_5b9a1b5d553ceb0e8576','service'),
  ('domain_events','d','gridex_mp_b6ea5533a57e54e1457a','service'),
  ('ediel_message_events','a','gridex_mp_2b5aaae6a5f88afd1b74','tenant'),
  ('ediel_message_events','w','gridex_mp_8f81fc0a90406e7bb3ba','tenant'),
  ('ediel_messages','w','gridex_mp_7bd821a0c63bef93248d','tenant'),
  ('ediel_messages','a','gridex_mp_a2f857be40f1e68ceb6e','tenant'),
  ('integration_api_clients','a','gridex_mp_181517a66560cb3a31ec','service'),
  ('integration_api_clients','w','gridex_mp_b7f0b8763f55f22c4605','service'),
  ('integration_api_clients','d','gridex_mp_c356aa39390f794620bd','service'),
  ('integration_api_requests','d','gridex_mp_2180a19ce7c5433c21d2','service'),
  ('integration_api_requests','a','gridex_mp_4d6485d44d84437e0144','service'),
  ('integration_api_requests','w','gridex_mp_5d047929ee49ed9e46f1','service'),
  ('metering_points','a','gridex_mp_a453fc79e2169d72710a','tenant'),
  ('metering_points','w','gridex_mp_a98f13fb311cdd9153b7','tenant'),
  ('metering_values','w','gridex_mp_0f867c6e0aa1ab45af28','tenant'),
  ('metering_values','d','gridex_mp_513497b40c59479b4f38','platform'),
  ('metering_values','a','gridex_mp_7459d8d4221467a1bee7','tenant'),
  ('powers_of_attorney','a','gridex_mp_24851d20c03e49a78e72','tenant'),
  ('powers_of_attorney','w','gridex_mp_f95b28fc8e3f41deb0b5','tenant'),
  ('supplier_switch_events','d','gridex_mp_62dd0779dead0b1e10f5','platform'),
  ('supplier_switch_events','w','gridex_mp_887de2d44e7b19d8912e','tenant'),
  ('supplier_switch_events','a','gridex_mp_d5aa89e7d3c29d03e72b','tenant'),
  ('supplier_switch_requests','w','gridex_mp_779ccf817e9e70313560','tenant'),
  ('supplier_switch_requests','a','gridex_mp_c8519ae05e83e7829c74','tenant'),
  ('user_permission_overrides','a','gridex_mp_010d8bdf326d05b94c22','tenant'),
  ('user_permission_overrides','w','gridex_mp_275c56e6aea033404306','tenant'),
  ('webhook_deliveries','a','gridex_mp_a6186c6d84748c343933','service'),
  ('webhook_deliveries','w','gridex_mp_d908d1f170fafa864d90','service'),
  ('webhook_deliveries','d','gridex_mp_f5b79b50996a4f74e82f','service'),
  ('webhook_subscriptions','a','gridex_mp_9009f6634179599200f4','service'),
  ('webhook_subscriptions','w','gridex_mp_95f845fafda898240c89','service'),
  ('webhook_subscriptions','d','gridex_mp_bdd1fa8bf3345f1741d3','service');

DO $admission$
BEGIN
  IF current_user <> 'postgres' OR
     current_setting('server_version_num')::int / 10000 <> 17 OR
     (SELECT count(*) FROM policy_actor_targets) <> 52 OR
     NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls) OR
     NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') OR
     EXISTS(SELECT FROM pg_roles r WHERE r.rolname<>'service_role'
       AND NOT r.rolsuper AND NOT r.rolbypassrls
       AND pg_has_role(r.oid,(SELECT oid FROM pg_roles WHERE rolname='service_role'),'USAGE')) OR
     EXISTS(SELECT FROM policy_actor_targets x LEFT JOIN pg_class c
       ON c.oid=to_regclass('public.'||quote_ident(x.table_name))
       WHERE c.oid IS NULL OR c.relkind <> 'r' OR NOT c.relrowsecurity
          OR pg_has_role('authenticated',c.relowner,'USAGE')) OR
     EXISTS(SELECT FROM policy_actor_targets x WHERE NOT EXISTS(
       SELECT FROM pg_policy p WHERE p.polrelid=to_regclass('public.'||quote_ident(x.table_name))
         AND p.polname=x.policy_name AND p.polcmd::text=x.cmd AND p.polpermissive
         AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')])) THEN
    RAISE EXCEPTION 'POLICY_ACTOR_CATALOG_REQUIRED' USING ERRCODE='PA001';
  END IF;
END $admission$;

-- Collision is an error: these are new, locally fixed fixture identities.
INSERT INTO public.companies(id,name,slug,status,lifecycle_status)
SELECT ('ab310000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       'Policy actor fixture '||i,'policy-actor-fixture-'||i,status,status
FROM (VALUES(1,'active'),(2,'active'),(3,'onboarding'),(4,'paused'),(5,'suspended')) x(i,status);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
SELECT ('ab310100-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       'authenticated','authenticated','policy-actor-'||i||'@example.invalid',now(),'{}','{}'
FROM generate_series(1,7) i;
INSERT INTO public.user_profiles(id,email,user_status,auth_email_confirmed_at)
SELECT ('ab310100-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       'policy-actor-'||i||'@example.invalid','active',now()
FROM generate_series(1,7) i
ON CONFLICT(id) DO UPDATE SET user_status='active',auth_email_confirmed_at=excluded.auth_email_confirmed_at;
INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active)
SELECT ('ab310000-0000-4000-8000-'||lpad(company::text,12,'0'))::uuid,
       ('ab310100-0000-4000-8000-'||lpad(actor::text,12,'0'))::uuid,
       CASE WHEN actor=2 THEN 'member' ELSE 'operations' END,
       CASE WHEN actor=2 THEN 'member' ELSE 'operations' END,
       CASE WHEN actor=5 THEN 'disabled' ELSE 'active' END,actor<>5
FROM (VALUES(1),(2),(4),(5)) a(actor) CROSS JOIN (VALUES(1),(3),(4),(5)) c(company);
INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active)
VALUES('ab310000-0000-4000-8000-000000000002','ab310100-0000-4000-8000-000000000003',
       'operations','operations','active',true);
UPDATE public.user_profiles SET user_status='disabled'
WHERE id='ab310100-0000-4000-8000-000000000004';
INSERT INTO public.admin_users(user_id,role,is_active)
VALUES('ab310100-0000-4000-8000-000000000007','super_admin',true);

-- Capture every applicable retained policy, including PUBLIC and inherited roles.
-- PostgreSQL defaults WITH CHECK to USING for ALL/UPDATE policies. Permissive
-- predicates are ORed, restrictive predicates ANDed; absence of permissive denies.
CREATE TEMP TABLE policy_actor_compositions ON COMMIT DROP AS
SELECT x.*,r.role_name,
       (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=r.role_name) AS bypass,
       (has_table_privilege(r.role_name,to_regclass('public.'||quote_ident(x.table_name)),
         CASE x.cmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' ELSE 'DELETE' END)
        OR CASE WHEN x.cmd IN ('a','w') THEN
          has_any_column_privilege(r.role_name,to_regclass('public.'||quote_ident(x.table_name)),
            CASE x.cmd WHEN 'a' THEN 'INSERT' ELSE 'UPDATE' END)
          ELSE false END) AS acl,
       '('||coalesce(string_agg('('||coalesce(pg_get_expr(p.polqual,p.polrelid,true),'true')||')',' OR ' ORDER BY p.polname)
           FILTER(WHERE p.polpermissive),'false')||') AND ('||
       coalesce(string_agg('('||coalesce(pg_get_expr(p.polqual,p.polrelid,true),'true')||')',' AND ' ORDER BY p.polname)
           FILTER(WHERE NOT p.polpermissive),'true')||')' AS using_sql,
       '('||coalesce(string_agg('('||coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),pg_get_expr(p.polqual,p.polrelid,true),'true')||')',' OR ' ORDER BY p.polname)
           FILTER(WHERE p.polpermissive),'false')||') AND ('||
       coalesce(string_agg('('||coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),pg_get_expr(p.polqual,p.polrelid,true),'true')||')',' AND ' ORDER BY p.polname)
           FILTER(WHERE NOT p.polpermissive),'true')||')' AS check_sql
FROM policy_actor_targets x CROSS JOIN (VALUES('authenticated'),('service_role')) r(role_name)
LEFT JOIN pg_policy p ON p.polrelid=to_regclass('public.'||quote_ident(x.table_name))
 AND p.polcmd::text IN (x.cmd,'*')
 AND EXISTS(SELECT FROM unnest(p.polroles) role_oid WHERE CASE WHEN role_oid=0 THEN true
            ELSE pg_has_role(r.role_name,role_oid,'USAGE') END)
GROUP BY x.table_name,x.cmd,x.policy_name,x.mode,r.role_name;

DO $actors$
DECLARE
  actor integer; company integer; row_company uuid; actor_id uuid; v_role_name text;
  q record; actual boolean; actual_using boolean; actual_check boolean;
  expected boolean; eligible boolean; cases integer:=0;
  write_allowed boolean; read_allowed boolean; session_allowed boolean; platform_admin boolean;
BEGIN
  FOR actor IN 1..8 LOOP
    v_role_name:=CASE WHEN actor=8 THEN 'service_role' ELSE 'authenticated' END;
    actor_id:=CASE WHEN actor=8 THEN NULL ELSE ('ab310100-0000-4000-8000-'||lpad(actor::text,12,'0'))::uuid END;
    PERFORM set_config('request.jwt.claim.sub',coalesce(actor_id::text,''),true);
    PERFORM set_config('request.jwt.claim.role',v_role_name,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role',v_role_name)::text,true);
    FOR company IN 1..6 LOOP
      row_company:=CASE WHEN company=6 THEN NULL ELSE ('ab310000-0000-4000-8000-'||lpad(company::text,12,'0'))::uuid END;
      -- Assert real helper outputs separately, so an accidentally privileged
      -- fixture cannot manufacture a successful policy truth table.
      IF actor<>8 THEN
        EXECUTE 'SET LOCAL ROLE authenticated';
        SELECT public.gridex_can_write_company(row_company),public.gridex_can_read_company(row_company),
               public.gridex_is_current_session_allowed(),public.gridex_user_is_platform_admin()
          INTO write_allowed,read_allowed,session_allowed,platform_admin;
        EXECUTE 'RESET ROLE';
        eligible:=(actor=1 AND company IN (1,3)) OR (actor=3 AND company=2) OR (actor=7 AND company IN (1,2,3));
        IF write_allowed IS DISTINCT FROM eligible OR
           read_allowed IS DISTINCT FROM (actor=7 OR (actor IN (1,2) AND company IN (1,3,4)) OR (actor=3 AND company=2)) OR
           session_allowed IS DISTINCT FROM (actor<>4) OR platform_admin IS DISTINCT FROM (actor=7) THEN
          RAISE EXCEPTION 'POLICY_ACTOR_HELPER_MISMATCH:%:%',actor,company USING ERRCODE='PA002';
        END IF;
      END IF;
      FOR q IN SELECT * FROM policy_actor_compositions c WHERE c.role_name=v_role_name ORDER BY table_name,cmd LOOP
        expected:=actor=8 OR (q.mode='tenant' AND eligible) OR
          (q.mode='platform' AND actor=7 AND company IN (1,2,3));
        IF actor<>8 AND q.mode='acl_denied' THEN expected:=false; END IF;
        IF q.acl IS DISTINCT FROM (actor=8 OR q.mode<>'acl_denied') THEN
          RAISE EXCEPTION 'POLICY_ACTOR_ACL_MISMATCH:%:%',q.table_name,q.cmd USING ERRCODE='PA003';
        END IF;
        IF NOT q.acl THEN actual:=false;
        ELSIF actor=8 AND q.bypass THEN
          -- Actual service-role authority bypasses RLS. Missing policies after
          -- deliberate redundant-service-policy cleanup do not deny its ACL.
          actual:=true;
        ELSE
          EXECUTE format('SET LOCAL ROLE %I',v_role_name);
          EXECUTE format('SELECT (%s) IS TRUE,(%s) IS TRUE FROM jsonb_populate_record(NULL::public.%I,$1) AS policy_row',
            q.using_sql,q.check_sql,q.table_name)
            INTO actual_using,actual_check USING jsonb_build_object('company_id',row_company,'id',row_company);
          EXECUTE 'RESET ROLE';
          -- UPDATE must qualify old-row USING and new-row CHECK separately.
          -- Their conjunction alone could hide cross-company reparenting.
          IF (q.cmd IN ('w','d') AND actual_using IS DISTINCT FROM expected) OR
             (q.cmd IN ('a','w') AND actual_check IS DISTINCT FROM expected) THEN
            RAISE EXCEPTION 'POLICY_ACTOR_COMPONENT:%:%:%:%',q.table_name,q.cmd,actor,company USING ERRCODE='PA004';
          END IF;
          actual:=CASE q.cmd WHEN 'a' THEN actual_check WHEN 'd' THEN actual_using
                    ELSE actual_using AND actual_check END;
        END IF;
        IF actual IS DISTINCT FROM expected THEN
          RAISE EXCEPTION 'POLICY_ACTOR_EXPECTATION:%:%:%:%',q.table_name,q.cmd,actor,company USING ERRCODE='PA004';
        END IF;
        cases:=cases+1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF cases<>2496 THEN RAISE EXCEPTION 'POLICY_ACTOR_CASE_COUNT' USING ERRCODE='PA005'; END IF;
  PERFORM set_config('gridex.policy_actor_case_count',cases::text,true);
END $actors$;
SELECT json_build_object('scope','RETAINED_POLICY_EXPRESSIONS_REAL_AUTH_HELPERS',
 'verified',true,'policyCount',52,'actorCount',8,'companyCaseCount',6,
 'caseCount',current_setting('gridex.policy_actor_case_count')::int,
 'servicePolicyMode',(SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'bypass' ELSE 'evaluated' END
                      FROM pg_roles WHERE rolname='service_role'),
 'servicePolicyRoleGraphClosed',true,
 'serviceChangedPoliciesInert',(SELECT CASE WHEN rolsuper OR rolbypassrls THEN 76 ELSE 0 END
                               FROM pg_roles WHERE rolname='service_role'),
 'businessGraphAccepted',false,'schemaAccepted',false,'generatedTypesVerified',false);
ROLLBACK;
