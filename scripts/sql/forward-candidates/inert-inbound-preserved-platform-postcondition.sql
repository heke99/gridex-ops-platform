(NOT EXISTS(SELECT 1 FROM (VALUES
            ('inbound_ediel_match_attempts','gridex_mp_3301efeef4cd0d084cdd'),
            ('inbound_ediel_match_attempts','gridex_mp_9802ed3e38447ba834ce'),
            ('inbound_ediel_match_attempts','gridex_mp_e8ea9a7093dcf8ddc6a0'),
            ('inbound_ediel_match_attempts','gridex_mp_fb247ef9f51878aee4ed'),
            ('inbound_ediel_match_attempts','tenant_lifecycle_delete_guard'),
            ('inbound_ediel_match_attempts','tenant_lifecycle_insert_guard'),
            ('inbound_ediel_match_attempts','tenant_lifecycle_select_guard'),
            ('inbound_ediel_match_attempts','tenant_lifecycle_update_guard'),
            ('inbound_ediel_parse_results','gridex_mp_47529f480871943c554b'),
            ('inbound_ediel_parse_results','gridex_mp_53c367782f747fb5b538'),
            ('inbound_ediel_parse_results','gridex_mp_5ddce368309b6e713323'),
            ('inbound_ediel_parse_results','gridex_mp_c82ecc87ed234cc4ccf6'),
            ('inbound_ediel_parse_results','tenant_lifecycle_delete_guard'),
            ('inbound_ediel_parse_results','tenant_lifecycle_insert_guard'),
            ('inbound_ediel_parse_results','tenant_lifecycle_select_guard'),
            ('inbound_ediel_parse_results','tenant_lifecycle_update_guard'),
            ('inbound_email_attachments','gridex_mp_0e54002bbe484cfdc875'),
            ('inbound_email_attachments','gridex_mp_ae96166528e4ca2afc20'),
            ('inbound_email_attachments','gridex_mp_aed40f0ee5d28cdcfb88'),
            ('inbound_email_attachments','gridex_mp_f7281fbf78fc174ca42c'),
            ('inbound_email_attachments','tenant_lifecycle_delete_guard'),
            ('inbound_email_attachments','tenant_lifecycle_insert_guard'),
            ('inbound_email_attachments','tenant_lifecycle_select_guard'),
            ('inbound_email_attachments','tenant_lifecycle_update_guard')) expected(table_name,policy_name)
          JOIN pg_policy p ON p.polrelid=to_regclass('public.'||expected.table_name) AND p.polname=expected.policy_name)
          AND (SELECT count(*)=3 AND bool_and(c.relkind='r' AND c.relrowsecurity
            AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
            AND NOT has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE')
            AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
            AND NOT has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE')
            AND has_table_privilege('service_role',c.oid,'SELECT')
            AND has_table_privilege('service_role',c.oid,'INSERT')
            AND has_table_privilege('service_role',c.oid,'UPDATE')
            AND has_table_privilege('service_role',c.oid,'DELETE')
            AND (SELECT count(*)=2 AND bool_and(p.polpermissive AND p.polroles='{0}'::oid[]
              AND p.polcmd::text=CASE WHEN p.polname=c.relname||'_platform_select' THEN 'r' ELSE '*' END
              AND pg_get_expr(p.polqual,p.polrelid,true)=CASE
                WHEN pg_function_is_visible('public.gridex_user_is_platform_admin()'::regprocedure)
                THEN 'gridex_user_is_platform_admin()' ELSE 'public.gridex_user_is_platform_admin()' END
              AND CASE WHEN p.polname=c.relname||'_platform_select' THEN p.polwithcheck IS NULL
                ELSE pg_get_expr(p.polwithcheck,p.polrelid,true)=CASE
                  WHEN pg_function_is_visible('public.gridex_user_is_platform_admin()'::regprocedure)
                  THEN 'gridex_user_is_platform_admin()' ELSE 'public.gridex_user_is_platform_admin()' END END)
            FROM pg_policy p WHERE p.polrelid=c.oid
              AND p.polname IN (c.relname||'_platform_select',c.relname||'_platform_write'))
            AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
              AND (0=ANY(p.polroles) OR 'anon'::regrole::oid=ANY(p.polroles)
                   OR 'authenticated'::regrole::oid=ANY(p.polroles))
              AND p.polname NOT IN (c.relname||'_platform_select',c.relname||'_platform_write')))
          FROM unnest(ARRAY['inbound_ediel_match_attempts','inbound_ediel_parse_results','inbound_email_attachments']) t(name)
          JOIN pg_class c ON c.oid=to_regclass('public.'||t.name)))
