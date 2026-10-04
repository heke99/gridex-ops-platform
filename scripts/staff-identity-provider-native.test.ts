import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

function sql(query: string): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('staff_native_local_only')
  execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: query, encoding: 'utf8', timeout: 10000,
  })
}

it('native staff provider purpose, replay isolation, service-only ACL and scoped permission resolution', () => {
  const a = randomUUID(), b = randomUUID(), user = randomUUID(), permission = randomUUID()
  expect(() => sql(`BEGIN;
    INSERT INTO public.companies(id,name,status) VALUES ('${a}','Synthetic staff provider A','active'),('${b}','Synthetic staff provider B','active');
    INSERT INTO public.tenant_customer_identity_providers(company_id,kind,display_name,issuer,audience,public_jwk)
    VALUES ('${a}','tenant_key','Customer','test-customer','customer-a','{"kty":"RSA","n":"public","e":"AQAB"}');
    DO $$BEGIN
      IF NOT EXISTS(SELECT FROM public.tenant_customer_identity_providers WHERE company_id='${a}' AND purpose='customer')
      THEN RAISE EXCEPTION 'legacy_customer_default_lost'; END IF;
    END$$;
    INSERT INTO public.tenant_customer_identity_providers(company_id,purpose,kind,display_name,issuer,audience,public_jwk,enforcement)
    VALUES ('${a}','staff','tenant_key','Staff','test-staff','staff-a','{"kty":"RSA","n":"public","e":"AQAB"}','enforce');
    DO $$BEGIN
      BEGIN
        INSERT INTO public.tenant_customer_identity_providers(company_id,purpose,kind,display_name,issuer,audience,public_jwk,enforcement)
        VALUES ('${a}','staff','tenant_key','Duplicate','test','staff','{"kty":"RSA","n":"public","e":"AQAB"}','enforce');
        RAISE EXCEPTION 'duplicate_staff_accepted';
      EXCEPTION WHEN unique_violation THEN NULL; END;
      BEGIN
        INSERT INTO public.tenant_customer_identity_providers(company_id,purpose,kind,display_name,issuer,audience,public_jwk,enforcement,is_active)
        VALUES ('${a}','staff','tenant_key','Report','test','staff','{"kty":"RSA","n":"public","e":"AQAB"}','report',false);
        RAISE EXCEPTION 'staff_report_accepted';
      EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN
        INSERT INTO public.tenant_customer_identity_providers(company_id,purpose,kind,display_name,issuer,audience,public_jwk,enforcement,subject_claim,is_active)
        VALUES ('${a}','staff','tenant_key','Wrong sub','test','staff','{"kty":"RSA","n":"public","e":"AQAB"}','enforce','email',false);
        RAISE EXCEPTION 'staff_non_sub_accepted';
      EXCEPTION WHEN check_violation THEN NULL; END;
    END$$;
    INSERT INTO public.tenant_staff_assertion_replays(company_id,jti,expires_at) VALUES ('${a}','shared-jti',now()+interval '15 minutes'),('${b}','shared-jti',now()+interval '15 minutes');
    INSERT INTO public.tenant_customer_assertion_replays(company_id,jti,expires_at) VALUES ('${a}','shared-jti',now()+interval '15 minutes');
    DO $$BEGIN
      BEGIN
        INSERT INTO public.tenant_staff_assertion_replays(company_id,jti,expires_at) VALUES ('${a}','shared-jti',now()+interval '15 minutes');
        RAISE EXCEPTION 'staff_replay_accepted';
      EXCEPTION WHEN unique_violation THEN NULL; END;
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tenant_staff_assertion_replays'::regclass)
        OR has_table_privilege('anon','public.tenant_staff_assertion_replays','SELECT')
        OR has_table_privilege('authenticated','public.tenant_staff_assertion_replays','INSERT')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','UPDATE')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','TRUNCATE')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','REFERENCES')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','TRIGGER')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','MAINTAIN')
        OR NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','INSERT')
        OR has_function_privilege('anon','public.gridex_staff_permission_overrides_v1(uuid,uuid)','EXECUTE')
        OR has_function_privilege('authenticated','public.gridex_staff_permission_overrides_v1(uuid,uuid)','EXECUTE')
      THEN RAISE EXCEPTION 'staff_service_boundary_invalid'; END IF;
    END$$;
    INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES ('${user}','authenticated','authenticated','${user}@example.invalid','{}','{}',now(),now(),false,false);
    INSERT INTO public.permissions(id,key,name,is_active) VALUES ('${permission}','staff-native.${permission}','Staff native permission',true);
    INSERT INTO public.user_permissions(company_id,user_id,permission_id,effect,status,is_active)
    VALUES ('${a}','${user}','${permission}','deny','active',true),('${b}','${user}','${permission}','allow','active',true);
    INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
    VALUES ('${a}','${user}','staff-native-inactive','allow','inactive',false);
    DO $$BEGIN
      IF (SELECT count(*) FROM public.gridex_staff_permission_overrides_v1('${a}','${user}')) <> 1
        OR NOT EXISTS(SELECT FROM public.gridex_staff_permission_overrides_v1('${a}','${user}') WHERE permission_key='staff-native.${permission}' AND effect='deny')
      THEN RAISE EXCEPTION 'staff_overrides_scope_invalid'; END IF;
    END$$;
    ROLLBACK;`)).not.toThrow()
})

it('native replay ACL forward migration clears inherited service ALL without changing RLS', () => {
  // The sourced replay retains checksum-verified original SQL in HOLD. Test
  // that actual forward SQL inside a rollback-only transaction after recreating
  // the observed Supabase default-ALL grants, rather than copying its commands.
  const migration = process.env.GRIDEX_STAFF_REPLAY_ACL_SQL
  if (!migration) throw new Error('staff_replay_acl_original_sql_required')
  const actualForwardSql = readFileSync(migration, 'utf8').replace(/^BEGIN;\r?$/m, '').replace(/^COMMIT;\r?$/m, '')
  expect(() => sql(`BEGIN;
    GRANT ALL ON TABLE public.tenant_staff_assertion_replays TO PUBLIC,anon,authenticated,service_role;
    DO $$BEGIN
      IF NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','UPDATE')
        OR NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','TRUNCATE')
      THEN RAISE EXCEPTION 'native_default_all_fixture_missing'; END IF;
    END$$;
    ${actualForwardSql}
    DO $$BEGIN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tenant_staff_assertion_replays'::regclass)
        OR NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','SELECT')
        OR NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','INSERT')
        OR NOT has_table_privilege('service_role','public.tenant_staff_assertion_replays','DELETE')
        OR has_table_privilege('service_role','public.tenant_staff_assertion_replays','UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_table_privilege('anon','public.tenant_staff_assertion_replays','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_table_privilege('authenticated','public.tenant_staff_assertion_replays','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      THEN RAISE EXCEPTION 'native_replay_acl_forward_did_not_close_default_grants'; END IF;
    END$$;
    ROLLBACK;`)).not.toThrow()
})
